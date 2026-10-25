import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTaskAttributesIntent, parseTaskCategoryIntent, parseTaskColorChangeIntent, parseTaskCreationIntent } from '../src/ai/taskCreationIntent.js'

test('extracts a new task title before the word task', () => {
  assert.deepEqual(parseTaskCreationIntent('can you add free time task in evening 9:00pm - 10:00pm of Tuesday?'), { isCreation: true, title: 'free time' })
  assert.deepEqual(parseTaskCreationIntent('can you add work out as a task on wenesday 8-9pm?'), { isCreation: true, title: 'work out' })
})

test('extracts a title after create a task', () => {
  assert.deepEqual(parseTaskCreationIntent('create a task called Buy groceries on Monday at 2pm'), { isCreation: true, title: 'Buy groceries' })
  assert.deepEqual(parseTaskCreationIntent("Add a task on whats on my mind about playing basketball, lets schedule it later."), {
    isCreation: true,
    title: 'playing basketball',
  })
})

test('detects a missing title and ignores normal scheduling commands', () => {
  assert.deepEqual(parseTaskCreationIntent('create a task'), { isCreation: true, title: '' })
  assert.deepEqual(parseTaskCreationIntent('schedule reporting on Tuesday'), { isCreation: false, title: '' })
  assert.deepEqual(
    parseTaskCreationIntent('schedule Drawing time task today at 3-4pm make it important and put a blue color on it'),
    { isCreation: false, title: '' },
  )
})

test('extracts task priority and an explicitly requested color', () => {
  assert.deepEqual(
    parseTaskAttributesIntent('make it important and put a blue color on it'),
    { category: 'important', alsoPriority: false, color: '#3b82f6', colorMode: 'manual' },
  )
})

test('understands every task color and spoken priority in an add-task command', () => {
  const colors = {
    red: '#ef4444',
    orange: '#f97316',
    yellow: '#eab308',
    green: '#22c55e',
    cyan: '#06b6d4',
    blue: '#3b82f6',
    purple: '#8b5cf6',
    pink: '#ec4899',
  }

  for (const [name, color] of Object.entries(colors)) {
    assert.deepEqual(parseTaskAttributesIntent(`make it urgent and put ${name} color on it`), {
      category: 'urgent',
      alsoPriority: false,
      color,
      colorMode: 'manual',
    })
  }

  assert.deepEqual(
    parseTaskCreationIntent('can you add a thesis task today at 6-7pm make it important and put red color on it'),
    { isCreation: true, title: 'thesis', category: 'important', alsoPriority: false },
  )
})

test('recognizes color changes for existing tasks', () => {
  assert.deepEqual(parseTaskColorChangeIntent('can you change the thesis color to green'), {
    isColorChange: true,
    title: 'thesis',
    color: '#22c55e',
    colorName: 'green',
    colorMode: 'manual',
  })
  assert.deepEqual(parseTaskColorChangeIntent('make thesis blue'), {
    isColorChange: true,
    title: 'thesis',
    color: '#3b82f6',
    colorName: 'blue',
    colorMode: 'manual',
  })
  assert.deepEqual(parseTaskColorChangeIntent('set the color of thesis to purple'), {
    isColorChange: true,
    title: 'thesis',
    color: '#8b5cf6',
    colorName: 'purple',
    colorMode: 'manual',
  })
  assert.deepEqual(parseTaskColorChangeIntent('what color is thesis'), { isColorChange: false, title: '' })
})

test('keeps an explicitly requested category when creating a task', () => {
  assert.deepEqual(parseTaskCreationIntent("can you add feed journey task in urgent, let's schedule it later"), {
    isCreation: true,
    title: 'feed journey',
    category: 'urgent',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCreationIntent('add an important task called Finish report'), {
    isCreation: true,
    title: 'Finish report',
    category: 'important',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCreationIntent('make a task named Renew passport in not urgent'), {
    isCreation: true,
    title: 'Renew passport',
    category: 'notUrgent',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCreationIntent('create an urgent and important task called Submit application'), {
    isCreation: true,
    title: 'Submit application',
    category: 'urgent',
    alsoPriority: true,
  })
})

test('recognizes an existing task category change before scheduling intent', () => {
  assert.deepEqual(parseTaskCategoryIntent('put feed journey in urgent'), {
    isCategoryChange: true,
    title: 'feed journey',
    category: 'urgent',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCategoryIntent('move task Renew passport to not urgent'), {
    isCategoryChange: true,
    title: 'Renew passport',
    category: 'notUrgent',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCategoryIntent('can you put sine task on not urgent'), {
    isCategoryChange: true,
    title: 'sine',
    category: 'notUrgent',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCategoryIntent('move sine task onto my important list'), {
    isCategoryChange: true,
    title: 'sine',
    category: 'important',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCategoryIntent('put feed journey on Tuesday'), {
    isCategoryChange: false,
    title: '',
  })
})

test('recognizes natural category status changes', () => {
  for (const input of ['gala is not urgent anymore', 'gala is no longer urgent', "gala isn't urgent anymore"]) {
    assert.deepEqual(parseTaskCategoryIntent(input), {
      isCategoryChange: true,
      title: 'gala',
      category: 'notUrgent',
      alsoPriority: false,
    })
  }
  assert.deepEqual(parseTaskCategoryIntent('gala is important now'), {
    isCategoryChange: true,
    title: 'gala',
    category: 'important',
    alsoPriority: false,
  })
  assert.deepEqual(parseTaskCategoryIntent('gala should be urgent'), {
    isCategoryChange: true,
    title: 'gala',
    category: 'urgent',
    alsoPriority: false,
  })
})
