import test from 'node:test'
import assert from 'node:assert/strict'
import { getMondayWeek, parseNamedTaskMoveRequest, planNamedTaskMoves } from '../src/ai/schedulingIntent.js'

const now = new Date(2026, 9, 24, 9)
const tasks = [
  { id: 'thesis', title: 'Thesis Logics Task', date: '2026-10-22', startTime: '09:00', endTime: '10:00', completed: false },
  { id: 'website', title: 'Gawa ng bagong Website Task', date: '2026-10-23', startTime: '13:00', endTime: '14:00', completed: false },
]

test('fuzzy matches multiple named scheduled tasks and a shared destination day', () => {
  const request = parseNamedTaskMoveRequest(
    'move thesis logic task and gawa ng bagong website task on saturday',
    tasks,
    getMondayWeek(0, now),
    now,
  )

  assert.equal(request.isMultiple, true)
  assert.deepEqual(request.tasks.map((task) => task.id), ['thesis', 'website'])
  assert.deepEqual(request.unmatchedNames, [])
  assert.deepEqual(request.ambiguousNames, [])
  assert.equal(request.destination.key, '2026-10-24')
})

test('always returns a destination label with the dashboard week-day shape', () => {
  const dashboardWeek = getMondayWeek(0, now).map(({ date, key, label }) => ({
    date,
    key,
    day: label.slice(0, 3),
    number: date.getDate(),
  }))
  const request = parseNamedTaskMoveRequest(
    'move thesis logic and gawa ng bagong website on Saturday',
    tasks,
    dashboardWeek,
    now,
  )

  assert.equal(request.destination.label, 'Saturday')
})

test('tolerates spelling mistakes when the intended task remains unambiguous', () => {
  const request = parseNamedTaskMoveRequest(
    'reschedule thesiss lojic and gawa ng bagong websit to Sunday',
    tasks,
    getMondayWeek(0, now),
    now,
  )

  assert.deepEqual(request.tasks.map((task) => task.id), ['thesis', 'website'])
  assert.deepEqual(request.unmatchedNames, [])
})

test('prefers the complete fuzzy title over another task sharing only one word', () => {
  const tasksWithDistractor = [
    ...tasks,
    { id: 'distractor', title: 'Thesis logic gawa', date: '2026-10-21', startTime: '15:00', endTime: '16:00', completed: false },
  ]
  const request = parseNamedTaskMoveRequest(
    'move thesis logic task and gawa ng bagong webbsite task on saturday',
    tasksWithDistractor,
    getMondayWeek(0, now),
    now,
  )

  assert.deepEqual(request.tasks.map((task) => task.id), ['thesis', 'website'])
  assert.deepEqual(request.ambiguousNames, [])
  assert.deepEqual(request.unmatchedNames, [])
})

test('keeps unmatched names so the assistant can ask for clarification without a partial move', () => {
  const request = parseNamedTaskMoveRequest(
    'move thesis logic and unknown project to Sunday',
    tasks,
    getMondayWeek(0, now),
    now,
  )

  assert.deepEqual(request.tasks.map((task) => task.id), ['thesis'])
  assert.deepEqual(request.unmatchedNames, ['unknown project'])
})

test('plans named moves together and preserves each original time', () => {
  const plan = planNamedTaskMoves(tasks, tasks, '2026-10-25')

  assert.deepEqual(plan.updates.map(({ taskId, date, startTime, endTime }) => ({ taskId, date, startTime, endTime })), [
    { taskId: 'thesis', date: '2026-10-25', startTime: '09:00', endTime: '10:00' },
    { taskId: 'website', date: '2026-10-25', startTime: '13:00', endTime: '14:00' },
  ])
  assert.deepEqual(plan.conflicts, [])
})

test('detects conflicts between named tasks moved to the same day', () => {
  const overlapping = [
    tasks[0],
    { ...tasks[1], startTime: '09:30', endTime: '10:30' },
  ]
  const plan = planNamedTaskMoves(overlapping, overlapping, '2026-10-25')

  assert.equal(plan.conflicts.length, 1)
})
