import test from 'node:test'
import assert from 'node:assert/strict'
import { planTaskListDrop, sortTasksForGroup } from '../src/taskListOrder.js'

test('plans a task above or below another task', () => {
  const tasks = [{ id: 'review' }, { id: 'website' }, { id: 'paper' }]
  assert.deepEqual(planTaskListDrop(tasks, 'review', 'website', 'after'), ['website', 'review', 'paper'])
  assert.deepEqual(planTaskListDrop(tasks, 'website', 'review', 'before'), ['website', 'review', 'paper'])
})

test('sorts saved positions per task list while keeping new unranked tasks first', () => {
  const tasks = [
    { id: 'new' },
    { id: 'website', orderImportant: 0 },
    { id: 'review', orderImportant: 1 },
  ]
  assert.deepEqual(sortTasksForGroup(tasks, 'important').map((task) => task.id), ['new', 'website', 'review'])
})
