import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeAssistantTaskText, sanitizeTaskTitle } from '../src/ai/taskTextSanitizer.js'

test('removes leaked JSON scheduling fields from a task title', () => {
  assert.equal(sanitizeTaskTitle(`solar finalization task”
"date": "2026-11-05",
"startTime": "08:00",
"endTime": "10:00"
}`), 'solar finalization task')
})

test('removes prose scheduling fields without damaging a normal title', () => {
  assert.equal(
    sanitizeTaskTitle('Flowchart", date is "2026-11-04", startTime is "10:00", endTime is "12:00". Flowchart'),
    'Flowchart',
  )
  assert.equal(sanitizeTaskTitle('Prepare date formats'), 'Prepare date formats')
})

test('cleans leaked scheduling fields from a saved assistant confirmation', () => {
  const text = `Done—“solar finalization task”
"date": "2026-11-05",
"startTime": "08:00",
"endTime": "10:00"
}” was created and scheduled Thursday, 8 AM–10 AM.`
  assert.equal(
    sanitizeAssistantTaskText(text),
    'Done—“solar finalization task” was created and scheduled Thursday, 8 AM–10 AM.',
  )
})
