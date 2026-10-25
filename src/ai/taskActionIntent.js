import { findTaskMatch } from './schedulingIntent.js'

const PRIORITY_LABEL = '(?:urgent\\s*(?:and|&|\\+)\\s*important|important\\s*(?:and|&|\\+)\\s*urgent|not[\\s-]*urgent|flexible|urgent|important)'

function cleanTaskReference(value) {
  return String(value || '').trim()
    .replace(/^(?:please\s+)?(?:(?:the|my)\s+)?(?:tasks?|todos?)\s+/i, '')
    .replace(/\s+(?:tasks?|todos?)$/i, '')
    .replace(/\s+from\s+(?:(?:the|my)\s+)?(?:tasks?|task\s+list|lists?|what(?:'s| is)\s+on\s+my\s+mind).*$/i, '')
    .replace(/\s+(?:entirely|completely|permanently)$/i, '')
    .replace(/^[\s:'"“”‘’-]+|[\s,.;:!?"“”‘’-]+$/g, '')
    .trim()
}

function resolveTaskNames(namesText, tasks) {
  const reference = cleanTaskReference(namesText)
  const wholeMatch = findTaskMatch(reference, tasks, { includeCompleted: true })
  const names = reference
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map(cleanTaskReference)
    .filter(Boolean)

  if (wholeMatch.task && names.length > 1) {
    return { isMultiple: false, tasks: [wholeMatch.task], unmatchedNames: [], ambiguousNames: [] }
  }

  const matchedTasks = []
  const unmatchedNames = []
  const ambiguousNames = []
  for (const name of names) {
    const match = findTaskMatch(name, tasks, { includeCompleted: true })
    if (match.task) {
      if (!matchedTasks.some((task) => task.id === match.task.id)) matchedTasks.push(match.task)
    } else if (match.matches.length > 1) {
      ambiguousNames.push({ name, matches: match.matches })
    } else {
      unmatchedNames.push(name)
    }
  }

  return {
    isMultiple: names.length > 1,
    tasks: matchedTasks,
    unmatchedNames,
    ambiguousNames,
  }
}

function priorityFromLabel(label) {
  const normalized = String(label || '').toLocaleLowerCase().replace(/[&+]/g, 'and').replace(/-/g, ' ')
  const urgent = /\burgent\b/.test(normalized) && !/\bnot\s+urgent\b/.test(normalized)
  const important = /\bimportant\b/.test(normalized)
  return {
    category: urgent ? 'urgent' : important ? 'important' : 'notUrgent',
    alsoPriority: urgent && important,
  }
}

export function parseNamedTaskDeletionRequest(value, tasks) {
  const text = String(value || '').trim()
  const command = /\b(?:delete|remove|erase)\b/i.exec(text)
  const isCancellationFlow = /\b(?:cancelled|canceled|called off|not happening anymore|no longer happening)\b/i.test(text)
  const onlyRemovesFromCalendar = /\bfrom\s+(?:(?:the|my)\s+)?(?:schedule|calendar)\b/i.test(text)
  if (!command || isCancellationFlow || onlyRemovesFromCalendar || /\b(?:all|every)\s+(?:of\s+)?(?:my\s+)?tasks?\b/i.test(text)) {
    return { isDeletion: false, isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [] }
  }

  const namesText = text.slice(command.index + command[0].length)
    .replace(/^(?:please\s+)?(?:(?:the|my)\s+)?(?:tasks?|todos?)\s+/i, '')
    .trim()
  if (!namesText || /^(?:it|this|that|them|those|the\s+task)$/i.test(namesText)) {
    return { isDeletion: false, isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [] }
  }

  return { isDeletion: true, ...resolveTaskNames(namesText, tasks) }
}

export function parseNamedTaskPriorityRequest(value, tasks) {
  const text = String(value || '').trim()
  const command = /\b(?:mark|make|set|put|move|categorize|classify|change)\b/i.exec(text)
  if (!command) {
    return { isPriorityChange: false, isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [] }
  }

  const remainder = text.slice(command.index + command[0].length).trim()
  const destination = remainder.match(new RegExp(`\\s+(?:as|to|into|in|on|onto|under)?\\s*(?:the\\s+|my\\s+)?(${PRIORITY_LABEL})(?:\\s+(?:category|list|tasks?))?[.!?\\s]*$`, 'i'))
  if (!destination) {
    return { isPriorityChange: false, isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [] }
  }

  const namesText = remainder.slice(0, destination.index)
    .replace(/^(?:the\s+)?(?:tasks?|todos?)\s+/i, '')
    .trim()
  if (!namesText || /^(?:it|this|that|them|those|the\s+task)$/i.test(namesText)) {
    return { isPriorityChange: false, isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [] }
  }

  return {
    isPriorityChange: true,
    ...priorityFromLabel(destination[1]),
    ...resolveTaskNames(namesText, tasks),
  }
}
