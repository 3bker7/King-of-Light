import { computeProvinces } from '../game/provinces';
import type { GameState } from '../game/types';
import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import { pickSpawnCellBFS } from './worldSpawn';
import {
  computeGoldBand,
  formatWorldCellKey,
  MAX_KINGDOM_NAME_LENGTH,
  MAX_RULER_NAME_LENGTH,
  sanitizeDisplayText,
  type OnlineWorldUser,
  type WorldCellLock,
  type WorldKingdom,
  type WorldPos,
} from './worldTypes';

export const DEFAULT_KINGDOM_NAME_AR = 'مملكة نور الشعب';
export const DEFAULT_RULER_NAME_AR = 'الحاكم';

const CELL_TAKEN_ERROR = 'WORLD_CELL_TAKEN';

/**
 * Pure payload builder for worldKingdoms/{uid} (Element 1.3 & Harden 0/1).
 * Privacy by design: NEVER emits exact treasury gold — only coarse goldBand.
 * Security: sanitizes and length-caps kingdomNameAr and rulerName.
 */
export function buildWorldKingdomPayload(
  uid: string,
  state: Pick<
    GameState,
    'cubes' | 'citizens' | 'population' | 'reputation' | 'gold' | 'kingdomNameAr' | 'rulerName'
  >,
  pos: WorldPos,
  now: number,
  fallbackRulerName?: string | null
): WorldKingdom {
  const provincesCount = computeProvinces({
    cubes: state.cubes,
    citizens: state.citizens,
    population: state.population,
  }).length;

  const nameAr = sanitizeDisplayText(
    state.kingdomNameAr,
    DEFAULT_KINGDOM_NAME_AR,
    MAX_KINGDOM_NAME_LENGTH
  );
  const rulerName = sanitizeDisplayText(
    state.rulerName ?? fallbackRulerName,
    DEFAULT_RULER_NAME_AR,
    MAX_RULER_NAME_LENGTH
  );

  return {
    uid,
    nameAr,
    rulerName,
    wx: Math.trunc(pos.wx),
    wy: Math.trunc(pos.wy),
    reputation: Math.max(0, Math.min(100, Math.round(state.reputation))),
    population: Math.max(0, Math.min(100000, Math.floor(state.population))),
    provincesCount: Math.max(0, Math.min(6, provincesCount)),
    goldBand: computeGoldBand(state.gold),
    updatedAt: Math.trunc(now),
  };
}

export async function subscribeAuthState(
  callback: (user: OnlineWorldUser | null) => void
): Promise<() => void> {
  if (!isOnlineWorldEnabled()) {
    callback(null);
    return () => {};
  }
  const services = await getFirebaseServices();
  if (!services) {
    callback(null);
    return () => {};
  }
  const { onAuthStateChanged } = await import('firebase/auth');
  return onAuthStateChanged(services.auth, (fbUser) => {
    if (!fbUser) {
      callback(null);
      return;
    }
    callback({
      uid: fbUser.uid,
      email: fbUser.email ?? null,
      displayName: fbUser.displayName ?? null,
    });
  });
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<OnlineWorldUser> {
  const services = await getFirebaseServices();
  if (!services) {
    throw new Error('العالم المشترك غير مُفعّل في إعدادات Firebase');
  }
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const cred = await signInWithEmailAndPassword(
    services.auth,
    email.trim(),
    password
  );
  return {
    uid: cred.user.uid,
    email: cred.user.email ?? null,
    displayName: cred.user.displayName ?? null,
  };
}

export async function signUpWithEmail(
  email: string,
  password: string
): Promise<OnlineWorldUser> {
  const services = await getFirebaseServices();
  if (!services) {
    throw new Error('العالم المشترك غير مُفعّل في إعدادات Firebase');
  }
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  const cred = await createUserWithEmailAndPassword(
    services.auth,
    email.trim(),
    password
  );
  return {
    uid: cred.user.uid,
    email: cred.user.email ?? null,
    displayName: cred.user.displayName ?? null,
  };
}

export async function signInWithGoogle(): Promise<OnlineWorldUser> {
  const services = await getFirebaseServices();
  if (!services) {
    throw new Error('العالم المشترك غير مُفعّل في إعدادات Firebase');
  }
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(services.auth, provider);
  return {
    uid: cred.user.uid,
    email: cred.user.email ?? null,
    displayName: cred.user.displayName ?? null,
  };
}

export async function signOutWorld(): Promise<void> {
  const services = await getFirebaseServices();
  if (!services) return;
  const { signOut } = await import('firebase/auth');
  await signOut(services.auth);
}

/**
 * Element 1.2 & Harden 1:
 * Registers worldKingdoms/{uid} on first sign-in inside a Firestore transaction that
 * atomically claims worldCells/{wx}_{wy} (preventing position squatting & concurrent races).
 * If worldKingdoms/{uid} already exists, refreshes its live stats while keeping (wx, wy) immutable.
 */
export async function registerOrLoadWorldKingdom(
  user: OnlineWorldUser,
  state: GameState
): Promise<{ kingdom: WorldKingdom; isNew: boolean }> {
  const services = await getFirebaseServices();
  if (!services) {
    throw new Error('العالم المشترك غير مُفعّل');
  }

  const { collection, doc, getDoc, getDocs, runTransaction, setDoc } =
    await import('firebase/firestore');

  const kingdomRef = doc(services.db, 'worldKingdoms', user.uid);
  const existingSnap = await getDoc(kingdomRef);
  const now = Date.now();

  if (existingSnap.exists()) {
    const existing = existingSnap.data() as WorldKingdom;
    const pos: WorldPos = { wx: existing.wx, wy: existing.wy };
    const refreshed = buildWorldKingdomPayload(
      user.uid,
      state,
      pos,
      now,
      user.displayName
    );
    await setDoc(kingdomRef, refreshed, { merge: false });
    return { kingdom: refreshed, isNew: false };
  }

  // Collect currently occupied coordinates from registry + cell locks
  const extraOccupied: WorldPos[] = [];
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const occupied: WorldPos[] = [...extraOccupied];
    const [kingdomsSnap, cellsSnap] = await Promise.all([
      getDocs(collection(services.db, 'worldKingdoms')),
      getDocs(collection(services.db, 'worldCells')),
    ]);
    kingdomsSnap.forEach((d) => {
      const data = d.data() as Partial<WorldKingdom>;
      if (typeof data.wx === 'number' && typeof data.wy === 'number') {
        occupied.push({ wx: data.wx, wy: data.wy });
      }
    });
    cellsSnap.forEach((d) => {
      const data = d.data() as Partial<WorldCellLock>;
      if (typeof data.wx === 'number' && typeof data.wy === 'number') {
        occupied.push({ wx: data.wx, wy: data.wy });
      }
    });

    const candidatePos = pickSpawnCellBFS(occupied);
    const cellKey = formatWorldCellKey(candidatePos.wx, candidatePos.wy);
    const cellRef = doc(services.db, 'worldCells', cellKey);

    try {
      const registered = await runTransaction(services.db, async (tx) => {
        const [txKingdom, txCell] = await Promise.all([
          tx.get(kingdomRef),
          tx.get(cellRef),
        ]);

        // Idempotent: if already created concurrently by another tab of same uid
        if (txKingdom.exists()) {
          return txKingdom.data() as WorldKingdom;
        }

        // Anti-squatting: verify chosen cell is still free inside the transaction
        if (txCell.exists()) {
          throw new Error(CELL_TAKEN_ERROR);
        }

        const ts = Date.now();
        const lockDoc: WorldCellLock = {
          uid: user.uid,
          wx: candidatePos.wx,
          wy: candidatePos.wy,
          createdAt: ts,
        };
        const kingdomDoc = buildWorldKingdomPayload(
          user.uid,
          state,
          candidatePos,
          ts,
          user.displayName
        );

        tx.set(cellRef, lockDoc);
        tx.set(kingdomRef, kingdomDoc);
        return kingdomDoc;
      });

      return { kingdom: registered, isNew: true };
    } catch (err) {
      if (err instanceof Error && err.message === CELL_TAKEN_ERROR) {
        extraOccupied.push(candidatePos);
        continue;
      }
      throw err;
    }
  }

  throw new Error('تعذر حجز موقع متاح في العالم المشترك بعد عدة محاولات');
}

/**
 * Element 1.3:
 * Throttled registry update (called at month boundaries and profile edits).
 */
export async function updateWorldKingdomRegistry(
  uid: string,
  state: GameState,
  pos: WorldPos,
  fallbackRulerName?: string | null
): Promise<WorldKingdom | null> {
  if (!isOnlineWorldEnabled()) return null;
  const services = await getFirebaseServices();
  if (!services) return null;

  const { doc, setDoc } = await import('firebase/firestore');
  const kingdomRef = doc(services.db, 'worldKingdoms', uid);
  const payload = buildWorldKingdomPayload(
    uid,
    state,
    pos,
    Date.now(),
    fallbackRulerName
  );
  await setDoc(kingdomRef, payload, { merge: false });
  return payload;
}
