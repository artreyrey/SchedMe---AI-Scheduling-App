const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_ALIASES = new Map([
  ['m', 0], ['mon', 0], ['monday', 0], ['monay', 0],
  ['tu', 1], ['tue', 1], ['tues', 1], ['tuesday', 1], ['teusday', 1], ['tusday', 1],
  ['w', 2], ['wed', 2], ['weds', 2], ['wednesday', 2], ['wensday', 2], ['wenesday', 2], ['wednsday', 2],
  ['th', 3], ['thu', 3], ['thur', 3], ['thurs', 3], ['thursday', 3], ['thurday', 3], ['thrusday', 3],
  ['f', 4], ['fri', 4], ['friday', 4], ['firday', 4],
  ['sa', 5], ['sat', 5], ['saturday', 5], ['saterday', 5],
  ['su', 6], ['sun', 6], ['sunday', 6],
])

const DAY_TOKEN_PATTERN = 'today|tomorrow|tommorow|tomorow|monday|monay|tuesday|teusday|tusday|wednesday|wensday|wenesday|wednsday|thursday|thurday|thrusday|friday|firday|saturday|saterday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun'

const MONTH_INDEX = new Map([
  ['january', 0], ['jan', 0], ['february', 1], ['feb', 1], ['march', 2], ['mar', 2],
  ['april', 3], ['apr', 3], ['may', 4], ['june', 5], ['jun', 5], ['july', 6], ['jul', 6],
  ['august', 7], ['aug', 7], ['september', 8], ['sept', 8], ['sep', 8], ['october', 9], ['oct', 9],
  ['november', 10], ['nov', 10], ['december', 11], ['dec', 11],
])

const MONTH_TOKEN_PATTERN = [...MONTH_INDEX.keys()].join('|')

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

function addMonths(date, amount) {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

const RELATIVE_NUMBERS = new Map([
  ['a', 1], ['an', 1], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
  ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12],
])

function relativeAmount(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? numeric : RELATIVE_NUMBERS.get(value)
}

export function getMondayWeek(offset = 0, now = new Date()) {
  const daysSinceMonday = (now.getDay() + 6) % 7
  const monday = addDays(now, -daysSinceMonday + (offset * 7))
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index)
    return { date, key: localDateKey(date), label: DAY_NAMES[index], index }
  })
}

function normalizeClockText(value) {
  return value
    .toLocaleLowerCase()
    .replaceAll('a.m.', 'am')
    .replaceAll('p.m.', 'pm')
    .replaceAll('a.m', 'am')
    .replaceAll('p.m', 'pm')
}

function to24Hour(rawHour, rawMinute, marker) {
  const hour = Number(rawHour)
  const minute = Number(rawMinute || 0)
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59 || !marker) return null
  return ((hour % 12) + (marker === 'pm' ? 12 : 0)) * 60 + minute
}

function minuteString(total) {
  const normalized = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function parseTimeWindow(value, defaultDuration = 60) {
  const text = normalizeClockText(value)
  const range = text.match(/(?:^|[^\d])([0-1]?\d)(?::([0-5]\d))?\s*(am|pm)?\s*(?:-|–|—|to)\s*([0-1]?\d)(?::([0-5]\d))?\s*(am|pm)\b/i)
  if (range) {
    let startMarker = range[3]
    let endMarker = range[6]
    const startHour = Number(range[1])
    const endHour = Number(range[4])
    if (!startMarker && endMarker) {
      if (endHour === 12 && startHour !== 12) startMarker = endMarker === 'pm' ? 'am' : 'pm'
      else startMarker = endMarker === 'pm' && startHour > endHour ? 'am' : endMarker
    }
    if (startMarker && !endMarker) endMarker = startMarker
    const start = to24Hour(range[1], range[2], startMarker)
    let end = to24Hour(range[4], range[5], endMarker)
    if (start === null || end === null) return null
    if (end <= start && endMarker === startMarker) end += 12 * 60
    if (end <= start || end - start > 12 * 60 || end > 24 * 60) return null
    return { startTime: minuteString(start), endTime: minuteString(end), matchedText: range[0].trim() }
  }

  const single = text.match(/(?:^|[^\d])([0-1]?\d)(?::([0-5]\d))?\s*(am|pm)\b/i)
  if (!single) return null
  const start = to24Hour(single[1], single[2], single[3])
  if (start === null || start + defaultDuration > 24 * 60) return null
  return { startTime: minuteString(start), endTime: minuteString(start + defaultDuration), matchedText: single[0].trim(), usedDefaultDuration: true }
}

export function parseDay(value, weekDays = getMondayWeek(), now = new Date()) {
  const text = value.toLocaleLowerCase()
  const todayKey = localDateKey(now)
  const relative = text.match(/\b(?:in\s*)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(days?|weeks?|months?)\s*(?:(?:from|frm)\s*now)?\b/i)
  if (relative) {
    const amount = relativeAmount(relative[1])
    const unit = relative[2]
    const targetDate = unit.startsWith('month') ? addMonths(now, amount) : addDays(now, amount * (unit.startsWith('week') ? 7 : 1))
    const key = localDateKey(targetDate)
    const matching = weekDays.find((day) => day.key === key)
    const label = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(targetDate)
    return matching ? { ...matching, label: matching.label || label, token: relative[0] } : { date: targetDate, key, label, token: relative[0] }
  }
  if (/\b(?:tomorrow|tommorow|tomorow)\b/.test(text)) {
    const tomorrowKey = localDateKey(addDays(now, 1))
    const matching = weekDays.find((day) => day.key === tomorrowKey)
    return matching ? { ...matching, label: matching.label || 'Tomorrow', token: 'tomorrow' } : { key: tomorrowKey, label: 'Tomorrow', token: 'tomorrow' }
  }
  if (/\btoday\b/.test(text)) {
    const matching = weekDays.find((day) => day.key === todayKey)
    return matching ? { ...matching, label: matching.label || 'Today', token: 'today' } : { key: todayKey, label: 'Today', token: 'today' }
  }

  const tokens = [...text.matchAll(/\b([a-z]+)\b/g)]
  for (const match of tokens) {
    const token = match[1]
    if (token === 't') return { ambiguous: ['Tuesday', 'Thursday'], token }
    if (token === 's') return { ambiguous: ['Saturday', 'Sunday'], token }
    const index = DAY_ALIASES.get(token)
    if (index !== undefined) {
      const selected = weekDays[index]
      if (selected.key < todayKey) {
        const nextDate = addDays(selected.date, 7)
        return { ...selected, date: nextDate, key: localDateKey(nextDate), label: selected.label || DAY_NAMES[index], token }
      }
      return { ...selected, label: selected.label || DAY_NAMES[index], token }
    }
  }
  return null
}

function parseExactCalendarDate(value, now) {
  const text = String(value || '').toLocaleLowerCase()
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2]) - 1
    const day = Number(iso[3])
    const date = new Date(year, month, day, 12)
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
    return {
      date,
      key: localDateKey(date),
      label: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date),
      token: iso[0],
    }
  }
  const monthFirst = text.match(new RegExp(`\\b(${MONTH_TOKEN_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'))
  const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_TOKEN_PATTERN})(?:,?\\s+(\\d{4}))?\\b`, 'i'))
  const match = monthFirst || dayFirst
  if (!match) return null
  const monthToken = monthFirst ? match[1] : match[2]
  const day = Number(monthFirst ? match[2] : match[1])
  const year = Number(match[3] || now.getFullYear())
  const month = MONTH_INDEX.get(monthToken.toLocaleLowerCase())
  const date = new Date(year, month, day, 12)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return {
    date,
    key: localDateKey(date),
    label: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date),
    token: match[0],
  }
}

export function parseTaskDate(value, now = new Date(), weekDays = getMondayWeek(0, now)) {
  return parseExactCalendarDate(value, now) || parseDay(value, weekDays, now)
}

export function parseBulkMoveRequest(value, now = new Date()) {
  const text = String(value || '').trim()
  const hasMoveVerb = /\b(?:move|reschedule)\b/i.test(text)
  if (!hasMoveVerb) return { isBulk: false, moves: [], invalidClauses: [] }

  const nextClause = '(?=(?:(?:move|reschedule)\\s+)?(?:(?:all|every)\\s+(?:of\\s+)?)?(?:my\\s+)?(?:tasks?\\b|[^,;]+?\\s+tasks?\\s+(?:to|on)\\b))'
  const clauseSeparator = new RegExp(`\\s*;\\s*|\\s*,\\s*(?:and\\s+)?${nextClause}|\\s+(?:and|then)\\s+${nextClause}`, 'i')
  const clauses = text.split(clauseSeparator).map((clause) => clause.trim()).filter(Boolean)
  const commandPrefix = '(?:(?:please\\s+)?(?:can|could|would)\\s+you\\s+)?(?:please\\s+)?(?:(?:move|reschedule)\\s+)?(?:(?:all|every)\\s+(?:of\\s+)?)?(?:my\\s+)?'
  const taskFirstPattern = new RegExp(`^${commandPrefix}tasks?\\s+(?:scheduled\\s+)?(?:on|from|in)\\s+(.+?)\\s+(?:to|on)\\s+(.+?)$`, 'i')
  const dayFirstPattern = new RegExp(`^${commandPrefix}(.+?)(?:['’]s)?\\s+tasks?\\s+(?:to|on)\\s+(.+?)$`, 'i')
  const parsedClauses = clauses
    .map((clause) => {
      const match = clause.match(taskFirstPattern) || clause.match(dayFirstPattern)
      return match ? { sourceText: match[1].trim(), destinationText: match[2].trim() } : null
    })
    .filter(Boolean)

  const moves = []
  const invalidClauses = []
  let hasRecognizableSourceDay = false
  for (const clause of parsedClauses) {
    const source = parseTaskDate(clause.sourceText, now)
    if (source?.key && !source.ambiguous) hasRecognizableSourceDay = true
    const destinationReference = source?.date || now
    const destination = parseTaskDate(clause.destinationText, destinationReference)
    if (!source?.key || source.ambiguous || !destination?.key || destination.ambiguous) {
      invalidClauses.push({ source: clause.sourceText, destination: clause.destinationText })
      continue
    }
    moves.push({
      sourceDate: source.key,
      destinationDate: destination.key,
      sourceLabel: source.label,
      destinationLabel: destination.label,
    })
  }

  const explicitlyGrouped = /\b(?:all|every|tasks)\b/i.test(text)
  const isBulk = parsedClauses.length > 0 && (hasRecognizableSourceDay || explicitlyGrouped)
  if (!isBulk) return { isBulk: false, moves: [], invalidClauses: [] }

  const destinationBySource = new Map()
  for (const move of moves) {
    const existing = destinationBySource.get(move.sourceDate)
    if (existing && existing !== move.destinationDate) {
      invalidClauses.push({ source: move.sourceLabel, destination: 'more than one destination' })
    }
    destinationBySource.set(move.sourceDate, move.destinationDate)
  }

  return { isBulk: true, moves, invalidClauses }
}

export function parseConversationalBulkMoveRequest(value, messages = [], now = new Date()) {
  const direct = parseBulkMoveRequest(value, now)
  if (direct.isBulk) return direct
  if (!/^\s*(?:all|all of them|every one|every task|all tasks?)\s*[.!]?\s*$/i.test(String(value || ''))) return direct

  const recent = [...(Array.isArray(messages) ? messages : [])].reverse()
  const latestMessage = recent.find((message) => message?.kind !== 'daily-greeting')
  if (latestMessage?.role !== 'model'
    || !/which\s+(?:scheduled\s+)?tasks?\s+(?:would\s+you\s+like|do\s+you\s+want)\s+to\s+move/i.test(String(latestMessage.text || ''))) return direct
  const latestIndex = recent.indexOf(latestMessage)
  const originalRequest = recent.slice(latestIndex + 1).find((message) => message?.role === 'user')
  return originalRequest ? parseBulkMoveRequest(originalRequest.text, now) : direct
}

function tasksOverlap(left, right) {
  const leftStart = minutes(left.startTime)
  const leftEnd = minutes(left.endTime)
  const rightStart = minutes(right.startTime)
  const rightEnd = minutes(right.endTime)
  return leftStart !== null && leftEnd !== null && rightStart !== null && rightEnd !== null
    && leftStart < rightEnd && rightStart < leftEnd
}

function findTaskMoveConflicts(tasks, updates) {
  const updateByTask = new Map(updates.map((update) => [update.taskId, update]))
  const originalByTask = new Map(tasks.map((task) => [task.id, task]))
  const plannedTasks = tasks
    .filter((task) => !task.completed && task.date)
    .map((task) => ({ ...task, date: updateByTask.get(task.id)?.date || task.date }))
  const conflicts = []

  for (let leftIndex = 0; leftIndex < plannedTasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plannedTasks.length; rightIndex += 1) {
      const left = plannedTasks[leftIndex]
      const right = plannedTasks[rightIndex]
      if (left.date !== right.date || !tasksOverlap(left, right)) continue
      if (!updateByTask.has(left.id) && !updateByTask.has(right.id)) continue
      const originalLeft = originalByTask.get(left.id)
      const originalRight = originalByTask.get(right.id)
      const alreadyOverlapped = originalLeft?.date === originalRight?.date && tasksOverlap(originalLeft, originalRight)
      if (!alreadyOverlapped) conflicts.push({ left, right, date: left.date })
    }
  }
  return conflicts
}

export function planBulkTaskMoves(tasks, dateMoves) {
  const ruleBySource = new Map(dateMoves.map((move) => [move.sourceDate, move]))
  const updates = tasks
    .filter((task) => !task.completed && task.date && ruleBySource.has(task.date))
    .map((task) => {
      const rule = ruleBySource.get(task.date)
      return {
        taskId: task.id,
        title: task.title,
        previousDate: task.date,
        date: rule.destinationDate,
        startTime: task.startTime,
        endTime: task.endTime,
      }
    })
    .filter((update) => update.date !== update.previousDate)

  const conflicts = findTaskMoveConflicts(tasks, updates)

  const counts = dateMoves.map((move) => ({
    ...move,
    count: updates.filter((update) => update.previousDate === move.sourceDate && update.date === move.destinationDate).length,
  }))
  return { updates, conflicts, counts }
}

export function planNamedTaskMoves(tasks, selectedTasks, destinationDate) {
  const updates = selectedTasks
    .filter((task) => task.date && !task.completed && task.date !== destinationDate)
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      previousDate: task.date,
      date: destinationDate,
      startTime: task.startTime,
      endTime: task.endTime,
    }))
  return { updates, conflicts: findTaskMoveConflicts(tasks, updates) }
}

function normalizeTaskText(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(diagonal, above, previous[rightIndex - 1]) + 1
      diagonal = above
    }
  }
  return previous[right.length]
}

function wordSimilarity(left, right) {
  if (!left || !right) return 0
  return 1 - (editDistance(left, right) / Math.max(left.length, right.length))
}

const TASK_COMMAND_WORDS = new Set(['schedule', 'scheduled', 'move', 'remove', 'task', 'tasks', 'from', 'on', 'at', 'for', 'the', 'my', 'please', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow', 'tommorow', 'tomorow'])

function fuzzyTaskScore(value, title) {
  const queryWords = normalizeTaskText(value).split(' ').filter((word) => word.length > 2 && !TASK_COMMAND_WORDS.has(word))
  const titleWords = normalizeTaskText(title).split(' ').filter((word) => word.length > 2 && !TASK_COMMAND_WORDS.has(word))
  if (!queryWords.length || !titleWords.length) return 0
  const scores = titleWords.map((titleWord) => Math.max(...queryWords.map((queryWord) => wordSimilarity(queryWord, titleWord))))
  const minimum = Math.min(...scores)
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length
  const threshold = titleWords.length === 1 ? 0.8 : 0.66
  return minimum >= threshold ? average : 0
}

export function findTaskMatch(value, tasks, { scheduled, includeCompleted = false } = {}) {
  const text = normalizeTaskText(value)
  const compactText = text.replaceAll(' ', '')
  const candidates = tasks.filter((task) => (includeCompleted || !task.completed) && (scheduled === undefined || Boolean(task.date) === scheduled))
  const exact = candidates.filter((task) => text === normalizeTaskText(task.title) || compactText === normalizeTaskText(task.title).replaceAll(' ', ''))
  if (exact.length === 1) return { task: exact[0], matches: exact }

  const contained = candidates.filter((task) => {
    const title = normalizeTaskText(task.title)
    const compactTitle = title.replaceAll(' ', '')
    return text.includes(title) || title.includes(text) || compactText.includes(compactTitle) || compactTitle.includes(compactText)
  })
  if (contained.length === 1) return { task: contained[0], matches: contained }

  const words = text.split(' ').filter((word) => word.length > 2 && !TASK_COMMAND_WORDS.has(word))
  const fuzzy = candidates.filter((task) => words.some((word) => normalizeTaskText(task.title).includes(word)))
  const scored = candidates
    .map((task) => ({ task, score: fuzzyTaskScore(value, task.title) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
  if (scored.length) {
    const matches = scored.map((item) => item.task)
    const confident = scored.length === 1 || (scored[0].score - scored[1].score >= 0.12)
    return { task: confident ? scored[0].task : null, matches }
  }

  // A single partial word is useful shorthand (for example, “thesis”), but
  // one shared word must not outweigh a longer multi-word task reference.
  if (words.length === 1 && fuzzy.length === 1) return { task: fuzzy[0], matches: fuzzy }
  return { task: null, matches: fuzzy }
}

function cleanNamedTaskReference(value) {
  return String(value || '').trim()
    .replace(/^(?:please\s+)?(?:my\s+|the\s+)?/i, '')
    .replace(/\s+tasks?$/i, '')
    .replace(/^[\s:'"“”‘’-]+|[\s,.;:!?"“”‘’-]+$/g, '')
    .trim()
}

export function parseNamedTaskMoveRequest(value, tasks, weekDays = getMondayWeek(), now = new Date()) {
  const text = String(value || '').trim()
  const verb = /\b(?:move|reschedule)\b/i.exec(text)
  if (!verb) return { isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [], destination: null }

  const remainder = text.slice(verb.index + verb[0].length).trim()
  const destinationMarkers = [...remainder.matchAll(/\b(?:to|on)\b/gi)]
  let namesText = ''
  let destination = null
  for (let index = destinationMarkers.length - 1; index >= 0; index -= 1) {
    const marker = destinationMarkers[index]
    const candidate = remainder.slice(marker.index + marker[0].length).trim()
    const parsedDay = parseDay(candidate, weekDays, now)
    if (parsedDay) {
      namesText = remainder.slice(0, marker.index).trim()
      destination = parsedDay
      break
    }
  }
  if (!namesText || !destination) return { isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [], destination: null }

  const scheduledTasks = tasks.filter((task) => task.date && !task.completed)
  const wholeReference = cleanNamedTaskReference(namesText)
  const wholeMatch = findTaskMatch(wholeReference, scheduledTasks, { scheduled: true })
  const nameParts = namesText
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map(cleanNamedTaskReference)
    .filter(Boolean)

  // Keep a real task title containing “and” in the existing single-task flow.
  if (wholeMatch.task && nameParts.length > 1 && normalizeTaskText(wholeReference).includes(normalizeTaskText(wholeMatch.task.title))) {
    return { isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [], destination: null }
  }
  if (nameParts.length < 2) return { isMultiple: false, tasks: [], unmatchedNames: [], ambiguousNames: [], destination: null }

  const matchedTasks = []
  const unmatchedNames = []
  const ambiguousNames = []
  for (const name of nameParts) {
    const match = findTaskMatch(name, scheduledTasks, { scheduled: true })
    if (match.task) {
      if (!matchedTasks.some((task) => task.id === match.task.id)) matchedTasks.push(match.task)
    } else if (match.matches.length > 1) {
      ambiguousNames.push({ name, matches: match.matches })
    } else {
      unmatchedNames.push(name)
    }
  }

  return { isMultiple: true, tasks: matchedTasks, unmatchedNames, ambiguousNames, destination }
}

export function parseSchedulingInput(value, tasks, weekDays, activeTaskId = null, defaultDuration = 60, now = new Date()) {
  const text = value.trim()
  const day = parseDay(text, weekDays, now)
  const time = parseTimeWindow(text, defaultDuration)
  let task = tasks.find((item) => item.id === activeTaskId) || null
  let taskMatches = []

  if (!task) {
    const slashParts = text.split('/').map((part) => part.trim()).filter(Boolean)
    const possibleTaskText = slashParts.length >= 2 ? slashParts[0] : text
    const result = findTaskMatch(possibleTaskText, tasks)
    task = result.task
    taskMatches = result.matches
  }

  return {
    task,
    taskMatches,
    day,
    time,
    isCompact: /[/.]/.test(text) || Boolean(day && time && text.length < 60),
  }
}

function cleanDirectScheduleTitle(value) {
  const cleaned = String(value || '').trim()
    .replace(/^(?:me\s+|my\s+|the\s+|a\s+|an\s+)/i, '')
    .replace(/\s+(?:on|for|at|from|by|this)\s*$/i, '')
    .replace(/\s+(?:task|event|appointment)$/i, '')
    .replace(/^[\s:'"-]+|[\s,.;:!?"'-]+$/g, '')
    .trim()
  if (/^(?:it|this|that|task|event|appointment|my tasks?|unscheduled tasks?|them)$/i.test(cleaned)) return ''
  return cleaned
}

export function parseDirectScheduleRequest(value, tasks, weekDays, defaultDuration = 60, now = new Date()) {
  const text = String(value || '').trim()
  const day = parseDay(text, weekDays, now)
  const time = parseTimeWindow(text, defaultDuration)
  const creationVerb = /\b(?:create|add|make)\b/i.exec(text)
  const taskMention = /\b(?:task|todo)\b/i.exec(text)
  const isCreationCommand = Boolean(creationVerb && taskMention && creationVerb.index < taskMention.index)
  const verb = isCreationCommand ? null : /\b(?:schedule|book|place|put)\b/i.exec(text)
  const slashParts = text.split('/').map((part) => part.trim()).filter(Boolean)
  let title = ''

  if (slashParts.length >= 3) {
    title = cleanDirectScheduleTitle(slashParts[0])
  } else if (verb) {
    const remainder = text.slice(verb.index + verb[0].length).trim()
    const detailPatterns = [
      /\b(?:in\s+)?(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:days?|weeks?|months?)\s*(?:(?:from|frm)\s+now)?\b/i,
      new RegExp(`\\b(?:${DAY_TOKEN_PATTERN})\\b`, 'i'),
      /\b(?:at|from)\s+[0-1]?\d(?::[0-5]\d)?\s*(?:am|pm)\b/i,
      /\b[0-1]?\d(?::[0-5]\d)?\s*(?:am|pm)\b/i,
    ]
    const detailIndexes = detailPatterns
      .map((pattern) => pattern.exec(remainder)?.index)
      .filter((index) => Number.isInteger(index))
    const detailIndex = detailIndexes.length ? Math.min(...detailIndexes) : remainder.length
    title = cleanDirectScheduleTitle(remainder.slice(0, detailIndex))
  }

  const match = title ? findTaskMatch(title, tasks) : { task: null, matches: [] }
  return {
    isDirect: Boolean(title && (day || time)),
    isComplete: Boolean(title && day && !day.ambiguous && time),
    title,
    task: match.task,
    taskMatches: match.matches,
    day,
    time,
  }
}

export function minutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return null
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

export function findScheduleConflict(tasks, taskId, slot) {
  const start = minutes(slot.startTime)
  const end = minutes(slot.endTime)
  return tasks.find((task) => {
    if (task.id === taskId || task.completed || task.date !== slot.date) return false
    const existingStart = minutes(task.startTime)
    const existingEnd = minutes(task.endTime)
    return existingStart !== null && existingEnd !== null && start < existingEnd && existingStart < end
  }) || null
}

export function suggestAvailableSlots(tasks, taskId, slot, limit = 2) {
  const start = minutes(slot.startTime)
  const end = minutes(slot.endTime)
  if (start === null || end === null) return []
  const duration = end - start
  const suggestions = []
  for (let distance = 30; distance <= 6 * 60 && suggestions.length < limit; distance += 30) {
    for (const candidateStart of [start - distance, start + distance]) {
      const candidateEnd = candidateStart + duration
      if (candidateStart < 6 * 60 || candidateEnd > 22 * 60) continue
      const candidate = { date: slot.date, startTime: minuteString(candidateStart), endTime: minuteString(candidateEnd) }
      if (!findScheduleConflict(tasks, taskId, candidate) && !suggestions.some((item) => item.startTime === candidate.startTime)) suggestions.push(candidate)
      if (suggestions.length >= limit) break
    }
  }
  return suggestions
}

export function formatTime(value) {
  const total = minutes(value)
  if (total === null) return value
  const hour = Math.floor(total / 60)
  const minute = total % 60
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour >= 12 ? 'PM' : 'AM'}`
}

export function formatTimeRange(startTime, endTime) {
  const start = minutes(startTime)
  const end = minutes(endTime)
  if (start === null || end === null) return `${startTime}–${endTime}`
  const clock = (total) => {
    const hour = Math.floor(total / 60)
    const minute = total % 60
    return {
      text: `${hour % 12 || 12}:${String(minute).padStart(2, '0')}`,
      period: hour >= 12 ? 'PM' : 'AM',
    }
  }
  const startClock = clock(start)
  const endClock = clock(end)
  return startClock.period === endClock.period
    ? `${startClock.text}–${endClock.text} ${endClock.period}`
    : `${startClock.text} ${startClock.period}–${endClock.text} ${endClock.period}`
}

export function formatSlot(slot, weekDays = []) {
  const day = weekDays.find((item) => item.key === slot.date)
  const fallback = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${slot.date}T12:00:00`))
  return `${day?.label || fallback}, ${formatTime(slot.startTime)}–${formatTime(slot.endTime)}`
}

export function getSchedulingQueue(tasks, deferredTaskIds = []) {
  const deferred = new Set(deferredTaskIds)
  const timestamp = (task) => task.createdAt?.toMillis?.() || 0
  const rank = (task) => task.category === 'free' ? 0 : task.urgent ? 1 : task.important ? 2 : 3
  return tasks
    .filter((task) => !task.completed && !task.date && !deferred.has(task.id))
    .sort((a, b) => rank(a) - rank(b) || timestamp(a) - timestamp(b))
}
