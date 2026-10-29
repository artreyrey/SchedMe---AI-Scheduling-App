import test from 'node:test'
import assert from 'node:assert/strict'
import { AI_USAGE_STORAGE_KEY, readAiUsageTelemetry, recordAiUsageMetadata, recordLocalCommandBypass } from '../src/ai/usageTelemetry.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('stores only daily aggregate Gemini token and cache-hit counts', () => {
  const storage = memoryStorage()
  recordAiUsageMetadata({ promptTokenCount: 900, candidatesTokenCount: 20, totalTokenCount: 920, cachedContentTokenCount: 0 }, storage, new Date('2026-10-29T01:00:00Z'))
  recordAiUsageMetadata({ promptTokenCount: 1100, candidatesTokenCount: 30, totalTokenCount: 1130, cachedContentTokenCount: 1024 }, storage, new Date('2026-10-29T02:00:00Z'))
  assert.deepEqual(readAiUsageTelemetry(storage), {
    date: '2026-10-29',
    requests: 2,
    localBypasses: 0,
    localBypassByKind: {},
    promptTokens: 2000,
    outputTokens: 50,
    totalTokens: 2050,
    cachedTokens: 1024,
  })
  assert.ok(storage.getItem(AI_USAGE_STORAGE_KEY))
})

test('counts local fast paths by command kind without storing command text', () => {
  const storage = memoryStorage()
  recordLocalCommandBypass('complete', storage, new Date('2026-10-29T01:00:00Z'))
  recordLocalCommandBypass('complete', storage, new Date('2026-10-29T01:01:00Z'))
  const usage = recordLocalCommandBypass('single_move', storage, new Date('2026-10-29T01:02:00Z'))
  assert.equal(usage.localBypasses, 3)
  assert.deepEqual(usage.localBypassByKind, { complete: 2, single_move: 1 })
  assert.equal(usage.requests, 0)
})

test('resets aggregates on a new UTC day and tolerates unavailable storage', () => {
  const storage = memoryStorage()
  recordAiUsageMetadata({ totalTokenCount: 20 }, storage, new Date('2026-10-29T23:59:00Z'))
  const next = recordAiUsageMetadata({ totalTokenCount: 10 }, storage, new Date('2026-10-30T00:01:00Z'))
  assert.equal(next.requests, 1)
  assert.equal(next.totalTokens, 10)
  assert.equal(recordAiUsageMetadata({}, null), null)
})
