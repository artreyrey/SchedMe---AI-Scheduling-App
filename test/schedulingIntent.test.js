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

test('parses a scheduled task even when priority and color instructions follow it', () => {
  const now = new Date(2026, 9, 23, 12, 0)
  const parsed = parseDirectScheduleRequest(
    'can you schedule Drawing time task today at 3-4pm make it important and put a blue color on it',
    tasks,
    getMondayWeek(0, now),
    60,
    now,
  )

  assert.equal(parsed.isComplete, true)
  assert.equal(parsed.title, 'Drawing time')
  assert.equal(parsed.day.key, '2026-10-23')
  assert.deepEqual(
    { startTime: parsed.time.startTime, endTime: parsed.time.endTime },
    { startTime: '15:00', endTime: '16:00' },
  )
})

test('does not treat a color instruction inside an add-task command as a second schedule request', () => {
  const now = new Date(2026, 9, 23, 12, 0)
  const parsed = parseDirectScheduleRequest(
    'can you add a thesis task today at 6-7pm make it important and put red color on it',
    tasks,
    getMondayWeek(0, now),
    60,
    now,
  )

  assert.equal(parsed.isDirect, false)
  assert.equal(parsed.title, '')
  assert.equal(parsed.day.key, '2026-10-23')
  assert.deepEqual(
    { startTime: parsed.time.startTime, endTime: parsed.time.endTime },
    { startTime: '18:00', endTime: '19:00' },
  )
})

test('a direct schedule request finds an existing named task', () => {
  const parsed = parseDirectScheduleRequest('schedule workout on Friday at 6pm', tasks, getMondayWeek())
  assert.equal(parsed.title, 'workout')
  assert.equal(parsed.task.id, 'workout')
  assert.equal(parsed.time.startTime, '18:00')
  assert.equal(parsed.time.endTime, '19:00')
})

test('voice-like commands tolerate small task transcription errors', () => {
  const now = new Date(2026, 9, 21, 9, 0)
  const weekDays = getMondayWeek(0, now)
  const tasks = [{ id: 'basketball', title: 'playing basketball', completed: false, date: '' }]
  const result = parseDirectScheduleRequest('Schedule plasying baketball tommorow from 11-12pm', tasks, weekDays, 60, now)
  assert.equal(result.task?.id, 'basketball')
  assert.equal(result.day?.key, '2026-10-22')
  assert.deepEqual(result.time, { startTime: '11:00', endTime: '12:00', matchedText: '11-12pm' })
})

test('understands a weekday followed by conversational punctuation', () => {
  assert.equal(parseDay('Can you add it on Tuesday?', getMondayWeek()).label, 'Tuesday')
})

test('understands common weekday misspellings', () => {
  const week = getMondayWeek()
  assert.equal(parseDay('on wenesday at 8pm', week).label, 'Wednesday')
  assert.equal(parseDay('next teusday', week).label, 'Tuesday')
  assert.equal(parseDay('this thrusday', week).label, 'Thursday')
  const parsed = parseSchedulingInput('can you add work out as a task on wenesday 8-9pm?', tasks, week, 'thesis')
  assert.equal(parsed.day.label, 'Wednesday')
  assert.deepEqual({ startTime: parsed.time.startTime, endTime: parsed.time.endTime }, { startTime: '20:00', endTime: '21:00' })
})

test('understands relative dates and common typing mistakes', () => {
  const now = new Date(2026, 9, 20, 12)
  const week = getMondayWeek(0, now)
  assert.equal(parseDay('Tommorow morning', week, now).key, '2026-10-21')
  assert.equal(parseDay('2 days from now', week, now).key, '2026-10-22')
  assert.equal(parseDay('7 days frm now', week, now).key, '2026-10-27')
  assert.equal(parseDay('two weeks from now', week, now).key, '2026-11-03')
  assert.equal(parseDay('3 months from now', week, now).key, '2027-01-20')
})

test('clamps relative months to the last valid calendar day', () => {
  const now = new Date(2027, 0, 31, 12)
  assert.equal(parseDay('a month from now', getMondayWeek(0, now), now).key, '2027-02-28')
})

test('extracts a task before a relative date in a direct schedule command', () => {
  const now = new Date(2026, 9, 20, 12)
  const parsed = parseDirectScheduleRequest('schedule workout 2 days from now at 6pm', tasks, getMondayWeek(0, now), 60, now)
  assert.equal(parsed.title, 'workout')
  assert.equal(parsed.task.id, 'workout')
  assert.equal(parsed.day.key, '2026-10-22')
  assert.equal(parsed.time.startTime, '18:00')
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
