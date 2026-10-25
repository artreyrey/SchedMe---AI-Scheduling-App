export function maskEmailAddress(email) {
  const normalizedEmail = String(email ?? '').trim()
  const atIndex = normalizedEmail.lastIndexOf('@')

  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    return 'your email address'
  }

  const localPart = normalizedEmail.slice(0, atIndex)
  const domain = normalizedEmail.slice(atIndex + 1)

  if (localPart.length <= 2) {
    return `${localPart.slice(0, 1)}****@${domain}`
  }

  if (localPart.length <= 5) {
    return `${localPart.slice(0, 2)}****${localPart.slice(-1)}@${domain}`
  }

  return `${localPart.slice(0, 3)}****${localPart.slice(-2)}@${domain}`
}
