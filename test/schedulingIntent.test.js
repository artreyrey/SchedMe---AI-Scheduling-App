import test from 'node:test'
import assert from 'node:assert/strict'
import { findScheduleConflict, findTaskMatch, formatTimeRange, getMondayWeek, getSchedulingQueue, parseDay, parseDirectScheduleRequest, parseSchedulingInput, parseTimeWindow, suggestAvailableSlots } from '../src/ai/schedulingIntent.js'
import { validatePlanningResponse } from '../src/ai/planValidation.js'

const tasks = [
  { id: 'grocery', title: 'Buy grocery', category: 'free', completed: false, createdAt: { toMillis: () => 1 } },
  { id: 'thesis', title: 'Make thesis', category: 'free', completed: false, createdAt: { toMillis: () => 2 } },
  { id: 'workout', title: 'Workout', category: 'urgent', urgent: true, completed: false, createdAt: { toMillis: () => 3 } },
]

test('parses compact task/day/time formats and task names without spaces', () => {
  const week = getMondayWeek()
  const parsed = parseSchedulingInput('makethesis/M/2:00-3:00 PM', tasks, week)
  assert.equal(parsed.task.id, 'thesis')
  assert.equal(parsed.day.label, 'Monday')
  assert.deepEqual({ startTime: parsed.time.startTime, endTime: parsed.time.endTime }, { startTime: '14:00', endTime: '15:00' })
})

test('accepts hyphen, space, and period day/time separators', () => {
  const week = getMondayWeek()
  for (const input of ['Monday-2-3pm', 'Monday 2-3pm', 'Monday.2-3pm']) {
    const parsed = parseSchedulingInput(input, tasks, week, 'thesis')
    assert.equal(parsed.day.label, 'Monday')
    assert.equal(parsed.time.startTime, '14:00')
    assert.equal(parsed.time.endTime, '15:00')
  }
})

test('a complete named schedule request overrides an unrelated active task', () => {
  const week = getMondayWeek()
  const parsed = parseDirectScheduleRequest('can we schedule dinner tomorrow on 8:00pm - 9:00pm', tasks, week)
  assert.equal(parsed.isDirect, true)
  assert.equal(parsed.isComplete, true)
  assert.equal(parsed.title, 'dinner')
  assert.equal(parsed.task, null)
  assert.equal(parsed.day.token, 'tomorrow')
  assert.deepEqual(
    { startTime: parsed.time.startTime, endTime: parsed.time.endTime },
    { startTime: '20:00', endTime: '21:00' },
  )
})

test('a direct schedule request finds an existing named task', () => {
  const parsed = parseDirectScheduleRequest('schedule workout on Friday at 6pm', tasks, getMondayWeek())
  assert.equal(parsed.title, 'workout')
  assert.equal(parsed.task.id, 'workout')
  assert.equal(parsed.time.startTime, '18:00')
  assert.equal(parsed.time.endTime, '19:00')
})

test('understands a weekday followed by conversational punctuation', () => {
  assert.equal(parseDay('Can you add it on Tuesday?', getMondayWeek()).label, 'Tuesday')
})

test('uses a default duration for a single time and clarifies ambiguous days', () => {
  assert.deepEqual(parseTimeWindow('6 PM', 60), { startTime: '18:00', endTime: '19:00', matchedText: '6 pm', usedDefaultDuration: true })
  assert.deepEqual(parseDay('T-2-3pm', getMondayWeek()).ambiguous, ['Tuesday', 'Thursday'])
})

test('formats stored 24-hour calendar ranges as compact 12-hour labels', () => {
  assert.equal(formatTimeRange('12:00', '14:00'), '12:00–2:00 PM')
  assert.equal(formatTimeRange('09:00', '10:00'), '9:00–10:00 AM')
  assert.equal(formatTimeRange('11:30', '13:15'), '11:30 AM–1:15 PM')
})

test('orders inbox tasks oldest first before urgent tasks', () => {
  assert.deepEqual(getSchedulingQueue(tasks).map((task) => task.id), ['grocery', 'thesis', 'workout'])
})

test('detects schedule conflicts', () => {
  const scheduled = [{ id: 'thesis', date: '2026-10-19', startTime: '13:00', endTime: '14:00', completed: false }]
  assert.equal(findScheduleConflict(scheduled, 'workout', { date: '2026-10-19', startTime: '13:30', endTime: '14:30' }).id, 'thesis')
  assert.deepEqual(suggestAvailableSlots(scheduled, 'workout', { date: '2026-10-19', startTime: '13:00', endTime: '14:00' })[0], { date: '2026-10-19', startTime: '12:00', endTime: '13:00' })
})

test('can match a completed task when a completion command needs idempotent feedback', () => {
  const tasks = [{ id: 'reporting', title: 'Reporting', completed: true }]
  assert.equal(findTaskMatch('reporting is already done', tasks).task, null)
  assert.equal(findTaskMatch('reporting is already done', tasks, { includeCompleted: true }).task.id, 'reporting')
})

test('scheduling cannot overwrite an existing task priority', () => {
  const importantTask = [{ id: 'thesis', category: 'important', urgent: false, important: true, completed: false }]
  const plan = validatePlanningResponse({
    scheduleProposal: [{ taskId: 'thesis', date: '2026-10-19', startTime: '13:00', endTime: '14:00', urgent: false, important: false }],
  }, importantTask, ['2026-10-19'], [])
  assert.equal(plan.scheduleProposal[0].important, true)
})
