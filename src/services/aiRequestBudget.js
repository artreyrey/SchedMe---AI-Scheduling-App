const memoryStore = new Map()

export const DEFAULT_AI_REQUEST_LIMITS = Object.freeze({
  minuteLimit: 10,
  dailyLimit: 50,
})

function configuredLimit(name, fallback) {
  const value = Number(import.meta.env?.[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function storageKey(uid) {
  return `schedme-ai-budget:${uid}`
}

function readUsage(uid) {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(storageKey(uid)) || 'null')
    if (parsed && Array.isArray(parsed.requests)) return parsed.requests.filter(Number.isFinite)
  } catch { /* Fall back to memory when storage is unavailable. */ }
  return memoryStore.get(uid) || []
}

function writeUsage(uid, requests) {
  memoryStore.set(uid, requests)
  try { globalThis.localStorage?.setItem(storageKey(uid), JSON.stringify({ requests })) }
  catch { /* Memory limiting still protects this tab. */ }
}

function budgetError(code, message, retryAfterMs) {
  const error = new Error(message)
  error.code = code
  error.retryAfterMs = retryAfterMs
  return error
}

function usageSnapshot(uid, now, limits) {
  const minuteLimit = limits.minuteLimit || configuredLimit('VITE_AI_MINUTE_REQUEST_LIMIT', DEFAULT_AI_REQUEST_LIMITS.minuteLimit)
  const dailyLimit = limits.dailyLimit || configuredLimit('VITE_AI_DAILY_REQUEST_LIMIT', DEFAULT_AI_REQUEST_LIMITS.dailyLimit)
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const requests = readUsage(uid).filter((timestamp) => timestamp >= dayStart.getTime() && timestamp <= now)
  const recent = requests.filter((timestamp) => timestamp > now - 60_000)
  return { minuteLimit, dailyLimit, dayStart, requests, recent }
}

export function getAiRequestBudgetStatus(uid, now = Date.now(), limits = {}) {
  const snapshot = usageSnapshot(uid, now, limits)
  return {
    minuteUsed: snapshot.recent.length,
    minuteLimit: snapshot.minuteLimit,
    minuteRemaining: Math.max(0, snapshot.minuteLimit - snapshot.recent.length),
    dailyUsed: snapshot.requests.length,
    dailyLimit: snapshot.dailyLimit,
    dailyRemaining: Math.max(0, snapshot.dailyLimit - snapshot.requests.length),
  }
}

export function consumeAiRequestBudget(uid, now = Date.now(), limits = {}) {
  const { minuteLimit, dailyLimit, dayStart, requests, recent } = usageSnapshot(uid, now, limits)
  if (requests.length >= dailyLimit) {
    const tomorrow = new Date(dayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    throw budgetError('ai/local-daily-limit', 'Your daily SchedMe AI allowance is used up. Exact commands and manual calendar controls still work.', tomorrow.getTime() - now)
  }
  if (recent.length >= minuteLimit) {
    throw budgetError('ai/local-minute-limit', 'Too many AI requests were sent at once. Wait a moment and try again.', Math.max(1_000, recent[0] + 60_000 - now))
  }
  requests.push(now)
  writeUsage(uid, requests)
  return {
    minuteUsed: recent.length + 1,
    minuteLimit,
    minuteRemaining: Math.max(0, minuteLimit - recent.length - 1),
    dailyUsed: requests.length,
    dailyLimit,
    dailyRemaining: Math.max(0, dailyLimit - requests.length),
  }
}

export function clearAiRequestBudgetForTests(uid) {
  memoryStore.delete(uid)
  try { globalThis.localStorage?.removeItem(storageKey(uid)) } catch { /* Ignore unavailable storage. */ }
}
