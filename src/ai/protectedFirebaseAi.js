import { getAI, GoogleAIBackend } from 'firebase/ai'
import { app, appCheck } from '../firebase/config.js'
import { FIREBASE_AI_SECURITY_OPTIONS } from './aiSecurityConfig.js'

export function getProtectedFirebaseAi() {
  if (!app) {
    const error = new Error('Firebase is not configured yet.')
    error.code = 'ai/local-firebase-not-configured'
    throw error
  }
  if (!appCheck) {
    const error = new Error('Firebase App Check has not been initialized. Configure an App Check provider for this environment.')
    error.code = 'app-check/not-initialized'
    throw error
  }

  return getAI(app, {
    backend: new GoogleAIBackend(),
    ...FIREBASE_AI_SECURITY_OPTIONS,
  })
}
