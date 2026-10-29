export const AI_ALLOWANCE_WARNING_LEVELS = Object.freeze([30, 20, 10])

export function isAiAllowanceStatusRequest(value) {
  const text = String(value || '').trim()
  if (!text) return false
  const subject = /\b(?:tokens?|requests?|allowance|quota|ai usage|gemini usage)\b/i.test(text)
  const status = /\b(?:left|remaining|remain|available|used|usage|balance|status|limit|count)\b/i.test(text)
  const question = /\bhow\s+(?:many|much)\b/i.test(text)
  return subject && (status || question)
}

function safeCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

export function formatAiAllowanceStatus(status, telemetry) {
  const dailyLimit = safeCount(status?.dailyLimit)
  const dailyUsed = safeCount(status?.dailyUsed)
  const dailyRemaining = Math.max(0, Number.isFinite(status?.dailyRemaining) ? Math.round(status.dailyRemaining) : dailyLimit - dailyUsed)
  const tokenCount = safeCount(telemetry?.totalTokens)
  const cachedTokens = safeCount(telemetry?.cachedTokens)
  return `This device has ${dailyRemaining} of ${dailyLimit} planned SchedMe AI requests left today (${dailyUsed} used). Gemini has processed ${tokenCount.toLocaleString()} tokens today${cachedTokens ? `, including ${cachedTokens.toLocaleString()} cached tokens` : ''}. This on-device count is a usage guide, not your Google quota. Firebase AI Logic and Gemini enforce the actual limits, and Google does not provide a fixed live free-token balance. Clear task commands still work without using Gemini.`
}

export function getAiAllowanceWarning(status) {
  const remaining = Number(status?.dailyRemaining)
  if (!AI_ALLOWANCE_WARNING_LEVELS.includes(remaining)) return ''
  return `Device usage guide: ${remaining} of ${status.dailyLimit} planned SchedMe AI requests remain today. Clear task commands still work without using Gemini.`
}
