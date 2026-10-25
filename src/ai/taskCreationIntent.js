const SCHEDULE_WORD = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|morning|afternoon|evening|night|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))'
const PRIORITY_LABEL = '(?:urgent\\s*(?:and|&|\\+)\\s*important|important\\s*(?:and|&|\\+)\\s*urgent|not[\\s-]*urgent|flexible|urgent|important)'
const PRIORITY_DESTINATION = `(?:in|into|on|onto|to|under|as)\\s+(?:(?:the|my)\\s+)?${PRIORITY_LABEL}(?:\\s+(?:category|list|tasks?))?`
const TASK_COLOR_LABEL = '(?:red|orange|yellow|green|cyan|blue|purple|pink)'
const TASK_COLOR_VALUES = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
}

function parseRequestedPriority(value) {
  const text = String(value || '')
  const beforeTask = text.match(new RegExp(`\\b(${PRIORITY_LABEL})\\s+(?:task|todo)\\b`, 'i'))?.[1]
  const destination = text.match(new RegExp(`\\b(?:in|into|on|onto|to|under|as)\\s+(?:(?:the|my)\\s+)?(${PRIORITY_LABEL})(?:\\s+(?:category|list|tasks?))?\\b`, 'i'))?.[1]
  const isNoLongerUrgent = /\b(?:is\s+not|isn['’]?t|isnt|is\s+no\s+longer)\s+urgent\b/i.test(text)
  const predicate = text.match(new RegExp(`\\b(?:is|should\\s+be)\\s+(${PRIORITY_LABEL})\\b`, 'i'))?.[1]
  const commandPredicate = text.match(new RegExp(`\\b(?:make|set|mark)\\s+(?:it|this|the\\s+task)\\s+(?:as\\s+)?(${PRIORITY_LABEL})\\b`, 'i'))?.[1]
  const label = isNoLongerUrgent ? 'not urgent' : destination || beforeTask || predicate || commandPredicate
  if (!label) return null

  const normalized = label.toLocaleLowerCase().replace(/[&+]/g, 'and').replace(/-/g, ' ')
  const urgent = /\burgent\b/.test(normalized) && !/\bnot\s+urgent\b/.test(normalized)
  const important = /\bimportant\b/.test(normalized)
  return {
    category: urgent ? 'urgent' : important ? 'important' : 'notUrgent',
    alsoPriority: urgent && important,
  }
}

export function parseTaskAttributesIntent(value) {
  const text = String(value || '').trim()
  const priority = parseRequestedPriority(text) || {}
  const colorName = text.match(/\b(?:put|make|set|use|give|with)\s+(?:it\s+)?(?:a\s+)?(red|orange|yellow|green|cyan|blue|purple|pink)(?:\s+colou?r)?\b/i)?.[1]
    || text.match(/\bcolou?r\s+(?:to\s+)?(red|orange|yellow|green|cyan|blue|purple|pink)\b/i)?.[1]

  return {
    ...priority,
    ...(colorName ? { color: TASK_COLOR_VALUES[colorName.toLocaleLowerCase()], colorMode: 'manual' } : {}),
  }
}

function cleanColorChangeTitle(value) {
  const title = String(value || '')
    .replace(/^(?:the|my)\s+/i, '')
    .replace(/\s+(?:task|todo)$/i, '')
    .replace(/^[\s:'"-]+|[\s,.;:!?"'-]+$/g, '')
    .trim()
  return /^(?:it|this|that|task|todo)$/i.test(title) ? '' : title
}

export function parseTaskColorChangeIntent(value) {
  const text = String(value || '').trim()
  const patterns = [
    new RegExp(`\\b(?:change|set|update)\\s+(?:the\\s+)?(.+?)\\s+(?:task\\s+)?colou?r\\s+(?:to|as)\\s+(?:a\\s+)?(${TASK_COLOR_LABEL})\\b`, 'i'),
    new RegExp(`\\b(?:change|set|update)\\s+(?:the\\s+)?colou?r\\s+(?:of|for)\\s+(?:the\\s+)?(.+?)\\s+(?:to|as)\\s+(?:a\\s+)?(${TASK_COLOR_LABEL})\\b`, 'i'),
    new RegExp(`\\b(?:make|turn)\\s+(?:the\\s+)?(.+?)\\s+(?:task\\s+)?(?:colou?r\\s+)?(${TASK_COLOR_LABEL})\\b`, 'i'),
    new RegExp(`\\b(?:change|set|update|turn)\\s+(?:the\\s+)?(.+?)\\s+(?:task\\s+)?(?:to|into)\\s+(?:a\\s+)?(${TASK_COLOR_LABEL})\\b`, 'i'),
  ]
  const match = patterns.map((pattern) => text.match(pattern)).find(Boolean)
  if (!match) return { isColorChange: false, title: '' }

  const colorName = match[2].toLocaleLowerCase()
  return {
    isColorChange: true,
    title: cleanColorChangeTitle(match[1]),
    color: TASK_COLOR_VALUES[colorName],
    colorName,
    colorMode: 'manual',
  }
}

function cleanTaskTitle(value) {
  return String(value || '')
    .replace(/^(?:in|on|to)\s+(?:my\s+)?what(?:'s|\s+is|s)?\s+on\s+my\s+mind\s+(?:about|for|called|named)\s+/i, '')
    .replace(new RegExp(`\\s+(?:on|for|at|in|during|this|of)\\s+(?=${SCHEDULE_WORD}).*$`, 'i'), '')
    .replace(new RegExp(`\\s+${PRIORITY_DESTINATION}.*$`, 'i'), '')
    .replace(/\s+(?:to|into)\s+(?:my\s+)?(?:schedule|calendar|tasks?|task list|what(?:'s| is) on my mind).*$/i, '')
    .replace(/\s*[,;]\s*(?:let'?s|we can|but|and)\s+schedule\b.*$/i, '')
    .replace(/\s+as\s+(?:a|an)$/i, '')
    .replace(/^[\s:'"-]+|[\s,.;:!?"'-]+$/g, '')
    .trim()
}

export function parseTaskCategoryIntent(value) {
  const text = String(value || '').trim()
  const priority = parseRequestedPriority(text)
  const hasCategoryVerb = /\b(?:put|move|mark|categorize|classify|change|set)\b/i.test(text)
  const hasCategoryPredicate = /\b(?:is|isn['’]?t|isnt|should\s+be)\b/i.test(text)
  if (!priority || (!hasCategoryVerb && !hasCategoryPredicate)) return { isCategoryChange: false, title: '' }

  const title = (hasCategoryVerb ? text
    .replace(/^.*?\b(?:put|move|mark|categorize|classify|change|set)\s+(?:the\s+)?(?:task\s+)?/i, '')
    .replace(new RegExp(`\\s+${PRIORITY_DESTINATION}.*$`, 'i'), '')
    : text.replace(/\s+\b(?:is\s+not|isn['’]?t|isnt|is\s+no\s+longer|is|should\s+be)\b.*$/i, ''))
    .replace(/\s+(?:task|todo)$/i, '')
    .replace(/^[\s:'"-]+|[\s,.;:!?"'-]+$/g, '')
    .trim()

  return { isCategoryChange: true, title, ...priority }
}

export function parseTaskCreationIntent(value) {
  const text = String(value || '').trim()
  const creationVerb = /\b(?:create|add|make)\b/i.exec(text)
  const taskMention = /\b(?:task|todo)\b/i.exec(text)
  if (!creationVerb || !taskMention || creationVerb.index > taskMention.index) return { isCreation: false, title: '' }
  const priority = parseRequestedPriority(text)

  const beforeTask = text.match(/\b(?:create|add|make)\s+(?:me\s+)?(?:(?:a|an)\s+)?(.+?)\s+(?:task|todo)\b/i)?.[1]
  if (beforeTask && !new RegExp(`^(?:a|an|new|a new|an new|another|${PRIORITY_LABEL})$`, 'i').test(beforeTask.trim())) {
    return { isCreation: true, title: cleanTaskTitle(beforeTask), ...(priority || {}) }
  }

  const afterTask = text.match(new RegExp(`\\b(?:create|add|make)\\s+(?:me\\s+)?(?:(?:a|an|new)\\s+)*(?:${PRIORITY_LABEL}\\s+)?(?:task|todo)(?:\\s+(?:called|named|for|about))?\\s*[:\\-]?\\s*(.*)$`, 'i'))?.[1]
  return { isCreation: true, title: cleanTaskTitle(afterTask), ...(priority || {}) }
}
