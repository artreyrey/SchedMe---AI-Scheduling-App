import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { maskEmailAddress } from '../src/authUtils.js'

describe('maskEmailAddress', () => {
  it('keeps enough of a regular email recognizable without exposing it', () => {
    assert.equal(maskEmailAddress('cuizonlance49@gmail.com'), 'cui****49@gmail.com')
  })

  it('safely masks short local parts', () => {
    assert.equal(maskEmailAddress('ab@example.com'), 'a****@example.com')
    assert.equal(maskEmailAddress('luz@example.com'), 'lu****z@example.com')
  })

  it('does not echo malformed input', () => {
    assert.equal(maskEmailAddress('not-an-email'), 'your email address')
  })
})
