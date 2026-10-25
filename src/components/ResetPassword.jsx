import { useEffect, useState } from 'react'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { auth } from '../firebase/config.js'
import { maskEmailAddress } from '../authUtils.js'
import ThemePicker from './ThemePicker.jsx'

function EyeIcon({ visible }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5">
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      {!visible && <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  )
}

function resetErrorMessage(error) {
  const messages = {
    'auth/expired-action-code': 'This reset link has expired. Request a new one to continue.',
    'auth/invalid-action-code': 'This reset link is invalid or has already been used.',
    'auth/user-disabled': 'This account is currently disabled.',
    'auth/user-not-found': 'We could not find the account for this reset link.',
    'auth/weak-password': 'Choose a stronger password and try again.',
    'auth/network-request-failed': 'We could not connect to Firebase. Check your connection and try again.',
  }

  return messages[error?.code] || 'We could not reset your password. Please request a new link and try again.'
}

export default function ResetPassword({ theme, onSelectTheme }) {
  const params = new URLSearchParams(window.location.search)
  const actionCode = params.get('oobCode')
  const mode = params.get('mode')
  const [status, setStatus] = useState('checking')
  const [accountEmail, setAccountEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    if (!auth) {
      setStatus('error')
      setError('Password reset is not configured yet.')
      return () => { active = false }
    }

    if (!actionCode || (mode && mode !== 'resetPassword')) {
      setStatus('error')
      setError('This password reset link is incomplete or invalid.')
      return () => { active = false }
    }

    verifyPasswordResetCode(auth, actionCode)
      .then((verifiedEmail) => {
        if (!active) return
        setAccountEmail(verifiedEmail)
        setStatus('ready')
      })
      .catch((verificationError) => {
        if (!active) return
        setError(resetErrorMessage(verificationError))
        setStatus('error')
      })

    return () => { active = false }
  }, [actionCode, mode])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Use at least 6 characters for your new password.')
      return
    }

    if (password !== confirmPassword) {
      setError('Your passwords do not match.')
      return
    }

    setStatus('saving')
    try {
      await confirmPasswordReset(auth, actionCode, password)
      setPassword('')
      setConfirmPassword('')
      setStatus('success')
    } catch (saveError) {
      setError(resetErrorMessage(saveError))
      setStatus(saveError?.code === 'auth/expired-action-code' || saveError?.code === 'auth/invalid-action-code' ? 'error' : 'ready')
    }
  }

  const isBusy = status === 'checking' || status === 'saving'

  return (
    <main className="app-shell reset-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="reset-header">
        <a className="brand-lockup" href="/" aria-label="SchedMe home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span className="text-xl font-semibold tracking-tight">SchedMe</span>
        </a>
        <ThemePicker theme={theme} onChange={onSelectTheme} />
      </header>

      <section className="reset-card" aria-labelledby="reset-title">
        <div className={`reset-icon reset-icon-${status}`} aria-hidden="true">
          {status === 'success' ? (
            <svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.5 3.4 3.4 7.6-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.7" /><path d="M8.5 10V7.6a3.5 3.5 0 0 1 7 0V10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          )}
        </div>

        {status === 'checking' && (
          <div className="reset-state" role="status">
            <p className="reset-kicker">Secure password reset</p>
            <h1 id="reset-title">Checking your link</h1>
            <p>Just a moment while we make sure this reset request is valid.</p>
            <span className="reset-loader" aria-hidden="true" />
          </div>
        )}

        {(status === 'ready' || status === 'saving') && (
          <>
            <div className="reset-state">
              <p className="reset-kicker">Secure password reset</p>
              <h1 id="reset-title">Choose a new password</h1>
              <p>For <strong>{maskEmailAddress(accountEmail)}</strong></p>
            </div>

            <form className="reset-form" onSubmit={handleSubmit}>
              <label className="auth-label" htmlFor="reset-password">New password</label>
              <div className="auth-password-wrap">
                <input id="reset-password" className="auth-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={isBusy} />
                <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                  <EyeIcon visible={showPassword} />
                </button>
              </div>

              <label className="auth-label" htmlFor="reset-password-confirm">Confirm new password</label>
              <input id="reset-password-confirm" className="auth-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={isBusy} />
              <p className="reset-hint">Use at least 6 characters and avoid a password you use elsewhere.</p>

              {error && <p className="auth-error reset-message" role="alert">{error}</p>}

              <button className="auth-submit reset-submit" type="submit" disabled={isBusy}>
                {status === 'saving' ? 'Saving new password…' : 'Save new password'}
              </button>
            </form>
          </>
        )}

        {status === 'success' && (
          <div className="reset-state reset-complete" role="status">
            <p className="reset-kicker">All set</p>
            <h1 id="reset-title">Password updated</h1>
            <p>Your new password is ready. You can return to SchedMe and sign in.</p>
            <a className="auth-submit reset-submit" href="/?auth=signin">Continue to sign in</a>
          </div>
        )}

        {status === 'error' && (
          <div className="reset-state reset-complete" role="alert">
            <p className="reset-kicker">Reset link unavailable</p>
            <h1 id="reset-title">Let’s get a fresh link</h1>
            <p>{error}</p>
            <a className="auth-submit reset-submit" href="/?auth=signin">Request another reset link</a>
          </div>
        )}
      </section>

      <p className="reset-footer">SchedMe · Make room for what matters.</p>
    </main>
  )
}
