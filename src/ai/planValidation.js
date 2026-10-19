export function getUpcomingPlanningDates(now = new Date()) {
  const mondayOffset = (8 - now.getDay()) % 7
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
}

function minutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return null
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

function overlaps(first, second) {
  return first.start < second.end && second.start < first.end
}

export function validatePlanningResponse(response, tasks, planningDates, previousAvailability) {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const dateSet = new Set(planningDates)
  const now = new Date()
  dateSet.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  const updatedTaskIds = new Set()
  const taskUpdates = (Array.isArray(response.taskUpdates) ? response.taskUpdates : []).map((update) => {
    const task = taskById.get(update.taskId)
    if (!task || task.completed || task.date) throw new Error('The AI returned a priority update for a task that cannot be changed.')
    if (updatedTaskIds.has(update.taskId)) throw new Error('The AI returned duplicate priority updates for one task.')
    if (typeof update.urgent !== 'boolean' || typeof update.important !== 'boolean') throw new Error('The AI returned an invalid priority label.')
    updatedTaskIds.add(update.taskId)
    if (task.category !== 'free' && Boolean(task.urgent) === update.urgent && Boolean(task.important) === update.important) return null
    return { taskId: task.id, urgent: update.urgent, important: update.important }
  }).filter(Boolean)

  const availabilityByKey = new Map()
  for (const window of [...(previousAvailability || []), ...(Array.isArray(response.availability) ? response.availability : [])]) {
    const start = minutes(window.startTime)
    const end = minutes(window.endTime)
    if (!dateSet.has(window.date) || start === null || end === null || start >= end) continue
    availabilityByKey.set(`${window.date}-${window.startTime}-${window.endTime}`, { date: window.date, startTime: window.startTime, endTime: window.endTime, start, end })
  }
  const availability = [...availabilityByKey.values()]

  const proposed = Array.isArray(response.scheduleProposal) ? response.scheduleProposal : []
  const priorityByTask = new Map(taskUpdates.map((update) => [update.taskId, update]))
  const taskIds = new Set()
  const scheduleProposal = proposed.map((item) => {
    const task = taskById.get(item.taskId)
    const start = minutes(item.startTime)
    const end = minutes(item.endTime)
    if (!task || task.completed || taskIds.has(item.taskId)) throw new Error('The AI returned a schedule for an unavailable or duplicate task.')
    if (!dateSet.has(item.date) || start === null || end === null || start >= end) throw new Error('The AI returned an invalid date or time.')
    const priority = priorityByTask.get(task.id)
    const urgent = priority?.urgent ?? Boolean(task.urgent)
    const important = priority?.important ?? Boolean(task.important)
    taskIds.add(item.taskId)
    return { taskId: task.id, date: item.date, startTime: item.startTime, endTime: item.endTime, urgent, important, start, end }
  })

  const daySlots = new Map()
  for (const slot of scheduleProposal) {
    const day = daySlots.get(slot.date) || []
    if (day.some((existing) => overlaps(slot, existing))) throw new Error('The proposed tasks overlap each other.')
    day.push(slot)
    daySlots.set(slot.date, day)
  }
  for (const task of tasks) {
    if (!task.date || !task.startTime || !task.endTime || task.completed || taskIds.has(task.id)) continue
    const start = minutes(task.startTime)
    const end = minutes(task.endTime)
    if (start === null || end === null || end <= start) continue
    if ((daySlots.get(task.date) || []).some((slot) => overlaps(slot, { start, end }))) throw new Error('A proposed task overlaps a task already on your calendar.')
  }

  return {
    taskUpdates,
    availability: availability.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })),
    scheduleProposal: scheduleProposal.map(({ start, end, ...item }) => item),
    applyImmediately: response.applyImmediately === true,
  }
}
