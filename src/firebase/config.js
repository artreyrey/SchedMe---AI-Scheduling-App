import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
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
export const firebaseConfigured = missingConfigKeys.length === 0

// Keep the UI usable while local Firebase configuration is being added.
export const app = firebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_RECAPTCHA_ENTERPRISE_KEY
const localDebugHost =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
export let appCheck = null
export let appCheckSetupError = null

if (app && (appCheckSiteKey || localDebugHost) && typeof window !== 'undefined') {
  try {
    appCheck = initializeAppCheck(app, {
      // On localhost, FIREBASE_APPCHECK_DEBUG_TOKEN swaps this provider for the
      // SDK's debug provider. Production must use the site's registered key.
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey || 'local-debug-provider'),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (error) {
    appCheckSetupError = error
  }
}

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null

// Analytics is optional and is not supported in every browser environment.
export const analyticsReady =
  !app || typeof window === 'undefined'
    ? Promise.resolve(null)
    : isSupported()
        .then((supported) => (supported ? getAnalytics(app) : null))
        .catch(() => null)
