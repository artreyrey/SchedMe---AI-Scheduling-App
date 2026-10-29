const SIMPLE_MOVE_LANGUAGE = /\b(?:move|reschedule|change|adjust)\b/i
const COMPLEX_MOVE_LANGUAGE = /\b(?:earlier|later|same time|free|available|availability|busy|unavailable|whenever|wherever)\b/i
const COMPOUND_MUTATION_LANGUAGE = /\b(?:delete|erase|complete|done|undone|reopen|urgent|important|flexible|category|categorize|classify|colou?r|red|orange|yellow|green|cyan|blue|purple|pink)\b/i

function localMoveAction(text, preliminary) {
  const task = preliminary?.task
  const day = preliminary?.day
  const time = preliminary?.time
  if (!SIMPLE_MOVE_LANGUAGE.test(text) || COMPLEX_MOVE_LANGUAGE.test(text) || COMPOUND_MUTATION_LANGUAGE.test(text)) return null
  if (!task || day?.ambiguous || (!day && !time)) return null

  return {
    intent: task.date ? 'move_task' : 'schedule_task',
    confidence: 1,
    scope: 'single',
    target: { taskId: task.id, taskIds: [task.id], query: task.title },
    patch: {
      ...(day?.key ? { date: day.key } : {}),
      ...(time ? { startTime: time.startTime, endTime: time.endTime } : {}),
    },
    constraints: {},
    missingFields: [],
    requiresConfirmation: false,
    destructive: false,
    preserveUnspecified: true,
  }
}

export function getLocalCommandRoute({
  text = '',
  preliminary = {},
  bulkMoveRequest = {},
  namedTaskMoveRequest = {},
  completionRequest = {},
  namedCompletionRequest = {},
  bulkDeletionRequest = {},
  namedDeletionRequest = {},
  pendingAction = null,
} = {}) {
  if (pendingAction) return { bypassGemini: false, kind: '', action: null }
  if (bulkMoveRequest.isBulk) return { bypassGemini: true, kind: 'bulk_move', action: null }
  if (namedTaskMoveRequest.isMultiple) return { bypassGemini: true, kind: 'named_move', action: null }
  if (bulkDeletionRequest.isBulkDeletion) return { bypassGemini: true, kind: 'bulk_delete', action: null }
  if (namedDeletionRequest.isDeletion) return { bypassGemini: true, kind: 'delete', action: null }
  if (completionRequest.isCompletion || namedCompletionRequest.isMultiple) {
    return { bypassGemini: true, kind: completionRequest.completed === false || namedCompletionRequest.completed === false ? 'reopen' : 'complete', action: null }
  }
  const action = localMoveAction(String(text || ''), preliminary)
  return action
    ? { bypassGemini: true, kind: 'single_move', action }
    : { bypassGemini: false, kind: '', action: null }
}
