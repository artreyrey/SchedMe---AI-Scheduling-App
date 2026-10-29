import test from 'node:test'
import assert from 'node:assert/strict'
import { formatAiAllowanceStatus, getAiAllowanceWarning, isAiAllowanceStatusRequest } from '../src/ai/allowanceStatus.js'

test('recognizes natural questions about tokens and AI allowance', () => {
  assert.equal(isAiAllowanceStatusRequest('how much token are left?'), true)
  assert.equal(isAiAllowanceStatusRequest('how many tokens do I have?'), true)
  assert.equal(isAiAllowanceStatusRequest('How many AI requests do I have remaining?'), true)
  assert.equal(isAiAllowanceStatusRequest('show my Gemini usage'), true)
  assert.equal(isAiAllowanceStatusRequest('mark the token task as done'), false)
})

test('labels the device request count as guidance alongside measured token usage', () => {
  const message = formatAiAllowanceStatus(
    { dailyUsed: 8, dailyLimit: 50, dailyRemaining: 42 },
    { totalTokens: 12345, cachedTokens: 1024 },
  )
  assert.match(message, /This device has 42 of 50 planned SchedMe AI requests left today/)
  assert.match(message, /12,345 tokens today/)
  assert.match(message, /1,024 cached tokens/)
  assert.match(message, /usage guide, not your Google quota/)
  assert.match(message, /does not provide a fixed live free-token balance/)
})

test('warns only at the 30, 20, and 10 request thresholds', () => {
  for (const remaining of [30, 20, 10]) {
    assert.match(getAiAllowanceWarning({ dailyRemaining: remaining, dailyLimit: 50 }), new RegExp(`Device usage guide: ${remaining} of 50`))
  }
  assert.equal(getAiAllowanceWarning({ dailyRemaining: 29, dailyLimit: 50 }), '')
})
