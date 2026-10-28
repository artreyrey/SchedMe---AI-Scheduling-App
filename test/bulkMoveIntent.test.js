import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBulkMoveRequest, parseConversationalBulkMoveRequest, planBulkTaskMoves } from '../src/ai/schedulingIntent.js'

test('parses chained all-task day moves with an explicit calendar date', () => {
  const now = new Date(2026, 9, 24, 9)
  const request = parseBulkMoveRequest(
    'move all my task on saturday october 24 to sunday, and all my task on sunday to monday',
    now,
  )

  assert.equal(request.isBulk, true)
  assert.deepEqual(request.invalidClauses, [])
  assert.deepEqual(
    request.moves.map(({ sourceDate, destinationDate }) => ({ sourceDate, destinationDate })),
    [
      { sourceDate: '2026-10-24', destinationDate: '2026-10-25' },
      { sourceDate: '2026-10-25', destinationDate: '2026-10-26' },
    ],
  )
})

test('does not turn a sentence without a move verb into a bulk write', () => {
  const request = parseBulkMoveRequest('show all tasks on Saturday to Sunday', new Date(2026, 9, 24, 9))
  assert.equal(request.isBulk, false)
})

test('treats a singular day-qualified task as every task scheduled on that day', () => {
  const request = parseBulkMoveRequest('move my Saturday task to Sunday', new Date(2026, 9, 24, 9))

  assert.equal(request.isBulk, true)
  assert.deepEqual(request.invalidClauses, [])
  assert.deepEqual(
    request.moves.map(({ sourceDate, destinationDate }) => ({ sourceDate, destinationDate })),
    [{ sourceDate: '2026-10-24', destinationDate: '2026-10-25' }],
  )
})

test('keeps the original day move when the user answers a task clarification with all', () => {
  const now = new Date(2026, 9, 28, 9)
  const request = parseConversationalBulkMoveRequest('all', [
    { role: 'user', text: 'move thy thursday task on wednesday' },
    { role: 'model', text: 'Which scheduled task would you like to move?' },
  ], now)

  assert.equal(request.isBulk, true)
  assert.equal(request.moves[0].sourceLabel, 'Thursday')
  assert.equal(request.moves[0].destinationLabel, 'Wednesday')
})

test('does not reinterpret an unrelated standalone all as a calendar move', () => {
  const request = parseConversationalBulkMoveRequest('all', [
    { role: 'user', text: 'Which tasks are urgent?' },
    { role: 'model', text: 'You have three urgent tasks.' },
  ], new Date(2026, 9, 28, 9))
  assert.equal(request.isBulk, false)
})

test('does not revive an old move clarification after a newer conversation', () => {
  const request = parseConversationalBulkMoveRequest('all', [
    { role: 'user', text: 'move Thursday tasks on Wednesday' },
    { role: 'model', text: 'Which scheduled task would you like to move?' },
    { role: 'user', text: 'never mind' },
    { role: 'model', text: 'Okay, I canceled that request.' },
  ], new Date(2026, 9, 28, 9))
  assert.equal(request.isBulk, false)
})

test('parses an explicit source date before task and an on destination', () => {
  const request = parseBulkMoveRequest(
    'move all october 24 task on sunday october 25',
    new Date(2026, 9, 24, 9),
  )

  assert.equal(request.isBulk, true)
  assert.deepEqual(request.invalidClauses, [])
  assert.deepEqual(
    request.moves.map(({ sourceDate, destinationDate }) => ({ sourceDate, destinationDate })),
    [{ sourceDate: '2026-10-24', destinationDate: '2026-10-25' }],
  )
})

test('parses a conversational task-first move with on before both dates', () => {
  const request = parseBulkMoveRequest(
    'can you move all my tasks on october 28 on thursday 29',
    new Date(2026, 9, 25, 9),
  )

  assert.equal(request.isBulk, true)
  assert.deepEqual(request.invalidClauses, [])
  assert.deepEqual(
    request.moves.map(({ sourceDate, destinationDate }) => ({ sourceDate, destinationDate })),
    [{ sourceDate: '2026-10-28', destinationDate: '2026-10-29' }],
  )
})

test('accepts in before the source weekday for all-of-my-task requests', () => {
  const request = parseBulkMoveRequest(
    'move all of my task in saturday to wednesday',
    new Date(2026, 9, 25, 9),
  )

  assert.equal(request.isBulk, true)
  assert.deepEqual(request.invalidClauses, [])
  assert.deepEqual(
    request.moves.map(({ sourceDate, destinationDate }) => ({ sourceDate, destinationDate })),
    [{ sourceDate: '2026-10-31', destinationDate: '2026-11-04' }],
  )
})

test('parses several date-first moves that use on destinations', () => {
  const request = parseBulkMoveRequest(
    'move October 24 tasks on October 25, October 26 tasks on October 27',
    new Date(2026, 9, 24, 9),
  )

  assert.deepEqual(
    request.moves.map(({ sourceDate, destinationDate }) => ({ sourceDate, destinationDate })),
    [
      { sourceDate: '2026-10-24', destinationDate: '2026-10-25' },
      { sourceDate: '2026-10-26', destinationDate: '2026-10-27' },
    ],
  )
})

test('parses multiple day-qualified moves without repeating the move verb', () => {
  const request = parseBulkMoveRequest(
    'move Saturday task to Sunday, Monday task to Tuesday',
    new Date(2026, 9, 24, 9),
  )

  assert.equal(request.isBulk, true)
  assert.deepEqual(request.invalidClauses, [])
  assert.deepEqual(
    request.moves.map(({ sourceDate, destinationDate }) => ({ sourceDate, destinationDate })),
    [
      { sourceDate: '2026-10-24', destinationDate: '2026-10-25' },
      { sourceDate: '2026-10-26', destinationDate: '2026-10-27' },
    ],
  )
})

test('leaves an empty source day in the result so the assistant can report it', () => {
  const request = parseBulkMoveRequest(
    'move Saturday tasks to Sunday and Tuesday tasks to Wednesday',
    new Date(2026, 9, 24, 9),
  )
  const plan = planBulkTaskMoves([
    { id: 'sat', title: 'Saturday task', date: '2026-10-24', startTime: '09:00', endTime: '10:00', completed: false },
  ], request.moves)

  assert.deepEqual(plan.counts.map(({ sourceDate, count }) => ({ sourceDate, count })), [
    { sourceDate: '2026-10-24', count: 1 },
    { sourceDate: '2026-10-27', count: 0 },
  ])
})

test('plans chained moves from the original schedule without moving a task twice', () => {
  const request = parseBulkMoveRequest(
    'move all tasks from Saturday to Sunday and all tasks from Sunday to Monday',
    new Date(2026, 9, 24, 9),
  )
  const tasks = [
    { id: 'sat', title: 'Saturday task', date: '2026-10-24', startTime: '09:00', endTime: '10:00', completed: false },
    { id: 'sun', title: 'Sunday task', date: '2026-10-25', startTime: '11:00', endTime: '12:00', completed: false },
  ]
  const plan = planBulkTaskMoves(tasks, request.moves)

  assert.deepEqual(
    plan.updates.map(({ taskId, previousDate, date }) => ({ taskId, previousDate, date })),
    [
      { taskId: 'sat', previousDate: '2026-10-24', date: '2026-10-25' },
      { taskId: 'sun', previousDate: '2026-10-25', date: '2026-10-26' },
    ],
  )
  assert.deepEqual(plan.conflicts, [])
})

test('reports a collision introduced by a bulk move before anything is saved', () => {
  const tasks = [
    { id: 'moving', title: 'Moving task', date: '2026-10-24', startTime: '09:00', endTime: '10:00', completed: false },
    { id: 'existing', title: 'Existing task', date: '2026-10-25', startTime: '09:30', endTime: '10:30', completed: false },
  ]
  const plan = planBulkTaskMoves(tasks, [{
    sourceDate: '2026-10-24',
    destinationDate: '2026-10-25',
    sourceLabel: 'Saturday',
    destinationLabel: 'Sunday',
  }])

  assert.equal(plan.updates.length, 1)
  assert.equal(plan.conflicts.length, 1)
  assert.deepEqual([plan.conflicts[0].left.id, plan.conflicts[0].right.id], ['moving', 'existing'])
})
