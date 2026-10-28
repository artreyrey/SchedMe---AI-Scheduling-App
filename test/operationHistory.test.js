import test from 'node:test'
import assert from 'node:assert/strict'
import { taskDocumentsMatch, validateUndoSnapshots } from '../src/services/operationHistory.js'

test('undo validation ignores timestamp-only refreshes', () => {
  const before = { title: 'Draw', completed: false, updatedAt: 100 }
  const current = { title: 'Draw', completed: false, updatedAt: 200 }
  assert.equal(taskDocumentsMatch(before, current), true)
})

test('undo validation stops when a newer task edit would be overwritten', () => {
  const changes = [{ taskId: 'drawing', before: null, after: { title: 'Draw', completed: false } }]
  const current = new Map([['drawing', { title: 'Draw', completed: true }]])
  assert.equal(validateUndoSnapshots(changes, current), false)
})

test('undo validation supports atomic multi-task and delete histories', () => {
  const changes = [
    { taskId: 'drawing', before: { title: 'Draw' }, after: null },
    { taskId: 'meeting', before: { date: '2026-11-01' }, after: { date: '2026-11-02' } },
  ]
  const current = new Map([
    ['drawing', null],
    ['meeting', { date: '2026-11-02', updatedAt: 300 }],
  ])
  assert.equal(validateUndoSnapshots(changes, current), true)
})
