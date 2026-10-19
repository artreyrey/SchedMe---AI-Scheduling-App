const SCHEDULE_WORD = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|morning|afternoon|evening|night|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))'

function cleanTaskTitle(value) {
  return String(value || '')
    .replace(new RegExp(`\\s+(?:on|for|at|in|during|this|of)\\s+(?=${SCHEDULE_WORD}).*$`, 'i'), '')
    .replace(/\s+(?:to|into)\s+(?:my\s+)?(?:schedule|calendar|tasks?|task list|what(?:'s| is) on my mind).*$/i, '')
    .replace(/^[\s:'"-]+|[\s,.;:!?"'-]+$/g, '')
    .trim()
}

export function parseTaskCreationIntent(value) {
  const text = String(value || '').trim()
  const hasCreationVerb = /\b(?:create|add|make)\b/i.test(text)
  const mentionsTask = /\b(?:task|todo)\b/i.test(text)
  if (!hasCreationVerb || !mentionsTask) return { isCreation: false, title: '' }

  const beforeTask = text.match(/\b(?:create|add|make)\s+(?:me\s+)?(?:(?:a|an)\s+)?(.+?)\s+(?:task|todo)\b/i)?.[1]
  if (beforeTask && !/^(?:a|an|new|a new|an new|another)$/i.test(beforeTask.trim())) {
    return { isCreation: true, title: cleanTaskTitle(beforeTask) }
  }

  const afterTask = text.match(/\b(?:create|add|make)\s+(?:me\s+)?(?:(?:a|an|new)\s+)*(?:task|todo)(?:\s+(?:called|named|for))?\s*[:\-]?\s*(.*)$/i)?.[1]
  return { isCreation: true, title: cleanTaskTitle(afterTask) }
}
