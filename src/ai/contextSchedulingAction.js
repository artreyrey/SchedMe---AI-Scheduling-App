import { findTaskMatch, minutes, planNamedTaskMoves } from './schedulingIntent.js'

const CONTEXT_SCHEDULING_INTENTS = new Set(['move_task', 'schedule_task', 'update_task', 'clarify'])

function isStopOrSpecialCommand(text) {
  return /^(?:undo|stop|cancel|skip|later|not now|yes|no|replace|delete|remove)[.\s!]*$/i.test(String(text || '').trim())
}

export function shouldInterpretContextScheduling({ text, schedulingState = {}, preliminary = {} } = {}) {
  if (schedulingState.pendingDeletionTaskId || isStopOrSpecialCommand(text)) return false
  const value = String(text || '')
  if (schedulingState.pendingConflict) {
    if (/\b(replace|another time|keep the existing|keep it|choose another|do not move|don't move)\b/i.test(value)) return false
    return Boolean(preliminary.day || preliminary.time || /\b(actually|instead|earlier|later|correction)\b/i.test(value))
  }
  if (/\b(move|reschedule|shift)\b/i.test(value)) return true
  if (/\b(?:free time|when\s+(?:i(?:'m| am)?\s+)?free|where\s+(?:i(?:'m| am)?\s+)?free|availability|available|busy|unavailable)\b/i.test(value)) return true
  if (/\b(change|adjust)\b/i.test(value) && (preliminary.day || preliminary.time || /\b(earlier|later|date|day|time)\b/i.test(value))) return true
  if ((schedulingState.lastReferencedTaskId || schedulingState.lastAction?.taskId) && /\b(same|actually|instead|earlier|later|unchanged|keep|correction)\b/i.test(value)) return true
  if (!schedulingState.activeTaskId) return schedulingState.mode === 'move' || Boolean(schedulingState.date || schedulingState.startTime)
  if (schedulingState.mode === 'move') return true
  if (/\b(same|actually|instead|earlier|later|unchanged|keep|correction)\b/i.test(value)) return true
  const activeTaskHasStoredTime = preliminary.task?.startTime && preliminary.task?.endTime
  return Boolean(preliminary.day && !preliminary.time && activeTaskHasStoredTime)
}

function minuteString(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function durationOf(task) {
  const start = minutes(task?.startTime)
  const end = minutes(task?.endTime)
  return start !== null && end !== null && end > start ? end - start : null
}

function slotsEqual(left, right) {
  return Boolean(left && right
    && left.date === right.date
    && left.startTime === right.startTime
    && left.endTime === right.endTime)
}

export function getTrustedRecentSlot(schedulingState, task) {
  const action = schedulingState?.lastAction
  if (!action?.slot || action.taskId !== task?.id) return null
  const taskSlot = task.date ? { date: task.date, startTime: task.startTime, endTime: task.endTime } : null
  if (slotsEqual(taskSlot, action.slot) || slotsEqual(taskSlot, action.previousSlot)) return action.slot
  if (!taskSlot && !action.previousSlot) return action.slot
  return null
}

function resolveTarget(action, tasks, schedulingState) {
  const activeTasks = tasks.filter((task) => !task.completed)
  const query = action.target?.query?.trim() || ''
  if (query && !/^(?:it|that|this|the task|same task)$/i.test(query)) {
    const match = findTaskMatch(query, activeTasks)
    if (!match.task && match.matches.length > 1) return { status: 'ambiguous', matches: match.matches }
    if (match.task) return { status: 'found', task: match.task }
  }
  const suppliedId = action.target?.taskId || action.target?.taskIds?.[0]
  const suppliedTask = suppliedId ? activeTasks.find((task) => task.id === suppliedId) : null
  if (suppliedTask) return { status: 'found', task: suppliedTask }
  const contextualTask = schedulingState.activeTaskId
    ? activeTasks.find((task) => task.id === schedulingState.activeTaskId)
    : null
  if (contextualTask) return { status: 'found', task: contextualTask }
  const recentTaskId = schedulingState.lastReferencedTaskId || schedulingState.lastAction?.taskId
  const recentTask = recentTaskId ? activeTasks.find((task) => task.id === recentTaskId) : null
  if (recentTask) return { status: 'found', task: recentTask }
  if (query) {
    const match = findTaskMatch(query, activeTasks)
    if (!match.task && match.matches.length > 1) return { status: 'ambiguous', matches: match.matches }
    if (match.task) return { status: 'found', task: match.task }
  }
  return { status: 'missing', matches: [] }
}

function shiftedRange(startTime, endTime, shiftMinutes) {
  const start = minutes(startTime)
  const end = minutes(endTime)
  if (start === null || end === null || end <= start) return null
  const shiftedStart = start + shiftMinutes
  const shiftedEnd = end + shiftMinutes
  if (shiftedStart < 0 || shiftedEnd > 24 * 60) return null
  return { startTime: minuteString(shiftedStart), endTime: minuteString(shiftedEnd) }
}

function endFromDuration(startTime, durationMinutes) {
  const start = minutes(startTime)
  if (start === null || !Number.isInteger(durationMinutes) || durationMinutes < 1 || start + durationMinutes > 24 * 60) return ''
  return minuteString(start + durationMinutes)
}

export function planContextSchedulingAction({ action, text, tasks = [], schedulingState = {}, preliminary = {} } = {}) {
  if (!action || !CONTEXT_SCHEDULING_INTENTS.has(action.intent)) return { status: 'unsupported' }
  if (action.confidence < 0.65) return { status: 'unsupported' }
  if (action.destructive || action.requiresConfirmation) return { status: 'unsupported' }

  if (action.scope !== 'single') {
    const targetIds = [...new Set(action.target?.taskIds || [])]
    const selectedTasks = targetIds.map((id) => tasks.find((task) => task.id === id && !task.completed)).filter(Boolean)
    const destinationDate = preliminary.day?.key || action.patch?.date || schedulingState.date || ''
    if (!selectedTasks.length || selectedTasks.length !== targetIds.length) {
      return { status: 'clarify', reason: 'missing_task', matches: [] }
    }
    if (!destinationDate) return { status: 'clarify', reason: 'missing_date', tasks: selectedTasks }
    if (selectedTasks.some((task) => !task.date || !task.startTime || !task.endTime)) {
      return { status: 'clarify', reason: 'missing_time', tasks: selectedTasks, date: destinationDate }
    }
    const plan = planNamedTaskMoves(tasks, selectedTasks, destinationDate)
    if (plan.conflicts.length) return { status: 'clarify', reason: 'bulk_conflict', tasks: selectedTasks, conflict: plan.conflicts[0] }
    if (!plan.updates.length) return { status: 'unchanged_many', tasks: selectedTasks, date: destinationDate }
    return { status: 'ready_many', tasks: selectedTasks, updates: plan.updates, date: destinationDate, sourceText: String(text || '') }
  }

  const target = resolveTarget(action, tasks, schedulingState)
  if (target.status === 'ambiguous') return { status: 'clarify', reason: 'ambiguous_task', matches: target.matches }
  if (target.status !== 'found') return { status: 'clarify', reason: 'missing_task', matches: [] }
  const task = target.task

  if (preliminary.day?.ambiguous) {
    return { status: 'clarify', reason: 'ambiguous_day', task, choices: preliminary.day.ambiguous }
  }

  const patch = action.patch || {}
  const recentSlot = getTrustedRecentSlot(schedulingState, task)
  const parsedDate = preliminary.day?.key || ''
  const date = parsedDate || patch.date || schedulingState.date || recentSlot?.date || task.date || ''
  if (!date) return { status: 'clarify', reason: 'missing_date', task }

  const explicitTime = preliminary.time || null
  let startTime = explicitTime?.startTime || patch.startTime || schedulingState.startTime || recentSlot?.startTime || task.startTime || ''
  let endTime = explicitTime?.endTime || patch.endTime || schedulingState.endTime || recentSlot?.endTime || task.endTime || ''
  const originalDuration = durationOf(recentSlot || task)

  if (explicitTime?.usedDefaultDuration && originalDuration) {
    endTime = endFromDuration(startTime, originalDuration)
  } else if (patch.durationMinutes && startTime && !patch.endTime) {
    endTime = endFromDuration(startTime, patch.durationMinutes)
  }

  if (patch.timeShiftMinutes && !explicitTime && !patch.startTime && !patch.endTime) {
    const shifted = shiftedRange(startTime, endTime, patch.timeShiftMinutes)
    if (!shifted) return { status: 'clarify', reason: 'invalid_time_shift', task, date }
    startTime = shifted.startTime
    endTime = shifted.endTime
  }

  if (!startTime || !endTime) return { status: 'clarify', reason: 'missing_time', task, date }
  const start = minutes(startTime)
  const end = minutes(endTime)
  if (start === null || end === null || start >= end) return { status: 'clarify', reason: 'invalid_time', task, date }

  const slot = { date, startTime, endTime }
  const unchanged = task.date === date && task.startTime === startTime && task.endTime === endTime
  return { status: unchanged ? 'unchanged' : 'ready', task, slot, sourceText: String(text || '') }
}
