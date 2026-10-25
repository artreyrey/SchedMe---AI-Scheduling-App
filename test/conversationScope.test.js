import test from 'node:test'
import assert from 'node:assert/strict'
import { getConversationScopeResponse, isSchedulingRelatedMessage } from '../src/ai/conversationScope.js'

test('keeps task planning messages inside the scheduling flow', () => {
  for (const message of [
    'Help me organize my week',
    'Schedule thesis tomorrow from 2-3pm',
    'Make this task urgent and blue',
    'Move my meeting to Friday',
  ]) assert.equal(isSchedulingRelatedMessage(message), true)
})

test('redirects unrelated questions back to scheduling', () => {
  assert.equal(isSchedulingRelatedMessage('Who won the basketball game?'), false)
  assert.match(getConversationScopeResponse('Who won the basketball game?'), /focused on tasks and scheduling/i)
})

test('responds briefly to greetings and capability questions', () => {
  assert.match(getConversationScopeResponse('How are you?'), /What task would you like to schedule today/i)
  assert.match(getConversationScopeResponse('What can you do?'), /add, schedule, reschedule, classify, complete, or delete tasks/i)
})

test('answers a general request for task help immediately', () => {
  assert.equal(
    getConversationScopeResponse('can you help me with a task'),
    'Of course. What would you like to do with the task—add it, schedule it, change its priority or color, mark it done, or delete it?',
  )
  assert.match(getConversationScopeResponse('I need help with my tasks'), /What would you like to do with the task/i)
})

test('uses a clear fallback for an unreadable message', () => {
  assert.equal(getConversationScopeResponse('??'), "Sorry, I didn't quite understand. What task would you like to schedule today?")
})
