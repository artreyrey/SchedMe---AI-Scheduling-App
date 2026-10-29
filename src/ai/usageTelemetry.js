export const AI_USAGE_STORAGE_KEY = 'schedme.aiUsage.v1'

function finiteCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function localDayKey(now) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function dailyUsage(storage, date) {
  const stored = JSON.parse(storage.getItem(AI_USAGE_STORAGE_KEY) || '{}')
  return stored.date === date
    ? {
        requests: 0,
        localBypasses: 0,
        localBypassByKind: {},
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        ...stored,
      }
    : { date, requests: 0, localBypasses: 0, localBypassByKind: {}, promptTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
}

export function recordAiUsageMetadata(metadata, storage = globalThis.localStorage, now = new Date()) {
  if (!metadata || !storage?.getItem || !storage?.setItem) return null
  try {
    const date = localDayKey(now)
    const current = dailyUsage(storage, date)
    const next = {
      ...current,
      requests: finiteCount(current.requests) + 1,
      promptTokens: finiteCount(current.promptTokens) + finiteCount(metadata.promptTokenCount),
      outputTokens: finiteCount(current.outputTokens) + finiteCount(metadata.candidatesTokenCount),
      totalTokens: finiteCount(current.totalTokens) + finiteCount(metadata.totalTokenCount),
      cachedTokens: finiteCount(current.cachedTokens) + finiteCount(metadata.cachedContentTokenCount),
    }
    storage.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}

export function recordLocalCommandBypass(kind, storage = globalThis.localStorage, now = new Date()) {
  if (!kind || !storage?.getItem || !storage?.setItem) return null
  try {
    const date = localDayKey(now)
    const current = dailyUsage(storage, date)
    const localBypassByKind = current.localBypassByKind && typeof current.localBypassByKind === 'object' ? current.localBypassByKind : {}
    const next = {
      ...current,
      localBypasses: finiteCount(current.localBypasses) + 1,
      localBypassByKind: {
        ...localBypassByKind,
        [kind]: finiteCount(localBypassByKind[kind]) + 1,
      },
    }
    storage.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}

export function readAiUsageTelemetry(storage = globalThis.localStorage) {
  if (!storage?.getItem) return null
  try { return JSON.parse(storage.getItem(AI_USAGE_STORAGE_KEY) || 'null') }
  catch { return null }
}

export function readTodayAiUsageTelemetry(storage = globalThis.localStorage, now = new Date()) {
  const usage = readAiUsageTelemetry(storage)
  return usage?.date === localDayKey(now) ? usage : null
}
