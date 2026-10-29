import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_RESIZE_DIRECTIONS, clampChatRectangle, resizeChatRectangle } from '../src/chatResize.js'

const viewport = { width: 1200, height: 900 }
const rectangle = { left: 400, top: 180, width: 368, height: 520 }

function resize(direction, clientX, clientY) {
  return resizeChatRectangle({ direction, startX: 0, startY: 0, rectangle }, clientX, clientY, viewport)
}

test('provides drag handles for every side and corner', () => {
  assert.deepEqual(CHAT_RESIZE_DIRECTIONS, ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])
})

test('resizes east and south edges while preserving the opposite edges', () => {
  assert.deepEqual(resize('e', 120, 0), { left: 400, top: 180, width: 488, height: 520 })
  assert.deepEqual(resize('s', 0, 100), { left: 400, top: 180, width: 368, height: 620 })
})

test('resizes west and north edges while preserving the opposite edges', () => {
  assert.deepEqual(resize('w', -100, 0), { left: 300, top: 180, width: 468, height: 520 })
  assert.deepEqual(resize('n', 0, -80), { left: 400, top: 100, width: 368, height: 600 })
})

test('resizes corners in both dimensions and respects minimum size', () => {
  assert.deepEqual(resize('nw', -100, -80), { left: 300, top: 100, width: 468, height: 600 })
  assert.deepEqual(resize('se', -500, -500), { left: 400, top: 180, width: 300, height: 360 })
})

test('keeps a resized chat inside the visible viewport', () => {
  assert.deepEqual(
    clampChatRectangle({ left: -50, top: 880, width: 2000, height: 100 }, viewport),
    { left: 12, top: 528, width: 1176, height: 360 },
  )
})
