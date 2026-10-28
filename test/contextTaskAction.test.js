import test from 'node:test'
import assert from 'node:assert/strict'
import { planContextTaskAction, shouldInterpretContextTaskAction } from '../src/ai/contextTaskAction.js'

const tasks = [
  { id: 'drawing', title: 'Practice Drawing', category: 'important', important: true, urgent: false, color: '#3b82f6', completed: false, date: '2026-11-02', startTime: '20:00', endTime: '21:00' },
  { id: 'thesis', title: 'Write Thesis', category: 'free', completed: false },
]

function action(intent, overrides = {}) {
  return {
    intent,
    confidence: 0.95,
    scope: 'single',
    target: { taskId: 'drawing', taskIds: ['drawing'], query: 'practice drawing' },
    patch: {},
    constraints: {},
    requiresConfirmation: false,
    destructive: intent === 'delete_task',
    confirmed: false,
    ...overrides,
  }
}

test('routes task mutations and pending clarifications through Gemini', () => {
  assert.equal(shouldInterpretContextTaskAction({ text: 'Make it urgent' }), true)
  assert.equal(shouldInterpretContextTaskAction({ text: 'Delete my drawing task' }), true)
  assert.equal(shouldInterpretContextTaskAction({ text: 'Cancel the drawing meeting' }), true)
  assert.equal(shouldInterpretContextTaskAction({ text: 'yes', schedulingState: { pendingAction: { intent: 'delete_task' } } }), true)
  assert.equal(shouldInterpretContextTaskAction({ text: 'hello' }), false)
})

test('plans unscheduled and scheduled task creation', () => {
  const unscheduled = planContextTaskAction({ action: action('create_task', { target: {}, patch: { title: 'Read book', category: 'important' }, destructive: false }), tasks })
  assert.equal(unscheduled.operation, 'create')
  assert.equal(unscheduled.data.category, 'important')

  const scheduled = planContextTaskAction({ action: action('create_task', {
    target: {},
    patch: { title: 'Read book', date: '2026-11-03', startTime: '18:00', endTime: '19:00' },
    destructive: false,
  }), tasks })
  assert.equal(scheduled.operation, 'create_scheduled')
})

test('keeps incomplete creation requests pending without writing partial tasks', () => {
  const result = planContextTaskAction({ action: action('create_task', { target: {}, patch: { title: 'Read book', date: '2026-11-03' }, destructive: false }), tasks })
  assert.equal(result.status, 'clarify')
  assert.equal(result.reason, 'missing_time')
})

test('plans completion, reopening, priority, color, and unscheduling', () => {
  assert.equal(planContextTaskAction({ action: action('complete_task'), tasks }).operation, 'completion')
  assert.equal(planContextTaskAction({ action: action('reopen_task'), tasks: [{ ...tasks[0], completed: true }] }).completed, false)
  assert.equal(planContextTaskAction({ action: action('change_priority', { patch: { category: 'urgentImportant' } }), tasks }).alsoPriority, true)
  assert.equal(planContextTaskAction({ action: action('change_color', { patch: { color: '#ef4444' } }), tasks }).operation, 'color')
  assert.deepEqual(planContextTaskAction({ action: action('unschedule_task'), tasks }).previousSlot, { date: '2026-11-02', startTime: '20:00', endTime: '21:00' })
})

test('requires explicit confirmation before deletion', () => {
  const confirmation = planContextTaskAction({ action: action('delete_task'), tasks })
  assert.equal(confirmation.status, 'confirm')
  const ready = planContextTaskAction({ action: action('delete_task', { confirmed: true }), tasks })
  assert.equal(ready.status, 'ready')
  assert.equal(ready.operation, 'delete')

  const bulk = action('delete_task', {
    scope: 'matching',
    target: { taskId: '', taskIds: ['drawing', 'thesis'], query: '' },
  })
  assert.equal(planContextTaskAction({ action: bulk, tasks }).status, 'confirm')
  assert.equal(planContextTaskAction({ action: { ...bulk, confirmed: true }, tasks }).operation, 'delete_many')
})

test('clarifies ambiguous task references and missing priority', () => {
  const ambiguousTasks = [tasks[0], { ...tasks[0], id: 'drawing-class', title: 'Practice Drawing Class' }]
  const ambiguous = planContextTaskAction({ action: action('complete_task', { target: { taskId: '', taskIds: [], query: 'drawing' } }), tasks: ambiguousTasks })
  assert.equal(ambiguous.reason, 'ambiguous_task')
  const missing = planContextTaskAction({ action: action('change_priority'), tasks })
  assert.equal(missing.reason, 'missing_priority')
})
