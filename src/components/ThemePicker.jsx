import { useEffect, useRef, useState } from 'react'
import { THEME_OPTIONS } from '../themePreferences.js'

function ThemeSymbol({ theme }) {
  if (theme === 'pink') return <span className="theme-symbol-flower" aria-hidden="true">✿</span>
  if (theme === 'night') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M19.4 15.3A8 8 0 0 1 8.7 4.6a8.1 8.1 0 1 0 10.7 10.7Z" />
        <path d="m17.5 4 .5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" />
      </svg>
    )
  }
  if (theme === 'matcha') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M19.5 4.5C12 4.8 6.3 8 5.3 13.3c-.6 3.1 1.6 5.5 4.7 5.2 5.1-.5 8.2-5.6 9.5-14Z" />
        <path d="M5 20c2.3-4.7 5.7-8 10.6-10.4" />
      </svg>
    )
  }
  if (theme === 'berry') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M4 16h16" />
        <path d="M7 16a5 5 0 0 1 10 0" />
        <path d="M12 4v3M5.6 7.1l2.1 2.1m10.7-2.1-2.1 2.1" />
      </svg>
    )
  }
  if (theme === 'dark') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.6 8.6 0 1 0 20.2 15.3Z" /></svg>
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
}

export default function ThemePicker({ theme, onChange }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function closeOnOutside(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className={`theme-picker ${open ? 'is-open' : ''}`} ref={pickerRef}>
      <button type="button" className="theme-toggle" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        <span className="theme-current-icon"><ThemeSymbol theme={theme} /></span>
        <span>Theme</span>
        <span className="theme-chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="theme-menu" role="menu" aria-label="Choose appearance" aria-hidden={!open}>
        <div className="theme-menu-heading"><strong>Appearance</strong><small>Saved on this device</small></div>
        {THEME_OPTIONS.map((option) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={theme === option.id}
            tabIndex={open ? 0 : -1}
            className={theme === option.id ? 'is-selected' : ''}
            key={option.id}
            onClick={() => { onChange(option.id); setOpen(false) }}
          >
            <span className={`theme-option-swatch ${option.id}`}><ThemeSymbol theme={option.id} /></span>
            <span className="theme-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
            <span className="theme-option-check" aria-hidden="true">✓</span>
          </button>
        ))}
      </div>
    </div>
  )
}
