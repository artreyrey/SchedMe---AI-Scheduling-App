import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTaskCreationIntent } from '../src/ai/taskCreationIntent.js'

test('extracts a new task title before the word task', () => {
  assert.deepEqual(parseTaskCreationIntent('can you add free time task in evening 9:00pm - 10:00pm of Tuesday?'), { isCreation: true, title: 'free time' })
})

test('extracts a title after create a task', () => {
  assert.deepEqual(parseTaskCreationIntent('create a task called Buy groceries on Monday at 2pm'), { isCreation: true, title: 'Buy groceries' })
})

test('detects a missing title and ignores normal scheduling commands', () => {
  assert.deepEqual(parseTaskCreationIntent('create a task'), { isCreation: true, title: '' })
  assert.deepEqual(parseTaskCreationIntent('schedule reporting on Tuesday'), { isCreation: false, title: '' })
})
