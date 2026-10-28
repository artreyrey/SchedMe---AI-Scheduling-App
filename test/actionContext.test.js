import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCompactActionContext, normalizeActionIntent, selectRelevantTasks } from '../src/ai/actionContext.js'

const tasks = [
  { id: 'drawing', title: 'Practice Drawing', date: '2026-10-25', startTime: '20:00', endTime: '21:00', completed: false, category: 'important' },
  { id: 'thesis', title: 'Write Thesis', completed: false, category: 'urgent' },
  { id: 'groceries', title: 'Buy Groceries', completed: false, category: 'free' },
  { id: 'meeting', title: 'Team Meeting', date: '2026-10-27', startTime: '09:00', endTime: '10:00', completed: false, category: 'notUrgent' },
]

test('selects the named task without sending the entire task list', () => {
  const selected = selectRelevantTasks('Move my practice drawing to Monday', tasks, {}, 2)
  assert.equal(selected.length, 2)
  assert.equal(selected[0].id, 'drawing')
})

test('uses the active task for contextual follow-ups such as same time', () => {
  const selected = selectRelevantTasks('Same time', tasks, { activeTaskId: 'drawing' }, 2)
  assert.equal(selected[0].id, 'drawing')
  assert.equal(selected[0].startTime, '20:00')
  assert.equal(selected[0].endTime, '21:00')
})

test('prioritizes tasks named in recent conversation for them and all follow-ups', () => {
  const context = buildCompactActionContext({
    message: 'move them to Wednesday',
    messages: [
      { role: 'model', text: 'On Thursday you have Practice Drawing, Write Thesis, and Team Meeting.' },
    ],
    tasks,
    taskLimit: 3,
  })
  assert.deepEqual(context.state.recentReferencedTaskIds, ['drawing', 'thesis', 'meeting'])
  assert.deepEqual(context.taskCandidates.map((task) => task.id).sort(), ['drawing', 'meeting', 'thesis'])
})

test('builds bounded context with recent turns, state, preferences, and candidates', () => {
  const messages = Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? 'model' : 'user', text: `turn ${index}` }))
  const context = buildCompactActionContext({
    message: 'Actually Tuesday and one hour earlier',
    messages,
    tasks,
    schedulingState: { activeTaskId: 'drawing', mode: 'move', date: '2026-11-02' },
    memory: { defaultDuration: 60, preferences: ['Prefer evening drawing sessions', 'Keep lunch free'] },
    interactionProfile: { prefersConcise: true },
    currentDate: '2026-10-28',
    timezone: 'Asia/Manila',
  })

  assert.equal(context.version, 1)
  assert.equal(context.recentTurns.length, 8)
  assert.equal(context.taskCandidates[0].id, 'drawing')
  assert.equal(context.state.activeTaskId, 'drawing')
  assert.equal(context.userSettings.prefersConcise, true)
  assert.equal(context.timezone, 'Asia/Manila')
})

test('includes only bounded, valid availability windows in the compact context', () => {
  const context = buildCompactActionContext({
    message: 'Move it where I am free',
    tasks,
    availability: [
      { date: '2026-11-02', startTime: '09:00', endTime: '17:00' },
      { date: 'not-a-date', startTime: '09:00', endTime: '17:00' },
    ],
  })
  assert.deepEqual(context.availability, [{ date: '2026-11-02', startTime: '09:00', endTime: '17:00' }])
})

test('bounds bulk action state before it is sent to Gemini', () => {
  const taskIds = Array.from({ length: 30 }, (_, index) => `task-${index}`)
  const context = buildCompactActionContext({
    message: 'Undo that',
    tasks,
    schedulingState: {
      deferredTaskIds: taskIds,
      lastAction: {
        type: 'bulk-move',
        moves: taskIds.map((taskId) => ({ taskId, previousDate: '2026-10-20', date: '2026-10-27', ignored: 'do not send' })),
      },
    },
  })
  assert.equal(context.state.deferredTaskIds.length, 12)
  assert.equal(context.state.lastAction.moves.length, 12)
  assert.equal('ignored' in context.state.lastAction.moves[0], false)
})

test('normalizes patches, preserves omitted fields, and rejects invented task IDs', () => {
  const normalized = normalizeActionIntent({
    intent: 'move_task',
    confidence: 1.4,
    scope: 'single',
    target: { taskId: 'invented', query: 'practice drawing' },
    patch: { date: '2026-11-03', timeShiftMinutes: -60, color: 'not-a-color' },
    missingFields: [],
    requiresConfirmation: false,
    destructive: false,
    preserveUnspecified: false,
  }, ['drawing'])

  assert.equal(normalized.confidence, 1)
  assert.equal(normalized.target.taskId, '')
  assert.deepEqual(normalized.invalidTargetIds, ['invented'])
  assert.deepEqual(normalized.patch, { date: '2026-11-03', timeShiftMinutes: -60 })
  assert.equal(normalized.preserveUnspecified, true)
})

test('automatically marks deletion as destructive', () => {
  const normalized = normalizeActionIntent({
    intent: 'delete_task',
    confidence: 0.9,
    scope: 'single',
    target: { taskId: 'drawing' },
    missingFields: [],
    requiresConfirmation: true,
    destructive: false,
    preserveUnspecified: true,
  }, ['drawing'])
  assert.equal(normalized.destructive, true)
  assert.equal(normalized.target.taskId, 'drawing')
})
