import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredConfigKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]

const missingConfigKeys = requiredConfigKeys.filter((key) => !firebaseConfig[key])

if (missingConfigKeys.length > 0) {
  throw new Error(
    `Missing Firebase configuration: ${missingConfigKeys.join(', ')}. Add the VITE_FIREBASE_* values to the project root .env file.`,
  )
}

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

// Analytics is optional and is not supported in every browser environment.
export const analyticsReady =
  typeof window === 'undefined'
    ? Promise.resolve(null)
    : isSupported()
        .then((supported) => (supported ? getAnalytics(app) : null))
        .catch(() => null)
