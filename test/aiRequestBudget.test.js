import test from 'node:test'
import assert from 'node:assert/strict'
import { clearAiRequestBudgetForTests, consumeAiRequestBudget } from '../src/services/aiRequestBudget.js'

test('enforces per-minute AI request limits', () => {
  const uid = 'minute-user'
  clearAiRequestBudgetForTests(uid)
  consumeAiRequestBudget(uid, 100_000, { minuteLimit: 2, dailyLimit: 10 })
  consumeAiRequestBudget(uid, 100_001, { minuteLimit: 2, dailyLimit: 10 })
  assert.throws(() => consumeAiRequestBudget(uid, 100_002, { minuteLimit: 2, dailyLimit: 10 }), { code: 'ai/local-minute-limit' })
})

test('enforces daily limits and allows a new local day', () => {
  const uid = 'daily-user'
  clearAiRequestBudgetForTests(uid)
  const start = new Date(2026, 9, 28, 8).getTime()
  consumeAiRequestBudget(uid, start, { minuteLimit: 10, dailyLimit: 2 })
  consumeAiRequestBudget(uid, start + 61_000, { minuteLimit: 10, dailyLimit: 2 })
  assert.throws(() => consumeAiRequestBudget(uid, start + 122_000, { minuteLimit: 10, dailyLimit: 2 }), { code: 'ai/local-daily-limit' })
  const nextDay = new Date(2026, 9, 29, 8).getTime()
  assert.equal(consumeAiRequestBudget(uid, nextDay, { minuteLimit: 10, dailyLimit: 2 }).dailyUsed, 1)
})
