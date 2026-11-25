import { TOTAL_CUBES } from '../game/constants';
import { serializeGameState } from '../game/save';
import type { GameState, PersistedSaveData } from '../game/types';
import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import type { CloudKingdomSave } from './worldTypes';

export const CLOUD_SYNC_TOAST_AR = 'تمت المزامنة من السحابة';
const MAX_CLOUD_SAVE_BYTES = 900_000;

/**
 * Security Note (Prompt 8 Harden 2):
 * Cloud saves in `cloudKingdoms/{uid}` are strictly self-regarding (readable and writable
 * only by their owning uid). Save forgery affects only the player's own kingdom — accepted risk.
 * Shared ECONOMY documents (`worldBourse`, `worldPalace`, `marketListings`, `embassies`, `visas`)
 * are the protected surface and are independently transaction-validated on live Firestore state.
 */

export interface SaveFreshness {
  totalMonths: number;
  updatedAt: number;
}

/**
 * Element 2.1 & Harden 2:
 * Last-writer-wins comparator: primary key is the monthly processor's own monotonic `totalMonths`
 * counter (NEVER wall-clock); exact `totalMonths` ties break by `updatedAt`.
 * Returns > 0 if `a` is newer than `b`, < 0 if `a` is older, 0 if equal.
 */
export function compareSaveFreshness(a: SaveFreshness, b: SaveFreshness): number {
  const ma = Number.isFinite(a.totalMonths) ? Math.max(0, Math.trunc(a.totalMonths)) : 0;
  const mb = Number.isFinite(b.totalMonths) ? Math.max(0, Math.trunc(b.totalMonths)) : 0;
  if (ma !== mb) return ma - mb;
  const ta = Number.isFinite(a.updatedAt) ? Math.trunc(a.updatedAt) : 0;
  const tb = Number.isFinite(b.updatedAt) ? Math.trunc(b.updatedAt) : 0;
  return ta - tb;
}

/**
 * Element 2.1 Sign-in download rule:
 * Adopt the cloud save on sign-in ONLY when cloud.totalMonths is strictly greater
 * than the local processor's totalMonths (never driven by wall-clock).
 */
export function shouldAdoptCloudSaveOnSignIn(
  localTotalMonths: number,
  cloudTotalMonths: number
): boolean {
  const localM = Number.isFinite(localTotalMonths)
    ? Math.max(0, Math.trunc(localTotalMonths))
    : 0;
  const cloudM = Number.isFinite(cloudTotalMonths)
    ? Math.max(0, Math.trunc(cloudTotalMonths))
    : 0;
  return cloudM > localM;
}

/**
 * Validates and parses a cloud `saveJson` string into a safe `PersistedSaveData` object.
 * Strips any derived `provinces` key if present. Returns null if malformed.
 */
export function parseCloudSaveJson(saveJson: string): PersistedSaveData | null {
  if (typeof saveJson !== 'string' || saveJson.length === 0) return null;
  try {
    const parsed = JSON.parse(saveJson) as Partial<PersistedSaveData>;
    if (
      !parsed ||
      (parsed.version !== 1 && parsed.version !== 2) ||
      !Array.isArray(parsed.cubes) ||
      parsed.cubes.length !== TOTAL_CUBES ||
      !parsed.warehouse ||
      typeof parsed.gold !== 'number'
    ) {
      return null;
    }
    delete (parsed as unknown as Record<string, unknown>).provinces;
    return parsed as PersistedSaveData;
  } catch {
    return null;
  }
}

export function buildCloudSavePayload(
  state: GameState,
  now: number
): CloudKingdomSave {
  const serialized = serializeGameState(state, now);
  return {
    saveJson: JSON.stringify(serialized),
    updatedAt: Math.trunc(now),
    totalMonths: Math.max(0, Math.trunc(state.totalMonths)),
  };
}

/**
 * Fire-and-forget safe upload of the local kingdom save to `cloudKingdoms/{uid}`.
 * Uses LWW by `(totalMonths, updatedAt)` inside a transaction so a stale tab cannot
 * clobber a newer cloud backup. Failures NEVER throw out to corrupt local state.
 */
export async function uploadCloudSave(
  uid: string,
  state: GameState
): Promise<{ ok: boolean; skippedOlder?: boolean }> {
  if (!isOnlineWorldEnabled() || !uid) {
    return { ok: false };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) return { ok: false };

    const payload = buildCloudSavePayload(state, Date.now());
    if (payload.saveJson.length > MAX_CLOUD_SAVE_BYTES) {
      return { ok: false };
    }

    const { doc, runTransaction } = await import('firebase/firestore');
    const saveRef = doc(services.db, 'cloudKingdoms', uid);

    let skippedOlder = false;
    await runTransaction(services.db, async (tx) => {
      const existingSnap = await tx.get(saveRef);
      if (existingSnap.exists()) {
        const existing = existingSnap.data() as Partial<CloudKingdomSave>;
        const cmp = compareSaveFreshness(
          { totalMonths: payload.totalMonths, updatedAt: payload.updatedAt },
          {
            totalMonths: typeof existing.totalMonths === 'number' ? existing.totalMonths : 0,
            updatedAt: typeof existing.updatedAt === 'number' ? existing.updatedAt : 0,
          }
        );
        if (cmp < 0) {
          skippedOlder = true;
          return;
        }
      }
      tx.set(saveRef, payload);
    });

    return { ok: true, skippedOlder };
  } catch {
    // Harden 2: Sync is a copy, never the source. Failed uploads never roll back local state.
    return { ok: false };
  }
}

/**
 * Element 2.1: Download `cloudKingdoms/{uid}` on sign-in ONLY if cloud.totalMonths > localTotalMonths.
 * Returns the validated `PersistedSaveData` when cloud is newer, or null otherwise.
 */
export async function downloadCloudSaveIfNewer(
  uid: string,
  localTotalMonths: number
): Promise<{ save: PersistedSaveData; cloudTotalMonths: number } | null> {
  if (!isOnlineWorldEnabled() || !uid) {
    return null;
  }
  try {
    const services = await getFirebaseServices();
    if (!services) return null;

    const { doc, getDoc } = await import('firebase/firestore');
    const saveRef = doc(services.db, 'cloudKingdoms', uid);
    const snap = await getDoc(saveRef);
    if (!snap.exists()) return null;

    const data = snap.data() as Partial<CloudKingdomSave>;
    const cloudMonths =
      typeof data.totalMonths === 'number' && Number.isFinite(data.totalMonths)
        ? Math.max(0, Math.trunc(data.totalMonths))
        : 0;

    if (!shouldAdoptCloudSaveOnSignIn(localTotalMonths, cloudMonths)) {
      return null;
    }

    const parsed = parseCloudSaveJson(data.saveJson ?? '');
    if (!parsed) return null;

    return { save: parsed, cloudTotalMonths: cloudMonths };
  } catch {
    // Harden 2: Never corrupt or block local play on network failure.
    return null;
  }
}
