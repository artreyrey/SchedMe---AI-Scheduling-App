import test from 'node:test'
import assert from 'node:assert/strict'
import { findFreeTimeSuggestions, planContextAvailabilityAction } from '../src/ai/availabilityAction.js'

const planningDates = ['2026-11-02', '2026-11-03']
const drawing = { id: 'drawing', title: 'Practice Drawing', completed: false, date: '2026-11-01', startTime: '20:00', endTime: '21:00' }
const tasks = [
  drawing,
  { id: 'meeting', title: 'Team Meeting', completed: false, date: '2026-11-02', startTime: '09:00', endTime: '10:00' },
]

function action(intent, overrides = {}) {
  return {
    intent,
    confidence: 0.95,
    scope: 'single',
    target: { taskId: 'drawing', taskIds: ['drawing'], query: '' },
    patch: {},
    constraints: {},
    missingFields: [],
    requiresConfirmation: false,
    destructive: false,
    ...overrides,
  }
}

test('turns a busy-after boundary into persisted free windows for the planning week', () => {
  const plan = planContextAvailabilityAction({
    action: action('set_availability', { constraints: { beforeTime: '17:00' } }),
    text: "I'm busy after 5",
    planningDates,
  })
  assert.equal(plan.status, 'ready')
  assert.equal(plan.operation, 'set_availability')
  assert.deepEqual(plan.availability, [
    { date: '2026-11-02', startTime: '08:00', endTime: '17:00' },
    { date: '2026-11-03', startTime: '08:00', endTime: '17:00' },
  ])
})

test('a date-specific availability update preserves windows on other days', () => {
  const plan = planContextAvailabilityAction({
    action: action('set_availability', { constraints: { date: '2026-11-02', afterTime: '13:00', beforeTime: '17:00' } }),
    text: 'I am available Monday afternoon',
    planningDates,
    availability: [{ date: '2026-11-03', startTime: '09:00', endTime: '16:00' }],
  })
  assert.deepEqual(plan.availability, [
    { date: '2026-11-03', startTime: '09:00', endTime: '16:00' },
    { date: '2026-11-02', startTime: '13:00', endTime: '17:00' },
  ])
})

test('finds conflict-free choices inside the user availability window', () => {
  const suggestions = findFreeTimeSuggestions({
    task: drawing,
    tasks,
    planningDates,
    availability: [{ date: '2026-11-02', startTime: '09:00', endTime: '12:00' }],
    date: '2026-11-02',
  })
  assert.deepEqual(suggestions[0], { date: '2026-11-02', startTime: '10:00', endTime: '11:00' })
  assert.equal(suggestions.some((slot) => slot.startTime < '10:00'), false)
})

test('offers free-time choices for a contextual task reference', () => {
  const plan = planContextAvailabilityAction({
    action: action('find_free_time', { target: { taskId: '', taskIds: [], query: 'it' } }),
    text: "Move it where I'm free",
    tasks,
    schedulingState: { lastReferencedTaskId: 'drawing' },
    planningDates,
    availability: [{ date: '2026-11-02', startTime: '08:00', endTime: '12:00' }],
  })
  assert.equal(plan.status, 'suggest')
  assert.equal(plan.task.id, 'drawing')
  assert.equal(plan.suggestions.length, 3)
})

test('accepts an exact free-time choice from a follow-up without changing other task fields', () => {
  const plan = planContextAvailabilityAction({
    action: action('find_free_time', { patch: { date: '2026-11-02', startTime: '10:00', endTime: '11:00' } }),
    text: 'the first one',
    tasks,
    planningDates,
  })
  assert.equal(plan.status, 'ready')
  assert.deepEqual(plan.slot, { date: '2026-11-02', startTime: '10:00', endTime: '11:00' })
})

test('does not offer a window when every available minute conflicts', () => {
  const plan = planContextAvailabilityAction({
    action: action('find_free_time', { constraints: { date: '2026-11-02' } }),
    text: 'Find a free time for drawing',
    tasks,
    planningDates,
    availability: [{ date: '2026-11-02', startTime: '09:00', endTime: '10:00' }],
  })
  assert.equal(plan.status, 'clarify')
  assert.equal(plan.reason, 'no_free_time')
})

test('does not suggest past days or past times on the current day', () => {
  const suggestions = findFreeTimeSuggestions({
    task: drawing,
    tasks: [],
    planningDates: ['2026-11-01', '2026-11-02', '2026-11-03'],
    availability: [
      { date: '2026-11-02', startTime: '08:00', endTime: '18:00' },
      { date: '2026-11-03', startTime: '08:00', endTime: '18:00' },
    ],
    currentDate: '2026-11-02',
    currentTime: '16:07',
  })
  assert.equal(suggestions.some((slot) => slot.date < '2026-11-02'), false)
  assert.equal(suggestions[0].startTime, '16:15')
})
