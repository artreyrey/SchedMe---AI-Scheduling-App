import test from 'node:test'
import assert from 'node:assert/strict'
import { isTaskCompletionMessage } from '../src/ai/completionIntent.js'

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
