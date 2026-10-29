import { findTaskMatch, getMondayWeek, parseTaskDate } from './schedulingIntent.js'

const INCOMPLETE_LANGUAGE = /\b(?:unmark|reopen|unfinished|incomplete|undone)\b|\b(?:not|isn['â€™]?t|aren['â€™]?t)\s+(?:done|complete|completed)\b|\b(?:active|open)\s+again\b/i
const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export function isTaskCompletionMessage(value) {
  const text = String(value || '').trim().toLocaleLowerCase()
  if (!text) return false
  return /\b(?:mark|set|make|unmark)\b.{0,70}\b(?:done|complete|completed|incomplete|unfinished|undone)\b/i.test(text)
    || /\breopen\b.{0,70}\b(?:task|tasks|it|this|that|them)\b/i.test(text)
    || /\b(?:task|tasks|it|this|that|them|[a-z][a-z0-9'-]*)\s+(?:is|was|are)\s+(?:already\s+)?(?:done|complete|completed|incomplete|unfinished)\b/i.test(text)
    || /\b(?:i(?:'ve| have)?\s+)?(?:finished|completed|did)\b.{0,50}\b(?:task|it|this|that|[a-z][a-z0-9'-]*)\b/i.test(text)
    || /\b(?:done|finished)\s+with\b/i.test(text)
}

function isPlainWeekdayReference(text, day) {
  return Number.isInteger(day?.index)
    && !/\b(?:next|today|tomorrow|tommorow|tomorow)\b/i.test(text)
    && !/\b(?:in\s*)?(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:days?|weeks?|months?)\b/i.test(text)
}

export function parseTaskCompletionRequest(value, weekDays = getMondayWeek(), now = new Date()) {
  const text = String(value || '').trim()
  if (!isTaskCompletionMessage(text)) return { isCompletion: false, isBulk: false, completed: true, day: null, days: [] }

  const completed = !INCOMPLETE_LANGUAGE.test(text)
  let day = parseTaskDate(text, now, weekDays)
  if (day && isPlainWeekdayReference(text, day) && weekDays[day.index]) {
    day = { ...weekDays[day.index], token: day.token }
  }
  const weekdayDays = WEEKDAY_NAMES.flatMap((weekday, index) => {
    if (!new RegExp(`\\b${weekday}\\b`, 'i').test(text) || !weekDays[index]) return []
    return [{ ...weekDays[index], label: weekDays[index].label || weekday[0].toUpperCase() + weekday.slice(1), token: weekday }]
  })
  const days = weekdayDays.length > 1 ? weekdayDays : day ? [day] : []
  if (days.length) day = days[0]
  const allTasks = /\b(?:all|every)\b.{0,30}\b(?:my\s+)?tasks?\b|\b(?:all|every)\s+of\s+(?:my\s+)?(?:tasks?|them)\b/i.test(text)
  const datedTasks = Boolean(days.length && /\btasks\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)['â€™]s\s+tasks?\b/i.test(text))
  return { isCompletion: true, isBulk: allTasks || datedTasks, completed, day, days }
}

function taskIdsFromLastAction(lastAction) {
  if (lastAction?.type === 'bulk-completion') {
    const ids = Array.isArray(lastAction.targetTaskIds) && lastAction.targetTaskIds.length
      ? lastAction.targetTaskIds
      : lastAction.taskIds
    return Array.isArray(ids) ? ids.filter((taskId) => typeof taskId === 'string' && taskId) : []
  }
  if (lastAction?.type === 'bulk-move' && Array.isArray(lastAction.moves)) {
    return lastAction.moves.map((move) => move?.taskId).filter((taskId) => typeof taskId === 'string' && taskId)
  }
  return []
}

export function applyTaskCompletionContext(request, value, previousRequest, lastAction) {
  const text = String(value || '').trim()
  const referencesGroup = /\b(?:them|those|all(?:\s+of)?\s+(?:them|those)|every(?:\s+one)?)\b/i.test(text)
  const taskIds = taskIdsFromLastAction(lastAction)
  if (request?.isCompletion && !request.isBulk && referencesGroup && taskIds.length) {
    return {
      ...request,
      isBulk: true,
      targetTaskIds: taskIds,
      targetLabel: typeof lastAction?.targetLabel === 'string' ? lastAction.targetLabel : '',
    }
  }
  if (!request?.isCompletion && referencesGroup && previousRequest?.isCompletion) {
    if (taskIds.length) {
      return {
        ...previousRequest,
        isBulk: true,
        targetTaskIds: taskIds,
        targetLabel: typeof lastAction?.targetLabel === 'string' ? lastAction.targetLabel : '',
      }
    }
    if (previousRequest.isBulk) return previousRequest
  }
  return request
}

function cleanTaskReference(value) {
  return String(value || '').trim()
    .replace(/^(?:please\s+)?(?:mark|set|make|unmark|reopen)\s+(?:the\s+)?/i, '')
    .replace(/\s+(?:as\s+)?(?:not\s+)?(?:done|complete|completed|incomplete|unfinished|undone)(?:\s+again)?[.!?\s]*$/i, '')
    .replace(/^[\s:'"â€œâ€â€˜â€™-]+|[\s,.;:!?"â€œâ€â€˜â€™-]+$/g, '')
    .trim()
}

export function parseNamedTaskCompletionRequest(value, tasks) {
  const text = String(value || '').trim()
  if (!isTaskCompletionMessage(text) || /\b(?:all|every)\b/i.test(text)) {
    return { isMultiple: false, completed: true, tasks: [], unmatchedNames: [], ambiguousNames: [] }
  }

  const completed = !INCOMPLETE_LANGUAGE.test(text)
  const reference = cleanTaskReference(text)
  const wholeMatch = findTaskMatch(reference, tasks, { includeCompleted: true })
  const names = reference.split(/\s*(?:,|&|\band\b)\s*/i).map(cleanTaskReference).filter(Boolean)
  if (names.length < 2 || wholeMatch.task) {
    return { isMultiple: false, completed, tasks: [], unmatchedNames: [], ambiguousNames: [] }
  }

  const matchedTasks = []
  const unmatchedNames = []
  const ambiguousNames = []
  for (const name of names) {
    const match = findTaskMatch(name, tasks, { includeCompleted: true })
    if (match.task) {
      if (!matchedTasks.some((task) => task.id === match.task.id)) matchedTasks.push(match.task)
    } else if (match.matches.length > 1) ambiguousNames.push({ name, matches: match.matches })
    else unmatchedNames.push(name)
  }
  return { isMultiple: true, completed, tasks: matchedTasks, unmatchedNames, ambiguousNames }
}
