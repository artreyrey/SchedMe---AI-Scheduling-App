import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme, themeColor } from '../src/themePreferences.js'

test('restores all supported saved themes', () => {
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme('pink', true), 'pink')
  assert.equal(resolveTheme('berry', false), 'berry')
  assert.equal(resolveTheme('matcha', true), 'matcha')
  assert.equal(resolveTheme('latte', false), 'latte')
  assert.equal(resolveTheme('cherry', false), 'cherry')
  assert.equal(resolveTheme('night', false), 'night')
  assert.equal(resolveTheme('violet', false), 'violet')
})

test('falls back to the system preference for an unknown saved value', () => {
  assert.equal(resolveTheme('unknown', true), 'dark')
  assert.equal(resolveTheme(null, false), 'light')
  assert.equal(themeColor('pink'), '#FFE5EC')
  assert.equal(themeColor('berry'), '#4C1D3D')
  assert.equal(themeColor('matcha'), '#E3EED4')
  assert.equal(themeColor('latte'), '#F6F1E6')
  assert.equal(themeColor('cherry'), '#F7F1EA')
  assert.equal(themeColor('night'), '#043f50')
  assert.equal(themeColor('violet'), '#2A123F')
})
