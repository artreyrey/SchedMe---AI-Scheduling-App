import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedPendingAction, createPendingAction, mergePendingAction, normalizePendingAction } from '../src/ai/pendingAction.js'

const action = {
  intent: 'change_priority',
  scope: 'single',
  target: { taskId: 'drawing', taskIds: ['drawing'], query: 'drawing' },
  patch: {},
  constraints: {},
  destructive: false,
}

test('creates bounded pending actions that expire after thirty minutes', () => {
  const pending = createPendingAction(action, { reason: 'missing_priority', missingFields: ['category'] }, 1_000)
  assert.equal(pending.expiresAt, 1_801_000)
  assert.equal(normalizePendingAction(pending, 1_800_999).intent, 'change_priority')
  assert.equal(normalizePendingAction(pending, 1_801_000), null)
})

test('merges a clarification reply into the saved action', () => {
  const pending = createPendingAction(action, { missingFields: ['category'] }, 1_000)
  const merged = mergePendingAction({
    intent: 'clarify',
    scope: 'single',
    target: { taskId: '', taskIds: [], query: '' },
    patch: { category: 'urgent' },
    constraints: {},
    destructive: false,
  }, pending, 2_000)
  assert.equal(merged.intent, 'change_priority')
  assert.equal(merged.target.taskId, 'drawing')
  assert.equal(merged.patch.category, 'urgent')
})

test('keeps a pending creation when a time reply is classified as scheduling', () => {
  const pending = createPendingAction({
    ...action,
    intent: 'create_task',
    target: { taskId: '', taskIds: [], query: '' },
    patch: { title: 'Read book', date: '2026-11-03' },
  }, { missingFields: ['startTime', 'endTime'] }, 1_000)
  const merged = mergePendingAction({
    ...action,
    intent: 'schedule_task',
    target: { taskId: '', taskIds: [], query: '' },
    patch: { startTime: '18:00', endTime: '19:00' },
  }, pending, 2_000)
  assert.equal(merged.intent, 'create_task')
  assert.deepEqual(merged.patch, { title: 'Read book', date: '2026-11-03', startTime: '18:00', endTime: '19:00' })
})

test('allows a clearly different task request to replace a pending action', () => {
  const pending = createPendingAction(action, { missingFields: ['category'] }, 1_000)
  const merged = mergePendingAction({
    ...action,
    intent: 'complete_task',
    target: { taskId: 'thesis', taskIds: ['thesis'], query: 'thesis' },
  }, pending, 2_000)
  assert.equal(merged.intent, 'complete_task')
  assert.equal(merged.target.taskId, 'thesis')
})

test('turns a saved destructive action into an explicit confirmed action', () => {
  const pending = createPendingAction({ ...action, intent: 'delete_task', destructive: true }, { awaitingConfirmation: true }, 1_000)
  const confirmed = confirmedPendingAction(pending, 2_000)
  assert.equal(confirmed.intent, 'delete_task')
  assert.equal(confirmed.confirmed, true)
  assert.equal(confirmed.requiresConfirmation, false)
})
