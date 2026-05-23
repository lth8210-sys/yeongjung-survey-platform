import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredKeys = [
  ['VITE_FIREBASE_API_KEY', firebaseConfig.apiKey],
  ['VITE_FIREBASE_AUTH_DOMAIN', firebaseConfig.authDomain],
  ['VITE_FIREBASE_PROJECT_ID', firebaseConfig.projectId],
  ['VITE_FIREBASE_APP_ID', firebaseConfig.appId],
];

export const firebaseConfigIssues = requiredKeys
  .filter(([, value]) => !value || String(value).includes('your-'))
  .map(([key]) => key);

export const isFirebaseConfigured = firebaseConfigIssues.length === 0;

let firebaseApp = null;
let firebaseInitError = null;

if (isFirebaseConfigured) {
  try {
    firebaseApp = initializeApp(firebaseConfig);
  } catch (error) {
    firebaseInitError = error;
  }
}

export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
export const googleProvider = firebaseApp ? new GoogleAuthProvider() : null;
export const firebaseErrorMessage = firebaseInitError?.message ?? null;

export function getFirebaseStatusMessage() {
  if (firebaseInitError) {
    return `Firebase 초기화에 실패했습니다: ${firebaseInitError.message}`;
  }

  if (!isFirebaseConfigured) {
    return `Firebase 환경변수가 비어 있습니다: ${firebaseConfigIssues.join(', ')}`;
  }

  return '';
}
