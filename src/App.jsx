import { useEffect, useState } from 'react'
import { browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth'
import { auth } from './firebase/config.js'
import Dashboard from './Dashboard.jsx'
import ResetPassword from './components/ResetPassword.jsx'
import ThemePicker from './components/ThemePicker.jsx'
import { maskEmailAddress, requiresEmailVerification } from './authUtils.js'
import { resolveTheme, themeColor } from './themePreferences.js'

const categories = [
  { label: 'Flexible', color: 'var(--tone-one)' },
  { label: 'Urgent', color: 'var(--tone-two)' },
  { label: 'Important', color: 'var(--tone-three)' },
  { label: 'Scheduled', color: 'var(--tone-four)' },
]

const weekPreview = [
  { day: 'MON', date: '12', title: 'Plan the week', time: '9:00 AM', color: 'var(--tone-one)' },
  { day: 'TUE', date: '13', title: 'Study session', time: '11:30 AM', color: 'var(--tone-three)' },
  { day: 'WED', date: '14', title: 'Project milestone', time: '2:00 PM', color: 'var(--tone-two)' },
]

function getInitialTheme() {
  try {
    const savedTheme = localStorage.getItem('schedme-theme')
    return resolveTheme(savedTheme, window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  } catch {
    // Storage can be unavailable in private browsing; use the system setting instead.
  }

  return resolveTheme(null, window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

function getInitialAuthMode() {
  return new URLSearchParams(window.location.search).get('auth') === 'signin' ? 'signin' : null
}

function isPasswordResetPage() {
  const params = new URLSearchParams(window.location.search)
  return window.location.pathname.replace(/\/$/, '') === '/reset-password' || params.get('mode') === 'resetPassword'
}

function EyeIcon({ visible }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5">
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      {!visible && <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  )
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [authMode, setAuthMode] = useState(getInitialAuthMode)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [passwordResetBusy, setPasswordResetBusy] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [authResolved, setAuthResolved] = useState(!auth)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      themeColor(theme),
    )
    try {
      localStorage.setItem('schedme-theme', theme)
    } catch {
      // The theme still works for this visit if storage is unavailable.
    }
  }, [theme])

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, (user) => {
      if (requiresEmailVerification(user)) {
        setCurrentUser(null)
        setAuthResolved(true)
        return
      }

      setCurrentUser(user)
      setAuthResolved(true)
    })
  }, [])

  function verificationActionSettings() {
    return { url: `${window.location.origin}/?auth=signin`, handleCodeInApp: false }
  }

  async function applySelectedPersistence() {
    await setPersistence(auth, rememberDevice ? browserLocalPersistence : browserSessionPersistence)
  }

  function openAuth(mode) {
    setAuthError('')
    setAuthNotice('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmPassword(false)
    setAuthMode(mode)
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()
    setAuthError('')
    setAuthNotice('')

    if (authMode === 'signup' && password !== confirmPassword) {
      setAuthError('Your passwords do not match.')
      return
    }

    if (!auth) {
      setAuthError('Sign-in is not configured yet. Add your Firebase settings to enable accounts.')
      return
    }

    setAuthBusy(true)
    try {
      await applySelectedPersistence()
      if (authMode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        try {
          await updateProfile(credential.user, { displayName: username.trim() })
          await sendEmailVerification(credential.user, verificationActionSettings())
        } finally {
          await signOut(auth)
        }
        setAuthMode('signin')
        setAuthNotice('Your account was created. Check your inbox and verify your email before signing in.')
        setUsername('')
        setConfirmPassword('')
        setPassword('')
        return
      } else {
        const credential = await signInWithEmailAndPassword(auth, email, password)
        if (requiresEmailVerification(credential.user)) {
          try {
            await sendEmailVerification(credential.user, verificationActionSettings())
          } catch (verificationError) {
            if (verificationError?.code !== 'auth/too-many-requests') throw verificationError
          }
          await signOut(auth)
          setAuthNotice('Please verify your email before signing in. We sent a new verification link if sending is currently allowed.')
          setPassword('')
          return
        }
      }
      setAuthMode(null)
      setUsername('')
      setConfirmPassword('')
      setPassword('')
    } catch (error) {
      const messages = {
        'auth/email-already-in-use': 'There is already an account with this email. Try signing in.',
        'auth/invalid-credential': 'That email and password do not match an account.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/operation-not-allowed': 'Email and password sign-in is not enabled in Firebase yet.',
        'auth/weak-password': 'Choose a password with at least 6 characters.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
      }
      setAuthError(messages[error.code] || 'We could not complete that request. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleGoogleSignIn() {
    setAuthError('')
    setAuthNotice('')
    if (!auth) {
      setAuthError('Sign-in is not configured yet. Add your Firebase settings to enable accounts.')
      return
    }

    setAuthBusy(true)
    try {
      await applySelectedPersistence()
      await signInWithPopup(auth, new GoogleAuthProvider())
      setAuthMode(null)
      setPassword('')
    } catch (error) {
      const messages = {
        'auth/account-exists-with-different-credential': 'An account already exists with this email. Sign in using its original method.',
        'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
        'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
        'auth/operation-not-allowed': 'Google sign-in is not enabled in Firebase yet.',
      }
      setAuthError(messages[error.code] || 'We could not complete Google sign-in. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handlePasswordReset() {
    const resetEmail = email.trim()
    const resetNotice = `If an account uses ${maskEmailAddress(resetEmail)}, Firebase has sent it a password reset link. Check your inbox and spam folder.`
    setAuthError('')
    setAuthNotice('')
    if (!resetEmail) {
      setAuthError('Enter your email address first, then choose Forgot password.')
      return
    }
    if (!auth) {
      setAuthError('Password reset is not configured yet. Add your Firebase settings to enable accounts.')
      return
    }

    setPasswordResetBusy(true)
    try {
      auth.useDeviceLanguage()
      await sendPasswordResetEmail(auth, resetEmail, {
        url: `${window.location.origin}/?auth=signin`,
      })
      setAuthNotice(resetNotice)
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        setAuthNotice(resetNotice)
      } else {
        const messages = {
          'auth/invalid-email': 'Enter a valid email address.',
          'auth/too-many-requests': 'Too many reset attempts. Please wait a moment and try again.',
          'auth/network-request-failed': 'The reset email could not be sent because of a network problem. Please try again.',
        }
        setAuthError(messages[error.code] || 'The reset email could not be sent. Please try again.')
      }
    } finally {
      setPasswordResetBusy(false)
    }
  }

  async function handleSignOut() {
    if (auth) await signOut(auth)
  }

  if (isPasswordResetPage()) {
    return <ResetPassword theme={theme} onSelectTheme={setTheme} />
  }

  if (!authResolved) {
    return (
      <main className="app-shell grid min-h-screen place-items-center">
        <p className="copy-muted text-sm">Loading your planning space…</p>
      </main>
    )
  }

  if (currentUser) {
    return <Dashboard user={currentUser} onSignOut={handleSignOut} theme={theme} onSelectTheme={setTheme} />
  }

  return (
    <main className="app-shell landing-shell min-h-screen overflow-hidden px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <div className="landing-frame relative mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-7xl flex-col sm:min-h-[calc(100vh-3.5rem)]">
        <header className="flex items-center justify-between gap-3">
          <a className="brand-lockup" href="#top" aria-label="SchedMe home">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span className="text-xl font-semibold tracking-tight">SchedMe</span>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-medium md:flex" aria-label="Main navigation">
            <a className="nav-link" href="#your-week">Your week</a>
            <a className="nav-link" href="#planning-style">Our approach</a>
          </nav>

          <div className="header-actions flex shrink-0 items-center gap-2">
            {currentUser ? (
              <button type="button" className="auth-text-button rounded-full px-2.5 py-2 text-sm font-semibold sm:px-3" onClick={() => signOut(auth)} title={`Sign out ${currentUser.email}`}>
                <span className="sm:hidden">Sign out</span>
                <span className="hidden max-w-36 truncate sm:inline">{currentUser.email}</span>
              </button>
            ) : (
              <>
                <button type="button" className="auth-text-button rounded-full px-2.5 py-2 text-sm font-semibold min-[380px]:px-3" onClick={() => openAuth('signin')}>
                  Sign in
                </button>
                <button type="button" className="auth-signup rounded-full px-3 py-2.5 text-sm font-bold sm:px-4" onClick={() => openAuth('signup')}>
                  Sign up
                </button>
              </>
            )}
            <ThemePicker theme={theme} onChange={setTheme} />
          </div>
        </header>

        <section id="top" className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-16">
          <div className="max-w-2xl">
            <div className="eyebrow inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold uppercase tracking-[0.14em]">
              <span className="status-dot" />
              Make room for what matters
            </div>

            <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-[1.04] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
              A week that feels more <span className="gradient-text">like yours.</span>
            </h1>
            <p className="copy-muted mt-6 max-w-xl text-base leading-7 sm:text-lg sm:leading-8">
              Bring your responsibilities into focus, then shape a plan with enough breathing room for real life.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a className="primary-link inline-flex items-center gap-3 rounded-full px-6 py-3.5 text-sm font-bold" href="#your-week">
                Take a look around
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
                  <path d="M3.5 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <span className="copy-muted text-sm">Thoughtful planning, at your pace.</span>
            </div>

            <div id="planning-style" className="mt-12">
              <p className="copy-subtle text-xs font-bold uppercase tracking-[0.16em]">Every kind of task has a place</p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {categories.map((category) => (
                  <span className="category-chip inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold" key={category.label}>
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                    {category.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <section id="your-week" className="schedule-card rounded-[2rem] p-5 sm:p-7" aria-label="Example week preview">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="copy-subtle text-xs font-bold uppercase tracking-[0.15em]">A little more in balance</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your week, at a glance</h2>
              </div>
              <span className="week-mark grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-bold">S</span>
            </div>

            <div className="mt-7 grid grid-cols-7 gap-1.5 sm:gap-2" aria-label="Week days">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <div className={`day-cell flex flex-col items-center gap-2 rounded-2xl py-2.5 sm:py-3 ${index === 3 ? 'day-current' : ''}`} key={`${day}-${index}`}>
                  <span className="copy-subtle text-[10px] font-bold sm:text-xs">{day}</span>
                  <span className="text-sm font-semibold sm:text-base">{11 + index}</span>
                  <span className={`day-indicator ${index === 3 ? 'day-indicator-current' : ''}`} />
                </div>
              ))}
            </div>

            <div className="mt-7 space-y-3">
              {weekPreview.map((item) => (
                <article className="task-row flex items-center gap-3 rounded-2xl px-3.5 py-3.5 sm:gap-4 sm:px-4" key={item.title}>
                  <span className="task-color size-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold sm:text-base">{item.title}</p>
                    <p className="copy-subtle mt-0.5 text-xs sm:text-sm">{item.time}</p>
                  </div>
                  <span className="copy-subtle text-[10px] font-bold tracking-[0.12em] sm:text-xs">{item.day} {item.date}</span>
                </article>
              ))}
            </div>

            <div className="gradient-track mt-6 h-2.5 overflow-hidden rounded-full" aria-hidden="true">
              <div className="gradient-fill h-full w-[72%] rounded-full" />
            </div>
            <p className="copy-subtle mt-3 text-center text-xs">A steady rhythm, with space to breathe.</p>
          </section>
        </section>

        <footer className="footer-row flex flex-col gap-2 border-t py-5 text-xs sm:flex-row sm:items-center sm:justify-between sm:text-sm">
          <span>SchedMe · Your schedule stays yours.</span>
          <span>Plan with a little more ease.</span>
        </footer>
      </div>

      {authMode && (
        <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null) }}>
          <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button type="button" className="auth-close" onClick={() => setAuthMode(null)} aria-label="Close sign-in dialog">×</button>
            <p className="copy-subtle text-xs font-bold uppercase tracking-[0.15em]">Make room for what matters</p>
            <h2 id="auth-title" className="mt-2 text-3xl font-semibold tracking-tight">{authMode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
            <p className="copy-muted mt-2 text-sm">{authMode === 'signup' ? 'Start shaping a week that feels like yours.' : 'Sign in to pick up where you left off.'}</p>
            <form className="auth-form mt-6" onSubmit={handleAuthSubmit}>
              {authMode === 'signup' && (
                <>
                  <label className="auth-label" htmlFor="auth-username">Username</label>
                  <input id="auth-username" className="auth-input" type="text" autoComplete="nickname" minLength={2} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} />
                  <label className="auth-label mt-4" htmlFor="auth-email">Email</label>
                </>
              )}
              {authMode === 'signin' && <label className="auth-label" htmlFor="auth-email">Email</label>}
              <input id="auth-email" className="auth-input" type="email" autoComplete="email" required value={email} onChange={(event) => { setEmail(event.target.value); setAuthNotice('') }} />
              <label className="auth-label mt-4" htmlFor="auth-password">Password</label>
              <div className="auth-password-wrap">
                <input id="auth-password" className="auth-input" type={showPassword ? 'text' : 'password'} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                  <EyeIcon visible={showPassword} />
                </button>
              </div>
              {authMode === 'signin' && <button type="button" className="auth-forgot" onClick={handlePasswordReset} disabled={authBusy || passwordResetBusy}>{passwordResetBusy ? 'Sending reset link…' : 'Forgot password?'}</button>}
              {authMode === 'signup' && (
                <>
                  <label className="auth-label mt-4" htmlFor="auth-confirm-password">Confirm password</label>
                  <div className="auth-password-wrap">
                    <input id="auth-confirm-password" className="auth-input" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                    <button type="button" className="password-visibility" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={showConfirmPassword}>
                      <EyeIcon visible={showConfirmPassword} />
                    </button>
                  </div>
                </>
              )}
              <label className="auth-remember mt-4">
                <input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />
                <span>
                  <strong>Remember me on this device</strong>
                  <small>Leave this off on shared devices. You will be signed out when this browser session ends.</small>
                </span>
              </label>
              {authError && <p className="auth-error mt-3" role="alert">{authError}</p>}
              {authNotice && <p className="auth-success mt-3" role="status">{authNotice}</p>}
              <button className="auth-submit mt-6 w-full rounded-full px-5 py-3.5 text-sm font-bold" type="submit" disabled={authBusy || passwordResetBusy}>
                {authBusy ? 'One moment…' : authMode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </form>
            <div className="auth-divider" aria-hidden="true"><span>or</span></div>
            <button type="button" className="auth-google w-full rounded-full px-5 py-3.5 text-sm font-semibold" onClick={handleGoogleSignIn} disabled={authBusy || passwordResetBusy}>
              <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.63 17.74 9.5 24 9.5Z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.72 7.18l7.62 5.91c4.45-4.1 7.14-10.13 7.14-17.56Z" />
                <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.62-5.91c-2.12 1.42-4.83 2.26-8.28 2.26-6.26 0-11.57-4.13-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
              </svg>
              Continue with Google
            </button>
            <p className="copy-muted mt-5 text-center text-sm">
              {authMode === 'signup' ? 'Already have an account?' : 'New to SchedMe?'}{' '}
              <button type="button" className="auth-switch font-bold" onClick={() => openAuth(authMode === 'signup' ? 'signin' : 'signup')}>
                {authMode === 'signup' ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
