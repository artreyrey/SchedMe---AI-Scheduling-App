import test from 'node:test'
import assert from 'node:assert/strict'
import { getTrustedRecentSlot, planContextSchedulingAction, shouldInterpretContextScheduling } from '../src/ai/contextSchedulingAction.js'

const drawing = { id: 'drawing', title: 'Practice Drawing', date: '2026-11-01', startTime: '20:00', endTime: '21:00', completed: false }
const tasks = [drawing, { id: 'thesis', title: 'Write Thesis', completed: false }]

function action(overrides = {}) {
  return {
    intent: 'move_task',
    confidence: 0.95,
    scope: 'single',
    target: { taskId: 'drawing', taskIds: ['drawing'], query: 'practice drawing' },
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

test('routes natural moves and contextual corrections to the interpreter', () => {
  assert.equal(shouldInterpretContextScheduling({ text: 'Move drawing to Monday' }), true)
  assert.equal(shouldInterpretContextScheduling({ text: 'Same time', schedulingState: { activeTaskId: 'drawing', mode: 'move' } }), true)
  assert.equal(shouldInterpretContextScheduling({ text: 'Actually Tuesday and an hour earlier', schedulingState: { lastAction: { taskId: 'drawing' } } }), true)
  assert.equal(shouldInterpretContextScheduling({
    text: 'Actually Tuesday and an hour earlier',
    schedulingState: { pendingConflict: { incomingTaskId: 'drawing', displacedTaskId: 'meeting' } },
    preliminary: { day: { key: '2026-11-03' } },
  }), true)
  assert.equal(shouldInterpretContextScheduling({
    text: 'Keep the existing task and choose another time',
    schedulingState: { pendingConflict: { incomingTaskId: 'drawing', displacedTaskId: 'meeting' } },
  }), false)
  assert.equal(shouldInterpretContextScheduling({ text: 'undo', schedulingState: { activeTaskId: 'drawing', mode: 'move' } }), false)
  assert.equal(shouldInterpretContextScheduling({ text: 'hello' }), false)
})

test('moves only the date while preserving the stored time and duration', () => {
  const result = planContextSchedulingAction({
    action: action({ patch: { date: '2026-11-02' } }),
    text: 'Move my practice drawing to Monday',
    tasks,
    preliminary: { day: { key: '2026-11-02', label: 'Monday' } },
  })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.slot, { date: '2026-11-02', startTime: '20:00', endTime: '21:00' })
})

test('resolves same time from the stored task during a pending move', () => {
  const result = planContextSchedulingAction({
    action: action({ patch: {} }),
    text: 'Same time',
    tasks,
    schedulingState: { activeTaskId: 'drawing', mode: 'move', date: '2026-11-03' },
    preliminary: { task: drawing },
  })
  assert.deepEqual(result.slot, { date: '2026-11-03', startTime: '20:00', endTime: '21:00' })
})

test('applies a relative time correction while retaining duration', () => {
  const result = planContextSchedulingAction({
    action: action({ patch: { date: '2026-11-03', timeShiftMinutes: -60 } }),
    text: 'Actually Tuesday and an hour earlier',
    tasks,
    schedulingState: { activeTaskId: 'drawing', mode: 'move', date: '2026-11-02' },
    preliminary: { task: drawing, day: { key: '2026-11-03', label: 'Tuesday' } },
  })
  assert.deepEqual(result.slot, { date: '2026-11-03', startTime: '19:00', endTime: '20:00' })
})

test('corrects the last committed slot even when the task snapshot is stale', () => {
  const result = planContextSchedulingAction({
    action: action({ patch: { date: '2026-11-03', timeShiftMinutes: -60 } }),
    text: 'Actually Tuesday and an hour earlier',
    tasks,
    schedulingState: {
      lastAction: {
        taskId: 'drawing',
        previousSlot: { date: '2026-11-01', startTime: '20:00', endTime: '21:00' },
        slot: { date: '2026-11-02', startTime: '20:00', endTime: '21:00' },
      },
    },
    preliminary: { day: { key: '2026-11-03', label: 'Tuesday' } },
  })
  assert.deepEqual(result.slot, { date: '2026-11-03', startTime: '19:00', endTime: '20:00' })
})

test('does not reuse stale conversational state after a separate calendar edit', () => {
  const manuallyEdited = { ...drawing, date: '2026-11-05', startTime: '10:00', endTime: '11:00' }
  const state = {
    lastAction: {
      taskId: 'drawing',
      previousSlot: { date: '2026-11-01', startTime: '20:00', endTime: '21:00' },
      slot: { date: '2026-11-02', startTime: '20:00', endTime: '21:00' },
    },
  }
  assert.equal(getTrustedRecentSlot(state, manuallyEdited), null)
})

test('uses the original duration when the user supplies only a new start time', () => {
  const result = planContextSchedulingAction({
    action: action({ patch: { startTime: '18:00' } }),
    text: 'Move it to 6 PM',
    tasks,
    schedulingState: { activeTaskId: 'drawing', mode: 'move' },
    preliminary: { task: drawing, time: { startTime: '18:00', endTime: '19:00', usedDefaultDuration: true } },
  })
  assert.deepEqual(result.slot, { date: '2026-11-01', startTime: '18:00', endTime: '19:00' })
})

test('asks for disambiguation when multiple task names match', () => {
  const duplicateTasks = [
    drawing,
    { id: 'drawing-class', title: 'Practice Drawing Class', date: '2026-11-01', startTime: '17:00', endTime: '18:00', completed: false },
  ]
  const result = planContextSchedulingAction({
    action: action({ target: { taskId: '', taskIds: [], query: 'drawing' }, patch: { date: '2026-11-02' } }),
    text: 'Move drawing to Monday',
    tasks: duplicateTasks,
    preliminary: { day: { key: '2026-11-02', label: 'Monday' } },
  })
  assert.equal(result.status, 'clarify')
  assert.equal(result.reason, 'ambiguous_task')
  assert.equal(result.matches.length, 2)
})

test('does not activate unsupported, bulk, destructive, or confirm-required actions', () => {
  assert.equal(planContextSchedulingAction({ action: action({ intent: 'delete_task' }), tasks }).status, 'unsupported')
  assert.equal(planContextSchedulingAction({ action: action({ scope: 'all', target: { taskId: '', taskIds: [], query: '' } }), tasks }).status, 'clarify')
  assert.equal(planContextSchedulingAction({ action: action({ requiresConfirmation: true }), tasks }).status, 'unsupported')
})

test('moves a recently discussed group while preserving every original time', () => {
  const groupedTasks = [
    drawing,
    { id: 'meeting', title: 'Team Meeting', date: '2026-11-01', startTime: '17:00', endTime: '18:00', completed: false },
  ]
  const result = planContextSchedulingAction({
    action: action({
      scope: 'matching',
      target: { taskId: 'drawing', taskIds: ['drawing', 'meeting'], query: 'them' },
      patch: { date: '2026-11-04' },
    }),
    text: 'Move them to Wednesday',
    tasks: groupedTasks,
  })
  assert.equal(result.status, 'ready_many')
  assert.deepEqual(result.updates.map(({ taskId, date, startTime, endTime }) => ({ taskId, date, startTime, endTime })), [
    { taskId: 'drawing', date: '2026-11-04', startTime: '20:00', endTime: '21:00' },
    { taskId: 'meeting', date: '2026-11-04', startTime: '17:00', endTime: '18:00' },
  ])
})
