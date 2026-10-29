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
  return `You have ${dailyRemaining} of ${dailyLimit} SchedMe AI requests left today (${dailyUsed} used). Gemini has processed ${tokenCount.toLocaleString()} tokens today${cachedTokens ? `, including ${cachedTokens.toLocaleString()} cached tokens` : ''}. Google does not provide a fixed free-token balance, so requests remaining is the reliable allowance counter. Clear task commands still work without using it.`
}

export function getAiAllowanceWarning(status) {
  const remaining = Number(status?.dailyRemaining)
  if (!AI_ALLOWANCE_WARNING_LEVELS.includes(remaining)) return ''
  return `Allowance update: ${remaining} of ${status.dailyLimit} SchedMe AI requests remain today. Clear task commands still work without using Gemini.`
}
