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
  assert.match(getConversationScopeResponse('What can you do?'), /natural-language requests into safe, verified changes/i)
})

test('answers identity questions using the configured assistant name', () => {
  assert.match(getConversationScopeResponse('what are you?'), /I’m SchedMe, a context-aware task and scheduling assistant/i)
  assert.match(getConversationScopeResponse('Who are you?', { assistantName: 'Mina' }), /I’m Mina, SchedMe’s context-aware task and scheduling assistant/i)
  assert.match(getConversationScopeResponse('Are you an AI?'), /schedule, reschedule, bulk-move, or unschedule/i)
})

test('explains the AI purpose using the current task context', () => {
  const tasks = [
    { title: 'Thesis', date: '2026-10-29', startTime: '09:00', endTime: '10:00', completed: false },
    { title: 'Practice drawing', completed: false },
    { title: 'Old task', completed: true },
  ]
  const response = getConversationScopeResponse('what is this AI for?', { assistantName: 'Mina', tasks })
  assert.match(response, /I’m Mina/i)
  assert.match(response, /2 active tasks: “Thesis”, “Practice drawing”/i)
  assert.match(response, /1 is scheduled and 1 is unscheduled, with 1 completed/i)
  assert.match(getConversationScopeResponse('What do you know about my tasks?', { tasks }), /2 active tasks/i)
})

test('recognizes varied questions about identity, purpose, and user help', () => {
  for (const question of [
    'What is SchedMe?',
    'What was this AI made for?',
    'Why were you made?',
    'How can this assistant help me?',
    'What could you do?',
  ]) {
    assert.match(getConversationScopeResponse(question), /task and scheduling assistant/i)
  }
})

test('adapts self-knowledge to a concise communication preference', () => {
  const response = getConversationScopeResponse('What are your capabilities?', { prefersConcise: true })
  assert.match(response, /I help you create, schedule, move, complete, prioritize, and color tasks/i)
  assert.doesNotMatch(response, /I was made to turn natural-language requests/i)
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
