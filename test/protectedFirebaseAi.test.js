import test from 'node:test'
import assert from 'node:assert/strict'
import { FIREBASE_AI_SECURITY_OPTIONS } from '../src/ai/aiSecurityConfig.js'

test('uses limited-use App Check tokens for replay-resistant AI requests', () => {
  assert.deepEqual(FIREBASE_AI_SECURITY_OPTIONS, {
    useLimitedUseAppCheckTokens: true,
  })
})
