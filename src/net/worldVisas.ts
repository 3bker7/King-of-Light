import {
  sanitizeCitizenSnapshot,
  VISA_FEE_GOLD,
} from '../game/visas';
import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import {
  MAX_KINGDOM_NAME_LENGTH,
  sanitizeDisplayText,
  type CitizenSnapshot,
  type VisaApplication,
} from './worldTypes';

export interface GrantVisaInput {
  fromUid: string;
  fromKingdomNameAr: string;
  toUid: string;
  snapshot: CitizenSnapshot;
  month: number;
  citizenId: number;
}

export interface GrantVisaResult {
  ok: boolean;
  visaId?: string;
  errorAr?: string;
}

export interface ReceivedVisaItem {
  visaId: string;
  fromUid: string;
  fromKingdomNameAr: string;
  month: number;
  snapshot: CitizenSnapshot;
}

/**
 * Element N3.3 — Grants one visa inside ONE Firestore transaction:
 *  - Increments `worldPalace/current.gold` by +20 (VISA_FEE_GOLD)
 *  - Writes `visaApplications/{visaId}` with status 'granted' and sanitized citizenSnapshot
 *  - Deterministic idempotency key `${fromUid}_${month}_${citizenId}` prevents double-charging or duplication.
 *
 * Local mode (`firebaseConfig = null`): returns `{ ok: false }` with zero network calls.
 */
export async function grantVisaTransaction(
  input: GrantVisaInput
): Promise<GrantVisaResult> {
  if (!isOnlineWorldEnabled()) {
    return { ok: false, errorAr: 'التأشيرات متاحة فقط في العالم المشترك' };
  }
  const services = await getFirebaseServices();
  if (!services) {
    return { ok: false, errorAr: 'خدمة العالم المشترك غير مهيأة' };
  }
  if (!input.fromUid || !input.toUid || input.fromUid === input.toUid) {
    return { ok: false, errorAr: 'وجهة السفر غير صالحة' };
  }

  const sanitized = sanitizeCitizenSnapshot(input.snapshot);
  const safeMonth = Math.max(0, Math.trunc(input.month));
  const visaId = `${input.fromUid}_${safeMonth}_${Math.trunc(input.citizenId)}`;
  const safeFromName = sanitizeDisplayText(
    input.fromKingdomNameAr,
    'مملكة مجاورة',
    MAX_KINGDOM_NAME_LENGTH
  );

  const { doc, runTransaction } = await import('firebase/firestore');
  const palaceRef = doc(services.db, 'worldPalace', 'current');
  const visaRef = doc(services.db, 'visaApplications', visaId);

  try {
    const granted = await runTransaction(services.db, async (tx) => {
      const existingVisa = await tx.get(visaRef);
      if (existingVisa.exists()) {
        return false;
      }

      const palaceSnap = await tx.get(palaceRef);
      const currentGoldRaw = palaceSnap.exists()
        ? (palaceSnap.data() as Record<string, unknown>).gold
        : 0;
      const currentGold =
        typeof currentGoldRaw === 'number' && Number.isFinite(currentGoldRaw)
          ? Math.max(0, Math.floor(currentGoldRaw))
          : 0;

      const docPayload: VisaApplication = {
        id: visaId,
        fromUid: input.fromUid,
        toUid: input.toUid,
        citizenSnapshot: sanitized,
        status: 'granted',
        month: safeMonth,
        fromKingdomNameAr: safeFromName,
        updatedAt: Date.now(),
      };

      tx.set(palaceRef, { gold: currentGold + VISA_FEE_GOLD }, { merge: true });
      tx.set(visaRef, docPayload);
      return true;
    });

    if (!granted) {
      return { ok: false, errorAr: 'تم إصدار هذه التأشيرة مسبقاً' };
    }
    return { ok: true, visaId };
  } catch {
    return { ok: false, errorAr: 'تعذر إتمام معاملة التأشيرة' };
  }
}

/**
 * Element N3.4 — Receives granted visas addressed to `myUid`.
 * Each visa is transitioned `'granted' -> 'received'` atomically inside its own
 * Firestore transaction so reloads NEVER duplicate an arriving citizen.
 *
 * Local mode (`firebaseConfig = null`): returns [] immediately with zero network calls.
 */
export async function receiveGrantedVisas(
  myUid: string
): Promise<ReceivedVisaItem[]> {
  if (!isOnlineWorldEnabled() || !myUid) return [];
  const services = await getFirebaseServices();
  if (!services) return [];

  const { collection, doc, getDocs, limit, query, runTransaction, where } =
    await import('firebase/firestore');

  const q = query(
    collection(services.db, 'visaApplications'),
    where('toUid', '==', myUid),
    where('status', '==', 'granted'),
    limit(25)
  );
  const snap = await getDocs(q);
  if (snap.empty) return [];

  const received: ReceivedVisaItem[] = [];

  for (const docSnap of snap.docs) {
    const visaRef = doc(services.db, 'visaApplications', docSnap.id);
    try {
      const item = await runTransaction(services.db, async (tx) => {
        const fresh = await tx.get(visaRef);
        if (!fresh.exists()) return null;
        const data = fresh.data() as Partial<VisaApplication>;
        if (data.status !== 'granted' || data.toUid !== myUid) {
          return null;
        }
        if (!data.fromUid || data.fromUid === myUid) {
          return null;
        }

        const sanitized = sanitizeCitizenSnapshot(data.citizenSnapshot);
        tx.update(visaRef, {
          status: 'received',
          updatedAt: Date.now(),
        });

        return {
          visaId: fresh.id,
          fromUid: data.fromUid,
          fromKingdomNameAr: sanitizeDisplayText(
            data.fromKingdomNameAr,
            'مملكة مجاورة',
            MAX_KINGDOM_NAME_LENGTH
          ),
          month:
            typeof data.month === 'number' && Number.isFinite(data.month)
              ? Math.max(0, Math.trunc(data.month))
              : 0,
          snapshot: sanitized,
        } satisfies ReceivedVisaItem;
      });
      if (item) received.push(item);
    } catch {
      // Skip contested/transient doc; next poll can retry safely
    }
  }

  return received;
}
