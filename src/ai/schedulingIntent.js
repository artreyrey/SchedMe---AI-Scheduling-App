const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_ALIASES = new Map([
  ['m', 0], ['mon', 0], ['monday', 0],
  ['tu', 1], ['tue', 1], ['tues', 1], ['tuesday', 1],
  ['w', 2], ['wed', 2], ['weds', 2], ['wednesday', 2],
  ['th', 3], ['thu', 3], ['thur', 3], ['thurs', 3], ['thursday', 3],
  ['f', 4], ['fri', 4], ['friday', 4],
  ['sa', 5], ['sat', 5], ['saturday', 5],
  ['su', 6], ['sun', 6], ['sunday', 6],
])

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
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
    if (!startMarker && endMarker) startMarker = endMarker === 'pm' && startHour > endHour ? 'am' : endMarker
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

export function parseDay(value, weekDays = getMondayWeek()) {
  const text = value.toLocaleLowerCase()
  const todayKey = localDateKey(new Date())
  if (/\btomorrow\b/.test(text)) {
    const tomorrowKey = localDateKey(addDays(new Date(), 1))
    const matching = weekDays.find((day) => day.key === tomorrowKey)
    return matching ? { ...matching, token: 'tomorrow' } : { key: tomorrowKey, label: 'Tomorrow', token: 'tomorrow' }
  }
  if (/\btoday\b/.test(text)) {
    const todayKey = localDateKey(new Date())
    const matching = weekDays.find((day) => day.key === todayKey)
    return matching ? { ...matching, token: 'today' } : { key: todayKey, label: 'Today', token: 'today' }
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
        return { ...selected, date: nextDate, key: localDateKey(nextDate), token }
      }
      return { ...selected, token }
    }
  }
  return null
}

function normalizeTaskText(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
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

  const words = text.split(' ').filter((word) => word.length > 2 && !['schedule', 'move', 'remove', 'task', 'from', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow'].includes(word))
  const fuzzy = candidates.filter((task) => words.some((word) => normalizeTaskText(task.title).includes(word)))
  return { task: fuzzy.length === 1 ? fuzzy[0] : null, matches: fuzzy }
}

export function parseSchedulingInput(value, tasks, weekDays, activeTaskId = null, defaultDuration = 60) {
  const text = value.trim()
  const day = parseDay(text, weekDays)
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
  const cleaned = String(value || '')
    .replace(/^(?:me\s+|my\s+|the\s+|a\s+|an\s+)/i, '')
    .replace(/\s+(?:on|for|at|from|by|this)\s*$/i, '')
    .replace(/\s+(?:task|event|appointment)$/i, '')
    .replace(/^[\s:'"-]+|[\s,.;:!?"'-]+$/g, '')
    .trim()
  if (/^(?:it|this|that|task|event|appointment|my tasks?|unscheduled tasks?|them)$/i.test(cleaned)) return ''
  return cleaned
}

export function parseDirectScheduleRequest(value, tasks, weekDays, defaultDuration = 60) {
  const text = String(value || '').trim()
  const day = parseDay(text, weekDays)
  const time = parseTimeWindow(text, defaultDuration)
  const verb = /\b(?:schedule|book|place|put)\b/i.exec(text)
  const slashParts = text.split('/').map((part) => part.trim()).filter(Boolean)
  let title = ''

  if (slashParts.length >= 3) {
    title = cleanDirectScheduleTitle(slashParts[0])
  } else if (verb) {
    const remainder = text.slice(verb.index + verb[0].length).trim()
    const detailPatterns = [
      /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i,
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
