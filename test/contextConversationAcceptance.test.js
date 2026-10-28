import test from 'node:test'
import assert from 'node:assert/strict'
import { planContextAvailabilityAction } from '../src/ai/availabilityAction.js'
import { planContextSchedulingAction } from '../src/ai/contextSchedulingAction.js'
import { planContextTaskAction } from '../src/ai/contextTaskAction.js'
import { createPendingAction, mergePendingAction } from '../src/ai/pendingAction.js'
import { validateUndoSnapshots } from '../src/services/operationHistory.js'

const drawing = { id: 'drawing', title: 'Practice Drawing', date: '2026-11-01', startTime: '20:00', endTime: '21:00', completed: false, category: 'important', color: '#3366ff' }
const thesis = { id: 'thesis', title: 'Write Thesis', completed: false, category: 'urgent' }
const tasks = [drawing, thesis]

function action(intent, overrides = {}) {
  return {
    intent,
    confidence: 0.95,
    scope: 'single',
    target: { taskId: 'drawing', taskIds: ['drawing'], query: '' },
    patch: {},
    constraints: {},
    missingFields: [],
    requiresConfirmation: false,
    destructive: false,
    preserveUnspecified: true,
    invalidTargetIds: [],
    ...overrides,
  }
}

test('A: a date-only move keeps the existing time', () => {
  const plan = planContextSchedulingAction({ action: action('move_task', { patch: { date: '2026-11-02' } }), tasks })
  assert.deepEqual(plan.slot, { date: '2026-11-02', startTime: '20:00', endTime: '21:00' })
})

test('B: a same-time follow-up uses the active task context', () => {
  const plan = planContextSchedulingAction({
    action: action('move_task'),
    tasks,
    schedulingState: { activeTaskId: 'drawing', date: '2026-11-03', mode: 'move' },
  })
  assert.deepEqual(plan.slot, { date: '2026-11-03', startTime: '20:00', endTime: '21:00' })
})

test('C: a relative correction preserves duration', () => {
  const plan = planContextSchedulingAction({
    action: action('move_task', { patch: { timeShiftMinutes: -60 } }),
    tasks,
    schedulingState: { lastReferencedTaskId: 'drawing' },
  })
  assert.deepEqual(plan.slot, { date: '2026-11-01', startTime: '19:00', endTime: '20:00' })
})

test('D: undo refuses to overwrite a newer edit', () => {
  const changes = [{ taskId: 'drawing', after: { title: 'Practice Drawing', date: '2026-11-02' } }]
  assert.equal(validateUndoSnapshots(changes, new Map([['drawing', { title: 'Practice Drawing', date: '2026-11-03' }]])), false)
})

test('E: changing priority does not produce schedule or color writes', () => {
  const plan = planContextTaskAction({ action: action('change_priority', { patch: { category: 'urgent' } }), tasks })
  assert.equal(plan.operation, 'priority')
  assert.equal(plan.category, 'urgent')
  assert.equal(plan.alsoPriority, false)
  assert.equal('date' in plan, false)
  assert.equal('color' in plan, false)
})

test('F: move where I am free returns conflict-free choices', () => {
  const plan = planContextAvailabilityAction({
    action: action('find_free_time'),
    tasks,
    planningDates: ['2026-11-02'],
    availability: [{ date: '2026-11-02', startTime: '09:00', endTime: '12:00' }],
  })
  assert.equal(plan.status, 'suggest')
  assert.equal(plan.suggestions[0].date, '2026-11-02')
})

test('G: ambiguous task names ask instead of guessing', () => {
  const plan = planContextSchedulingAction({
    action: action('move_task', { target: { taskId: '', taskIds: [], query: 'drawing' }, patch: { date: '2026-11-02' } }),
    tasks: [drawing, { ...drawing, id: 'class', title: 'Practice Drawing Class' }],
  })
  assert.equal(plan.reason, 'ambiguous_task')
})

test('H: a correction merges into the pending action', () => {
  const pending = createPendingAction(action('move_task', { patch: { date: '2026-11-02' } }), { missingFields: ['startTime', 'endTime'] }, 1000)
  const merged = mergePendingAction(action('clarify', { target: { taskId: '', taskIds: [], query: '' }, patch: { startTime: '18:00', endTime: '19:00' } }), pending, 1100)
  assert.equal(merged.intent, 'move_task')
  assert.deepEqual(merged.patch, { date: '2026-11-02', startTime: '18:00', endTime: '19:00' })
})

test('I: busy-after availability becomes a reusable free-time boundary', () => {
  const plan = planContextAvailabilityAction({
    action: action('set_availability', { constraints: { beforeTime: '17:00' } }),
    text: "I'm busy after 5",
    planningDates: ['2026-11-02'],
  })
  assert.deepEqual(plan.availability, [{ date: '2026-11-02', startTime: '08:00', endTime: '17:00' }])
})

test('J: a clearly different request replaces stale pending context', () => {
  const pending = createPendingAction(action('move_task', { target: { taskId: 'drawing', taskIds: ['drawing'], query: '' } }), { missingFields: ['date'] }, 1000)
  const next = mergePendingAction(action('complete_task', { target: { taskId: 'thesis', taskIds: ['thesis'], query: '' } }), pending, 1100)
  assert.equal(next.intent, 'complete_task')
  assert.equal(next.target.taskId, 'thesis')
})
