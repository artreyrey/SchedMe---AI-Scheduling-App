import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultPeriodTimes, getDroppedCalendarSlot, timeFromMinutes, validateCalendarEntry } from '../src/ai/calendarEditor.js'

test('creates a one-hour default inside the selected calendar period', () => {
  assert.deepEqual(getDefaultPeriodTimes({ start: 12 * 60, end: 17 * 60 }), { startTime: '12:00', endTime: '13:00' })
  assert.deepEqual(getDefaultPeriodTimes({ start: 17 * 60, end: 24 * 60 }), { startTime: '17:00', endTime: '18:00' })
})

test('formats minutes as a time input value', () => {
  assert.equal(timeFromMinutes(125), '02:05')
})

test('moves a dropped task to another day while preserving duration and period offset', () => {
  const periods = [
    { label: 'Morning', start: 8 * 60, end: 12 * 60 },
    { label: 'Afternoon', start: 12 * 60, end: 17 * 60 },
  ]
  const task = { startTime: '09:00', endTime: '10:00' }
  assert.deepEqual(
    getDroppedCalendarSlot(task, '2026-10-20', periods[1], periods),
    { date: '2026-10-20', startTime: '13:00', endTime: '14:00' },
  )
  assert.deepEqual(
    getDroppedCalendarSlot(task, '2026-10-21', periods[0], periods),
    { date: '2026-10-21', startTime: '09:00', endTime: '10:00' },
  )
})

test('validates calendar title and time order', () => {
  assert.equal(validateCalendarEntry({ title: '', startTime: '12:00', endTime: '13:00' }), 'Enter a task title.')
  assert.equal(validateCalendarEntry({ title: 'Lunch', startTime: '13:00', endTime: '12:00' }), 'End time must be after the start time.')
  assert.equal(validateCalendarEntry({ title: 'Lunch', startTime: '12:00', endTime: '13:00' }), '')
})
