export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
}

/**
 * Prompt 8 Element 0.1 — Firebase configuration (opt-in Shared World).
 *
 * LOCAL MODE IS SACRED:
 * Keep `firebaseConfig = null` to run Noor Al-Shaab in 100% local mode
 * (identical to Prompt 7 — zero network requests, zero Firebase initialization).
 *
 * TODO: To enable the Shared World (Auth + Firestore), replace `null` below
 * with your Firebase web app config object:
 *
 * export const firebaseConfig: FirebaseWebConfig | null = {
 *   apiKey: 'YOUR_FIREBASE_API_KEY',
 *   authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
 *   projectId: 'YOUR_PROJECT_ID',
 *   appId: '1:YOUR_SENDER_ID:web:YOUR_APP_ID',
 * };
 */
export const firebaseConfig: FirebaseWebConfig | null = null;
