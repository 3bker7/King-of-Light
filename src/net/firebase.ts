import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { firebaseConfig, type FirebaseWebConfig } from './firebaseConfig';

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

function hasValidFirebaseConfig(
  cfg: FirebaseWebConfig | null
): cfg is FirebaseWebConfig {
  if (!cfg) return false;
  return (
    typeof cfg.apiKey === 'string' &&
    cfg.apiKey.trim().length > 0 &&
    typeof cfg.authDomain === 'string' &&
    cfg.authDomain.trim().length > 0 &&
    typeof cfg.projectId === 'string' &&
    cfg.projectId.trim().length > 0 &&
    typeof cfg.appId === 'string' &&
    cfg.appId.trim().length > 0
  );
}

/**
 * Element 0.1 & Harden 0:
 * True ONLY when a non-null, populated Firebase config is present.
 * When false, ZERO Firebase SDK modules are loaded or initialized.
 */
export function isOnlineWorldEnabled(): boolean {
  return hasValidFirebaseConfig(firebaseConfig);
}

let servicesPromise: Promise<FirebaseServices | null> | null = null;
let cachedServices: FirebaseServices | null = null;

/**
 * Lazy-initializes Firebase App, Auth, and Firestore ONLY when firebaseConfig is non-null.
 * Dynamic imports guarantee that in local mode (firebaseConfig = null), nothing network-bound
 * is imported or executed at module load.
 */
export async function getFirebaseServices(): Promise<FirebaseServices | null> {
  if (!hasValidFirebaseConfig(firebaseConfig)) {
    return null;
  }
  if (cachedServices) {
    return cachedServices;
  }
  if (!servicesPromise) {
    servicesPromise = (async () => {
      const [{ getApps, initializeApp }, { getAuth }, { getFirestore }] =
        await Promise.all([
          import('firebase/app'),
          import('firebase/auth'),
          import('firebase/firestore'),
        ]);

      const existing = getApps();
      const app =
        existing.length > 0 ? existing[0] : initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const db = getFirestore(app);
      cachedServices = { app, auth, db };
      return cachedServices;
    })().catch((err) => {
      servicesPromise = null;
      throw err;
    });
  }
  return servicesPromise;
}

export function getCachedFirebaseServices(): FirebaseServices | null {
  return cachedServices;
}
