import test from 'node:test'
import assert from 'node:assert/strict'
import { getLocalCommandRoute } from '../src/ai/localCommandRouting.js'

const task = { id: 'drawing', title: 'Practice Drawing', date: '2026-11-02', startTime: '20:00', endTime: '21:00' }

test('bypasses Gemini for deterministic completion, deletion, and grouped moves', () => {
  assert.equal(getLocalCommandRoute({ completionRequest: { isCompletion: true, completed: true } }).kind, 'complete')
  assert.equal(getLocalCommandRoute({ completionRequest: { isCompletion: true, completed: false } }).kind, 'reopen')
  assert.equal(getLocalCommandRoute({ namedDeletionRequest: { isDeletion: true } }).kind, 'delete')
  assert.equal(getLocalCommandRoute({ namedTaskMoveRequest: { isMultiple: true } }).kind, 'named_move')
  assert.equal(getLocalCommandRoute({ bulkMoveRequest: { isBulk: true } }).kind, 'bulk_move')
})

test('creates a local structured action for a clear single-task move or time change', () => {
  const moved = getLocalCommandRoute({
    text: 'move practice drawing to Tuesday',
    preliminary: { task, day: { key: '2026-11-03' }, time: null },
  })
  assert.equal(moved.bypassGemini, true)
  assert.equal(moved.action.intent, 'move_task')
  assert.deepEqual(moved.action.patch, { date: '2026-11-03' })

  const retimed = getLocalCommandRoute({
    text: 'change practice drawing to 7pm',
    preliminary: { task, day: null, time: { startTime: '19:00', endTime: '20:00' } },
  })
  assert.deepEqual(retimed.action.patch, { startTime: '19:00', endTime: '20:00' })
})

test('keeps ambiguous, relative, and pending commands on the Gemini path', () => {
  assert.equal(getLocalCommandRoute({ text: 'move drawing an hour earlier', preliminary: { task } }).bypassGemini, false)
  assert.equal(getLocalCommandRoute({ text: 'move it when I am free', preliminary: { task, day: { key: '2026-11-03' } } }).bypassGemini, false)
  assert.equal(getLocalCommandRoute({ text: 'move drawing to Tuesday and make it urgent', preliminary: { task, day: { key: '2026-11-03' } } }).bypassGemini, false)
  assert.equal(getLocalCommandRoute({ completionRequest: { isCompletion: true }, pendingAction: { intent: 'move_task' } }).bypassGemini, false)
})
