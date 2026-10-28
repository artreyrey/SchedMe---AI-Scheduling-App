import { findTaskMatch, minutes, parseTimeWindow } from './schedulingIntent.js'

const DEFAULT_DAY_START = '08:00'
const DEFAULT_DAY_END = '22:00'

function minuteString(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function taskDuration(task, fallback = 60) {
  const start = minutes(task?.startTime)
  const end = minutes(task?.endTime)
  return start !== null && end !== null && end > start ? end - start : fallback
}

function resolveTask(action, tasks, schedulingState) {
  const activeTasks = tasks.filter((task) => !task.completed)
  const query = String(action.target?.query || '').trim()
  if (query && !/^(?:it|that|this|the task|same task)$/i.test(query)) {
    const match = findTaskMatch(query, activeTasks)
    if (!match.task && match.matches.length > 1) return { status: 'ambiguous', matches: match.matches }
    if (match.task) return { status: 'found', task: match.task }
  }
  for (const taskId of [
    action.target?.taskId,
    action.target?.taskIds?.[0],
    schedulingState.activeTaskId,
    schedulingState.lastReferencedTaskId,
    schedulingState.lastAction?.taskId,
  ]) {
    const task = taskId ? activeTasks.find((item) => item.id === taskId) : null
    if (task) return { status: 'found', task }
  }
  return { status: 'missing', matches: [] }
}

function validWindow(window) {
  const start = minutes(window?.startTime)
  const end = minutes(window?.endTime)
  return start !== null && end !== null && start < end
}

function availabilityWindow(action, text) {
  const parsedTime = parseTimeWindow(String(text || ''))
  const boundary = parsedTime?.startTime || ''
  if (/\b(?:busy|unavailable|not available)\b.*\bafter\b/i.test(text) && boundary) {
    return { startTime: DEFAULT_DAY_START, endTime: boundary }
  }
  if (/\b(?:busy|unavailable|not available)\b.*\bbefore\b/i.test(text) && boundary) {
    return { startTime: boundary, endTime: DEFAULT_DAY_END }
  }
  if (/\b(?:available|free)\b.*\bafter\b/i.test(text) && boundary) {
    return { startTime: boundary, endTime: DEFAULT_DAY_END }
  }
  if (/\b(?:available|free)\b.*\bbefore\b/i.test(text) && boundary) {
    return { startTime: DEFAULT_DAY_START, endTime: boundary }
  }
  if (/\b(?:available|free)\b/i.test(text) && parsedTime && !parsedTime.usedDefaultDuration) {
    return { startTime: parsedTime.startTime, endTime: parsedTime.endTime }
  }
  return {
    startTime: action.constraints?.afterTime || DEFAULT_DAY_START,
    endTime: action.constraints?.beforeTime || DEFAULT_DAY_END,
  }
}

function windowsForDate(availability, date) {
  const exact = availability.filter((window) => window.date === date && validWindow(window))
  if (exact.length) return exact
  return [{ date, startTime: DEFAULT_DAY_START, endTime: DEFAULT_DAY_END }]
}

export function findFreeTimeSuggestions({
  task,
  tasks = [],
  planningDates = [],
  availability = [],
  date = '',
  durationMinutes,
  limit = 3,
  currentDate = '',
  currentTime = '',
} = {}) {
  const duration = Number.isInteger(durationMinutes) && durationMinutes > 0
    ? Math.min(durationMinutes, 12 * 60)
    : taskDuration(task)
  const dates = (date ? [date] : planningDates).filter((candidateDate) => !currentDate || candidateDate >= currentDate)
  const suggestions = []

  for (const candidateDate of dates) {
    const occupied = tasks
      .filter((item) => item.id !== task?.id && !item.completed && item.date === candidateDate)
      .map((item) => ({ start: minutes(item.startTime), end: minutes(item.endTime) }))
      .filter((slot) => slot.start !== null && slot.end !== null && slot.start < slot.end)
      .sort((left, right) => left.start - right.start)

    for (const window of windowsForDate(availability, candidateDate)) {
      const windowStart = minutes(window.startTime)
      const windowEnd = minutes(window.endTime)
      const currentMinute = candidateDate === currentDate ? minutes(currentTime) : null
      let cursor = currentMinute === null ? windowStart : Math.max(windowStart, Math.ceil(currentMinute / 15) * 15)
      while (cursor + duration <= windowEnd && suggestions.length < limit) {
        const conflict = occupied.find((slot) => cursor < slot.end && slot.start < cursor + duration)
        if (conflict) {
          cursor = Math.max(cursor + 15, conflict.end)
          continue
        }
        suggestions.push({ date: candidateDate, startTime: minuteString(cursor), endTime: minuteString(cursor + duration) })
        cursor += Math.min(30, duration)
      }
      if (suggestions.length >= limit) return suggestions
    }
  }
  return suggestions
}

export function planContextAvailabilityAction({
  action,
  text,
  tasks = [],
  schedulingState = {},
  preliminary = {},
  planningDates = [],
  availability = [],
  defaultDuration = 60,
  currentDate = '',
  currentTime = '',
} = {}) {
  if (!action || !['set_availability', 'find_free_time'].includes(action.intent) || action.confidence < 0.65) {
    return { status: 'unsupported' }
  }
  if (action.destructive || action.requiresConfirmation) return { status: 'unsupported' }

  if (action.intent === 'set_availability') {
    const window = availabilityWindow(action, text)
    if (!validWindow(window)) return { status: 'clarify', reason: 'invalid_availability' }
    const selectedDate = preliminary.day?.key || action.constraints?.date || ''
    const dates = selectedDate ? [selectedDate] : planningDates
    if (!dates.length) return { status: 'clarify', reason: 'missing_date' }
    const affected = new Set(dates)
    const nextAvailability = [
      ...availability.filter((item) => !affected.has(item.date)),
      ...dates.map((date) => ({ date, ...window })),
    ]
    return { status: 'ready', operation: 'set_availability', dates, window, availability: nextAvailability }
  }

  if (action.scope !== 'single') return { status: 'unsupported' }
  const target = resolveTask(action, tasks, schedulingState)
  if (target.status === 'ambiguous') return { status: 'clarify', reason: 'ambiguous_task', matches: target.matches }
  if (target.status !== 'found') return { status: 'clarify', reason: 'missing_task', matches: [] }
  const task = target.task
  const patch = action.patch || {}
  if (patch.date && patch.startTime && patch.endTime && validWindow(patch)) {
    return { status: 'ready', operation: 'schedule', task, slot: { date: patch.date, startTime: patch.startTime, endTime: patch.endTime } }
  }
  const suggestions = findFreeTimeSuggestions({
    task,
    tasks,
    planningDates,
    availability,
    date: preliminary.day?.key || action.constraints?.date || patch.date || schedulingState.date || '',
    durationMinutes: action.constraints?.durationMinutes || patch.durationMinutes || taskDuration(task, defaultDuration),
    currentDate,
    currentTime,
  })
  if (!suggestions.length) return { status: 'clarify', reason: 'no_free_time', task }
  return { status: 'suggest', operation: 'find_free_time', task, suggestions }
}
