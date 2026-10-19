const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function timeFromMinutes(minutes) {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, Number(minutes) || 0))
  const hours = Math.floor(safeMinutes / 60)
  const remainingMinutes = safeMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`
}

export function getDefaultPeriodTimes(period) {
  const start = Math.max(0, Math.min(23 * 60, period?.start || 0))
  const end = Math.min(period?.end || 24 * 60, start + 60)
  return {
    startTime: timeFromMinutes(start),
    endTime: end >= 24 * 60 ? '23:59' : timeFromMinutes(end),
  }
}

function minutesFromTime(value) {
  if (!TIME_PATTERN.test(value || '')) return null
  const [hours, minutes] = value.split(':').map(Number)
  return (hours * 60) + minutes
}

export function getDroppedCalendarSlot(task, date, targetPeriod, periods = []) {
  const originalStart = minutesFromTime(task?.startTime)
  const originalEnd = minutesFromTime(task?.endTime)
  if (originalStart === null || originalEnd === null || originalEnd <= originalStart) return null
  if (!date || !targetPeriod || !Number.isFinite(targetPeriod.start) || !Number.isFinite(targetPeriod.end)) return null

  const sourcePeriod = periods.find((period) => originalStart >= period.start && originalStart < period.end)
  const relativeOffset = sourcePeriod ? originalStart - sourcePeriod.start : 0
  const latestStart = Math.max(targetPeriod.start, targetPeriod.end - 1)
  const nextStart = Math.min(targetPeriod.start + relativeOffset, latestStart)
  const duration = originalEnd - originalStart
  const nextEnd = Math.min((24 * 60) - 1, nextStart + duration)
  if (nextEnd <= nextStart) return null

  return {
    date,
    startTime: timeFromMinutes(nextStart),
    endTime: timeFromMinutes(nextEnd),
  }
}

export function validateCalendarEntry({ title, startTime, endTime }) {
  if (!String(title || '').trim()) return 'Enter a task title.'
  if (String(title).trim().length > 240) return 'Keep the task title under 240 characters.'
  if (!TIME_PATTERN.test(startTime || '') || !TIME_PATTERN.test(endTime || '')) return 'Choose a valid start and end time.'
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  if ((endHour * 60) + endMinute <= (startHour * 60) + startMinute) return 'End time must be after the start time.'
  return ''
}
