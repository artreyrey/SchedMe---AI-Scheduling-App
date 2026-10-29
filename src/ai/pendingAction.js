const PENDING_ACTION_TTL_MS = 30 * 60 * 1000

function safeString(value, maximum = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function safeTarget(value) {
  return {
    taskId: safeString(value?.taskId, 120),
    taskIds: Array.isArray(value?.taskIds) ? [...new Set(value.taskIds.filter((id) => typeof id === 'string' && id))].slice(0, 20) : [],
    query: safeString(value?.query),
  }
}

function safeRecord(value, allowedKeys) {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(allowedKeys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))
}

export function normalizePendingAction(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null
  const expiresAt = Number(value.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null
  return {
    id: safeString(value.id, 80) || `pending-${Math.round(Number(value.createdAt) || now)}`,
    intent: safeString(value.intent, 40),
    scope: safeString(value.scope, 20) || 'single',
    target: safeTarget(value.target),
    patch: safeRecord(value.patch, ['title', 'date', 'startTime', 'endTime', 'category', 'color', 'completed', 'timeShiftMinutes', 'durationMinutes']),
    constraints: safeRecord(value.constraints, ['date', 'afterTime', 'beforeTime', 'durationMinutes', 'freeTimeOnly']),
    missingFields: Array.isArray(value.missingFields) ? [...new Set(value.missingFields.map((item) => safeString(item, 40)).filter(Boolean))].slice(0, 8) : [],
    reason: safeString(value.reason, 40),
    awaitingConfirmation: value.awaitingConfirmation === true,
    destructive: value.destructive === true,
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : now,
    expiresAt,
  }
}

export function createPendingAction(action, { reason = '', missingFields = [], awaitingConfirmation = false } = {}, now = Date.now()) {
  return normalizePendingAction({
    id: `pending-${now}`,
    intent: action.intent,
    scope: action.scope,
    target: action.target,
    patch: action.patch,
    constraints: action.constraints,
    missingFields,
    reason,
    awaitingConfirmation,
    destructive: action.destructive,
    createdAt: now,
    expiresAt: now + PENDING_ACTION_TTL_MS,
  }, now)
}

export function mergePendingAction(action, pendingValue, now = Date.now()) {
  const pending = normalizePendingAction(pendingValue, now)
  if (!pending) return action
  const currentTarget = action.target || {}
  const currentIdentity = currentTarget.taskId || currentTarget.taskIds?.[0] || currentTarget.query
  const pendingIdentity = pending.target.taskId || pending.target.taskIds?.[0] || pending.target.query
  const targetContinues = !currentIdentity
    || currentIdentity === pendingIdentity
    || pending.missingFields.includes('task')
  const continuePending = action.intent === pending.intent
    || ['clarify', 'chat', 'out_of_scope'].includes(action.intent)
    || targetContinues
  const taskIds = currentTarget.taskIds?.length ? currentTarget.taskIds : pending.target.taskIds
  return {
    ...action,
    intent: continuePending ? pending.intent : action.intent,
    scope: action.scope === 'single' && pending.scope !== 'single' && continuePending ? pending.scope : action.scope,
    target: {
      taskId: currentTarget.taskId || pending.target.taskId,
      taskIds,
      query: currentTarget.query || pending.target.query,
    },
    patch: { ...pending.patch, ...action.patch },
    constraints: { ...pending.constraints, ...action.constraints },
    destructive: pending.destructive || action.destructive,
    pendingActionId: pending.id,
  }
}

export function confirmedPendingAction(pendingValue, now = Date.now()) {
  const pending = normalizePendingAction(pendingValue, now)
  if (!pending) return null
  return {
    ...pending,
    confidence: 1,
    requiresConfirmation: false,
    confirmed: true,
    preserveUnspecified: true,
    invalidTargetIds: [],
  }
}
