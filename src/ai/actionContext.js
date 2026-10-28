export const ACTION_INTENTS = Object.freeze([
  'create_task',
  'schedule_task',
  'update_task',
  'move_task',
  'unschedule_task',
  'complete_task',
  'reopen_task',
  'change_priority',
  'change_color',
  'delete_task',
  'undo',
  'find_free_time',
  'set_availability',
  'query_schedule',
  'clarify',
  'chat',
  'out_of_scope',
])

export const ACTION_SCOPES = Object.freeze(['single', 'matching', 'all'])
export const ACTION_CATEGORIES = Object.freeze(['free', 'urgent', 'important', 'urgentImportant', 'notUrgent'])

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'can', 'could', 'do', 'for', 'from', 'i', 'in', 'is', 'it', 'me', 'my',
  'of', 'on', 'please', 'that', 'the', 'this', 'to', 'we', 'with', 'would', 'you', 'your',
])

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function meaningfulTokens(value) {
  return [...new Set(normalizedText(value).split(/\s+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))]
}

function referencedTaskIds(schedulingState) {
  const ids = new Set()
  const add = (value) => { if (typeof value === 'string' && value) ids.add(value) }
  add(schedulingState?.activeTaskId)
  add(schedulingState?.pendingDeletionTaskId)
  add(schedulingState?.pendingConflict?.incomingTaskId)
  add(schedulingState?.pendingConflict?.displacedTaskId)
  add(schedulingState?.pendingAction?.target?.taskId)
  for (const id of schedulingState?.pendingAction?.target?.taskIds || []) add(id)
  add(schedulingState?.lastReferencedTaskId)
  add(schedulingState?.lastAction?.taskId)
  for (const id of schedulingState?.lastAction?.taskIds || []) add(id)
  for (const move of schedulingState?.lastAction?.moves || []) add(move?.taskId)
  for (const id of schedulingState?.recentReferencedTaskIds || []) add(id)
  return ids
}

function recentlyMentionedTaskIds(messages, tasks, limit = 8) {
  const recentText = normalizedText((Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === 'user' || message.role === 'model'))
    .slice(-6)
    .map((message) => message.text)
    .join(' '))
  if (!recentText) return []
  return tasks
    .filter((task) => task?.id && normalizedText(task.title) && recentText.includes(normalizedText(task.title)))
    .slice(0, limit)
    .map((task) => task.id)
}

function taskRelevance(task, messageText, messageTokens, contextualIds, index) {
  const title = normalizedText(task?.title)
  const titleTokens = meaningfulTokens(title)
  let score = contextualIds.has(task?.id) ? 1000 : 0
  if (title && messageText.includes(title)) score += 500
  const overlap = titleTokens.filter((token) => messageTokens.includes(token)).length
  score += overlap * 40
  if (overlap && overlap === titleTokens.length) score += 120
  if (/\b(move|reschedule|cancel|unschedule|remove)\b/.test(messageText) && task?.date) score += 10
  if (/\b(schedule|plan|book)\b/.test(messageText) && !task?.date && !task?.completed) score += 10
  return { task, score, index }
}

function compactTask(task) {
  return {
    id: String(task.id),
    title: String(task.title || '').slice(0, 240),
    category: String(task.category || 'free'),
    completed: task.completed === true,
    date: typeof task.date === 'string' ? task.date : '',
    startTime: typeof task.startTime === 'string' ? task.startTime : '',
    endTime: typeof task.endTime === 'string' ? task.endTime : '',
    urgent: task.urgent === true,
    important: task.important === true,
    color: typeof task.color === 'string' ? task.color.slice(0, 16) : '',
  }
}

export function selectRelevantTasks(message, tasks, schedulingState, limit = 8) {
  const safeLimit = Math.max(1, Math.min(12, Number(limit) || 8))
  const messageText = normalizedText(message)
  const messageTokens = meaningfulTokens(messageText)
  const contextualIds = referencedTaskIds(schedulingState)
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task && typeof task.id === 'string')
    .map((task, index) => taskRelevance(task, messageText, messageTokens, contextualIds, index))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, safeLimit)
    .map(({ task }) => compactTask(task))
}

function compactRecentTurns(messages, limit) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => item && (item.role === 'user' || item.role === 'model') && item.kind !== 'daily-greeting')
    .slice(-limit)
    .map((item) => ({ role: item.role, text: String(item.text || '').trim().slice(0, 600) }))
    .filter((item) => item.text)
}

function compactSlot(value) {
  if (!value || typeof value !== 'object') return null
  return {
    date: typeof value.date === 'string' ? value.date.slice(0, 10) : '',
    startTime: typeof value.startTime === 'string' ? value.startTime.slice(0, 5) : '',
    endTime: typeof value.endTime === 'string' ? value.endTime.slice(0, 5) : '',
  }
}

function compactLastAction(value) {
  if (!value || typeof value !== 'object') return null
  return {
    type: typeof value.type === 'string' ? value.type.slice(0, 32) : '',
    taskId: typeof value.taskId === 'string' ? value.taskId : '',
    taskIds: Array.isArray(value.taskIds) ? value.taskIds.filter((id) => typeof id === 'string').slice(0, 12) : [],
    targetTaskIds: Array.isArray(value.targetTaskIds) ? value.targetTaskIds.filter((id) => typeof id === 'string').slice(0, 12) : [],
    moves: Array.isArray(value.moves) ? value.moves.slice(0, 12).map((move) => ({
      taskId: typeof move?.taskId === 'string' ? move.taskId : '',
      previousDate: typeof move?.previousDate === 'string' ? move.previousDate.slice(0, 10) : '',
      date: typeof move?.date === 'string' ? move.date.slice(0, 10) : '',
    })) : [],
    previousSlot: compactSlot(value.previousSlot),
    slot: compactSlot(value.slot),
    previousCompleted: value.previousCompleted === true,
    targetLabel: typeof value.targetLabel === 'string' ? value.targetLabel.slice(0, 80) : '',
  }
}

function compactPendingState(value) {
  return {
    activeTaskId: typeof value?.activeTaskId === 'string' ? value.activeTaskId : '',
    mode: typeof value?.mode === 'string' ? value.mode.slice(0, 24) : 'schedule',
    date: typeof value?.date === 'string' ? value.date : '',
    startTime: typeof value?.startTime === 'string' ? value.startTime : '',
    endTime: typeof value?.endTime === 'string' ? value.endTime : '',
    queueMode: value?.queueMode === true,
    deferredTaskIds: Array.isArray(value?.deferredTaskIds) ? value.deferredTaskIds.filter((id) => typeof id === 'string').slice(0, 12) : [],
    pendingConflict: value?.pendingConflict ? {
      incomingTaskId: String(value.pendingConflict.incomingTaskId || ''),
      displacedTaskId: String(value.pendingConflict.displacedTaskId || ''),
      slot: compactSlot(value.pendingConflict.slot),
    } : null,
    pendingDeletionTaskId: typeof value?.pendingDeletionTaskId === 'string' ? value.pendingDeletionTaskId : '',
    pendingAction: value?.pendingAction ? {
      id: String(value.pendingAction.id || '').slice(0, 80),
      intent: String(value.pendingAction.intent || '').slice(0, 40),
      scope: String(value.pendingAction.scope || 'single').slice(0, 20),
      target: {
        taskId: String(value.pendingAction.target?.taskId || ''),
        taskIds: Array.isArray(value.pendingAction.target?.taskIds) ? value.pendingAction.target.taskIds.slice(0, 12) : [],
        query: String(value.pendingAction.target?.query || '').slice(0, 240),
      },
      patch: value.pendingAction.patch || {},
      constraints: value.pendingAction.constraints || {},
      missingFields: Array.isArray(value.pendingAction.missingFields) ? value.pendingAction.missingFields.slice(0, 8) : [],
      reason: String(value.pendingAction.reason || '').slice(0, 40),
      awaitingConfirmation: value.pendingAction.awaitingConfirmation === true,
      expiresAt: Number(value.pendingAction.expiresAt) || 0,
    } : null,
    lastReferencedTaskId: typeof value?.lastReferencedTaskId === 'string' ? value.lastReferencedTaskId : '',
    lastAction: compactLastAction(value?.lastAction),
  }
}

function selectRelevantPreferences(message, preferences, limit = 6) {
  const messageTokens = meaningfulTokens(message)
  return (Array.isArray(preferences) ? preferences : [])
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item, index) => ({
      item: item.trim().slice(0, 240),
      index,
      score: meaningfulTokens(item).filter((token) => messageTokens.includes(token)).length,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item)
}

export function buildCompactActionContext({
  message,
  messages = [],
  tasks = [],
  schedulingState = {},
  memory = {},
  interactionProfile = {},
  currentDate = '',
  timezone = 'UTC',
  availability = [],
  recentTurnLimit = 8,
  taskLimit = 8,
} = {}) {
  const userMessage = String(message || '').trim().slice(0, 2000)
  const recentReferencedTaskIds = recentlyMentionedTaskIds(messages, tasks, taskLimit)
  const contextualState = { ...schedulingState, recentReferencedTaskIds }
  return {
    version: 1,
    userMessage,
    currentDate: String(currentDate || '').slice(0, 10),
    timezone: String(timezone || 'UTC').slice(0, 80),
    recentTurns: compactRecentTurns(messages, Math.max(2, Math.min(12, Number(recentTurnLimit) || 8))),
    state: { ...compactPendingState(schedulingState), recentReferencedTaskIds },
    availability: (Array.isArray(availability) ? availability : []).slice(0, 14).map((window) => ({
      date: safeDate(window?.date),
      startTime: safeTime(window?.startTime),
      endTime: safeTime(window?.endTime),
    })).filter((window) => window.date && window.startTime && window.endTime),
    taskCandidates: selectRelevantTasks(userMessage, tasks, contextualState, taskLimit),
    userSettings: {
      defaultDurationMinutes: [30, 45, 60, 90, 120].includes(Number(memory?.defaultDuration)) ? Number(memory.defaultDuration) : 60,
      prefersConcise: interactionProfile?.prefersConcise === true,
      preferences: selectRelevantPreferences(userMessage, memory?.preferences),
    },
  }
}

function safeString(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function safeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : ''
}

function safeTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? value : ''
}

function safeInteger(value, minimum, maximum) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : null
}

export function normalizeActionIntent(value, candidateTaskIds = []) {
  if (!value || typeof value !== 'object') throw new Error('Gemini returned an invalid action intent.')
  if (!ACTION_INTENTS.includes(value.intent)) throw new Error('Gemini returned an unsupported action intent.')
  const allowedIds = new Set(candidateTaskIds.filter((id) => typeof id === 'string'))
  const suppliedIds = [value.target?.taskId, ...(Array.isArray(value.target?.taskIds) ? value.target.taskIds : [])]
    .filter((id) => typeof id === 'string' && id)
  const validIds = [...new Set(suppliedIds.filter((id) => allowedIds.has(id)))]
  const invalidTargetIds = [...new Set(suppliedIds.filter((id) => !allowedIds.has(id)))]
  const patch = {}
  const title = safeString(value.patch?.title, 240)
  const date = safeDate(value.patch?.date)
  const startTime = safeTime(value.patch?.startTime)
  const endTime = safeTime(value.patch?.endTime)
  const color = /^#[0-9a-f]{6}$/i.test(value.patch?.color || '') ? value.patch.color.toLowerCase() : ''
  const timeShiftMinutes = safeInteger(value.patch?.timeShiftMinutes, -10080, 10080)
  const durationMinutes = safeInteger(value.patch?.durationMinutes, 1, 1440)
  if (title) patch.title = title
  if (date) patch.date = date
  if (startTime) patch.startTime = startTime
  if (endTime) patch.endTime = endTime
  if (ACTION_CATEGORIES.includes(value.patch?.category)) patch.category = value.patch.category
  if (color) patch.color = color
  if (typeof value.patch?.completed === 'boolean') patch.completed = value.patch.completed
  if (timeShiftMinutes !== null) patch.timeShiftMinutes = timeShiftMinutes
  if (durationMinutes !== null) patch.durationMinutes = durationMinutes

  const constraints = {}
  const constraintDate = safeDate(value.constraints?.date)
  const afterTime = safeTime(value.constraints?.afterTime)
  const beforeTime = safeTime(value.constraints?.beforeTime)
  const constraintDuration = safeInteger(value.constraints?.durationMinutes, 1, 1440)
  if (constraintDate) constraints.date = constraintDate
  if (afterTime) constraints.afterTime = afterTime
  if (beforeTime) constraints.beforeTime = beforeTime
  if (constraintDuration !== null) constraints.durationMinutes = constraintDuration
  if (typeof value.constraints?.freeTimeOnly === 'boolean') constraints.freeTimeOnly = value.constraints.freeTimeOnly

  return {
    intent: value.intent,
    confidence: Number.isFinite(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : 0,
    scope: ACTION_SCOPES.includes(value.scope) ? value.scope : 'single',
    target: {
      taskId: validIds[0] || '',
      taskIds: validIds,
      query: safeString(value.target?.query, 240),
    },
    patch,
    constraints,
    missingFields: Array.isArray(value.missingFields)
      ? [...new Set(value.missingFields.filter((item) => typeof item === 'string').map((item) => item.trim().slice(0, 40)).filter(Boolean))].slice(0, 8)
      : [],
    clarificationQuestion: safeString(value.clarificationQuestion, 300),
    requiresConfirmation: value.requiresConfirmation === true,
    destructive: value.intent === 'delete_task' || value.destructive === true,
    preserveUnspecified: true,
    invalidTargetIds,
  }
}
