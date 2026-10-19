import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmsTaskDeletion, declinesTaskDeletion, isCancellationMessage, wantsFullCancellationRemoval, wantsToScheduleAnotherTask } from '../src/ai/cancellationIntent.js'

test('recognizes a canceled scheduled task without treating plain cancel as task cancellation', () => {
  assert.equal(isCancellationMessage("It's canceled now"), true)
  assert.equal(isCancellationMessage('The meeting was called off'), true)
  assert.equal(isCancellationMessage('cancel'), false)
})

test('distinguishes unscheduling from removing the task everywhere', () => {
  assert.equal(wantsFullCancellationRemoval("It's canceled now"), false)
  assert.equal(wantsFullCancellationRemoval("It's canceled now; remove it from the schedule and what's on my mind"), true)
  assert.equal(wantsFullCancellationRemoval("It's canceled now; remove it from the schedule and whats on my mind"), true)
  assert.equal(wantsFullCancellationRemoval('The task is canceled, delete the task and its schedule'), true)
})

test('understands follow-up confirmation to keep or delete the canceled task', () => {
  assert.equal(confirmsTaskDeletion('yes, remove it'), true)
  assert.equal(confirmsTaskDeletion('delete that task'), true)
  assert.equal(declinesTaskDeletion('no, keep it'), true)
  assert.equal(declinesTaskDeletion('leave the task there'), true)
})

test('recognizes a request to move on to another unscheduled task', () => {
  assert.equal(wantsToScheduleAnotherTask('schedule another task'), true)
  assert.equal(wantsToScheduleAnotherTask('can we plan the next task?'), true)
  assert.equal(wantsToScheduleAnotherTask('remove it entirely'), false)
})
