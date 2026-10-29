import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTaskCompletionContext, isTaskCompletionMessage, parseNamedTaskCompletionRequest, parseTaskCompletionRequest } from '../src/ai/completionIntent.js'
import { getMondayWeek } from '../src/ai/schedulingIntent.js'

test('recognizes direct requests to complete an existing task', () => {
  assert.equal(isTaskCompletionMessage('my reporting task is done, can you mark it as done now'), true)
  assert.equal(isTaskCompletionMessage('mark reporting as complete'), true)
  assert.equal(isTaskCompletionMessage('I finished reporting'), true)
  assert.equal(isTaskCompletionMessage('reporting is already done'), true)
})

test('does not confuse scheduling and cancellation with completion', () => {
  assert.equal(isTaskCompletionMessage('schedule reporting on Monday'), false)
  assert.equal(isTaskCompletionMessage('reporting was canceled'), false)
})

test('parses bulk completion for a weekday in the visible week', () => {
  const now = new Date(2026, 9, 24, 12)
  const weekDays = getMondayWeek(0, now)
  const request = parseTaskCompletionRequest('can you mark all my task on monday as done?', weekDays, now)
  assert.equal(request.isCompletion, true)
  assert.equal(request.isBulk, true)
  assert.equal(request.completed, true)
  assert.equal(request.day.key, '2026-10-19')
})

test('parses completion and reopening across multiple weekdays', () => {
  const now = new Date(2026, 9, 29, 12)
  const weekDays = getMondayWeek(0, now)
  const done = parseTaskCompletionRequest('can you make all monday and tuesday task mark as done?', weekDays, now)
  const reopened = parseTaskCompletionRequest('mark all Monday and Tuesday tasks as undone', weekDays, now)
  assert.equal(done.isCompletion, true)
  assert.equal(done.isBulk, true)
  assert.equal(done.completed, true)
  assert.deepEqual(done.days.map((day) => day.key), ['2026-10-26', '2026-10-27'])
  assert.equal(reopened.isBulk, true)
  assert.equal(reopened.completed, false)
  assert.deepEqual(reopened.days.map((day) => day.label), ['Monday', 'Tuesday'])
})

test('calculates compact relative dates for bulk completion', () => {
  const now = new Date(2026, 9, 24, 12)
  const request = parseTaskCompletionRequest('mark every task 4days fromnow complete', getMondayWeek(0, now), now)
  const tomorrow = parseTaskCompletionRequest('mark all tasks tomorrow as done', getMondayWeek(0, now), now)
  const fiveDays = parseTaskCompletionRequest('mark all tasks 5 days from now as done', getMondayWeek(0, now), now)
  assert.equal(request.isBulk, true)
  assert.equal(request.day.key, '2026-10-28')
  assert.equal(tomorrow.day.key, '2026-10-25')
  assert.equal(fiveDays.day.key, '2026-10-29')
})

test('parses exact calendar dates and bulk uncompletion', () => {
  const now = new Date(2026, 9, 24, 12)
  const namedDate = parseTaskCompletionRequest('unmark all tasks on October 24 as done', getMondayWeek(0, now), now)
  const isoDate = parseTaskCompletionRequest('mark all tasks on 2026-10-29 complete', getMondayWeek(0, now), now)
  assert.equal(namedDate.completed, false)
  assert.equal(namedDate.day.key, '2026-10-24')
  assert.equal(isoDate.day.key, '2026-10-29')
})

test('parses several named tasks for done and active updates', () => {
  const tasks = [
    { id: 'report', title: 'Reporting', completed: false },
    { id: 'site', title: 'Gawa ng bagong website', completed: true },
  ]
  const done = parseNamedTaskCompletionRequest('mark reporting and gawa ng bagong website as done', tasks)
  const reopened = parseNamedTaskCompletionRequest('unmark reporting and gawa ng bagong website as done', tasks)
  assert.deepEqual(done.tasks.map((task) => task.id), ['report', 'site'])
  assert.equal(done.completed, true)
  assert.equal(reopened.completed, false)
})

test('uses the last bulk group for plural mark and unmark follow-ups', () => {
  const now = new Date(2026, 9, 24, 12)
  const weekDays = getMondayWeek(0, now)
  const lastAction = {
    type: 'bulk-completion',
    taskIds: ['one', 'two'],
    targetTaskIds: ['one', 'two', 'three'],
    targetLabel: 'Monday',
    previousCompleted: false,
  }
  const unmark = parseTaskCompletionRequest('unmark them as done', weekDays, now)
  const contextualUnmark = applyTaskCompletionContext(unmark, 'unmark them as done', null, lastAction)
  assert.equal(contextualUnmark.isBulk, true)
  assert.equal(contextualUnmark.completed, false)
  assert.deepEqual(contextualUnmark.targetTaskIds, ['one', 'two', 'three'])
  assert.equal(contextualUnmark.targetLabel, 'Monday')
})

test('understands all-of-them clarification from the previous completion request', () => {
  const now = new Date(2026, 9, 24, 12)
  const weekDays = getMondayWeek(0, now)
  const current = parseTaskCompletionRequest('all of them in the monday', weekDays, now)
  const previous = parseTaskCompletionRequest('unmark them as done', weekDays, now)
  const resolved = applyTaskCompletionContext(current, 'all of them in the monday', previous, {
    type: 'bulk-completion',
    taskIds: ['one', 'two'],
    targetLabel: 'Monday',
  })
  assert.equal(resolved.isCompletion, true)
  assert.equal(resolved.isBulk, true)
  assert.equal(resolved.completed, false)
  assert.deepEqual(resolved.targetTaskIds, ['one', 'two'])
})
