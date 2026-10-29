import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { maskEmailAddress, requiresEmailVerification } from '../src/authUtils.js'

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

describe('requiresEmailVerification', () => {
  it('requires verification for an unverified password account', () => {
    assert.equal(requiresEmailVerification({
      emailVerified: false,
      providerData: [{ providerId: 'password' }],
    }), true)
  })

  it('allows verified password accounts', () => {
    assert.equal(requiresEmailVerification({
      emailVerified: true,
      providerData: [{ providerId: 'password' }],
    }), false)
  })

  it('does not apply the password-only gate to a Google account', () => {
    assert.equal(requiresEmailVerification({
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    }), false)
  })

  it('handles signed-out state', () => {
    assert.equal(requiresEmailVerification(null), false)
  })
})
