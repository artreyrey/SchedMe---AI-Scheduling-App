import { findTaskMatch, minutes } from './schedulingIntent.js'

const CONTEXT_TASK_INTENTS = new Set([
  'create_task',
  'complete_task',
  'reopen_task',
  'change_priority',
  'change_color',
  'unschedule_task',
  'delete_task',
])

const COLOR_WORDS = 'red|orange|yellow|green|cyan|blue|purple|pink'

export function shouldInterpretContextTaskAction({ text, schedulingState = {} } = {}) {
  if (schedulingState.pendingAction) return true
  const value = String(text || '')
  return /\b(create|add|new)\b.*\b(task|todo)\b/i.test(value)
    || /^\s*(?:please\s+)?(?:add|create|remember|remind me to|i need to|i have to)\b/i.test(value)
    || /\b(complete|completed|finish|finished|done|undone|reopen|uncomplete|not done)\b/i.test(value)
    || /\b(urgent|important|priority|prioritize|category|categorize|classify|flexible|unclassified|not urgent|what['’]?s on my mind)\b/i.test(value)
    || new RegExp(`\\b(colou?r|${COLOR_WORDS})\\b`, 'i').test(value)
    || /\b(unschedule|delete|erase)\b/i.test(value)
    || (/^\s*(?:please\s+)?(?:remove|cancel)\b/i.test(value) && !/^\s*cancel[.!\s]*$/i.test(value))
    || /\b(remove|cancel)\b.*\b(task|calendar|schedule|event|appointment|it|that)\b/i.test(value)
}

function resolveTarget(action, tasks, schedulingState, includeCompleted) {
  const candidates = tasks.filter((task) => includeCompleted || !task.completed)
  const query = action.target?.query?.trim() || ''
  if (query && !/^(?:it|that|this|the task|same task)$/i.test(query)) {
    const match = findTaskMatch(query, candidates, { includeCompleted })
    if (!match.task && match.matches.length > 1) return { status: 'ambiguous', matches: match.matches }
    if (match.task) return { status: 'found', task: match.task }
  }
  const suppliedId = action.target?.taskId || action.target?.taskIds?.[0]
  const suppliedTask = suppliedId ? candidates.find((task) => task.id === suppliedId) : null
  if (suppliedTask) return { status: 'found', task: suppliedTask }
  for (const contextualId of [schedulingState.activeTaskId, schedulingState.lastReferencedTaskId, schedulingState.lastAction?.taskId]) {
    const contextualTask = contextualId ? candidates.find((task) => task.id === contextualId) : null
    if (contextualTask) return { status: 'found', task: contextualTask }
  }
  return { status: 'missing', matches: [] }
}

function categoryConfig(category) {
  if (category === 'urgentImportant') return { category: 'urgent', alsoPriority: true, label: 'urgent and important' }
  if (category === 'urgent') return { category: 'urgent', alsoPriority: false, label: 'urgent' }
  if (category === 'important') return { category: 'important', alsoPriority: false, label: 'important' }
  if (category === 'notUrgent') return { category: 'notUrgent', alsoPriority: false, label: 'flexible' }
  if (category === 'free') return { category: 'free', alsoPriority: false, label: "What's on my mind" }
  return null
}

function validSlot(patch) {
  if (!patch.date || !patch.startTime || !patch.endTime) return false
  const start = minutes(patch.startTime)
  const end = minutes(patch.endTime)
  return /^\d{4}-\d{2}-\d{2}$/.test(patch.date) && start !== null && end !== null && start < end
}

export function planContextTaskAction({ action, tasks = [], schedulingState = {} } = {}) {
  if (!action || !CONTEXT_TASK_INTENTS.has(action.intent) || action.confidence < 0.65) return { status: 'unsupported' }
  const patch = action.patch || {}

  if (action.intent === 'delete_task' && action.scope !== 'single') {
    const ids = [...new Set(action.target?.taskIds || [])]
    const matchedTasks = ids.map((id) => tasks.find((task) => task.id === id)).filter(Boolean)
    if (!matchedTasks.length || matchedTasks.length !== ids.length) return { status: 'clarify', reason: 'missing_task', matches: [], missingFields: ['task'] }
    if (!action.confirmed) return { status: 'confirm', operation: 'delete_many', tasks: matchedTasks }
    return { status: 'ready', operation: 'delete_many', tasks: matchedTasks }
  }

  if (action.scope !== 'single' && ['complete_task', 'reopen_task', 'change_priority', 'change_color'].includes(action.intent)) {
    const ids = [...new Set(action.target?.taskIds || [])]
    const matchedTasks = ids.map((id) => tasks.find((task) => task.id === id)).filter(Boolean)
    if (!matchedTasks.length || matchedTasks.length !== ids.length) {
      return { status: 'clarify', reason: 'missing_task', matches: [], missingFields: ['task'] }
    }

    if (action.intent === 'complete_task' || action.intent === 'reopen_task') {
      const completed = action.intent === 'complete_task'
      const tasksToUpdate = matchedTasks.filter((task) => Boolean(task.completed) !== completed)
      return {
        status: tasksToUpdate.length ? 'ready_many' : 'unchanged_many',
        operation: 'completion',
        tasks: matchedTasks,
        tasksToUpdate,
        completed,
      }
    }

    if (action.intent === 'change_priority') {
      const priority = categoryConfig(patch.category)
      if (!priority) return { status: 'clarify', reason: 'missing_priority', tasks: matchedTasks, missingFields: ['category'] }
      const tasksToUpdate = matchedTasks.filter((task) => task.category !== priority.category
        || Boolean(task.urgent) !== (priority.category === 'urgent' || priority.alsoPriority)
        || Boolean(task.important) !== (priority.category === 'important' || priority.alsoPriority))
      return {
        status: tasksToUpdate.length ? 'ready_many' : 'unchanged_many',
        operation: 'priority',
        tasks: matchedTasks,
        tasksToUpdate,
        ...priority,
      }
    }

    if (!/^#[0-9a-f]{6}$/i.test(patch.color || '')) {
      return { status: 'clarify', reason: 'missing_color', tasks: matchedTasks, missingFields: ['color'] }
    }
    const color = patch.color.toLowerCase()
    const tasksToUpdate = matchedTasks.filter((task) => String(task.color || '').toLowerCase() !== color)
    return {
      status: tasksToUpdate.length ? 'ready_many' : 'unchanged_many',
      operation: 'color',
      tasks: matchedTasks,
      tasksToUpdate,
      color,
    }
  }
  if (action.scope !== 'single') return { status: 'unsupported' }

  if (action.intent === 'create_task') {
    const title = String(patch.title || '').trim()
    if (!title) return { status: 'clarify', reason: 'missing_title', missingFields: ['title'] }
    const hasDate = Boolean(patch.date)
    const hasTime = Boolean(patch.startTime || patch.endTime)
    if (hasDate && !hasTime) return { status: 'clarify', reason: 'missing_time', missingFields: ['startTime', 'endTime'] }
    if (!hasDate && hasTime) return { status: 'clarify', reason: 'missing_date', missingFields: ['date'] }
    if ((hasDate || hasTime) && !validSlot(patch)) return { status: 'clarify', reason: 'invalid_slot', missingFields: ['date', 'startTime', 'endTime'] }
    const priority = categoryConfig(patch.category) || categoryConfig(hasDate ? 'notUrgent' : 'free')
    return {
      status: 'ready',
      operation: hasDate ? 'create_scheduled' : 'create',
      data: { title, ...priority, color: patch.color || '', ...(hasDate ? { date: patch.date, startTime: patch.startTime, endTime: patch.endTime } : {}) },
    }
  }

  const includeCompleted = action.intent === 'reopen_task' || action.intent === 'delete_task' || action.intent === 'complete_task'
  const target = resolveTarget(action, tasks, schedulingState, includeCompleted)
  if (target.status === 'ambiguous') return { status: 'clarify', reason: 'ambiguous_task', matches: target.matches, missingFields: ['task'] }
  if (target.status !== 'found') return { status: 'clarify', reason: 'missing_task', matches: [], missingFields: ['task'] }
  const task = target.task

  if (action.intent === 'complete_task' || action.intent === 'reopen_task') {
    const completed = action.intent === 'complete_task'
    if (Boolean(task.completed) === completed) return { status: 'unchanged', operation: 'completion', task, completed }
    return { status: 'ready', operation: 'completion', task, completed }
  }

  if (action.intent === 'change_priority') {
    const priority = categoryConfig(patch.category)
    if (!priority) return { status: 'clarify', reason: 'missing_priority', task, missingFields: ['category'] }
    const alreadySet = task.category === priority.category
      && Boolean(task.urgent) === (priority.category === 'urgent' || priority.alsoPriority)
      && Boolean(task.important) === (priority.category === 'important' || priority.alsoPriority)
    if (alreadySet) return { status: 'unchanged', operation: 'priority', task, ...priority }
    return { status: 'ready', operation: 'priority', task, ...priority }
  }

  if (action.intent === 'change_color') {
    if (!/^#[0-9a-f]{6}$/i.test(patch.color || '')) return { status: 'clarify', reason: 'missing_color', task, missingFields: ['color'] }
    if (String(task.color || '').toLowerCase() === patch.color.toLowerCase()) return { status: 'unchanged', operation: 'color', task, color: patch.color.toLowerCase() }
    return { status: 'ready', operation: 'color', task, color: patch.color.toLowerCase() }
  }

  if (action.intent === 'unschedule_task') {
    if (!task.date) return { status: 'unchanged', operation: 'unschedule', task }
    return {
      status: 'ready',
      operation: 'unschedule',
      task,
      previousSlot: { date: task.date, startTime: task.startTime, endTime: task.endTime },
    }
  }

  if (action.intent === 'delete_task') {
    if (!action.confirmed) return { status: 'confirm', operation: 'delete', task }
    return { status: 'ready', operation: 'delete', task }
  }

  return { status: 'unsupported' }
}
