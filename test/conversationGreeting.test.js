import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDailyGreetingHistory, preserveGreetingDate } from '../src/ai/conversationGreeting.js'

test('daily greeting is tagged and shown only once for the current day', () => {
  const greeting = 'Hi there! How’s your day going?'
  const result = prepareDailyGreetingHistory([
    { role: 'model', text: greeting },
    { role: 'user', text: 'Schedule my tasks' },
    { role: 'model', text: greeting },
  ], greeting, '2026-10-18')

  assert.equal(result.hasTodayGreeting, true)
  assert.equal(result.changed, true)
  assert.equal(result.messages.filter((message) => message.kind === 'daily-greeting').length, 1)
  assert.equal(result.messages[0].date, '2026-10-18')
})

test('resetting temporary scheduling state preserves the daily greeting date', () => {
  const result = preserveGreetingDate(
    { activeTaskId: null, lastGreetingDate: '' },
    { activeTaskId: 'task-1', lastGreetingDate: '2026-10-18' },
  )

  assert.equal(result.lastGreetingDate, '2026-10-18')
})
