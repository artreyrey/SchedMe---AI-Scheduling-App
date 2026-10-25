import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNamedTaskDeletionRequest, parseNamedTaskPriorityRequest } from '../src/ai/taskActionIntent.js'

const tasks = [
  { id: 'logic', title: 'Thesis logic gawa', completed: false },
  { id: 'site', title: 'Gawa ng bagong website', completed: true },
  { id: 'review', title: 'Review embesys and softdes', completed: false },
]

test('resolves several named tasks for deletion, including completed tasks', () => {
  const request = parseNamedTaskDeletionRequest('delete thesis logic, gawa ng bagong website and review embesys', tasks)
  assert.equal(request.isDeletion, true)
  assert.equal(request.isMultiple, true)
  assert.deepEqual(request.tasks.map((task) => task.id), ['logic', 'site', 'review'])
  assert.deepEqual(request.unmatchedNames, [])
})

test('does not interpret a request to delete every task as a named deletion', () => {
  assert.equal(parseNamedTaskDeletionRequest('delete all my tasks', tasks).isDeletion, false)
  assert.equal(parseNamedTaskDeletionRequest('remove thesis logic from my schedule', tasks).isDeletion, false)
  assert.equal(parseNamedTaskDeletionRequest('the meeting was canceled; remove it from my task list too', tasks).isDeletion, false)
})

test('resolves multiple fuzzy task names for urgent and important changes', () => {
  const urgent = parseNamedTaskPriorityRequest('mark thesis logic and bagong website as urgent', tasks)
  const important = parseNamedTaskPriorityRequest('make thesis logic, review embesys important', tasks)
  const flexible = parseNamedTaskPriorityRequest('move thesis logic and review embesys to flexible', tasks)
  assert.deepEqual(urgent.tasks.map((task) => task.id), ['logic', 'site'])
  assert.equal(urgent.category, 'urgent')
  assert.deepEqual(important.tasks.map((task) => task.id), ['logic', 'review'])
  assert.equal(important.category, 'important')
  assert.deepEqual(flexible.tasks.map((task) => task.id), ['logic', 'review'])
  assert.equal(flexible.category, 'notUrgent')
})

test('reports an unmatched task name without dropping resolved names', () => {
  const request = parseNamedTaskPriorityRequest('mark thesis logic and missing report as important', tasks)
  assert.deepEqual(request.tasks.map((task) => task.id), ['logic'])
  assert.deepEqual(request.unmatchedNames, ['missing report'])
})
