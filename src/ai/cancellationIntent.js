export function isCancellationMessage(text) {
  return /\b(?:cancelled|canceled|called off|not happening anymore|no longer happening)\b/i.test(text)
}

export function wantsFullCancellationRemoval(text) {
  const mentionsRemoval = /\b(?:remove|delete)\b/i.test(text)
  const mentionsTaskStorage = /\b(?:task|what(?:'|’)?s on my mind|inbox|list)\b/i.test(text)
  const includesBothIntent = /\b(?:both|also|and|entirely|completely|permanently)\b/i.test(text)
  return mentionsRemoval && mentionsTaskStorage && includesBothIntent
}

export function confirmsTaskDeletion(text) {
  return /^(?:yes|yeah|yep|sure|okay|ok)(?:\b|[,.!])/i.test(text.trim())
    || /\b(?:remove|delete)\s+(?:it|the task|that task)\b/i.test(text)
}

export function declinesTaskDeletion(text) {
  return /^(?:no|nope|not now|later)\b/i.test(text.trim())
    || /\b(?:keep|leave|retain)\s+(?:it|the task|that task)\b/i.test(text)
}

export function wantsToScheduleAnotherTask(text) {
  return /\b(?:schedule|plan)\b.*\b(?:another|other|next)\s+task\b/i.test(text)
    || /\b(?:another|other|next)\s+task\b.*\b(?:schedule|plan)\b/i.test(text)
}
