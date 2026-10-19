export const THEME_OPTIONS = Object.freeze([
  { id: 'light', label: 'Light', description: 'Soft monochrome' },
  { id: 'dark', label: 'Dark', description: 'Deep graphite' },
  { id: 'pink', label: 'Pink', description: 'Soft blush' },
  { id: 'berry', label: 'Berry Sunset', description: 'Peach and plum' },
  { id: 'matcha', label: 'Matcha', description: 'Calm botanical' },
  { id: 'night', label: 'Night', description: 'Midnight blue' },
])

export function resolveTheme(savedTheme, prefersDark = false) {
  if (THEME_OPTIONS.some((option) => option.id === savedTheme)) return savedTheme
  return prefersDark ? 'dark' : 'light'
}

export function themeColor(theme) {
  if (theme === 'dark') return '#1d1f1e'
  if (theme === 'pink') return '#FFE5EC'
  if (theme === 'berry') return '#4C1D3D'
  if (theme === 'matcha') return '#E3EED4'
  if (theme === 'night') return '#0B111D'
  return '#d7d8d6'
}
