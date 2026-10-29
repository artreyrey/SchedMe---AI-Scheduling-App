import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createScheduledTask, createTask, deleteTask, deleteTasks, moveScheduledTasks, moveTaskToPriorityList, replaceScheduledTask, scheduleTask, setTaskColor, setTaskCompleted, setTaskListOrder, setTasksCompleted, setTaskPriority, setTasksPriority, subscribeToTasks, unscheduleTask, updateScheduledTask, updateTaskDetails } from './services/taskService.js'
import { askPlanningAssistant } from './ai/planningAgent.js'
import { validatePlanningResponse } from './ai/planValidation.js'
import { addPromptToAiMemory, AI_MOODS, DEFAULT_AI_MEMORY, forgetAiPreference, saveAiMemory, subscribeToAiMemory } from './services/aiMemoryService.js'
import { clearConversation, DEFAULT_INTERACTION_PROFILE, EMPTY_SCHEDULING_STATE, learnInteractionStyle, saveConversation, subscribeToConversation } from './services/conversationService.js'
import { findScheduleConflict, findTaskMatch, formatSlot, formatTimeRange, getMondayWeek, getSchedulingQueue, parseConversationalBulkMoveRequest, parseDirectScheduleRequest, parseNamedTaskMoveRequest, parseSchedulingInput, planBulkTaskMoves, planNamedTaskMoves, suggestAvailableSlots } from './ai/schedulingIntent.js'
import { prepareDailyGreetingHistory, preserveGreetingDate } from './ai/conversationGreeting.js'
import { confirmsTaskDeletion, declinesTaskDeletion, isCancellationMessage, wantsFullCancellationRemoval, wantsToScheduleAnotherTask } from './ai/cancellationIntent.js'
import { getDefaultPeriodTimes, getDroppedCalendarSlot, validateCalendarEntry, validateOptionalScheduleEntry } from './ai/calendarEditor.js'
import { applyTaskCompletionContext, parseNamedTaskCompletionRequest, parseTaskCompletionRequest } from './ai/completionIntent.js'
import { parseTaskAttributesIntent, parseTaskCategoryIntent, parseTaskColorChangeIntent, parseTaskCreationIntent } from './ai/taskCreationIntent.js'
import { parseNamedTaskDeletionRequest, parseNamedTaskPriorityRequest } from './ai/taskActionIntent.js'
import { getConversationScopeResponse } from './ai/conversationScope.js'
import { buildCompactActionContext } from './ai/actionContext.js'
import { actionIntentShadowEnabled, contextSchedulingActionsEnabled, contextTaskActionsEnabled, interpretActionIntent } from './ai/actionInterpreter.js'
import { getTrustedRecentSlot, planContextSchedulingAction, shouldInterpretContextScheduling } from './ai/contextSchedulingAction.js'
import { planContextAvailabilityAction } from './ai/availabilityAction.js'
import { planContextTaskAction, shouldInterpretContextTaskAction } from './ai/contextTaskAction.js'
import { confirmedPendingAction, createPendingAction, mergePendingAction } from './ai/pendingAction.js'
import { getLocalCommandRoute } from './ai/localCommandRouting.js'
import { recordLocalCommandBypass } from './ai/usageTelemetry.js'
import { deleteUserVoiceMessages, loadVoiceMessage, saveVoiceMessage } from './services/voiceMessageStore.js'
import { commitTaskOperation, createTaskDocumentId, newOperationRequestId, undoLastTaskOperation } from './services/taskOperationService.js'
import { consumeAiRequestBudget } from './services/aiRequestBudget.js'
import { planTaskListDrop, sortTasksForGroup } from './taskListOrder.js'
import ThemePicker from './components/ThemePicker.jsx'

const groups = [
  { id: 'free', title: "What's on my mind", subtitle: 'A place to get thoughts out', tone: 'free', icon: '\u25cb', placeholder: 'Write down anything on your mind...' },
  { id: 'urgent', title: 'Urgent', subtitle: 'Needs attention soon', tone: 'urgent', icon: '!', placeholder: 'Add an urgent task...' },
  { id: 'important', title: 'Important', subtitle: 'Moves your priorities forward', tone: 'important', icon: '\u2726', placeholder: 'Add an important task...' },
  { id: 'notUrgent', title: 'Flexible', subtitle: 'Adjust when needed', tone: 'calm', icon: '\u2197', placeholder: 'Add a flexible task...' },
]

const taskClassifications = [
  { id: 'free', label: "What's on my mind", description: 'Classify later', symbol: '○', tone: 'free' },
  { id: 'urgent', label: 'Urgent', description: 'Needs attention soon', symbol: '!', tone: 'urgent' },
  { id: 'important', label: 'Important', description: 'Moves priorities forward', symbol: '✦', tone: 'important' },
  { id: 'notUrgent', label: 'Flexible', description: 'Adjust when needed', symbol: '↗', tone: 'not-urgent' },
]

const taskListFilters = [
  { id: 'all', label: 'All', symbol: '◎', tone: 'all' },
  { id: 'urgent', label: 'Urgent', symbol: '!', tone: 'urgent' },
  { id: 'important', label: 'Important', symbol: '✦', tone: 'important' },
  { id: 'notUrgent', label: 'Flexible', symbol: '↗', tone: 'not-urgent' },
  { id: 'unclassified', label: 'Not classified', symbol: '○', tone: 'free' },
]

const schedulePeriods = [
  { label: 'Early morning', range: '12 AM - 8 AM', start: 0, end: 8 * 60 },
  { label: 'Morning', range: '8 AM - 12 PM', start: 8 * 60, end: 12 * 60 },
  { label: 'Afternoon', range: '12 PM - 5 PM', start: 12 * 60, end: 17 * 60 },
  { label: 'Evening', range: '5 PM - 12 AM', start: 17 * 60, end: 24 * 60 },
]

const taskColors = [
  { id: 'red', label: 'Red', value: '#ef4444' },
  { id: 'orange', label: 'Orange', value: '#f97316' },
  { id: 'yellow', label: 'Yellow', value: '#eab308' },
  { id: 'green', label: 'Green', value: '#22c55e' },
  { id: 'cyan', label: 'Cyan', value: '#06b6d4' },
  { id: 'blue', label: 'Blue', value: '#3b82f6' },
  { id: 'purple', label: 'Purple', value: '#8b5cf6' },
  { id: 'pink', label: 'Pink', value: '#ec4899' },
]

function pickRandomTaskColor(currentColor = '') {
  const choices = taskColors.filter((option) => option.value !== currentColor)
  return choices[Math.floor(Math.random() * choices.length)]?.value || taskColors[0].value
}

function getAutomaticTaskColor(category, currentColor = '', reroll = false) {
  if (category === 'urgent') return '#ef4444'
  if (category === 'important') return '#22c55e'
  if (!reroll && /^#[0-9a-f]{6}$/i.test(currentColor)) return currentColor
  return pickRandomTaskColor(currentColor)
}

function getTaskDisplayColor(task) {
  if (task.colorMode === 'manual') return task.color || ''
  const category = task.urgent ? 'urgent' : task.important ? 'important' : task.category
  if (category === 'urgent') return '#ef4444'
  if (category === 'important') return '#22c55e'
  if (/^#[0-9a-f]{6}$/i.test(task.color || '')) return task.color
  const seed = `${task.id || ''}:${task.title || ''}`
  const hash = [...seed].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) | 0, 0)
  return taskColors[Math.abs(hash) % taskColors.length].value
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function minuteOfDay(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return -1
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function stopRepeatedPriorityPrompt(response, tasks, userMessage) {
  const scheduleOnlyRequest = /\b(schedule|put|place|book|add to)\b/i.test(userMessage)
    && !/\b(urgent|important|priority|categor(?:y|ize)|classify|not urgent|flexible)\b/i.test(userMessage)
  if (!scheduleOnlyRequest) return response

  const settledTaskIds = new Set(tasks.filter((task) => task.category !== 'free').map((task) => task.id))
  const taskUpdates = (response.taskUpdates || []).filter((update) => !settledTaskIds.has(update.taskId))
  const asksPriorityAgain = /\b(urgent or important|which (?:is )?(?:urgent|important)|classif(?:y|ication)|categor(?:y|ies)|how urgent|priority)\b/i.test(response.message || '')
  return {
    ...response,
    taskUpdates,
    ...(asksPriorityAgain ? { message: 'Got it. I’ll keep the task’s saved category and focus on placing it on the schedule you gave me.' } : {}),
  }
}

function taskCategoryLabel(category, alsoPriority = false) {
  if (category === 'urgent') return alsoPriority ? 'Urgent and Important' : 'Urgent'
  if (category === 'important') return 'Important'
  if (category === 'notUrgent') return 'Flexible'
  return 'What’s on my mind'
}

function describeRequestedTaskAttributes(attributes) {
  const classification = attributes.category ? taskCategoryLabel(attributes.category, attributes.alsoPriority) : ''
  const color = taskColors.find((option) => option.value === attributes.color)?.label
  if (classification && color) return `${classification} with ${color.toLocaleLowerCase()} color`
  return classification || (color ? `${color} color` : '')
}

function getWeekDays(offset) {
  const today = new Date()
  return getMondayWeek(offset, today).map(({ date, key, label }) => ({
    date,
    key,
    label,
    day: label.slice(0, 3),
    number: date.getDate(),
    isToday: date.toDateString() === today.toDateString(),
  }))
}

function taskScheduleLabel(task) {
  if (!task.date || !task.startTime || !task.endTime) return 'Date & time · N/A'
  const date = new Date(`${task.date}T12:00:00`)
  const day = Number.isNaN(date.getTime()) ? task.date : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
  return `${day} · ${formatTimeRange(task.startTime, task.endTime)}`
}

function TaskClassificationSymbols({ task }) {
  const items = []
  if (task.urgent) items.push(taskClassifications.find((item) => item.id === 'urgent'))
  if (task.important) items.push(taskClassifications.find((item) => item.id === 'important'))
  if (!task.urgent && !task.important && task.category === 'notUrgent') items.push(taskClassifications.find((item) => item.id === 'notUrgent'))
  if (!items.length) return null
  return <span className="task-classification-symbols" aria-label={items.map((item) => item.label).join(' and ')}>{items.map((item) => <i className={`task-classification-symbol ${item.tone}`} aria-hidden="true" title={item.label} key={item.id}>{item.symbol}</i>)}</span>
}

function TaskListFilter({ value, tasks, onChange }) {
  const [open, setOpen] = useState(false)
  const filterRef = useRef(null)
  const selected = taskListFilters.find((option) => option.id === value) || taskListFilters[0]
  const counts = {
    all: tasks.length,
    urgent: tasks.filter((task) => task.urgent).length,
    important: tasks.filter((task) => task.important).length,
    notUrgent: tasks.filter((task) => !task.urgent && !task.important && task.category === 'notUrgent').length,
    unclassified: tasks.filter((task) => !task.urgent && !task.important && !['urgent', 'important', 'notUrgent'].includes(task.category)).length,
  }

  useEffect(() => {
    if (!open) return undefined
    function closeOnOutside(event) {
      if (!filterRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className={`task-list-filter ${open ? 'is-open' : ''}`} ref={filterRef}>
    <button type="button" className="task-list-filter-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((current) => !current)}>
      <span className={`task-classification-symbol ${selected.tone}`} aria-hidden="true">{selected.symbol}</span>
      <span>{selected.label}</span>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
    </button>
    {open && <div className="task-list-filter-menu" role="listbox" aria-label="Filter tasks by classification">
      {taskListFilters.map((option, index) => <button type="button" role="option" aria-selected={option.id === selected.id} className={option.id === selected.id ? 'is-selected' : ''} style={{ '--filter-index': index }} onClick={() => { onChange(option.id); setOpen(false) }} key={option.id}>
        <span className={`task-classification-symbol ${option.tone}`} aria-hidden="true">{option.symbol}</span><span>{option.label}</span><small>{counts[option.id]}</small>
      </button>)}
    </div>}
  </div>
}

function TaskPanel({ group, tasks, onAdd, onComplete, onEdit, onTaskDragStart, onTaskDragMove, onTaskDragEnd, onTaskDragOver, onTaskDrop, draggedTaskId, dropTarget, dropTaskId, dropPosition, saving, error }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [taskFilter, setTaskFilter] = useState('all')
  const [taskPage, setTaskPage] = useState(0)
  const filteredTasks = group.id !== 'free' || taskFilter === 'all' ? tasks : tasks.filter((task) => {
    if (taskFilter === 'urgent') return task.urgent
    if (taskFilter === 'important') return task.important
    if (taskFilter === 'notUrgent') return !task.urgent && !task.important && task.category === 'notUrgent'
    return !task.urgent && !task.important && !['urgent', 'important', 'notUrgent'].includes(task.category)
  })
  const previousTaskCountRef = useRef(filteredTasks.length)
  const pageSize = 7
  const taskPageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize))
  const visibleTasks = filteredTasks.slice(taskPage * pageSize, (taskPage + 1) * pageSize)

  useEffect(() => {
    setTaskPage((currentPage) => filteredTasks.length > previousTaskCountRef.current ? 0 : Math.min(currentPage, taskPageCount - 1))
    previousTaskCountRef.current = filteredTasks.length
  }, [filteredTasks.length, taskPageCount])

  async function submit(event) {
    event.preventDefault()
    if (!draft.trim()) return
    const value = draft
    setDraft('')
    await onAdd(value, group.id, false)
  }
  return (
    <section
      id={`${group.id}-tasks`}
      className={`dashboard-panel dashboard-task-panel ${group.tone} ${draggedTaskId ? 'is-task-drag-active' : ''} ${dropTarget === group.id && !dropTaskId ? 'is-task-drop-target' : ''}`}
      data-drop-label={`Move to ${group.title}`}
      onDragOver={(event) => { if (draggedTaskId && !event.target.closest('.dashboard-task-item')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; onTaskDragOver(group.id, '', 'after') } }}
      onDrop={(event) => { if (!event.target.closest('.dashboard-task-item')) { event.preventDefault(); onTaskDrop(event.dataTransfer.getData('text/plain') || draggedTaskId, group.id, '', 'after') } }}
    >
      <div className="dashboard-panel-heading">
        <span className={`dashboard-panel-icon ${group.tone}`} aria-hidden="true">{group.icon}</span>
        <div><h2>{group.title}</h2><p>{group.subtitle}</p></div>
        <span className="dashboard-panel-heading-actions">
          {group.id === 'free' && <TaskListFilter value={taskFilter} tasks={tasks} onChange={(nextFilter) => { setTaskFilter(nextFilter); setTaskPage(0) }} />}
          <span className="dashboard-count">{filteredTasks.length}</span>
        </span>
      </div>
      <form className="task-entry-form" onSubmit={submit}>
        <input aria-label={`New ${group.title} item`} maxLength={240} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={group.placeholder} />
        <button type="submit" disabled={saving || !draft.trim()} aria-label={`Add to ${group.title}`}>+</button>
        <button type="button" className={`task-edit-toggle ${editing ? 'is-active' : ''}`} onClick={() => setEditing((value) => !value)} aria-label={editing ? `Finish editing ${group.title} tasks` : `Edit ${group.title} tasks`} aria-pressed={editing} title={editing ? 'Finish editing' : 'Edit tasks'}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 20 4.3-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.3 16Z" /><path d="m14.8 6.5 2.8 2.8" /></svg>
        </button>
      </form>
      {error && <p className="task-storage-error" role="alert">{error}</p>}
      <div className="dashboard-task-list">
        {filteredTasks.length === 0 && <p className="empty-task-note">{tasks.length ? `No ${taskListFilters.find((option) => option.id === taskFilter)?.label.toLocaleLowerCase()} tasks yet.` : 'Nothing here yet. Add a thought above.'}</p>}
        <div className={`dashboard-task-list-page ${taskPageCount > 1 ? 'is-paginated' : ''}`} key={`${group.id}-${taskFilter}-${taskPage}`}>
        {visibleTasks.map((task) => {
          const displayColor = getTaskDisplayColor(task)
          return <article
            className={`dashboard-task-item ${displayColor ? 'has-color' : ''} ${task.completed ? 'is-complete' : ''} ${editing ? 'is-editable' : ''} ${draggedTaskId === task.id ? 'is-dragging' : ''} ${dropTarget === group.id && dropTaskId === task.id && draggedTaskId !== task.id ? `is-drop-${dropPosition}` : ''}`}
            style={displayColor ? { '--task-color': displayColor } : undefined}
            key={task.id}
            draggable={editing && !saving}
            aria-grabbed={editing ? draggedTaskId === task.id : undefined}
            onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); const invisibleDragImage = document.createElement('canvas'); invisibleDragImage.width = 1; invisibleDragImage.height = 1; event.dataTransfer.setDragImage(invisibleDragImage, 0, 0); onTaskDragStart(event, task, group.id, displayColor) }}
            onDrag={onTaskDragMove}
            onDragEnd={onTaskDragEnd}
            onDragOver={(event) => { if (draggedTaskId && draggedTaskId !== task.id) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; const bounds = event.currentTarget.getBoundingClientRect(); onTaskDragOver(group.id, task.id, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after') } }}
            onDrop={(event) => { if (draggedTaskId && draggedTaskId !== task.id) { event.preventDefault(); event.stopPropagation(); const bounds = event.currentTarget.getBoundingClientRect(); onTaskDrop(event.dataTransfer.getData('text/plain') || draggedTaskId, group.id, task.id, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after') } }}
            onClick={editing ? () => onEdit(task) : undefined}
            onKeyDown={editing ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(task) } } : undefined}
            role={editing ? 'button' : undefined}
            tabIndex={editing ? 0 : undefined}
          >
            <button type="button" className="dashboard-task-check" onClick={(event) => { event.stopPropagation(); onComplete(task) }} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} aria-pressed={Boolean(task.completed)} />
            <div className="dashboard-task-content"><div className="dashboard-task-title-row"><h4>{task.title}</h4><TaskClassificationSymbols task={task} /></div><p>{task.completed ? 'Completed' : task.urgent && task.important ? 'Urgent · Important' : task.urgent ? 'Urgent' : task.important ? 'Important' : task.category === 'notUrgent' ? 'Flexible' : 'What’s on my mind'}</p><small className="dashboard-task-schedule">{taskScheduleLabel(task)}</small></div>
            {editing && <span className="dashboard-task-edit-cue" aria-hidden="true">Edit</span>}
          </article>
        })}
        </div>
        {taskPageCount > 1 && <nav className="dashboard-task-pagination" aria-label={`${group.title} task pages`}>
          <button type="button" onClick={() => setTaskPage((page) => Math.max(0, page - 1))} disabled={taskPage === 0} aria-label="Show previous seven tasks" title="Previous seven tasks">←</button>
          <span><strong>{taskPage * pageSize + 1}–{Math.min((taskPage + 1) * pageSize, filteredTasks.length)}</strong> of {filteredTasks.length}</span>
          <button type="button" onClick={() => setTaskPage((page) => Math.min(taskPageCount - 1, page + 1))} disabled={taskPage === taskPageCount - 1} aria-label="Show next seven tasks" title="Next seven tasks">→</button>
        </nav>}
      </div>
    </section>
  )
}

function SettingsChoice({ label, value, options, onChange }) {
  return (
    <fieldset className="assistant-settings-choice">
      <legend>{label}</legend>
      <div style={{ '--settings-choice-count': options.length }}>
        {options.map((option) => (
          <button
            type="button"
            className={String(value) === String(option.value) ? 'is-selected' : ''}
            aria-pressed={String(value) === String(option.value)}
            onClick={() => onChange(option.value)}
            key={option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function AssistantSettings({ memory, onClose, onSave, onForget, saving, error }) {
  const [name, setName] = useState(memory.chatbotName)
  const [mood, setMood] = useState(memory.mood)
  const [defaultDuration, setDefaultDuration] = useState(memory.defaultDuration || 60)
  const [greetingStyle, setGreetingStyle] = useState(memory.greetingStyle || 'friendly')
  const [editingPreference, setEditingPreference] = useState(null)
  const [preferenceDraft, setPreferenceDraft] = useState('')

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  return (
    <div className="assistant-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="assistant-settings" role="dialog" aria-modal="true" aria-labelledby="assistant-settings-title">
        <button type="button" className="auth-close" onClick={onClose} disabled={saving} aria-label="Close AI settings">×</button>
        <div className="assistant-settings-heading">
          <span className="assistant-settings-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 18l-1.6-5.8L5 10.6 10.4 9 12 3.5Z" /></svg></span>
          <div><p className="dashboard-kicker">Your AI, your way</p><h2 id="assistant-settings-title">Personalize SchedMe</h2></div>
        </div>
        <p className="copy-muted">Choose how your assistant sounds and plans with you.</p>
        <form className="assistant-settings-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...memory, chatbotName: name.trim() || 'SchedMe', mood, defaultDuration: Number(defaultDuration), greetingStyle }) }}>
          <label className="assistant-name-field" htmlFor="assistant-name"><span>Assistant name</span><input id="assistant-name" maxLength={32} value={name} onChange={(event) => setName(event.target.value)} placeholder="SchedMe" /></label>
          <SettingsChoice label="Chat mood" value={mood} onChange={setMood} options={AI_MOODS.map((option) => ({ value: option, label: option.charAt(0).toUpperCase() + option.slice(1) }))} />
          <SettingsChoice label="Default task time" value={defaultDuration} onChange={setDefaultDuration} options={[{ value: 30, label: '30m' }, { value: 45, label: '45m' }, { value: 60, label: '1h' }, { value: 90, label: '1.5h' }, { value: 120, label: '2h' }]} />
          <SettingsChoice label="Opening style" value={greetingStyle} onChange={setGreetingStyle} options={[{ value: 'friendly', label: 'Friendly' }, { value: 'short', label: 'Brief' }, { value: 'direct', label: 'Go direct' }]} />
          <div className="assistant-settings-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="auth-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
        </form>
        <div className="assistant-memory-section">
          <div className="assistant-memory-heading"><div><h3>Saved preferences</h3><p>Messages you chose to remember.</p></div><span>{memory.preferences.length}</span></div>
          {memory.preferences.length === 0 ? <p className="empty-task-note">No preferences saved yet.</p> : <ul>{memory.preferences.map((preference) => <li key={preference}>{editingPreference === preference ? <div className="assistant-memory-edit"><input maxLength={240} value={preferenceDraft} onChange={(event) => setPreferenceDraft(event.target.value)} aria-label="Edit saved preference" /><div><button type="button" disabled={saving || !preferenceDraft.trim()} onClick={() => { const next = memory.preferences.map((item) => item === preference ? preferenceDraft.trim() : item); onSave({ ...memory, preferences: [...new Set(next)] }) }}>Save</button><button type="button" onClick={() => setEditingPreference(null)}>Cancel</button></div></div> : <><span>{preference}</span><div className="assistant-memory-actions"><button type="button" onClick={() => { setEditingPreference(preference); setPreferenceDraft(preference) }}>Edit</button><button type="button" onClick={() => onForget(preference)}>Remove</button></div></>}</li>)}</ul>}
        </div>
        {error && <p className="task-storage-error" role="alert">{error}</p>}
      </section>
    </div>
  )
}

function TimePicker({ id, label, value, onChange }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef(null)
  const [hourText = '09', minuteText = '00'] = String(value || '09:00').split(':')
  const hour24 = Number(hourText)
  const minute = Number(minuteText)
  const hour = hour24 % 12 || 12
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const minuteOptions = [...new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, minute])].sort((a, b) => a - b)

  useEffect(() => {
    if (!open) return undefined
    function closeOnOutside(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function setTime(nextHour = hour, nextMinute = minute, nextPeriod = period) {
    const convertedHour = (nextHour % 12) + (nextPeriod === 'PM' ? 12 : 0)
    onChange(`${String(convertedHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`)
  }

  return (
    <div className={`calendar-time-picker ${open ? 'is-open' : ''}`} ref={pickerRef}>
      <button id={id} type="button" className="calendar-time-trigger" aria-label={`${label}: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)}>
        <span>{String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}</span>
        <small>{period}</small>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5l3.2 1.8" /></svg>
      </button>
      {open && <div className="calendar-time-popover" role="dialog" aria-label={`Choose ${label.toLocaleLowerCase()}`}>
        <div className="calendar-time-popover-head"><span>{label}</span><strong>{String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')} {period}</strong></div>
        <span className="calendar-time-section-label">Hour</span>
        <div className="calendar-hour-grid">{Array.from({ length: 12 }, (_, index) => index + 1).map((option) => <button type="button" className={hour === option ? 'is-selected' : ''} aria-pressed={hour === option} onClick={() => setTime(option)} key={option}>{String(option).padStart(2, '0')}</button>)}</div>
        <span className="calendar-time-section-label">Minute</span>
        <div className="calendar-minute-row">{minuteOptions.map((option) => <button type="button" className={minute === option ? 'is-selected' : ''} aria-pressed={minute === option} onClick={() => setTime(hour, option)} key={option}>{String(option).padStart(2, '0')}</button>)}</div>
        <div className="calendar-period-row">
          {['AM', 'PM'].map((option) => <button type="button" className={period === option ? 'is-selected' : ''} aria-pressed={period === option} onClick={() => setTime(hour, minute, option)} key={option}>{option}</button>)}
          <button type="button" className="calendar-time-done" onClick={() => setOpen(false)}>Done</button>
        </div>
      </div>}
    </div>
  )
}

function TaskColorPicker({ value, mode, classification, onChange }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef(null)
  const closeTimerRef = useRef(null)
  const selected = taskColors.find((option) => option.value === value)
  const choices = [{ id: 'automatic', label: 'Automatic', value: '' }, ...taskColors]

  useEffect(() => {
    if (!open) return undefined
    function closeOnOutside(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  function chooseColor(option) {
    const automatic = option.id === 'automatic'
    onChange({ color: automatic ? getAutomaticTaskColor(classification, value, true) : option.value, mode: automatic ? 'automatic' : 'manual' })
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 260)
  }

  return (
    <div className={`calendar-color-picker ${open ? 'is-open' : ''}`} ref={pickerRef}>
      <button type="button" className="calendar-color-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)}>
        <span className={`calendar-color-current ${mode === 'automatic' ? 'is-automatic' : ''}`} style={{ '--choice-color': value }} aria-hidden="true" />
        <span className="calendar-color-trigger-copy"><strong>Task color</strong><small>Optional · {mode === 'automatic' ? `Automatic · ${classification === 'urgent' ? 'Urgent red' : classification === 'important' ? 'Important green' : selected?.label || 'Mixed palette'}` : selected?.label}</small></span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
      </button>
      {open && <div className="calendar-color-popover" role="dialog" aria-label="Choose a task color">
        <div className="calendar-color-popover-head"><div><strong>Choose a color</strong><small>Automatic follows the classification: urgent is red, important is green, and flexible uses the full palette.</small></div><span>{mode === 'automatic' ? `Auto · ${selected?.label || 'Mixed'}` : selected?.label}</span></div>
        <div className="calendar-color-grid">
          {choices.map((option, index) => {
            const automatic = option.id === 'automatic'
            const isSelected = automatic ? mode === 'automatic' : mode === 'manual' && value === option.value
            return <button type="button" className={`calendar-color-choice ${automatic ? 'is-automatic' : ''} ${isSelected ? 'is-selected' : ''}`} style={{ '--choice-color': option.value || undefined, '--color-index': index }} aria-pressed={isSelected} onClick={() => chooseColor(option)} key={option.id}>
              <span className="calendar-color-swatch" aria-hidden="true" />
              <span>{option.label}</span>
              <i aria-hidden="true">✓</i>
            </button>
          })}
        </div>
      </div>}
    </div>
  )
}

function TaskClassificationPicker({ value, onChange, allowUnclassified = true }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef(null)
  const choices = allowUnclassified ? taskClassifications : taskClassifications.filter((item) => item.id !== 'free')
  const selected = choices.find((item) => item.id === value) || choices[0]

  useEffect(() => {
    if (!open) return undefined
    function closeOnOutside(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className={`task-classification-picker ${open ? 'is-open' : ''}`} ref={pickerRef}>
    <button type="button" className="task-classification-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((current) => !current)}>
      <span className={`task-classification-symbol ${selected.tone}`} aria-hidden="true">{selected.symbol}</span>
      <span><strong>Classification</strong><small>{selected.label} · {selected.description}</small></span>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
    </button>
    {open && <div className="task-classification-menu" role="listbox" aria-label="Task classification">{choices.map((option, index) => <button type="button" role="option" aria-selected={option.id === selected.id} className={option.id === selected.id ? 'is-selected' : ''} style={{ '--classification-index': index }} onClick={() => { onChange(option.id); setOpen(false) }} key={option.id}>
      <span className={`task-classification-symbol ${option.tone}`} aria-hidden="true">{option.symbol}</span><span><strong>{option.label}</strong><small>{option.description}</small></span><i aria-hidden="true">✓</i>
    </button>)}</div>}
  </div>
}

function CalendarDatePicker({ value, onChange }) {
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(`${value}T12:00:00`) : new Date()
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const leadingDays = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayKey = localDateKey(new Date())
  const dayCells = [...Array(leadingDays).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]
  while (dayCells.length % 7) dayCells.push(null)

  function moveMonth(offset) {
    setViewMonth(new Date(year, month + offset, 1))
  }

  return <div className="task-date-picker">
    <div className="task-date-picker-heading">
      <strong>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(viewMonth)}</strong>
      <div><button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">‹</button><button type="button" onClick={() => moveMonth(1)} aria-label="Next month">›</button></div>
    </div>
    <div className="task-date-picker-weekdays" aria-hidden="true">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="task-date-picker-grid" role="grid" aria-label="Choose a date">{dayCells.map((day, index) => {
      if (!day) return <span key={`empty-${index}`} />
      const key = localDateKey(new Date(year, month, day))
      const label = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(year, month, day))
      return <button type="button" className={`${key === value ? 'is-selected' : ''} ${key === todayKey ? 'is-today' : ''}`} aria-label={label} aria-pressed={key === value} onClick={() => onChange(key)} key={key}>{day}</button>
    })}</div>
    <button type="button" className="task-date-picker-today" onClick={() => { const today = new Date(); setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1)); onChange(todayKey) }}>Today</button>
  </div>
}

function CalendarEditorModal({ editor, onClose, onConfirm, onDelete, saving, error }) {
  const isInboxTask = editor.origin === 'inbox'
  const savedClassification = editor.category || (editor.urgent ? 'urgent' : editor.important ? 'important' : isInboxTask ? 'free' : 'notUrgent')
  const initialClassification = !isInboxTask && savedClassification === 'free' ? 'notUrgent' : savedClassification
  const initialColorMode = editor.colorMode || (editor.color ? 'manual' : 'automatic')
  const [title, setTitle] = useState(editor.title || '')
  const [startTime, setStartTime] = useState(editor.startTime)
  const [endTime, setEndTime] = useState(editor.endTime)
  const [date, setDate] = useState(editor.date || '')
  const [scheduled, setScheduled] = useState(Boolean(editor.date && editor.startTime && editor.endTime))
  const [completed, setCompleted] = useState(Boolean(editor.completed))
  const [classification, setClassification] = useState(initialClassification)
  const [colorMode, setColorMode] = useState(initialColorMode)
  const [color, setColor] = useState(() => initialColorMode === 'automatic' ? getAutomaticTaskColor(initialClassification, editor.color || '') : editor.color || pickRandomTaskColor())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false)
  const [scheduleDraft, setScheduleDraft] = useState({ date: '', startTime: '09:00', endTime: '10:00' })
  const [scheduleError, setScheduleError] = useState('')

  function openScheduleEditor() {
    setScheduleDraft({ date: date || localDateKey(new Date()), startTime: startTime || '09:00', endTime: endTime || '10:00' })
    setScheduleError('')
    setScheduleEditorOpen(true)
  }

  function applySchedule() {
    const validationError = validateOptionalScheduleEntry({ title: title || 'Task', scheduled: true, ...scheduleDraft })
    if (validationError) {
      setScheduleError(validationError)
      return
    }
    setDate(scheduleDraft.date)
    setStartTime(scheduleDraft.startTime)
    setEndTime(scheduleDraft.endTime)
    setScheduled(true)
    setScheduleEditorOpen(false)
    setScheduleError('')
  }

  function changeClassification(nextClassification) {
    setClassification(nextClassification)
    if (colorMode === 'automatic') setColor(getAutomaticTaskColor(nextClassification, color, true))
  }

  function cancelDeleteOrClose() {
    if (scheduleEditorOpen) setScheduleEditorOpen(false)
    else if (confirmingDelete) setConfirmingDelete(false)
    else onClose()
  }

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key !== 'Escape' || saving) return
      if (scheduleEditorOpen) setScheduleEditorOpen(false)
      else if (confirmingDelete) setConfirmingDelete(false)
      else onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [confirmingDelete, onClose, saving, scheduleEditorOpen])

  return (
    <div className="calendar-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) cancelDeleteOrClose() }}>
      <section className="calendar-editor-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-editor-title">
        <button type="button" className="auth-close" onClick={cancelDeleteOrClose} disabled={saving} aria-label={confirmingDelete ? 'Cancel task deletion' : 'Close calendar editor'}>×</button>
        <span className="calendar-editor-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="m4 20 4.3-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.3 16Z" /><path d="m14.8 6.5 2.8 2.8" /></svg>
        </span>
        <p className="dashboard-kicker">{editor.mode === 'create' ? 'Add to calendar' : isInboxTask ? 'Edit task' : 'Edit calendar task'}</p>
        <div className="calendar-editor-title-row">
          <h2 id="calendar-editor-title">{editor.mode === 'create' ? 'Create a time block' : isInboxTask ? 'Update this task' : 'Update this time block'}</h2>
          {editor.mode === 'edit' && <button type="button" className="calendar-delete-icon-button" onClick={() => setConfirmingDelete(true)} disabled={saving} aria-label="Delete task" title="Delete task">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>
          </button>}
        </div>
        <p className="calendar-editor-date">{scheduled && date ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`)) : 'Date & time'}<span>{scheduled ? formatTimeRange(startTime, endTime) : 'N/A'}</span></p>
        <form className="calendar-editor-form" onSubmit={(event) => { event.preventDefault(); onConfirm({ title, date, startTime, endTime, scheduled, completed, color, colorMode, category: classification }) }}>
          <label htmlFor="calendar-task-title">Task</label>
          <input id="calendar-task-title" autoFocus maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What are you planning?" />
          <TaskClassificationPicker value={classification} onChange={changeClassification} allowUnclassified={isInboxTask} />
          <TaskColorPicker value={color} mode={colorMode} classification={classification} onChange={({ color: nextColor, mode: nextMode }) => { setColor(nextColor); setColorMode(nextMode) }} />
          <section className={`calendar-optional-schedule ${scheduled ? 'is-scheduled' : ''}`}>
            <span className="calendar-optional-schedule-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4v3M19 4v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12H4V7a1 1 0 0 1 1-1Z" /></svg></span>
            <div><strong>Schedule</strong><span>{scheduled ? `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`))} · ${formatTimeRange(startTime, endTime)}` : 'N/A · Schedule it whenever you’re ready.'}</span></div>
            <button type="button" onClick={openScheduleEditor} aria-haspopup="dialog">{scheduled ? 'Edit schedule' : 'Add date & time'}</button>
          </section>
          {editor.mode === 'edit' && <fieldset className="calendar-completion-choice">
            <legend>Mark as done?</legend>
            <button type="button" className={completed ? 'is-selected' : ''} aria-pressed={completed} onClick={() => setCompleted(true)}>Yes</button>
            <button type="button" className={!completed ? 'is-selected' : ''} aria-pressed={!completed} onClick={() => setCompleted(false)}>No</button>
            <small>{completed ? 'The title will appear crossed out.' : isInboxTask ? 'The task will stay active.' : 'The task will stay active on your calendar.'}</small>
          </fieldset>}
          {error && <p className="calendar-editor-error" role="alert">{error}</p>}
          <div className="calendar-editor-actions">
            <button type="button" className="calendar-cancel-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="calendar-confirm-button" disabled={saving}>{saving ? 'Saving…' : editor.mode === 'create' ? 'Add to calendar' : 'Confirm changes'}</button>
          </div>
        </form>
      </section>
      {scheduleEditorOpen && <div className="task-schedule-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setScheduleEditorOpen(false) }}>
        <section className="task-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="task-schedule-dialog-title">
          <div className="task-schedule-dialog-heading"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4v3M19 4v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12H4V7a1 1 0 0 1 1-1Z" /></svg></span><div><p className="dashboard-kicker">Plan your task</p><h3 id="task-schedule-dialog-title">Choose a date and time</h3></div><button type="button" onClick={() => setScheduleEditorOpen(false)} aria-label="Close schedule popup">×</button></div>
          <CalendarDatePicker value={scheduleDraft.date} onChange={(nextDate) => setScheduleDraft((draft) => ({ ...draft, date: nextDate }))} />
          <div className="calendar-time-fields task-schedule-dialog-times">
            <div className="calendar-time-control"><label htmlFor="task-popup-start-time">Time start</label><TimePicker id="task-popup-start-time" label="Start time" value={scheduleDraft.startTime} onChange={(nextTime) => setScheduleDraft((draft) => ({ ...draft, startTime: nextTime }))} /></div>
            <span aria-hidden="true">→</span>
            <div className="calendar-time-control"><label htmlFor="task-popup-end-time">End</label><TimePicker id="task-popup-end-time" label="End time" value={scheduleDraft.endTime} onChange={(nextTime) => setScheduleDraft((draft) => ({ ...draft, endTime: nextTime }))} /></div>
          </div>
          {scheduleError && <p className="calendar-editor-error" role="alert">{scheduleError}</p>}
          {isInboxTask && scheduled && <button type="button" className="task-schedule-later-button" onClick={() => { setScheduled(false); setScheduleEditorOpen(false); setScheduleError('') }}>Remove date and schedule later</button>}
          <div className="task-schedule-dialog-actions"><button type="button" onClick={() => setScheduleEditorOpen(false)}>Cancel</button><button type="button" className="is-primary" onClick={applySchedule}>Apply schedule</button></div>
        </section>
      </div>}
      {confirmingDelete && <div className="calendar-delete-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setConfirmingDelete(false) }}>
        <section className="calendar-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="calendar-delete-dialog-title" aria-describedby="calendar-delete-dialog-description">
          <span className="calendar-delete-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></span>
          <h3 id="calendar-delete-dialog-title">Delete this task?</h3>
          <p id="calendar-delete-dialog-description">“{editor.title}” will be permanently removed from your task lists and calendar.</p>
          {error && <p className="calendar-editor-error" role="alert">{error}</p>}
          <div className="calendar-delete-confirmation-actions">
            <button type="button" className="calendar-cancel-button" onClick={() => setConfirmingDelete(false)} disabled={saving} autoFocus>Cancel</button>
            <button type="button" className="calendar-delete-confirm-button" onClick={onDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete task'}</button>
          </div>
        </section>
      </div>}
    </div>
  )
}

function PlanReview({ plan, tasks, onApply, busy, applied, error }) {
  const taskNames = new Map(tasks.map((task) => [task.id, task.title]))
  const proposal = plan.scheduleProposal || []
  const updates = plan.taskUpdates || []
  return (
    <div className="ai-plan-review">
      <strong>{proposal.length ? 'Proposed weekly plan' : 'Proposed task categories'}</strong>
      {proposal.length > 0 && <ul>{proposal.map((item) => <li key={item.taskId}><span>{taskNames.get(item.taskId) || 'Task'} · {item.urgent && item.important ? 'Urgent + important' : item.urgent ? 'Urgent' : item.important ? 'Important' : 'Flexible'}</span><small>{item.date} · {item.startTime}–{item.endTime}</small></li>)}</ul>}
      {updates.length > 0 && <ul>{updates.map((item) => <li key={item.taskId}><span>{taskNames.get(item.taskId) || 'Task'} · {item.urgent && item.important ? 'Urgent + important' : item.urgent ? 'Urgent' : item.important ? 'Important' : 'Flexible'}</span><small>Category</small></li>)}</ul>}
      {error && <p className="task-storage-error" role="alert">{error}</p>}
      <button type="button" onClick={onApply} disabled={busy || applied}>{applied ? proposal.length ? 'Added to your week' : 'Categories saved' : busy ? 'Saving…' : proposal.length ? 'Approve and add to my week' : 'Apply these categories'}</button>
    </div>
  )
}

function explainAiError(error) {
  const code = String(error?.code || '').toLowerCase()
  const detail = String(error?.message || '').toLowerCase()
  if (code.startsWith('operation/') || code.startsWith('ai/local-')) return error.message
  if (code.includes('api-not-enabled')) {
    return 'Firebase AI Logic is not enabled for this Firebase project yet. Open Firebase Console → AI Logic and finish enabling the Gemini Developer API.'
  }
  if (code.includes('invalid-schema')) {
    return 'Firebase rejected the AI response format. Please refresh the page and try again; if it continues, check the browser console for details.'
  }
  if (code.includes('invalid-content')) {
    return 'The saved chat turns were invalid. Refresh the page to start a clean conversation, then try again.'
  }
  if (code.includes('not-initialized')) {
    return 'App Check did not initialize. On localhost, restart the dev server; on a deployed site, configure its reCAPTCHA Enterprise site key.'
  }
  if (code.includes('app-check') || code.includes('appcheck') || detail.includes('app check') || detail.includes('appcheck')) {
    return 'Gemini is waiting for a valid App Check token. In your browser console, copy the Firebase App Check debug token and register it under Firebase Console → App Check → Apps → Manage debug tokens.'
  }
  if (code.includes('permission-denied') || code.includes('403') || code.includes('failed-precondition')) {
    return 'Gemini isn’t enabled for this app yet. In Firebase Console, open AI Services → AI Logic and finish the Gemini Developer API setup.'
  }
  if (code.includes('quota') || code.includes('resource-exhausted') || code.includes('429')) {
    return 'Gemini’s current free-tier quota is used up. Try again later; saved tasks and preferences are still available.'
  }
  return `Gemini request failed (${error?.code || 'unknown error'}). Check Firebase AI Logic and App Check setup; open the browser console for details. Saved tasks and preferences are still available.`
}

function openingMessage(user, memory) {
  const name = user.displayName || 'there'
  if (memory.greetingStyle === 'direct') return `Welcome back, ${name}. You can say “schedule my tasks” or use Task / Day / Time.`
  if (memory.greetingStyle === 'short') return `Hi ${name}! Ready to plan, or would you like to talk first?`
  return `Hi ${name}! How’s your day going? We can talk for a moment, or you can start scheduling whenever you’re ready.`
}

function normalizedGeminiHistory(messages) {
  const turns = []
  for (const message of messages.slice(-24)) {
    const role = message.role === 'user' ? 'user' : 'model'
    const text = String(message.text || '').trim()
    if (!text) continue
    if (turns.at(-1)?.role === role) turns[turns.length - 1].parts[0].text += `\n${text}`
    else turns.push({ role, parts: [{ text }] })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  while (turns.length && turns.at(-1).role !== 'model') turns.pop()
  return turns
}

function isStopMessage(text) {
  return /^(?:stop|cancel|finish|finished|no|not now|later|leave it|leave it unscheduled)[.!\s]*$/i.test(text.trim())
}

function isSkipMessage(text) {
  return /\b(skip|another task|other task|schedule .* first)\b/i.test(text)
}

function isReplaceChoice(text) {
  return /\b(replace|use that time|put .* there|move the existing|unschedule the existing|move thesis|yes,? replace)\b/i.test(text)
}

function isChooseAnotherTime(text) {
  return /\b(another time|different time|keep the existing|keep thesis|don.?t move|do not move)\b/i.test(text)
}

const voiceWaveBars = [8, 13, 18, 10, 22, 15, 25, 12, 19, 27, 16, 23, 11, 18, 14, 25, 20, 9, 16, 12, 22, 15, 8]

function formatVoiceDuration(value) {
  const total = Math.max(0, Math.round(Number(value) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function MicrophoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" /></svg>
}

function VoiceWaveform({ active = false, progress = 0 }) {
  return <span className={`voice-waveform ${active ? 'is-active' : ''}`} aria-hidden="true">{voiceWaveBars.map((height, index) => <i className={(index + 1) / voiceWaveBars.length <= progress ? 'is-played' : ''} key={index} style={{ '--voice-bar': `${height}px`, '--voice-delay': `${index * -34}ms` }} />)}</span>
}

function VoiceMessage({ duration, src = '', transcript = '', onRemove = null }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const audioRef = useRef(null)

  async function togglePlayback() {
    if (!src || !audioRef.current) return
    if (playing) audioRef.current.pause()
    else {
      if (audioRef.current.ended) {
        audioRef.current.currentTime = 0
        setProgress(0)
      }
      try { await audioRef.current.play() } catch { return }
    }
    setPlaying(!playing)
  }

  function changePlaybackRate() {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1
    setPlaybackRate(nextRate)
    if (audioRef.current) audioRef.current.playbackRate = nextRate
  }

  return <div className={`voice-message ${transcript ? 'has-transcript' : ''}`}>
    <div className="voice-message-player">
      <button type="button" className="voice-play-button" onClick={togglePlayback} disabled={!src} aria-label={src ? (playing ? 'Pause voice message' : 'Play voice message') : 'Voice playback is unavailable on this device'}>{playing ? 'Ⅱ' : '▶'}</button>
      <VoiceWaveform active={playing} progress={progress} />
      <span className="voice-message-meta"><time>{formatVoiceDuration(duration)}</time><button type="button" className="voice-speed-button" onClick={changePlaybackRate} disabled={!src} aria-label={`Playback speed ${playbackRate} times`}>{playbackRate}×</button></span>
      {onRemove && <button type="button" className="voice-remove-button" onClick={onRemove} aria-label="Discard voice recording">×</button>}
    </div>
    {transcript && <><button type="button" className="voice-transcript-toggle" aria-expanded={transcriptOpen} onClick={() => setTranscriptOpen((open) => !open)}>{transcriptOpen ? 'Hide transcription' : 'View transcription'}</button>{transcriptOpen && <p className="voice-transcript-text">{transcript}</p>}</>}
    {src && <audio ref={audioRef} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(event) => setProgress(event.currentTarget.duration ? event.currentTarget.currentTime / event.currentTarget.duration : 0)} />}
  </div>
}

function MicrophonePermissionModal({ blocked, onCancel, onContinue }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onCancel])

  return <div className="microphone-permission-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section className="microphone-permission-modal" role="dialog" aria-modal="true" aria-labelledby="microphone-permission-title">
      <span className="microphone-permission-icon"><MicrophoneIcon /></span>
      <div><p className="dashboard-kicker">Voice message</p><h2 id="microphone-permission-title">{blocked ? 'Microphone is blocked' : 'Use your microphone?'}</h2></div>
      <p>{blocked
        ? 'Your browser has already blocked microphone access. Open the lock icon beside the website address, set Microphone to Allow, then try again.'
        : 'SchedMe needs microphone access to record your voice message. Your browser will show the final permission request next.'}</p>
      {!blocked && <small>The recording stays in this browser. Transcription uses the browser’s built-in speech recognition with no paid API.</small>}
      <div className="microphone-permission-actions"><button type="button" onClick={onCancel}>{blocked ? 'Close' : 'Cancel'}</button>{!blocked && <button type="button" className="is-primary" onClick={onContinue}>Continue</button>}</div>
    </section>
  </div>
}

function FloatingAssistant({
  assistantName,
  assistantMood,
  userName,
  messages,
  tasks,
  chatInput,
  setChatInput,
  onSend,
  chatBusy,
  conversationReady,
  chatError,
  onApplyPlan,
  planBusy,
  planError,
  getVoiceUrl,
}) {
  const [open, setOpen] = useState(false)
  const [popupMounted, setPopupMounted] = useState(false)
  const [dragPoint, setDragPoint] = useState(null)
  const [settling, setSettling] = useState(false)
  const [settleTilt, setSettleTilt] = useState(0)
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: 728, y: 150 }
    try {
      const saved = JSON.parse(window.localStorage.getItem('schedme-chathead-position') || '{}')
      const fallbackX = saved.side === 'left' ? 16 : Math.max(8, window.innerWidth - 72)
      return {
        x: Number.isFinite(saved.x) ? Math.max(8, Math.min(window.innerWidth - 64, saved.x)) : fallbackX,
        y: Number.isFinite(saved.y) ? Math.max(8, Math.min(window.innerHeight - 64, saved.y)) : Math.min(150, window.innerHeight - 76),
      }
    } catch {
      return { x: Math.max(8, window.innerWidth - 72), y: Math.min(150, window.innerHeight - 76) }
    }
  })
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? { width: 800, height: 800 } : { width: window.innerWidth, height: window.innerHeight })
  const [lastSeenModelCount, setLastSeenModelCount] = useState(() => messages.filter((message) => message.role === 'model').length)
  const rootRef = useRef(null)
  const transcriptRef = useRef(null)
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const modelMessageCount = messages.filter((message) => message.role === 'model').length
  const hasUnreadReply = !open && modelMessageCount > lastSeenModelCount
  const headX = dragPoint?.x ?? position.x
  const headY = dragPoint?.y ?? position.y
  const popupHeight = Math.min(520, viewport.height - 24)
  const popupWidth = Math.max(200, Math.min(368, viewport.width - 24))
  const popupSide = headX + 28 >= viewport.width / 2 ? 'right' : 'left'
  const desiredPopupLeft = popupSide === 'right' ? headX - popupWidth - 12 : headX + 68
  const popupLeft = Math.max(12, Math.min(viewport.width - popupWidth - 12, desiredPopupLeft))
  const popupTop = Math.max(12, Math.min(viewport.height - popupHeight - 12, headY - 180))

  useEffect(() => {
    function handleResize() {
      const width = window.innerWidth
      const height = window.innerHeight
      setViewport({ width, height })
      setPosition((current) => ({
        x: Math.max(8, Math.min(width - 64, current.x)),
        y: Math.max(8, Math.min(height - 64, current.y)),
      }))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem('schedme-chathead-position', JSON.stringify(position)) } catch { /* Position persistence is optional. */ }
  }, [position])

  useEffect(() => {
    if (open) {
      setPopupMounted(true)
      return undefined
    }
    if (!popupMounted) return undefined
    const closeTimer = window.setTimeout(() => setPopupMounted(false), 220)
    return () => window.clearTimeout(closeTimer)
  }, [open, popupMounted])

  useEffect(() => {
    if (!settling) return undefined
    const settleTimer = window.setTimeout(() => setSettling(false), 440)
    return () => window.clearTimeout(settleTimer)
  }, [settling])

  useLayoutEffect(() => {
    if (!open || !popupMounted) return undefined
    let secondFrame = 0
    const scrollToLatest = () => {
      const transcript = transcriptRef.current
      if (transcript) transcript.scrollTop = transcript.scrollHeight
    }
    scrollToLatest()
    const firstFrame = window.requestAnimationFrame(() => {
      scrollToLatest()
      secondFrame = window.requestAnimationFrame(scrollToLatest)
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [open, popupMounted, messages.length, chatBusy])

  useEffect(() => {
    if (!open) return undefined
    setLastSeenModelCount(modelMessageCount)
    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, modelMessageCount])

  function beginDrag(event) {
    if (event.button !== 0) return
    setSettling(false)
    const bounds = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      lastX: event.clientX,
      tilt: 0,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
    drag.moved = true
    setOpen(false)
    const tilt = Math.max(-11, Math.min(11, (event.clientX - drag.lastX) * 0.85))
    drag.lastX = event.clientX
    drag.tilt = tilt
    setDragPoint({
      x: Math.max(8, Math.min(window.innerWidth - 64, event.clientX - drag.offsetX)),
      y: Math.max(8, Math.min(window.innerHeight - 64, event.clientY - drag.offsetY)),
      tilt,
    })
  }

  function finishDrag(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      const nextX = Math.max(8, Math.min(window.innerWidth - 64, event.clientX - drag.offsetX))
      const nextY = Math.max(8, Math.min(window.innerHeight - 64, event.clientY - drag.offsetY))
      setPosition({ x: nextX, y: nextY })
      setSettleTilt(drag.tilt)
      setSettling(true)
      suppressClickRef.current = true
    }
    setDragPoint(null)
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function toggleChat() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setOpen((current) => {
      const next = !current
      if (next) setLastSeenModelCount(modelMessageCount)
      return next
    })
  }

  const headStyle = {
    left: headX,
    top: headY,
    '--schedme-chathead-tilt': `${dragPoint?.tilt ?? settleTilt}deg`,
  }
  const popupStyle = { top: popupTop, left: popupLeft, width: popupWidth, height: popupHeight }

  return <div className={`schedme-chathead-layer is-${popupSide} ${open ? 'is-open' : 'is-closed'}`} ref={rootRef}>
    {popupMounted && <section className={`schedme-chat-popup ${open ? 'is-opening' : 'is-closing'}`} style={popupStyle} role="dialog" aria-modal="false" aria-label={`Chat with ${assistantName}`}>
      <header className="schedme-chat-popup-header">
        <span className="schedme-chat-popup-avatar" aria-hidden="true">{assistantName.charAt(0).toUpperCase()}</span>
        <div><strong>{assistantName}</strong><small>{assistantMood} planning companion</small></div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close SchedMe chat">×</button>
      </header>
      <div className="schedme-chat-popup-transcript ai-chat-transcript" ref={transcriptRef} aria-live="polite">
        {messages.map((message, index) => <div className={`ai-chat-message ${message.role}`} key={`floating-${index}-${message.role}`}>
          <span className="ai-message-avatar" aria-hidden="true">{message.role === 'model' ? assistantName.charAt(0).toUpperCase() : (userName || 'Y').charAt(0).toUpperCase()}</span>
          <div className="ai-chat-bubble">
            {message.kind === 'voice' ? <VoiceMessage duration={message.voiceDurationSeconds} src={getVoiceUrl(message.voiceId)} transcript={message.text} /> : <p>{message.text}</p>}
            {message.role === 'model' && message.plan && <PlanReview plan={message.plan} tasks={tasks} onApply={() => onApplyPlan(message.plan, index)} busy={planBusy} applied={message.planApplied} error={planError} />}
          </div>
        </div>)}
        {chatBusy && <p className="ai-thinking">Thinking…</p>}
      </div>
      <form className="schedme-chat-popup-composer" onSubmit={onSend}>
        <input aria-label={`Message ${assistantName}`} value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask SchedMe to move or plan tasks…" maxLength={2000} />
        <button type="submit" disabled={chatBusy || !chatInput.trim() || !conversationReady} aria-label="Send message">↑</button>
      </form>
      {chatError && <p className="schedme-chat-popup-error" role="alert">{chatError}</p>}
    </section>}
    <button
      type="button"
      className={`schedme-chathead ${dragPoint ? 'is-dragging' : ''} ${settling ? 'is-settling' : ''} ${hasUnreadReply ? 'has-unread' : ''}`}
      style={headStyle}
      aria-expanded={open}
      aria-label={open ? `Close ${assistantName} chat` : `Open ${assistantName} chat. Hold and drag to move`}
      title="Tap to chat · Hold and drag to move"
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onClick={toggleChat}
    >
      <span aria-hidden="true">{open ? '×' : assistantName.charAt(0).toUpperCase()}</span>
      {hasUnreadReply && <i aria-label="New assistant reply" />}
    </button>
  </div>
}

function Dashboard({ user, onSignOut, theme, onSelectTheme }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [calendarEditMode, setCalendarEditMode] = useState(false)
  const [calendarEditor, setCalendarEditor] = useState(null)
  const [calendarSaving, setCalendarSaving] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [draggedTaskId, setDraggedTaskId] = useState('')
  const [calendarDragPreview, setCalendarDragPreview] = useState(null)
  const [calendarDropTarget, setCalendarDropTarget] = useState('')
  const [calendarNotice, setCalendarNotice] = useState(null)
  const [activeSection, setActiveSection] = useState('weekly-schedule')
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuSelection, setMenuSelection] = useState('')
  const [tasks, setTasks] = useState([])
  const [taskError, setTaskError] = useState('')
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskListDrag, setTaskListDrag] = useState({ taskId: '', sourceGroup: '', targetGroup: '', targetTaskId: '', position: 'after', x: 0, y: 0, title: '', label: '', color: '' })
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [voiceTranscriptionSupported, setVoiceTranscriptionSupported] = useState(false)
  const [voiceStarting, setVoiceStarting] = useState(false)
  const [microphonePermissionPrompt, setMicrophonePermissionPrompt] = useState(null)
  const [voiceRecording, setVoiceRecording] = useState(false)
  const [voiceDuration, setVoiceDuration] = useState(0)
  const [voiceDraft, setVoiceDraft] = useState(null)
  const [voiceError, setVoiceError] = useState('')
  const [voiceTranscriptStatus, setVoiceTranscriptStatus] = useState('')
  const [, setVoiceAudioVersion] = useState(0)
  const [aiMemory, setAiMemory] = useState(DEFAULT_AI_MEMORY)
  const [aiMemoryError, setAiMemoryError] = useState('')
  const [aiMemoryBusy, setAiMemoryBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [availability, setAvailability] = useState([])
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState('')
  const [conversationReady, setConversationReady] = useState(false)
  const [schedulingState, setSchedulingState] = useState({ ...EMPTY_SCHEDULING_STATE })
  const [interactionProfile, setInteractionProfile] = useState({ ...DEFAULT_INTERACTION_PROFILE })
  const chatEndRef = useRef(null)
  const floatingMenuRef = useRef(null)
  const menuTimerRef = useRef(null)
  const calendarNoticeTimerRef = useRef(null)
  const suppressCalendarClickRef = useRef(false)
  const greetedDateRef = useRef('')
  const voiceRecognitionRef = useRef(null)
  const voiceRecorderRef = useRef(null)
  const voiceStreamRef = useRef(null)
  const voiceTimerRef = useRef(null)
  const voicePermissionTimerRef = useRef(null)
  const voiceRecognitionRestartTimerRef = useRef(null)
  const voiceStartedAtRef = useRef(0)
  const voiceRecordingRef = useRef(false)
  const voiceBaseTextRef = useRef('')
  const voiceFinalTextRef = useRef('')
  const voiceChunksRef = useRef([])
  const voiceAudioUrlsRef = useRef(new Map())
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset])
  const planningDates = useMemo(() => weekDays.map((day) => day.key), [weekDays])
  const formattedToday = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  useEffect(() => subscribeToTasks(user.uid, setTasks, (error) => {
    setTaskError(error.code === 'permission-denied' ? 'Task access is blocked. Deploy the provided Firestore rules in Firebase Console.' : 'Could not load saved tasks. Check that Firestore is enabled for this Firebase project.')
  }), [user.uid])

  useEffect(() => subscribeToAiMemory(user.uid, setAiMemory, (error) => {
    setAiMemoryError(error.code === 'permission-denied' ? 'Firestore blocked access to your AI preferences. Check the published owner-only rules.' : 'Could not load your saved AI preferences.')
  }), [user.uid])

  useEffect(() => subscribeToConversation(user.uid, ({ messages: savedMessages, schedulingState: savedState, interactionProfile: savedProfile, availability: savedAvailability }) => {
    const today = localDateKey(new Date())
    const greetingText = openingMessage(user, aiMemory)
    const preparedHistory = prepareDailyGreetingHistory(savedMessages, greetingText, today)
    const alreadyGreetedToday = savedState.lastGreetingDate === today || preparedHistory.hasTodayGreeting || greetedDateRef.current === today
    const needsGreeting = !alreadyGreetedToday
    if (needsGreeting || alreadyGreetedToday) greetedDateRef.current = today
    const nextMessages = needsGreeting
      ? [...preparedHistory.messages, { role: 'model', text: greetingText, kind: 'daily-greeting', date: today }]
      : preparedHistory.messages
    const visibleMessages = nextMessages.length ? nextMessages : [{ role: 'model', text: 'Ready when you are. Choose a task to schedule, or type Task / Day / Time.' }]
    const nextState = savedState.lastGreetingDate === today ? savedState : { ...savedState, lastGreetingDate: today }
    setMessages(visibleMessages)
    restoreSavedVoiceMessages(visibleMessages)
    setSchedulingState(nextState)
    setInteractionProfile(savedProfile)
    setAvailability(savedAvailability)
    setConversationReady(true)
    if (needsGreeting || preparedHistory.changed || savedState.lastGreetingDate !== today) saveConversation(user.uid, visibleMessages, nextState, savedProfile, savedAvailability).catch(() => {})
  }, () => {
    setMessages([{ role: 'model', text: 'Ready when you are. Choose a task to schedule, or type Task / Day / Time.' }])
    setConversationReady(true)
  }), [user.uid, aiMemory.chatbotName, aiMemory.greetingStyle])

  useEffect(() => {
    const transcript = chatEndRef.current?.parentElement
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' })
  }, [messages, chatBusy])

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setVoiceSupported(Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia))
    setVoiceTranscriptionSupported(Boolean(Recognition))
  }, [])

  useEffect(() => {
    if (!menuOpen) return undefined

    function closeOnOutsidePress(event) {
      if (!floatingMenuRef.current?.contains(event.target)) {
        setMenuOpen(false)
        setMenuSelection('')
      }
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        setMenuSelection('')
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  useEffect(() => () => {
    window.clearTimeout(menuTimerRef.current)
    window.clearTimeout(calendarNoticeTimerRef.current)
    window.clearInterval(voiceTimerRef.current)
    window.clearTimeout(voicePermissionTimerRef.current)
    window.clearTimeout(voiceRecognitionRestartTimerRef.current)
    voiceRecognitionRef.current?.abort()
    if (voiceRecorderRef.current?.state === 'recording') voiceRecorderRef.current.stop()
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
    voiceAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    const revealItems = [...document.querySelectorAll('[data-reveal]')]
    const sectionItems = ['weekly-schedule', 'task-priorities', 'planning-workspace']
      .map((id) => document.getElementById(id))
      .filter(Boolean)

    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealItems.forEach((item) => item.classList.add('is-visible'))
      return undefined
    }

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          revealObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })

    const sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) setActiveSection(visible.target.id)
    }, { threshold: [0.2, 0.45, 0.7], rootMargin: '-18% 0px -55% 0px' })

    revealItems.forEach((item) => revealObserver.observe(item))
    sectionItems.forEach((item) => sectionObserver.observe(item))

    return () => {
      revealObserver.disconnect()
      sectionObserver.disconnect()
    }
  }, [])

  function goToSection(event, sectionId) {
    event.preventDefault()
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([10, 22, 16])
    setActiveSection(sectionId)
    setMenuSelection(sectionId)
    window.clearTimeout(menuTimerRef.current)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    menuTimerRef.current = window.setTimeout(() => {
      setMenuOpen(false)
      document.getElementById(sectionId)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
      window.history.replaceState(null, '', `#${sectionId}`)
      menuTimerRef.current = window.setTimeout(() => setMenuSelection(''), 320)
    }, reducedMotion ? 0 : 210)
  }

  const tasksByGroup = useMemo(() => ({
    free: sortTasksForGroup(tasks.filter((task) => task.category === 'free' || task.showInInbox === true || task.source === 'manual-calendar'), 'free'),
    urgent: sortTasksForGroup(tasks.filter((task) => task.urgent), 'urgent'),
    important: sortTasksForGroup(tasks.filter((task) => task.important), 'important'),
    notUrgent: sortTasksForGroup(tasks.filter((task) => !task.urgent && !task.important && task.category !== 'free'), 'notUrgent'),
  }), [tasks])

  async function addTask(title, category, alsoPriority) {
    setTaskBusy(true)
    setTaskError('')
    try { await createTask(user.uid, title, category, alsoPriority) }
    catch (error) { setTaskError(error.code === 'permission-denied' ? 'Task access is blocked. Deploy the provided Firestore rules.' : error.message || 'Could not save this task.') }
    finally { setTaskBusy(false) }
  }

  async function completeTask(task) {
    setTaskError('')
    try { await setTaskCompleted(user.uid, task.id, !task.completed) }
    catch { setTaskError('Could not update this task. Check your Firestore setup.') }
  }

  function startTaskListDrag(event, task, sourceGroup, color) {
    const x = Math.max(12, Math.min(event.clientX + 18, window.innerWidth - 280))
    const y = Math.max(12, Math.min(event.clientY + 18, window.innerHeight - 104))
    setTaskListDrag({
      taskId: task.id,
      sourceGroup,
      targetGroup: sourceGroup,
      targetTaskId: '',
      position: 'after',
      x,
      y,
      title: task.title,
      label: task.completed ? 'Completed' : taskCategoryLabel(task.category),
      color,
    })
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(14)
  }

  function moveTaskListDragPreview(event) {
    if (!event.clientX && !event.clientY) return
    const x = Math.max(12, Math.min(event.clientX + 18, window.innerWidth - 280))
    const y = Math.max(12, Math.min(event.clientY + 18, window.innerHeight - 104))
    setTaskListDrag((current) => current.taskId ? { ...current, x, y } : current)
  }

  function updateTaskListDropTarget(targetGroup, targetTaskId = '', position = 'after') {
    setTaskListDrag((current) => current.taskId && (current.targetGroup !== targetGroup || current.targetTaskId !== targetTaskId || current.position !== position)
      ? { ...current, targetGroup, targetTaskId, position }
      : current)
  }

  function finishTaskListDrag() {
    setTaskListDrag({ taskId: '', sourceGroup: '', targetGroup: '', targetTaskId: '', position: 'after', x: 0, y: 0, title: '', label: '', color: '' })
  }

  async function moveTaskToList(taskId, targetGroup, targetTaskId = '', position = 'after') {
    if (!taskId || !targetGroup || taskId === targetTaskId) {
      finishTaskListDrag()
      return
    }
    const destinationTasks = tasksByGroup[targetGroup] || []
    const orderedTaskIds = planTaskListDrop(destinationTasks, taskId, targetTaskId, position)
    const currentOrder = destinationTasks.map((task) => task.id)
    const orderChanged = orderedTaskIds.some((id, index) => id !== currentOrder[index]) || orderedTaskIds.length !== currentOrder.length
    if (targetGroup === taskListDrag.sourceGroup && !orderChanged) {
      finishTaskListDrag()
      return
    }
    setTaskBusy(true)
    setTaskError('')
    try {
      if (targetGroup === taskListDrag.sourceGroup) await setTaskListOrder(user.uid, targetGroup, orderedTaskIds)
      else await moveTaskToPriorityList(user.uid, taskId, targetGroup, orderedTaskIds)
    } catch (error) {
      setTaskError(error.code === 'permission-denied' ? 'Task access is blocked. Check the published Firestore rules.' : error.message || 'Could not move or reorder this task.')
    } finally {
      setTaskBusy(false)
      finishTaskListDrag()
    }
  }

  async function saveAssistantSettings(memory) {
    setAiMemoryBusy(true)
    setAiMemoryError('')
    try {
      await saveAiMemory(user.uid, memory, user.displayName || '')
      setAiMemory(memory)
      setSettingsOpen(false)
    } catch (error) {
      setAiMemoryError(error.code === 'permission-denied' ? 'Firestore blocked this save. Check the published owner-only rules.' : 'Could not save these AI settings.')
    } finally { setAiMemoryBusy(false) }
  }

  async function rememberPrompt(prompt) {
    setAiMemoryBusy(true)
    setAiMemoryError('')
    try {
      await addPromptToAiMemory(user.uid, prompt, aiMemory, user.displayName || '')
      const savedPrompt = prompt.trim().slice(0, 240)
      setAiMemory((current) => current.preferences.some((item) => item.toLocaleLowerCase() === savedPrompt.toLocaleLowerCase()) ? current : { ...current, preferences: [...current.preferences, savedPrompt] })
    } catch (error) { setAiMemoryError(error.message || 'Could not save that preference.') }
    finally { setAiMemoryBusy(false) }
  }

  async function forgetPreference(prompt) {
    setAiMemoryBusy(true)
    setAiMemoryError('')
    try {
      await forgetAiPreference(user.uid, prompt, aiMemory, user.displayName || '')
      setAiMemory((current) => ({ ...current, preferences: current.preferences.filter((item) => item !== prompt) }))
    } catch { setAiMemoryError('Could not remove that preference.') }
    finally { setAiMemoryBusy(false) }
  }

  async function restoreSavedVoiceMessages(savedMessages) {
    const voiceMessages = savedMessages.filter((message) => message.kind === 'voice' && message.voiceId && !voiceAudioUrlsRef.current.has(message.voiceId))
    if (!voiceMessages.length) return
    let restored = false
    await Promise.all(voiceMessages.map(async (message) => {
      try {
        const blob = await loadVoiceMessage(user.uid, message.voiceId)
        if (!blob || voiceAudioUrlsRef.current.has(message.voiceId)) return
        voiceAudioUrlsRef.current.set(message.voiceId, URL.createObjectURL(blob))
        restored = true
      } catch { /* Voice recordings are optional local-only data. */ }
    }))
    if (restored) setVoiceAudioVersion((version) => version + 1)
  }

  function discardVoiceDraft() {
    if (voiceDraft?.url) URL.revokeObjectURL(voiceDraft.url)
    setVoiceDraft(null)
    setVoiceDuration(0)
    setVoiceError('')
    setVoiceTranscriptStatus('')
  }

  function stopVoiceRecording() {
    if (!voiceRecordingRef.current) return
    voiceRecordingRef.current = false
    setVoiceRecording(false)
    window.clearInterval(voiceTimerRef.current)
    window.clearTimeout(voiceRecognitionRestartTimerRef.current)
    const elapsed = Math.max(1, Math.round((Date.now() - voiceStartedAtRef.current) / 1000))
    setVoiceDuration(elapsed)

    const recognition = voiceRecognitionRef.current
    voiceRecognitionRef.current = null
    try { recognition?.stop() } catch { /* Recognition may already have ended. */ }

    const recorder = voiceRecorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    else {
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
      voiceStreamRef.current = null
    }
  }

  async function requestVoiceRecording() {
    if (chatBusy || voiceStarting || !conversationReady) return
    if (!voiceSupported) {
      await startVoiceRecording()
      return
    }

    let permissionState = 'prompt'
    try {
      const permission = await navigator.permissions?.query?.({ name: 'microphone' })
      if (permission?.state) permissionState = permission.state
    } catch { /* Some browsers only expose permission through getUserMedia. */ }

    if (permissionState === 'granted') {
      await startVoiceRecording()
      return
    }
    setVoiceError('')
    setMicrophonePermissionPrompt(permissionState === 'denied' ? 'blocked' : 'prompt')
  }

  async function startVoiceRecording() {
    if (!voiceSupported || chatBusy || !conversationReady) {
      if (!voiceSupported) setVoiceError(window.isSecureContext
        ? 'Microphone recording is not available in this browser. Open the site in Chrome, Edge, or Safari.'
        : 'Microphone access requires the secure production site. Open https://schedme.vercel.app in a new browser tab.')
      return
    }

    discardVoiceDraft()
    setVoiceStarting(true)
    setVoiceError('Waiting for microphone permission…')
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition

    try {
      try {
        const permission = await navigator.permissions?.query?.({ name: 'microphone' })
        if (permission?.state === 'denied') {
          const deniedError = new Error('Microphone permission is blocked.')
          deniedError.name = 'NotAllowedError'
          throw deniedError
        }
      } catch (permissionError) {
        if (permissionError?.name === 'NotAllowedError') throw permissionError
      }

      let permissionTimedOut = false
      const permissionRequest = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        if (permissionTimedOut) {
          stream.getTracks().forEach((track) => track.stop())
          const timeoutError = new Error('Microphone permission timed out.')
          timeoutError.name = 'PermissionTimeoutError'
          throw timeoutError
        }
        return stream
      })
      const permissionTimeout = new Promise((_, reject) => {
        voicePermissionTimerRef.current = window.setTimeout(() => {
          permissionTimedOut = true
          const timeoutError = new Error('Microphone permission timed out.')
          timeoutError.name = 'PermissionTimeoutError'
          reject(timeoutError)
        }, 15000)
      })
      const stream = await Promise.race([permissionRequest, permissionTimeout])
      window.clearTimeout(voicePermissionTimerRef.current)
      const recorder = new MediaRecorder(stream)
      let recognition = Recognition ? new Recognition() : null
      voiceStreamRef.current = stream
      voiceRecorderRef.current = recorder
      voiceRecognitionRef.current = recognition
      voiceChunksRef.current = []
      voiceBaseTextRef.current = chatInput.trim()
      voiceFinalTextRef.current = ''
      voiceStartedAtRef.current = Date.now()
      voiceRecordingRef.current = true
      setVoiceTranscriptStatus(recognition ? 'Starting live transcription…' : 'Live transcription is unavailable in this browser.')

      recorder.ondataavailable = (event) => {
        if (event.data?.size) voiceChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const seconds = Math.max(1, Math.round((Date.now() - voiceStartedAtRef.current) / 1000))
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size) setVoiceDraft({ blob, url: URL.createObjectURL(blob), duration: seconds })
        setVoiceDuration(seconds)
        stream.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        voiceRecorderRef.current = null
      }

      if (recognition) {
        recognition.lang = navigator.language || 'en-US'
        // Short recognition sessions restart after each phrase. This is more
        // reliable across Chromium-based and mobile browsers than continuous mode.
        recognition.continuous = false
        recognition.interimResults = true
        recognition.maxAlternatives = 1
        recognition.onstart = () => {
          setVoiceTranscriptStatus('Listening… speak now.')
          setVoiceError('')
        }
        recognition.onspeechstart = () => setVoiceTranscriptStatus('Hearing you…')
        recognition.onresult = (event) => {
          let interim = ''
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const transcript = event.results[index][0]?.transcript || ''
            if (event.results[index].isFinal) voiceFinalTextRef.current += `${transcript.trim()} `
            else interim += transcript
          }
          const spoken = `${voiceFinalTextRef.current}${interim}`.trim()
          setVoiceTranscriptStatus(spoken ? 'Transcribing live…' : 'Listening… speak now.')
          setChatInput([voiceBaseTextRef.current, spoken].filter(Boolean).join(' ').slice(0, 2000))
        }
        recognition.onerror = (event) => {
          if (event.error === 'aborted') return
          if (event.error === 'no-speech') {
            setVoiceTranscriptStatus('Listening… speak when ready.')
            return
          }

          const blocked = event.error === 'not-allowed' || event.error === 'service-not-allowed'
          const unavailable = blocked || event.error === 'audio-capture' || event.error === 'language-not-supported'
          setVoiceError(blocked
            ? 'Live transcription was blocked by this browser. Your audio is still recording; allow speech recognition or use Chrome or Edge.'
            : event.error === 'network'
              ? 'Live transcription lost its connection. I’ll keep trying while the audio records.'
              : 'Live transcription paused. I’ll keep trying while the audio records.')
          setVoiceTranscriptStatus(unavailable ? 'Live transcription unavailable—audio is still recording.' : 'Reconnecting live transcription…')
          if (unavailable) {
            recognition.onend = null
            if (voiceRecognitionRef.current === recognition) voiceRecognitionRef.current = null
          }
        }
        recognition.onend = () => {
          if (!voiceRecordingRef.current) return
          setVoiceTranscriptStatus((status) => status.startsWith('Live transcription unavailable') ? status : 'Listening for your next words…')
          window.clearTimeout(voiceRecognitionRestartTimerRef.current)
          voiceRecognitionRestartTimerRef.current = window.setTimeout(() => {
            if (!voiceRecordingRef.current || voiceRecognitionRef.current !== recognition) return
            try { recognition.start() } catch {
              setVoiceTranscriptStatus('Reconnecting live transcription…')
            }
          }, 180)
        }
      }

      recorder.start(250)
      if (recognition) {
        try { recognition.start() } catch {
          voiceRecognitionRef.current = null
          recognition = null
          setVoiceTranscriptStatus('Live transcription could not start—audio is still recording.')
        }
      }
      setVoiceRecording(true)
      setVoiceStarting(false)
      setVoiceDuration(0)
      setVoiceError(recognition ? '' : 'Recording is working, but this browser has no free built-in transcription. Type what you said before sending, or use Chrome, Edge, or Safari.')
      voiceTimerRef.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - voiceStartedAtRef.current) / 1000)
        setVoiceDuration(seconds)
        if (seconds >= 300) stopVoiceRecording()
      }, 250)
    } catch (error) {
      voiceRecordingRef.current = false
      setVoiceRecording(false)
      setVoiceStarting(false)
      window.clearInterval(voiceTimerRef.current)
      window.clearTimeout(voicePermissionTimerRef.current)
      window.clearTimeout(voiceRecognitionRestartTimerRef.current)
      try { voiceRecognitionRef.current?.abort() } catch { /* Recognition may not have started. */ }
      const failedRecorder = voiceRecorderRef.current
      if (failedRecorder?.state === 'recording') {
        failedRecorder.onstop = null
        failedRecorder.stop()
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
      voiceRecognitionRef.current = null
      voiceRecorderRef.current = null
      voiceStreamRef.current = null
      setVoiceError(error?.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Select the lock or microphone icon in the address bar, set Microphone to Allow, then try again.'
        : error?.name === 'PermissionTimeoutError'
          ? 'The browser permission prompt did not finish. Check the address bar for a microphone icon, choose Allow, then click the mic again. If this is an IDE preview, open schedme.vercel.app in a new tab.'
          : error?.name === 'NotFoundError'
            ? 'No microphone was found on this device.'
            : error?.name === 'NotReadableError'
              ? 'The microphone is being used by another app. Close that app and try again.'
              : 'The microphone could not start. Try again or type your message.')
    }
  }

  async function resetConversation() {
    if (!window.confirm('Clear this saved conversation? Your tasks and assistant preferences will stay unchanged.')) return
    if (voiceRecordingRef.current) stopVoiceRecording()
    setMicrophonePermissionPrompt(null)
    discardVoiceDraft()
    voiceAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    voiceAudioUrlsRef.current.clear()
    deleteUserVoiceMessages(user.uid).catch(() => {})
    const today = localDateKey(new Date())
    const freshMessages = [{ role: 'model', text: 'Chat cleared. Choose a task to schedule whenever you’re ready.' }]
    await clearConversation(user.uid, today)
    setMessages(freshMessages)
    setSchedulingState({ ...EMPTY_SCHEDULING_STATE, lastGreetingDate: today })
    setInteractionProfile({ ...DEFAULT_INTERACTION_PROFILE })
    setAvailability([])
  }

  async function persistConversation(nextMessages, nextState = schedulingState, nextProfile = interactionProfile, nextAvailability = availability) {
    const stateWithGreeting = preserveGreetingDate(nextState, schedulingState, greetedDateRef.current)
    setMessages(nextMessages)
    setSchedulingState(stateWithGreeting)
    setInteractionProfile(nextProfile)
    setAvailability(nextAvailability)
    try { await saveConversation(user.uid, nextMessages, stateWithGreeting, nextProfile, nextAvailability) }
    catch { setChatError('Your reply worked, but the conversation history could not be saved.') }
  }

  async function sendChat(event, directMessage = '') {
    event?.preventDefault()
    const text = (directMessage || chatInput).trim()
    if (!text || chatBusy || voiceRecording || !conversationReady) return
    const operationRequestId = newOperationRequestId('chat')

    const preliminary = parseSchedulingInput(text, tasks, weekDays, schedulingState.activeTaskId, aiMemory.defaultDuration || 60)
    const bulkMoveRequest = parseConversationalBulkMoveRequest(text, messages)
    const namedTaskMoveRequest = parseNamedTaskMoveRequest(text, tasks, weekDays)
    const previousUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const previousCompletionRequest = parseTaskCompletionRequest(previousUserMessage?.text, weekDays)
    let completionRequest = parseTaskCompletionRequest(text, weekDays)
    completionRequest = applyTaskCompletionContext(completionRequest, text, previousCompletionRequest, schedulingState.lastAction)
    const namedCompletionRequest = parseNamedTaskCompletionRequest(text, tasks)
    const namedDeletionRequest = parseNamedTaskDeletionRequest(text, tasks)
    const nextProfile = learnInteractionStyle(interactionProfile, text, preliminary.isCompact)
    let voiceMessage = null
    if (!directMessage && voiceDraft) {
      const voiceId = globalThis.crypto?.randomUUID?.() || `voice-${Date.now()}`
      voiceAudioUrlsRef.current.set(voiceId, voiceDraft.url)
      saveVoiceMessage(user.uid, voiceId, voiceDraft.blob).catch(() => {})
      voiceMessage = { kind: 'voice', voiceId, voiceDurationSeconds: voiceDraft.duration }
    }
    const next = [...messages, { role: 'user', text, ...(voiceMessage || {}) }]
    setMessages(next)
    setChatInput('')
    if (voiceMessage) {
      setVoiceDraft(null)
      setVoiceDuration(0)
      setVoiceError('')
    }
    setChatBusy(true)
    setChatError('')

    const complete = async (message, nextState = schedulingState, extra = {}) => {
      await persistConversation([...next, { role: 'model', text: message, ...extra }], nextState, nextProfile)
    }

    const nextQueuedTask = (state, excludedIds = []) => getSchedulingQueue(tasks, [...state.deferredTaskIds, ...excludedIds])[0]

    const saveSlot = async (task, slot, state) => {
      const now = new Date()
      const currentMinute = now.getHours() * 60 + now.getMinutes()
      if (slot.date === localDateKey(now) && minuteOfDay(slot.startTime) <= currentMinute) {
        await complete(`That time has already passed today. What later time should I use for “${task.title}”?`, { ...state, activeTaskId: task.id, lastReferencedTaskId: task.id, date: slot.date, startTime: '', endTime: '', pendingConflict: null })
        return
      }
      const conflict = findScheduleConflict(tasks, task.id, slot)
      if (conflict) {
        const alternatives = suggestAvailableSlots(tasks, task.id, slot).map((item) => formatSlot(item, weekDays).split(', ')[1]).join(' or ')
        await complete(
          `${formatSlot(slot, weekDays)} overlaps with “${conflict.title}.” Would you like to put “${task.title}” there and return “${conflict.title}” to What’s on my mind, or keep it and choose another time${alternatives ? ` such as ${alternatives}` : ''}?`,
          { ...state, activeTaskId: task.id, lastReferencedTaskId: task.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime, pendingConflict: { incomingTaskId: task.id, displacedTaskId: conflict.id, slot } },
        )
        return
      }

      await commitTaskOperation(user.uid, {
        requestId: operationRequestId,
        type: task.date ? 'move' : 'schedule',
        description: `${task.title} → ${slot.date} ${slot.startTime}-${slot.endTime}`,
        changes: [{
          kind: 'update',
          taskId: task.id,
          data: { ...slot, source: 'user-directed-schedule' },
        }],
      })
      const recentSlot = getTrustedRecentSlot(schedulingState, task)
      const lastAction = {
        type: recentSlot || task.date ? 'move' : 'schedule',
        taskId: task.id,
        previousSlot: recentSlot || (task.date ? { date: task.date, startTime: task.startTime, endTime: task.endTime } : null),
        slot,
      }
      if (state.queueMode) {
        const following = nextQueuedTask(state, [task.id])
        if (following) {
          await complete(
            `Done—“${task.title}” is scheduled ${formatSlot(slot, weekDays)}. Next is “${following.title}.” What day and time work for it? You can reply like Monday-2-3pm, skip, or stop.`,
            { ...EMPTY_SCHEDULING_STATE, queueMode: true, activeTaskId: following.id, lastReferencedTaskId: task.id, deferredTaskIds: state.deferredTaskIds, lastAction },
          )
          return
        }
      }
      await complete(`Done—“${task.title}” is scheduled ${formatSlot(slot, weekDays)}. You can say “undo” if you want to change it.`, { ...EMPTY_SCHEDULING_STATE, lastReferencedTaskId: task.id, lastAction })
    }

    const pendingActionState = (pendingAction, taskId = '') => ({
      ...EMPTY_SCHEDULING_STATE,
      pendingAction,
      lastReferencedTaskId: taskId || schedulingState.lastReferencedTaskId,
      lastAction: schedulingState.lastAction,
    })

    const finishedTaskActionState = (taskId = '', lastAction = null) => ({
      ...EMPTY_SCHEDULING_STATE,
      lastReferencedTaskId: taskId || null,
      lastAction,
    })

    const handleContextTaskPlan = async (plan, action) => {
      if (plan.status === 'unsupported') return false

      if (plan.status === 'clarify') {
        const pendingAction = createPendingAction(action, { reason: plan.reason, missingFields: plan.missingFields })
        const pendingState = pendingActionState(pendingAction, plan.task?.id)
        if (plan.reason === 'ambiguous_task') {
          const choices = plan.matches.slice(0, 4).map((task) => `“${task.title}”`).join(', ')
          await complete(`I found more than one matching task: ${choices}. Which one do you mean?`, pendingState)
        } else if (plan.reason === 'missing_title') {
          await complete('What should I call the new task?', pendingState)
        } else if (plan.reason === 'missing_priority') {
          await complete(plan.task
            ? `Should “${plan.task.title}” be urgent, important, urgent and important, flexible, or unclassified?`
            : 'Should those tasks be urgent, important, urgent and important, flexible, or unclassified?', pendingState)
        } else if (plan.reason === 'missing_color') {
          await complete(plan.task ? `What color should I use for “${plan.task.title}”?` : 'What color should I use for those tasks?', pendingState)
        } else if (plan.reason === 'missing_date') {
          await complete('What day should I schedule the new task?', pendingState)
        } else if (plan.reason === 'missing_time') {
          await complete('What time should I schedule the new task?', pendingState)
        } else if (plan.reason === 'invalid_slot') {
          await complete('What valid day and time should I use for the new task?', pendingState)
        } else {
          await complete('Which task do you mean?', pendingState)
        }
        return true
      }

      if (plan.status === 'confirm') {
        const pendingAction = createPendingAction(action, { reason: 'confirm_delete', awaitingConfirmation: true })
        const deletionTargets = plan.tasks || [plan.task]
        const names = deletionTargets.map((task) => `“${task.title}”`).join(' and ')
        await complete(`Delete ${names} permanently from your tasks and calendar?`, pendingActionState(pendingAction, deletionTargets.length === 1 ? deletionTargets[0].id : ''))
        return true
      }

      if (plan.status === 'unchanged') {
        let message = `“${plan.task.title}” is already unchanged.`
        if (plan.operation === 'completion') message = `“${plan.task.title}” is already ${plan.completed ? 'done' : 'active'}.`
        if (plan.operation === 'priority') message = `“${plan.task.title}” is already ${plan.label}.`
        if (plan.operation === 'color') message = `“${plan.task.title}” already uses that color.`
        if (plan.operation === 'unschedule') message = `“${plan.task.title}” is already off the calendar.`
        await complete(message, finishedTaskActionState(plan.task.id))
        return true
      }

      if (plan.status === 'unchanged_many') {
        let message = `All ${plan.tasks.length} tasks are already unchanged.`
        if (plan.operation === 'completion') message = `All ${plan.tasks.length} tasks are already ${plan.completed ? 'done' : 'active'}.`
        if (plan.operation === 'priority') message = `All ${plan.tasks.length} tasks are already ${plan.label}.`
        if (plan.operation === 'color') message = `All ${plan.tasks.length} tasks already use ${plan.color}.`
        await complete(message, finishedTaskActionState(plan.tasks.at(-1)?.id || ''))
        return true
      }

      if (plan.status === 'ready_many') {
        const changes = plan.tasksToUpdate.map((task) => {
          if (plan.operation === 'completion') return { kind: 'update', taskId: task.id, data: { completed: plan.completed } }
          if (plan.operation === 'priority') {
            return {
              kind: 'update',
              taskId: task.id,
              data: {
                category: plan.category,
                urgent: plan.category === 'urgent' || plan.alsoPriority,
                important: plan.category === 'important' || plan.alsoPriority,
              },
            }
          }
          return { kind: 'update', taskId: task.id, data: { color: plan.color, colorMode: 'manual' } }
        })
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: `${plan.operation}-many`,
          description: plan.operation === 'completion'
            ? `${plan.completed ? 'Completed' : 'Reopened'} ${changes.length} tasks`
            : `Changed ${plan.operation} for ${changes.length} tasks`,
          changes,
        })
        const unchangedCount = plan.tasks.length - plan.tasksToUpdate.length
        const unchangedNote = unchangedCount ? ` ${unchangedCount} ${unchangedCount === 1 ? 'was' : 'were'} already unchanged.` : ''
        let message = `Done—I updated ${changes.length} tasks.${unchangedNote}`
        if (plan.operation === 'completion') {
          message = plan.completed
            ? `Done—I marked ${changes.length} ${changes.length === 1 ? 'task' : 'tasks'} as done.${unchangedNote}`
            : `Done—I reopened ${changes.length} ${changes.length === 1 ? 'task' : 'tasks'}.${unchangedNote}`
        }
        if (plan.operation === 'priority') message = `Done—I changed ${changes.length} ${changes.length === 1 ? 'task' : 'tasks'} to ${plan.label}.${unchangedNote}`
        if (plan.operation === 'color') message = `Done—I changed ${changes.length} ${changes.length === 1 ? 'task' : 'tasks'} to ${plan.color}.${unchangedNote}`
        await complete(message, finishedTaskActionState(plan.tasks.at(-1)?.id || ''))
        return true
      }

      if (plan.status !== 'ready') return false

      if (plan.operation === 'create' || plan.operation === 'create_scheduled') {
        if (plan.operation === 'create_scheduled') {
          const slot = { date: plan.data.date, startTime: plan.data.startTime, endTime: plan.data.endTime }
          const conflict = findScheduleConflict(tasks, '__new-context-task__', slot)
          const now = new Date()
          const isPast = slot.date === localDateKey(now) && minuteOfDay(slot.startTime) <= now.getHours() * 60 + now.getMinutes()
          if (conflict || isPast) {
            const pendingAction = createPendingAction(action, { reason: conflict ? 'schedule_conflict' : 'past_time', missingFields: ['startTime', 'endTime'] })
            await complete(
              conflict
                ? `${formatSlot(slot, weekDays)} overlaps with “${conflict.title}.” What other time should I use?`
                : 'That time has already passed. What later time should I use?',
              pendingActionState(pendingAction),
            )
            return true
          }
        }
        const taskId = createTaskDocumentId(user.uid)
        const normalizedCategory = plan.operation === 'create_scheduled' && plan.data.category === 'free' ? 'notUrgent' : plan.data.category
        const taskData = {
          title: plan.data.title,
          category: normalizedCategory,
          urgent: normalizedCategory === 'urgent' || plan.data.alsoPriority,
          important: normalizedCategory === 'important' || plan.data.alsoPriority,
          completed: false,
          color: plan.data.color || '',
          colorMode: plan.data.color ? 'manual' : 'automatic',
          ...(plan.operation === 'create_scheduled' ? {
            date: plan.data.date,
            startTime: plan.data.startTime,
            endTime: plan.data.endTime,
            showInInbox: true,
            source: 'user-directed-ai-create',
          } : {}),
        }
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: plan.operation,
          description: `Created ${plan.data.title}`,
          changes: [{ kind: 'create', taskId, data: taskData }],
        })
        const message = plan.operation === 'create_scheduled'
          ? `Done—“${plan.data.title}” was created and scheduled ${formatSlot(plan.data, weekDays)}.`
          : `Done—“${plan.data.title}” was added to your ${plan.data.label} list.`
        await complete(message, finishedTaskActionState(taskId))
        return true
      }

      if (plan.operation === 'completion') {
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: plan.completed ? 'complete' : 'reopen',
          description: `${plan.completed ? 'Completed' : 'Reopened'} ${plan.task.title}`,
          changes: [{ kind: 'update', taskId: plan.task.id, data: { completed: plan.completed } }],
        })
        await complete(plan.completed ? `Done—“${plan.task.title}” is marked complete.` : `Done—“${plan.task.title}” is active again.`, finishedTaskActionState(plan.task.id))
        return true
      }
      if (plan.operation === 'priority') {
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: 'priority',
          description: `Changed priority for ${plan.task.title}`,
          changes: [{
            kind: 'update',
            taskId: plan.task.id,
            data: {
              category: plan.category,
              urgent: plan.category === 'urgent' || plan.alsoPriority,
              important: plan.category === 'important' || plan.alsoPriority,
            },
          }],
        })
        await complete(`Done—“${plan.task.title}” is now ${plan.label}.`, finishedTaskActionState(plan.task.id))
        return true
      }
      if (plan.operation === 'color') {
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: 'color',
          description: `Changed color for ${plan.task.title}`,
          changes: [{ kind: 'update', taskId: plan.task.id, data: { color: plan.color, colorMode: 'manual' } }],
        })
        await complete(`Done—“${plan.task.title}” now uses ${plan.color}.`, finishedTaskActionState(plan.task.id))
        return true
      }
      if (plan.operation === 'unschedule') {
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: 'unschedule',
          description: `Unscheduled ${plan.task.title}`,
          changes: [{ kind: 'update', taskId: plan.task.id, data: {}, removeFields: ['date', 'startTime', 'endTime', 'source'] }],
        })
        const lastAction = { type: 'unschedule', taskId: plan.task.id, previousSlot: plan.previousSlot, slot: null }
        await complete(`Done—“${plan.task.title}” was removed from the calendar while keeping its other details.`, finishedTaskActionState(plan.task.id, lastAction))
        return true
      }
      if (plan.operation === 'delete') {
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: 'delete',
          description: `Deleted ${plan.task.title}`,
          changes: [{ kind: 'delete', taskId: plan.task.id }],
        })
        await complete(`Done—“${plan.task.title}” was permanently deleted.`, finishedTaskActionState())
        return true
      }
      if (plan.operation === 'delete_many') {
        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: 'delete-many',
          description: `Deleted ${plan.tasks.length} tasks`,
          changes: plan.tasks.map((task) => ({ kind: 'delete', taskId: task.id })),
        })
        const names = plan.tasks.map((task) => `“${task.title}”`).join(' and ')
        await complete(`Done—${names} were permanently deleted.`, finishedTaskActionState())
        return true
      }
      return false
    }

    try {
      const savedPendingAction = schedulingState.pendingAction
      if (savedPendingAction && /^(?:never mind|nevermind|forget it|cancel request|stop|not now)[.!\s]*$/i.test(text)) {
        await complete('Okay—the pending change was canceled.', {
          ...EMPTY_SCHEDULING_STATE,
          lastReferencedTaskId: schedulingState.lastReferencedTaskId,
          lastAction: schedulingState.lastAction,
        })
        return
      }

      let forcedAction = null
      if (savedPendingAction?.awaitingConfirmation) {
        if (confirmsTaskDeletion(text)) forcedAction = confirmedPendingAction(savedPendingAction)
        else if (declinesTaskDeletion(text) || isStopMessage(text)) {
          await complete('Okay—I did not delete anything.', {
            ...EMPTY_SCHEDULING_STATE,
            lastReferencedTaskId: schedulingState.lastReferencedTaskId,
            lastAction: schedulingState.lastAction,
          })
          return
        } else {
          await complete('Please answer yes to delete it permanently, or no to keep it.', schedulingState)
          return
        }
      }

      const localRoute = getLocalCommandRoute({
        text,
        preliminary,
        bulkMoveRequest,
        namedTaskMoveRequest,
        completionRequest,
        namedCompletionRequest,
        namedDeletionRequest,
        pendingAction: savedPendingAction,
      })
      if (localRoute.bypassGemini) recordLocalCommandBypass(localRoute.kind)
      const useContextScheduling = !bulkMoveRequest.isBulk && contextSchedulingActionsEnabled() && shouldInterpretContextScheduling({ text, schedulingState, preliminary })
      const useContextTaskAction = !bulkMoveRequest.isBulk && contextTaskActionsEnabled() && shouldInterpretContextTaskAction({ text, schedulingState })
      const shouldRequestAction = !forcedAction && !localRoute.bypassGemini && !bulkMoveRequest.isBulk && (useContextScheduling || useContextTaskAction || actionIntentShadowEnabled())
      let action = forcedAction || localRoute.action
      if (shouldRequestAction) {
        const actionContext = buildCompactActionContext({
          message: text,
          messages,
          tasks,
          schedulingState,
          memory: aiMemory,
          interactionProfile: nextProfile,
          availability,
          currentDate: localDateKey(new Date()),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        })
        try {
          consumeAiRequestBudget(user.uid)
          action = await interpretActionIntent(actionContext)
        }
        catch (error) { console.warn('[SchedMe context actions] Interpreter unavailable; using the existing scheduler.', error?.message || error) }
      }

      if (action) {
        action = mergePendingAction(action, savedPendingAction)
        if (action.intent === 'create_task') {
          action = {
            ...action,
            patch: {
              ...action.patch,
              ...(preliminary.day && !preliminary.day.ambiguous ? { date: preliminary.day.key } : {}),
              ...(preliminary.time ? { startTime: preliminary.time.startTime, endTime: preliminary.time.endTime } : {}),
            },
          }
        }
        if (actionIntentShadowEnabled()) {
          console.info('[SchedMe intent shadow]', {
            intent: action.intent,
            confidence: action.confidence,
            scope: action.scope,
            targetTaskIds: action.target.taskIds,
            targetQuery: action.target.query,
            patchFields: Object.keys(action.patch),
            missingFields: action.missingFields,
            requiresConfirmation: action.requiresConfirmation,
            invalidTargetIds: action.invalidTargetIds,
          })
        }

        if (contextSchedulingActionsEnabled() && (useContextScheduling || savedPendingAction)) {
          const availabilityNow = new Date()
          const availabilityPlan = planContextAvailabilityAction({
            action,
            text,
            tasks,
            schedulingState,
            preliminary,
            planningDates,
            availability,
            defaultDuration: aiMemory.defaultDuration || 60,
            currentDate: localDateKey(availabilityNow),
            currentTime: `${String(availabilityNow.getHours()).padStart(2, '0')}:${String(availabilityNow.getMinutes()).padStart(2, '0')}`,
          })
          if (availabilityPlan.status === 'ready' && availabilityPlan.operation === 'set_availability') {
            const dateLabel = availabilityPlan.dates.length === 1
              ? (weekDays.find((day) => day.key === availabilityPlan.dates[0])?.label || availabilityPlan.dates[0])
              : 'the planning week'
            await persistConversation(
              [...next, { role: 'model', text: `Got it—for ${dateLabel}, I’ll look for free time between ${formatTimeRange(availabilityPlan.window.startTime, availabilityPlan.window.endTime)}.` }],
              { ...EMPTY_SCHEDULING_STATE, lastReferencedTaskId: schedulingState.lastReferencedTaskId, lastAction: schedulingState.lastAction },
              nextProfile,
              availabilityPlan.availability,
            )
            return
          }
          if (availabilityPlan.status === 'ready' && availabilityPlan.operation === 'schedule') {
            await saveSlot(availabilityPlan.task, availabilityPlan.slot, {
              ...EMPTY_SCHEDULING_STATE,
              activeTaskId: availabilityPlan.task.id,
              lastReferencedTaskId: availabilityPlan.task.id,
              mode: availabilityPlan.task.date ? 'move' : 'schedule',
            })
            return
          }
          if (availabilityPlan.status === 'suggest') {
            const pendingAction = createPendingAction(action, {
              reason: 'choose_free_time',
              missingFields: ['date', 'startTime', 'endTime'],
            })
            const choices = availabilityPlan.suggestions
              .map((slot, index) => `${index + 1}) ${formatSlot(slot, weekDays)}`)
              .join('; ')
            await complete(
              `I found these open times for “${availabilityPlan.task.title}”: ${choices}. Reply with the number you want, or give me another time.`,
              {
                ...pendingActionState(pendingAction, availabilityPlan.task.id),
                activeTaskId: availabilityPlan.task.id,
                mode: availabilityPlan.task.date ? 'move' : 'schedule',
              },
            )
            return
          }
          if (availabilityPlan.status === 'clarify') {
            if (availabilityPlan.reason === 'ambiguous_task') {
              const pendingAction = createPendingAction(action, { reason: 'ambiguous_task', missingFields: ['task'] })
              const choices = availabilityPlan.matches.slice(0, 4).map((task) => `“${task.title}”`).join(', ')
              await complete(`I found more than one matching task: ${choices}. Which one should I find time for?`, pendingActionState(pendingAction))
              return
            }
            if (availabilityPlan.reason === 'missing_task') {
              const pendingAction = createPendingAction(action, { reason: 'missing_task', missingFields: ['task'] })
              await complete('Which task should I find free time for?', pendingActionState(pendingAction))
              return
            }
            if (availabilityPlan.reason === 'no_free_time') {
              await complete(`I couldn’t find an open window for “${availabilityPlan.task.title}” in this planning week. Give me a day or a wider availability window.`, schedulingState)
              return
            }
            if (availabilityPlan.reason === 'invalid_availability') {
              await complete('That availability window is not valid. Tell me when your free time starts and ends.', schedulingState)
              return
            }
            if (availabilityPlan.reason === 'missing_date') {
              await complete('Which day should that availability apply to?', schedulingState)
              return
            }
          }
        }

        if (contextSchedulingActionsEnabled() && (useContextScheduling || savedPendingAction)) {
          const contextPlan = planContextSchedulingAction({ action, text, tasks, schedulingState, preliminary })
          if (contextPlan.status === 'ready_many') {
            await commitTaskOperation(user.uid, {
              requestId: operationRequestId,
              type: 'context-bulk-move',
              description: `Moved ${contextPlan.updates.length} context-referenced tasks`,
              changes: contextPlan.updates.map((item) => ({
                kind: 'update',
                taskId: item.taskId,
                data: { date: item.date, source: 'user-directed-bulk-move' },
              })),
            })
            const destination = weekDays.find((day) => day.key === contextPlan.date)?.label || contextPlan.date
            const names = contextPlan.tasks.map((task) => `“${task.title}”`).join(', ')
            await complete(`Done—I moved ${names} to ${destination} and kept their original times. You can say “undo” to move them back.`, {
              ...EMPTY_SCHEDULING_STATE,
              lastReferencedTaskId: contextPlan.tasks.at(-1)?.id || null,
              lastAction: {
                type: 'bulk-move',
                moves: contextPlan.updates.map((item) => ({ taskId: item.taskId, previousDate: item.previousDate, date: item.date })),
              },
            })
            return
          }
          if (contextPlan.status === 'unchanged_many') {
            const destination = weekDays.find((day) => day.key === contextPlan.date)?.label || contextPlan.date
            await complete(`Those ${contextPlan.tasks.length} tasks are already scheduled on ${destination}.`, {
              ...EMPTY_SCHEDULING_STATE,
              lastReferencedTaskId: contextPlan.tasks.at(-1)?.id || null,
              lastAction: schedulingState.lastAction,
            })
            return
          }
          if (contextPlan.status === 'ready') {
            await saveSlot(contextPlan.task, contextPlan.slot, {
              ...EMPTY_SCHEDULING_STATE,
              activeTaskId: contextPlan.task.id,
              lastReferencedTaskId: contextPlan.task.id,
              mode: contextPlan.task.date ? 'move' : 'schedule',
            })
            return
          }
          if (contextPlan.status === 'unchanged') {
            await complete(`“${contextPlan.task.title}” is already scheduled ${formatSlot(contextPlan.slot, weekDays)}.`, {
              ...EMPTY_SCHEDULING_STATE,
              lastReferencedTaskId: contextPlan.task.id,
              lastAction: schedulingState.lastAction,
            })
            return
          }
          if (contextPlan.status === 'clarify') {
            const pendingAction = createPendingAction(action, {
              reason: contextPlan.reason,
              missingFields: contextPlan.reason === 'missing_date' ? ['date'] : contextPlan.reason === 'missing_time' ? ['startTime', 'endTime'] : ['task'],
            })
            const pendingState = {
              ...pendingActionState(pendingAction, contextPlan.task?.id),
              activeTaskId: contextPlan.task?.id || null,
              mode: 'move',
              date: contextPlan.date || preliminary.day?.key || action.patch.date || schedulingState.date || '',
              startTime: preliminary.time?.startTime || action.patch.startTime || schedulingState.startTime || '',
              endTime: preliminary.time?.endTime || action.patch.endTime || schedulingState.endTime || '',
            }
            if (contextPlan.reason === 'ambiguous_task') {
              const choices = contextPlan.matches.slice(0, 4).map((task) => `“${task.title}”`).join(', ')
              await complete(`I found more than one matching task: ${choices}. Which one do you mean?`, pendingState)
            } else if (contextPlan.reason === 'ambiguous_day') {
              await complete(`Did you mean ${contextPlan.choices.join(' or ')} for “${contextPlan.task.title}”?`, pendingState)
            } else if (contextPlan.reason === 'missing_date' && contextPlan.tasks?.length) {
              await complete(`What day should I move those ${contextPlan.tasks.length} tasks to?`, pendingState)
            } else if (contextPlan.reason === 'missing_date') {
              await complete(`What day should I move “${contextPlan.task.title}” to?`, pendingState)
            } else if (contextPlan.reason === 'missing_time' && contextPlan.tasks?.length) {
              await complete('One or more of those tasks has no saved time. Tell me the time you want to use.', pendingState)
            } else if (contextPlan.reason === 'missing_time') {
              await complete(`What time should I use for “${contextPlan.task.title}”?`, pendingState)
            } else if (contextPlan.reason === 'invalid_time_shift' || contextPlan.reason === 'invalid_time') {
              await complete(`That change would produce an invalid time. What exact time should I use for “${contextPlan.task.title}”?`, pendingState)
            } else if (contextPlan.reason === 'bulk_conflict') {
              await complete(`I didn’t move those tasks because “${contextPlan.conflict.left.title}” would overlap with “${contextPlan.conflict.right.title}”. Give me another day or move one of them first.`, pendingState)
            } else {
              await complete('Which task would you like to move?', pendingState)
            }
            return
          }
        }

        if (contextTaskActionsEnabled() && (useContextTaskAction || savedPendingAction || forcedAction)) {
          const taskPlan = planContextTaskAction({ action, tasks, schedulingState })
          if (await handleContextTaskPlan(taskPlan, action)) return
        }
      }

      const creationRequest = parseTaskCreationIntent(text)
      const directSchedule = parseDirectScheduleRequest(text, tasks, weekDays, aiMemory.defaultDuration || 60)
      const namedPriorityRequest = parseNamedTaskPriorityRequest(text, tasks)
      const requestedAttributes = parseTaskAttributesIntent(text)
      const requestedAttributeDescription = describeRequestedTaskAttributes(requestedAttributes)

      if (namedDeletionRequest.isDeletion) {
        if (namedDeletionRequest.unmatchedNames.length || namedDeletionRequest.ambiguousNames.length) {
          const missing = namedDeletionRequest.unmatchedNames.map((name) => `I couldn't find a task matching "${name}."`)
          const ambiguous = namedDeletionRequest.ambiguousNames.map(({ name, matches }) => `"${name}" could mean ${matches.slice(0, 4).map((task) => `"${task.title}"`).join(' or ')}.`)
          await complete(`I didn't delete anything. ${[...missing, ...ambiguous].join(' ')} Please clarify the task ${namedDeletionRequest.unmatchedNames.length + namedDeletionRequest.ambiguousNames.length === 1 ? 'name' : 'names'}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (!namedDeletionRequest.tasks.length) {
          await complete("I couldn't find those tasks, so I didn't delete anything.", { ...EMPTY_SCHEDULING_STATE })
          return
        }
        const taskIds = namedDeletionRequest.tasks.map((task) => task.id)
        const legacyDeleteAction = {
          intent: 'delete_task',
          scope: taskIds.length > 1 ? 'matching' : 'single',
          target: { taskId: taskIds.length === 1 ? taskIds[0] : '', taskIds, query: '' },
          patch: {},
          constraints: {},
          destructive: true,
        }
        const pendingAction = createPendingAction(legacyDeleteAction, { reason: 'confirm_delete', awaitingConfirmation: true })
        const taskNames = namedDeletionRequest.tasks.map((task) => `“${task.title}”`).join(' and ')
        await complete(`Delete ${taskNames} permanently from your tasks and calendar?`, pendingActionState(pendingAction, taskIds.length === 1 ? taskIds[0] : ''))
        return
      }

      if (namedPriorityRequest.isPriorityChange && namedPriorityRequest.isMultiple) {
        if (namedPriorityRequest.unmatchedNames.length || namedPriorityRequest.ambiguousNames.length) {
          const missing = namedPriorityRequest.unmatchedNames.map((name) => `I couldn't find a task matching "${name}."`)
          const ambiguous = namedPriorityRequest.ambiguousNames.map(({ name, matches }) => `"${name}" could mean ${matches.slice(0, 4).map((task) => `"${task.title}"`).join(' or ')}.`)
          await complete(`I didn't change anything. ${[...missing, ...ambiguous].join(' ')} Please clarify the task ${namedPriorityRequest.unmatchedNames.length + namedPriorityRequest.ambiguousNames.length === 1 ? 'name' : 'names'}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (!namedPriorityRequest.tasks.length) {
          await complete("I couldn't find those tasks, so I didn't change anything.", { ...EMPTY_SCHEDULING_STATE })
          return
        }
        await setTasksPriority(user.uid, namedPriorityRequest.tasks.map((task) => task.id), namedPriorityRequest.category, namedPriorityRequest.alsoPriority)
        const taskNames = namedPriorityRequest.tasks.map((task) => `"${task.title}"`).join(' and ')
        const destination = taskCategoryLabel(namedPriorityRequest.category, namedPriorityRequest.alsoPriority)
        await complete(`Done! I moved ${taskNames} to your ${destination} task list.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (creationRequest.isCreation && !completionRequest.isCompletion) {
        if (!creationRequest.title) {
          await complete('What should I call the new task?', { ...EMPTY_SCHEDULING_STATE })
          return
        }

        const hasCompleteSlot = preliminary.day && !preliminary.day.ambiguous && preliminary.time
        const requestedCategory = requestedAttributes.category || creationRequest.category
        const requestedAlsoPriority = requestedAttributes.category ? requestedAttributes.alsoPriority : creationRequest.alsoPriority
        const existingTask = requestedCategory ? findTaskMatch(creationRequest.title, tasks).task : null
        if (existingTask) {
          await setTaskPriority(user.uid, existingTask.id, requestedCategory, requestedAlsoPriority)
          if (requestedAttributes.color) {
            await setTaskColor(user.uid, existingTask.id, requestedAttributes.color, requestedAttributes.colorMode)
          }
          if (hasCompleteSlot) {
            await saveSlot(existingTask, { date: preliminary.day.key, startTime: preliminary.time.startTime, endTime: preliminary.time.endTime }, { ...EMPTY_SCHEDULING_STATE, activeTaskId: existingTask.id })
            return
          }
          const destination = taskCategoryLabel(requestedCategory, requestedAlsoPriority)
          await complete(`Done—“${existingTask.title}” is now in your ${destination} task list. Tell me when you’re ready to schedule it.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }

        if (hasCompleteSlot) {
          const slot = { date: preliminary.day.key, startTime: preliminary.time.startTime, endTime: preliminary.time.endTime }
          const conflict = findScheduleConflict(tasks, '__new-task__', slot)
          const now = new Date()
          const currentMinute = now.getHours() * 60 + now.getMinutes()
          const isPast = slot.date === localDateKey(now) && minuteOfDay(slot.startTime) <= currentMinute
          if (!conflict && !isPast) {
            await createScheduledTask(user.uid, {
              title: creationRequest.title,
              ...slot,
              category: requestedCategory,
              alsoPriority: requestedAlsoPriority,
              color: requestedAttributes.color || getAutomaticTaskColor(requestedCategory || 'notUrgent'),
              colorMode: requestedAttributes.colorMode || 'automatic',
            })
            await complete(`Done—“${creationRequest.title}” was created${requestedAttributeDescription ? ` as ${requestedAttributeDescription}` : ''} and scheduled ${formatSlot(slot, weekDays)}.`, { ...EMPTY_SCHEDULING_STATE })
            return
          }

          await createTask(user.uid, creationRequest.title, requestedCategory || 'free', requestedAlsoPriority, requestedAttributes.color, requestedAttributes.colorMode)
          const destination = taskCategoryLabel(requestedCategory, requestedAlsoPriority)
          await complete(
            conflict
              ? `I’ve put “${creationRequest.title}” in ${destination} because that time overlaps with “${conflict.title}.” Tell me another day and time when you’re ready.`
              : `I’ve put “${creationRequest.title}” in ${destination} because that time has already passed. Tell me another day and time when you’re ready.`,
            { ...EMPTY_SCHEDULING_STATE },
          )
          return
        }

        await createTask(user.uid, creationRequest.title, requestedCategory || 'free', requestedAlsoPriority, requestedAttributes.color, requestedAttributes.colorMode)
        const destination = taskCategoryLabel(requestedCategory, requestedAlsoPriority)
        await complete(`I’ve put “${creationRequest.title}” in your ${destination} task list. Tell me when you’re ready to schedule it or any other task.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (bulkMoveRequest.isBulk) {
        if (bulkMoveRequest.invalidClauses.length || bulkMoveRequest.moves.length === 0) {
          await complete('I understood that you want to move multiple tasks, but I could not read every source and destination date. Try “Move all tasks from Saturday to Sunday.”', { ...EMPTY_SCHEDULING_STATE })
          return
        }

        const bulkPlan = planBulkTaskMoves(tasks, bulkMoveRequest.moves)
        if (bulkPlan.conflicts.length) {
          const conflict = bulkPlan.conflicts[0]
          const slot = { date: conflict.date, startTime: conflict.left.startTime, endTime: conflict.left.endTime }
          await complete(
            `I did not move anything because “${conflict.left.title}” would overlap with “${conflict.right.title}” ${formatSlot(slot, weekDays)}. Move one of those tasks first, or give me a different destination day.`,
            { ...EMPTY_SCHEDULING_STATE },
          )
          return
        }

        if (!bulkPlan.updates.length) {
          const sourceDays = bulkPlan.counts.map((item) => item.sourceLabel).join(' or ')
          await complete(`There are no scheduled tasks to move on ${sourceDays}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }

        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: 'bulk-move',
          description: `Moved ${bulkPlan.updates.length} ${bulkPlan.updates.length === 1 ? 'task' : 'tasks'} between days`,
          changes: bulkPlan.updates.map((item) => ({
            kind: 'update',
            taskId: item.taskId,
            data: { date: item.date, source: 'user-directed-bulk-move' },
          })),
        })
        const movedDescriptions = bulkPlan.counts
          .filter((item) => item.count > 0)
          .map((item) => `${item.count} ${item.count === 1 ? 'task' : 'tasks'} from ${item.sourceLabel} to ${item.destinationLabel}`)
        const emptySources = bulkPlan.counts.filter((item) => item.count === 0).map((item) => item.sourceLabel)
        const emptyNote = emptySources.length ? ` There were no scheduled tasks on ${emptySources.join(' or ')}.` : ''
        await complete(
          `Done—I moved ${movedDescriptions.join(', and ')}.${emptyNote} You can say “undo” to move them back.`,
          {
            ...EMPTY_SCHEDULING_STATE,
            lastAction: {
              type: 'bulk-move',
              moves: bulkPlan.updates.map((item) => ({ taskId: item.taskId, previousDate: item.previousDate, date: item.date })),
            },
          },
        )
        return
      }

      if (namedTaskMoveRequest.isMultiple) {
        if (namedTaskMoveRequest.destination?.ambiguous) {
          await complete(`Did you mean ${namedTaskMoveRequest.destination.ambiguous.join(' or ')}?`, { ...EMPTY_SCHEDULING_STATE })
          return
        }

        if (namedTaskMoveRequest.unmatchedNames.length || namedTaskMoveRequest.ambiguousNames.length) {
          const missing = namedTaskMoveRequest.unmatchedNames.map((name) => `I couldn’t find a scheduled task matching “${name}.”`)
          const ambiguous = namedTaskMoveRequest.ambiguousNames.map(({ name, matches }) => `“${name}” could mean ${matches.slice(0, 4).map((task) => `“${task.title}”`).join(' or ')}.`)
          await complete(`I didn’t move anything. ${[...missing, ...ambiguous].join(' ')} Please clarify the task ${namedTaskMoveRequest.unmatchedNames.length + namedTaskMoveRequest.ambiguousNames.length === 1 ? 'name' : 'names'}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }

        const namedMovePlan = planNamedTaskMoves(tasks, namedTaskMoveRequest.tasks, namedTaskMoveRequest.destination.key)
        if (namedMovePlan.conflicts.length) {
          const conflict = namedMovePlan.conflicts[0]
          const slot = { date: conflict.date, startTime: conflict.left.startTime, endTime: conflict.left.endTime }
          await complete(
            `I didn’t move anything because “${conflict.left.title}” would overlap with “${conflict.right.title}” ${formatSlot(slot, weekDays)}. Choose another day or move one of those tasks first.`,
            { ...EMPTY_SCHEDULING_STATE },
          )
          return
        }

        if (!namedMovePlan.updates.length) {
          await complete(`Those tasks are already scheduled on ${namedTaskMoveRequest.destination.label}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }

        await commitTaskOperation(user.uid, {
          requestId: operationRequestId,
          type: 'bulk-move',
          description: `Moved ${namedMovePlan.updates.length} named ${namedMovePlan.updates.length === 1 ? 'task' : 'tasks'}`,
          changes: namedMovePlan.updates.map((item) => ({
            kind: 'update',
            taskId: item.taskId,
            data: { date: item.date, source: 'user-directed-bulk-move' },
          })),
        })
        const movedTaskIds = new Set(namedMovePlan.updates.map((item) => item.taskId))
        const movedNames = namedTaskMoveRequest.tasks.filter((task) => movedTaskIds.has(task.id)).map((task) => `“${task.title}”`)
        const alreadyThere = namedTaskMoveRequest.tasks.filter((task) => !movedTaskIds.has(task.id)).map((task) => `“${task.title}”`)
        const alreadyThereNote = alreadyThere.length ? ` ${alreadyThere.join(' and ')} ${alreadyThere.length === 1 ? 'was' : 'were'} already there.` : ''
        await complete(
          `Done—I moved ${movedNames.join(' and ')} to ${namedTaskMoveRequest.destination.label} and kept ${movedNames.length === 1 ? 'its' : 'their'} original ${movedNames.length === 1 ? 'time' : 'times'}.${alreadyThereNote} You can say “undo” to move ${movedNames.length === 1 ? 'it' : 'them'} back.`,
          {
            ...EMPTY_SCHEDULING_STATE,
            lastAction: {
              type: 'bulk-move',
              moves: namedMovePlan.updates.map((item) => ({ taskId: item.taskId, previousDate: item.previousDate, date: item.date })),
            },
          },
        )
        return
      }

      const colorChangeRequest = parseTaskColorChangeIntent(text)
      if (colorChangeRequest.isColorChange) {
        const contextualTask = schedulingState.activeTaskId
          ? tasks.find((task) => task.id === schedulingState.activeTaskId)
          : schedulingState.lastAction?.taskId
            ? tasks.find((task) => task.id === schedulingState.lastAction.taskId)
            : null
        const match = colorChangeRequest.title
          ? findTaskMatch(colorChangeRequest.title, tasks, { includeCompleted: true })
          : { task: contextualTask, matches: [] }
        if (!match.task) {
          const choices = match.matches.slice(0, 3).map((task) => `“${task.title}”`).join(', ')
          await complete(choices ? `Which task do you mean: ${choices}?` : 'Which task would you like to recolor?', schedulingState)
          return
        }
        await setTaskColor(user.uid, match.task.id, colorChangeRequest.color, colorChangeRequest.colorMode)
        await complete(`Done—“${match.task.title}” is now ${colorChangeRequest.colorName}.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      const categoryRequest = parseTaskCategoryIntent(text)
      if (categoryRequest.isCategoryChange && !directSchedule.isDirect) {
        const match = findTaskMatch(categoryRequest.title, tasks, { includeCompleted: true })
        if (!match.task) {
          const choices = match.matches.slice(0, 3).map((task) => `“${task.title}”`).join(', ')
          await complete(choices ? `Which task do you mean: ${choices}?` : `I couldn’t find “${categoryRequest.title}” in your tasks.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        await setTaskPriority(user.uid, match.task.id, categoryRequest.category, categoryRequest.alsoPriority)
        const destination = taskCategoryLabel(categoryRequest.category, categoryRequest.alsoPriority)
        await complete(`Done—“${match.task.title}” is now in your ${destination} task list.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (completionRequest.isBulk) {
        const contextualTaskIds = new Set(Array.isArray(completionRequest.targetTaskIds) ? completionRequest.targetTaskIds : [])
        const completionDays = Array.isArray(completionRequest.days) && completionRequest.days.length
          ? completionRequest.days
          : completionRequest.day ? [completionRequest.day] : []
        const completionDateKeys = new Set(completionDays.map((day) => day.key))
        const targetTasks = contextualTaskIds.size
          ? tasks.filter((task) => contextualTaskIds.has(task.id))
          : completionDateKeys.size
            ? tasks.filter((task) => completionDateKeys.has(task.date))
            : tasks
        const targetLabel = completionDays.map((day) => day.label).join(' and ') || completionRequest.targetLabel || ''
        const targetScope = targetLabel ? ` on ${targetLabel}` : contextualTaskIds.size ? ' from the last change' : ''
        if (!targetTasks.length) {
          await complete(targetLabel
            ? `There are no tasks scheduled on ${targetLabel}.`
            : contextualTaskIds.size ? 'Those tasks are no longer available.' : 'There are no tasks to update.', { ...EMPTY_SCHEDULING_STATE })
          return
        }

        const tasksToUpdate = targetTasks.filter((task) => Boolean(task.completed) !== completionRequest.completed)
        if (!tasksToUpdate.length) {
          await complete(completionRequest.completed
            ? `All ${targetTasks.length} ${targetTasks.length === 1 ? 'task' : 'tasks'}${targetScope} ${targetTasks.length === 1 ? 'is' : 'are'} already done.`
            : `All ${targetTasks.length} ${targetTasks.length === 1 ? 'task' : 'tasks'}${targetScope} ${targetTasks.length === 1 ? 'is' : 'are'} already active.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }

        await setTasksCompleted(user.uid, tasksToUpdate.map((task) => task.id), completionRequest.completed)
        const unchangedCount = targetTasks.length - tasksToUpdate.length
        const unchangedNote = unchangedCount
          ? ` ${unchangedCount} ${unchangedCount === 1 ? 'was' : 'were'} already ${completionRequest.completed ? 'done' : 'active'}.`
          : ''
        await complete(
          completionRequest.completed
            ? `Done—I marked ${tasksToUpdate.length} ${tasksToUpdate.length === 1 ? 'task' : 'tasks'}${targetScope} as done.${unchangedNote}`
            : `Done—I reopened ${tasksToUpdate.length} ${tasksToUpdate.length === 1 ? 'task' : 'tasks'}${targetScope}.${unchangedNote}`,
          {
            ...EMPTY_SCHEDULING_STATE,
            lastAction: {
              type: 'bulk-completion',
              taskIds: tasksToUpdate.map((task) => task.id),
              targetTaskIds: targetTasks.map((task) => task.id),
              targetLabel,
              previousCompleted: !completionRequest.completed,
            },
          },
        )
        return
      }

      if (namedCompletionRequest.isMultiple) {
        if (namedCompletionRequest.unmatchedNames.length || namedCompletionRequest.ambiguousNames.length) {
          const missing = namedCompletionRequest.unmatchedNames.map((name) => `I couldn’t find a task matching “${name}.”`)
          const ambiguous = namedCompletionRequest.ambiguousNames.map(({ name, matches }) => `“${name}” could mean ${matches.slice(0, 4).map((task) => `“${task.title}”`).join(' or ')}.`)
          await complete(`I didn’t change anything. ${[...missing, ...ambiguous].join(' ')} Please clarify the task ${namedCompletionRequest.unmatchedNames.length + namedCompletionRequest.ambiguousNames.length === 1 ? 'name' : 'names'}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        const tasksToUpdate = namedCompletionRequest.tasks.filter((task) => Boolean(task.completed) !== namedCompletionRequest.completed)
        if (!tasksToUpdate.length) {
          await complete(`Those tasks are already ${namedCompletionRequest.completed ? 'done' : 'active'}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        await setTasksCompleted(user.uid, tasksToUpdate.map((task) => task.id), namedCompletionRequest.completed)
        const taskNames = tasksToUpdate.map((task) => `“${task.title}”`).join(' and ')
        await complete(
          namedCompletionRequest.completed ? `Done—I marked ${taskNames} as done.` : `Done—I reopened ${taskNames}.`,
          {
            ...EMPTY_SCHEDULING_STATE,
            lastAction: {
              type: 'bulk-completion',
              taskIds: tasksToUpdate.map((task) => task.id),
              targetTaskIds: namedCompletionRequest.tasks.map((task) => task.id),
              targetLabel: '',
              previousCompleted: !namedCompletionRequest.completed,
            },
          },
        )
        return
      }

      if (completionRequest.isCompletion) {
        const match = findTaskMatch(text, tasks, { includeCompleted: true })
        const contextualTask = schedulingState.activeTaskId
          ? tasks.find((task) => task.id === schedulingState.activeTaskId)
          : schedulingState.lastAction?.taskId
            ? tasks.find((task) => task.id === schedulingState.lastAction.taskId)
            : null
        const completedTask = match.task || contextualTask || (tasks.length === 1 ? tasks[0] : null)
        if (!completedTask) {
          const choices = match.matches.slice(0, 3).map((task) => `“${task.title}”`).join(', ')
          await complete(choices ? `Which task is done: ${choices}?` : 'Which task should I mark as done?', schedulingState)
          return
        }
        if (Boolean(completedTask.completed) === completionRequest.completed) {
          await complete(`“${completedTask.title}” is already ${completionRequest.completed ? 'done' : 'active'}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        await setTaskCompleted(user.uid, completedTask.id, completionRequest.completed)
        await complete(completionRequest.completed
          ? `Done—“${completedTask.title}” is marked complete.`
          : `Done—“${completedTask.title}” is active again.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (directSchedule.isDirect) {
        if (directSchedule.day?.ambiguous) {
          await complete(
            `Did you mean ${directSchedule.day.ambiguous.join(' or ')} for “${directSchedule.title}”?`,
            { ...EMPTY_SCHEDULING_STATE, activeTaskId: directSchedule.task?.id || null, startTime: directSchedule.time?.startTime || '', endTime: directSchedule.time?.endTime || '' },
          )
          return
        }

        if (directSchedule.taskMatches.length > 1 && !directSchedule.task) {
          await complete(
            `I found more than one match for “${directSchedule.title}”: ${directSchedule.taskMatches.slice(0, 4).map((task) => `“${task.title}”`).join(', ')}. Which one do you mean?`,
            { ...EMPTY_SCHEDULING_STATE, date: directSchedule.day?.key || '', startTime: directSchedule.time?.startTime || '', endTime: directSchedule.time?.endTime || '' },
          )
          return
        }

        if (directSchedule.task) {
          if (requestedAttributes.category) {
            await setTaskPriority(user.uid, directSchedule.task.id, requestedAttributes.category, requestedAttributes.alsoPriority)
          }
          if (requestedAttributes.color) {
            await setTaskColor(user.uid, directSchedule.task.id, requestedAttributes.color, requestedAttributes.colorMode)
          }
          const directState = {
            ...EMPTY_SCHEDULING_STATE,
            activeTaskId: directSchedule.task.id,
            date: directSchedule.day?.key || '',
            startTime: directSchedule.time?.startTime || '',
            endTime: directSchedule.time?.endTime || '',
          }
          if (!directState.date) {
            await complete(`Which day should I schedule “${directSchedule.task.title}”?`, directState)
            return
          }
          if (!directState.startTime) {
            await complete(`What time should I schedule “${directSchedule.task.title}”?`, directState)
            return
          }
          await saveSlot(directSchedule.task, { date: directState.date, startTime: directState.startTime, endTime: directState.endTime }, directState)
          return
        }

        if (!directSchedule.isComplete) {
          const createdTask = await createTask(
            user.uid,
            directSchedule.title,
            requestedAttributes.category || 'free',
            requestedAttributes.alsoPriority,
            requestedAttributes.color,
            requestedAttributes.colorMode,
          )
          const waitingState = {
            ...EMPTY_SCHEDULING_STATE,
            activeTaskId: createdTask.id,
            date: directSchedule.day?.key || '',
            startTime: directSchedule.time?.startTime || '',
            endTime: directSchedule.time?.endTime || '',
          }
          await complete(
            directSchedule.day
              ? `I added “${directSchedule.title}” to What’s on my mind. What time should I schedule it?`
              : `I added “${directSchedule.title}” to What’s on my mind. Which day should I schedule it?`,
            waitingState,
          )
          return
        }

        const slot = { date: directSchedule.day.key, startTime: directSchedule.time.startTime, endTime: directSchedule.time.endTime }
        const conflict = findScheduleConflict(tasks, '__new-task__', slot)
        const now = new Date()
        const currentMinute = now.getHours() * 60 + now.getMinutes()
        const isPast = slot.date === localDateKey(now) && minuteOfDay(slot.startTime) <= currentMinute
        if (conflict || isPast) {
          await createTask(
            user.uid,
            directSchedule.title,
            requestedAttributes.category || 'free',
            requestedAttributes.alsoPriority,
            requestedAttributes.color,
            requestedAttributes.colorMode,
          )
          await complete(
            conflict
              ? `I added “${directSchedule.title}” to What’s on my mind, but ${formatSlot(slot, weekDays)} overlaps with “${conflict.title}.” Tell me another day and time.`
              : `I added “${directSchedule.title}” to What’s on my mind because that time has already passed. Tell me another day and time.`,
            { ...EMPTY_SCHEDULING_STATE },
          )
          return
        }

        await createScheduledTask(user.uid, {
          title: directSchedule.title,
          ...slot,
          category: requestedAttributes.category || 'notUrgent',
          alsoPriority: requestedAttributes.alsoPriority,
          color: requestedAttributes.color || getAutomaticTaskColor(requestedAttributes.category || 'notUrgent'),
          colorMode: requestedAttributes.colorMode || 'automatic',
        })
        await complete(`Done—“${directSchedule.title}” was created${requestedAttributeDescription ? ` as ${requestedAttributeDescription}` : ''} and scheduled ${formatSlot(slot, weekDays)}.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (schedulingState.pendingDeletionTaskId) {
        const pendingTask = tasks.find((task) => task.id === schedulingState.pendingDeletionTaskId)
        if (!pendingTask) {
          await complete('That task has already been removed.', { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (wantsToScheduleAnotherTask(text)) {
          const following = nextQueuedTask(schedulingState, [pendingTask.id])
          if (!following) {
            await complete(`Okay—“${pendingTask.title}” will stay in What’s on my mind. There are no other unscheduled tasks right now.`, { ...EMPTY_SCHEDULING_STATE })
            return
          }
          await complete(
            `Okay—“${pendingTask.title}” will stay in What’s on my mind. Let’s schedule “${following.title}” next. What day and time work for it?`,
            { ...EMPTY_SCHEDULING_STATE, activeTaskId: following.id, queueMode: true },
          )
          return
        }
        if (confirmsTaskDeletion(text)) {
          await deleteTask(user.uid, pendingTask.id)
          await complete(`Done—“${pendingTask.title}” was also removed from What’s on my mind.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (declinesTaskDeletion(text) || isStopMessage(text)) {
          await complete(`Okay—“${pendingTask.title}” will stay in What’s on my mind for later.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        await complete(`Would you like to schedule another task, or remove “${pendingTask.title}” entirely from What’s on my mind?`, schedulingState)
        return
      }

      if (isCancellationMessage(text)) {
        const scheduledTasks = tasks.filter((task) => task.date && !task.completed)
        const namedMatch = findTaskMatch(text, tasks, { scheduled: true })
        const recentTask = schedulingState.lastAction?.taskId
          ? scheduledTasks.find((task) => task.id === schedulingState.lastAction.taskId)
          : null
        const canceledTask = namedMatch.task || recentTask || (scheduledTasks.length === 1 ? scheduledTasks[0] : null)

        if (!canceledTask) {
          const choices = namedMatch.matches.slice(0, 3).map((task) => `“${task.title}”`).join(', ')
          await complete(choices ? `Which canceled task do you mean: ${choices}?` : 'Which scheduled task was canceled?', schedulingState)
          return
        }

        if (wantsFullCancellationRemoval(text)) {
          const deleteAction = {
            intent: 'delete_task',
            scope: 'single',
            target: { taskId: canceledTask.id, taskIds: [canceledTask.id], query: canceledTask.title },
            patch: {},
            constraints: {},
            destructive: true,
          }
          const pendingAction = createPendingAction(deleteAction, { reason: 'confirm_delete', awaitingConfirmation: true })
          await complete(`Delete “${canceledTask.title}” permanently from your tasks and calendar?`, pendingActionState(pendingAction, canceledTask.id))
          return
        }

        await unscheduleTask(user.uid, canceledTask.id, { returnToInbox: true })
        await complete(
          `Done—“${canceledTask.title}” is removed from your calendar now and kept in What’s on my mind. Do you want to schedule another task, or remove it entirely from your What’s on my mind list?`,
          { ...EMPTY_SCHEDULING_STATE, pendingDeletionTaskId: canceledTask.id },
        )
        return
      }

      if (schedulingState.pendingConflict) {
        const pending = schedulingState.pendingConflict
        const incoming = tasks.find((task) => task.id === pending.incomingTaskId)
        const displaced = tasks.find((task) => task.id === pending.displacedTaskId)
        if (!incoming || !displaced) {
          await complete('That schedule changed while we were talking. Tell me the task, day, and time again.', { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (isStopMessage(text)) {
          await complete('Okay—the existing schedule is unchanged.', { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (isReplaceChoice(text)) {
          await replaceScheduledTask(user.uid, incoming.id, displaced.id, pending.slot)
          await complete(
            `Done—“${incoming.title}” is scheduled ${formatSlot(pending.slot, weekDays)}. “${displaced.title}” is back in What’s on my mind. What day and time should we use for it?`,
            { ...EMPTY_SCHEDULING_STATE, activeTaskId: displaced.id, queueMode: true },
          )
          return
        }
        if (isChooseAnotherTime(text)) {
          await complete(
            `I’ll keep “${displaced.title}” where it is. What other time on ${formatSlot(pending.slot, weekDays).split(',')[0]} works for “${incoming.title}”?`,
            { ...EMPTY_SCHEDULING_STATE, activeTaskId: incoming.id, date: pending.slot.date, queueMode: schedulingState.queueMode, deferredTaskIds: schedulingState.deferredTaskIds },
          )
          return
        }
        if (!preliminary.day && !preliminary.time) {
          await complete(`Please choose: replace “${displaced.title},” choose another time for “${incoming.title},” or cancel.`, schedulingState)
          return
        }
      }

      if ((schedulingState.activeTaskId || schedulingState.pendingConflict) && isStopMessage(text)) {
        await complete('No problem. I stopped this scheduling session, and the remaining tasks will stay unscheduled.', { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (/^undo(?:\s+that)?[.!\s]*$/i.test(text)) {
        try {
          const operation = await undoLastTaskOperation(user.uid)
          const count = operation.changes.length
          const description = operation.description ? operation.description.charAt(0).toLowerCase() + operation.description.slice(1) : `${count} ${count === 1 ? 'task change' : 'task changes'}`
          await complete(`Undone—I reversed ${description}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        } catch (error) {
          if (error?.code === 'operation/undo-conflict') {
            await complete(error.message, { ...EMPTY_SCHEDULING_STATE, lastReferencedTaskId: schedulingState.lastReferencedTaskId })
            return
          }
          if (error?.code !== 'operation/nothing-to-undo') throw error
        }
      }

      if (/^undo(?:\s+that)?[.!\s]*$/i.test(text) && schedulingState.lastAction) {
        const action = schedulingState.lastAction
        if (action.type === 'bulk-completion' && Array.isArray(action.taskIds) && action.taskIds.length) {
          await setTasksCompleted(user.uid, action.taskIds, Boolean(action.previousCompleted))
          await complete(`Undone—I restored ${action.taskIds.length} ${action.taskIds.length === 1 ? 'task' : 'tasks'} to ${action.previousCompleted ? 'done' : 'active'}.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (action.type === 'bulk-move' && Array.isArray(action.moves) && action.moves.length) {
          await moveScheduledTasks(user.uid, action.moves.map((move) => ({ taskId: move.taskId, date: move.previousDate })))
          await complete(`Undone—I moved ${action.moves.length} ${action.moves.length === 1 ? 'task' : 'tasks'} back to their previous days.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        const task = tasks.find((item) => item.id === action.taskId)
        if (!task) {
          await complete('I could not find the task from the last action.', { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (action.previousSlot) await scheduleTask(user.uid, task.id, action.previousSlot)
        else await unscheduleTask(user.uid, task.id, { returnToInbox: false })
        await complete(action.previousSlot
          ? `Undone—“${task.title}” is back at ${formatSlot(action.previousSlot, weekDays)}.`
          : `Undone—“${task.title}” is unscheduled again.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (/^undo(?:\s+that)?[.!\s]*$/i.test(text)) {
        await complete('There is no recent task change to undo.', { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (/\b(remove|unschedule|take)\b/i.test(text)) {
        const match = findTaskMatch(text, tasks, { scheduled: true })
        if (!match.task) {
          const choices = match.matches.slice(0, 3).map((task) => `“${task.title}”`).join(', ')
          await complete(choices ? `Which scheduled task do you mean: ${choices}?` : 'Which scheduled task should I remove from your week?', schedulingState)
          return
        }
        await unscheduleTask(user.uid, match.task.id, { returnToInbox: true })
        await complete(`Done—“${match.task.title}” was removed from the schedule and returned to What’s on my mind.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (/\b(move|reschedule)\b/i.test(text)) {
        const match = findTaskMatch(text, tasks, { scheduled: true })
        if (!match.task) {
          await complete('Which scheduled task would you like to move?', schedulingState)
          return
        }
        const destinationText = text.split(/\bto\b/i).at(-1)
        const moveInput = parseSchedulingInput(destinationText, tasks, weekDays, match.task.id, aiMemory.defaultDuration || 60)
        if (moveInput.day?.ambiguous) {
          await complete(`Did you mean ${moveInput.day.ambiguous.join(' or ')}?`, { ...EMPTY_SCHEDULING_STATE, activeTaskId: match.task.id, mode: 'move', startTime: moveInput.time?.startTime || '', endTime: moveInput.time?.endTime || '' })
          return
        }
        const moveState = { ...EMPTY_SCHEDULING_STATE, activeTaskId: match.task.id, mode: 'move', date: moveInput.day?.key || '', startTime: moveInput.time?.startTime || '', endTime: moveInput.time?.endTime || '' }
        if (!moveState.date) {
          await complete(`What day should I move “${match.task.title}” to?`, moveState)
          return
        }
        if (!moveState.startTime) {
          await complete(`What time on ${moveInput.day.label} should I move “${match.task.title}” to?`, moveState)
          return
        }
        await saveSlot(match.task, { date: moveState.date, startTime: moveState.startTime, endTime: moveState.endTime }, moveState)
        return
      }

      if (schedulingState.activeTaskId) {
        const activeTask = tasks.find((task) => task.id === schedulingState.activeTaskId)
        if (!activeTask) {
          await complete('That task is no longer available. Tell me which task you want to schedule instead.', { ...EMPTY_SCHEDULING_STATE })
          return
        }
        if (isSkipMessage(text)) {
          const deferredTaskIds = [...new Set([...schedulingState.deferredTaskIds, activeTask.id])]
          const stateAfterSkip = { ...schedulingState, deferredTaskIds }
          const requestedOther = findTaskMatch(text, tasks.filter((task) => task.id !== activeTask.id && !task.date)).task
          const following = requestedOther || nextQueuedTask(stateAfterSkip, [activeTask.id])
          if (!following) {
            await complete(`Okay—“${activeTask.title}” will stay unscheduled for now. There are no other tasks waiting.`, { ...EMPTY_SCHEDULING_STATE, deferredTaskIds })
            return
          }
          await complete(`Okay, I’ll leave “${activeTask.title}” unscheduled. Next is “${following.title}.” What day and time work for it?`, { ...EMPTY_SCHEDULING_STATE, activeTaskId: following.id, queueMode: true, deferredTaskIds })
          return
        }

        const activeInput = parseSchedulingInput(text, tasks, weekDays, activeTask.id, aiMemory.defaultDuration || 60)
        if (activeInput.day?.ambiguous) {
          await complete(`Did you mean ${activeInput.day.ambiguous.join(' or ')}?`, { ...schedulingState, startTime: activeInput.time?.startTime || schedulingState.startTime, endTime: activeInput.time?.endTime || schedulingState.endTime })
          return
        }
        const activeState = {
          ...schedulingState,
          date: activeInput.day?.key || schedulingState.date,
          startTime: activeInput.time?.startTime || schedulingState.startTime,
          endTime: activeInput.time?.endTime || schedulingState.endTime,
          pendingConflict: null,
        }
        if (!activeState.date) {
          await complete(`Which day should I schedule “${activeTask.title}”?`, activeState)
          return
        }
        if (!activeState.startTime) {
          const dayLabel = weekDays.find((day) => day.key === activeState.date)?.day || 'that day'
          await complete(`What time on ${dayLabel} should I schedule “${activeTask.title}”?`, activeState)
          return
        }
        await saveSlot(activeTask, { date: activeState.date, startTime: activeState.startTime, endTime: activeState.endTime }, activeState)
        return
      }

      if (!schedulingState.activeTaskId && (schedulingState.date || schedulingState.startTime)) {
        const selected = findTaskMatch(text, tasks.filter((task) => !task.completed)).task
        if (selected) {
          const selectedInput = parseSchedulingInput(text, tasks, weekDays, selected.id, aiMemory.defaultDuration || 60)
          const resumedState = {
            ...schedulingState,
            activeTaskId: selected.id,
            date: selectedInput.day?.key || schedulingState.date,
            startTime: selectedInput.time?.startTime || schedulingState.startTime,
            endTime: selectedInput.time?.endTime || schedulingState.endTime,
          }
          if (!resumedState.date) {
            await complete(`Which day should I schedule “${selected.title}”?`, resumedState)
            return
          }
          if (!resumedState.startTime) {
            await complete(`What time should I schedule “${selected.title}”?`, resumedState)
            return
          }
          await saveSlot(selected, { date: resumedState.date, startTime: resumedState.startTime, endTime: resumedState.endTime }, resumedState)
          return
        }
      }

      const lastModelMessage = [...messages].reverse().find((message) => message.role === 'model')?.text || ''
      const wantsQueue = /\b(schedule|plan)\b.*\b(tasks?|them|unscheduled)\b/i.test(text)
        || (/^(?:yes|sure|okay|ok|let'?s do it)[.!\s]*$/i.test(text) && /\b(schedule|unscheduled|continue)\b/i.test(lastModelMessage))
      if (wantsQueue) {
        const first = getSchedulingQueue(tasks)[0]
        if (!first) {
          await complete('Everything is already scheduled. Your week is up to date.', { ...EMPTY_SCHEDULING_STATE })
          return
        }
        await complete(`Let’s start with “${first.title}.” What day and time work for it? You can reply like Monday-2-3pm, skip, or stop.`, { ...EMPTY_SCHEDULING_STATE, activeTaskId: first.id, queueMode: true })
        return
      }

      const parsed = parseSchedulingInput(text, tasks, weekDays, null, aiMemory.defaultDuration || 60)
      const hasSchedulingIntent = parsed.isCompact || /\b(schedule|put|place|book)\b/i.test(text)
      if (hasSchedulingIntent) {
        if (parsed.day?.ambiguous) {
          await complete(`Did you mean ${parsed.day.ambiguous.join(' or ')}?`, { ...EMPTY_SCHEDULING_STATE, activeTaskId: parsed.task?.id || null, startTime: parsed.time?.startTime || '', endTime: parsed.time?.endTime || '' })
          return
        }
        if (!parsed.task) {
          if (parsed.taskMatches.length > 1) {
            await complete(`I found more than one match: ${parsed.taskMatches.slice(0, 4).map((task) => `“${task.title}”`).join(', ')}. Which one do you mean?`, { ...EMPTY_SCHEDULING_STATE, date: parsed.day?.key || '', startTime: parsed.time?.startTime || '', endTime: parsed.time?.endTime || '' })
          } else {
            await complete('Which task would you like to schedule?', { ...EMPTY_SCHEDULING_STATE, date: parsed.day?.key || '', startTime: parsed.time?.startTime || '', endTime: parsed.time?.endTime || '' })
          }
          return
        }
        const directState = { ...EMPTY_SCHEDULING_STATE, activeTaskId: parsed.task.id, date: parsed.day?.key || '', startTime: parsed.time?.startTime || '', endTime: parsed.time?.endTime || '' }
        if (!directState.date) {
          await complete(`Which day should I schedule “${parsed.task.title}”?`, directState)
          return
        }
        if (!directState.startTime) {
          await complete(`What time should I schedule “${parsed.task.title}”?`, directState)
          return
        }
        await saveSlot(parsed.task, { date: directState.date, startTime: directState.startTime, endTime: directState.endTime }, directState)
        return
      }

      const scopeResponse = getConversationScopeResponse(text, { assistantName: aiMemory.chatbotName, tasks, prefersConcise: nextProfile.prefersConcise })
      if (scopeResponse) {
        await complete(scopeResponse, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      const history = normalizedGeminiHistory(messages)
      consumeAiRequestBudget(user.uid)
      const response = await askPlanningAssistant({ message: text, history, tasks, memory: aiMemory, planningDates, availability, currentDate: localDateKey(new Date()), interactionProfile: nextProfile })
      const correctedResponse = stopRepeatedPriorityPrompt(response, tasks, text)
      const plan = validatePlanningResponse(correctedResponse, tasks, planningDates, availability)
      const hasActions = plan.taskUpdates.length > 0 || plan.scheduleProposal.length > 0
      await persistConversation([...next, { role: 'model', text: correctedResponse.message, ...(hasActions ? { plan } : {}) }], schedulingState, nextProfile, plan.availability)
    } catch (error) {
      console.error('SchedMe AI request failed', error)
      setChatError(error?.code ? explainAiError(error) : error?.message || 'SchedMe could not complete that request. Please try again.')
      await persistConversation(next, schedulingState, nextProfile)
    } finally { setChatBusy(false) }
  }

  async function applyPlan(plan, messageIndex) {
    setPlanBusy(true)
    setPlanError('')
    try {
      const checkedPlan = validatePlanningResponse(plan, tasks, planningDates, availability)
      const changesByTask = new Map()
      checkedPlan.taskUpdates.forEach((item) => {
        changesByTask.set(item.taskId, {
          urgent: item.urgent,
          important: item.important,
          category: item.urgent ? 'urgent' : item.important ? 'important' : 'notUrgent',
          source: 'user-approved-ai-plan',
        })
      })
      checkedPlan.scheduleProposal.forEach((item) => {
        changesByTask.set(item.taskId, {
          ...(changesByTask.get(item.taskId) || {}),
          date: item.date,
          startTime: item.startTime,
          endTime: item.endTime,
          source: 'user-approved-ai-plan',
        })
      })
      if (changesByTask.size) {
        await commitTaskOperation(user.uid, {
          requestId: newOperationRequestId('plan'),
          type: 'apply-ai-plan',
          description: `Applied an AI plan to ${changesByTask.size} ${changesByTask.size === 1 ? 'task' : 'tasks'}`,
          changes: [...changesByTask].map(([taskId, data]) => ({ kind: 'update', taskId, data })),
        })
      }
      const updatedMessages = messages.map((item, index) => index === messageIndex ? { ...item, planApplied: true } : item)
      await persistConversation(updatedMessages, schedulingState, interactionProfile)
    } catch (error) {
      setPlanError(error.message || 'The plan could not be validated or saved. Review it and try again.')
    } finally { setPlanBusy(false) }
  }

  function openNewCalendarEntry(day, period) {
    const defaults = getDefaultPeriodTimes(period)
    setCalendarError('')
    setCalendarEditor({
      mode: 'create',
      date: localDateKey(day.date),
      dayLabel: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(day.date),
      periodLabel: period.range,
      title: '',
      completed: false,
      color: '',
      colorMode: 'automatic',
      category: 'notUrgent',
      ...defaults,
    })
  }

  function openExistingCalendarEntry(task) {
    const taskDate = new Date(`${task.date}T12:00:00`)
    setCalendarError('')
    setCalendarEditor({
      mode: 'edit',
      taskId: task.id,
      date: task.date,
      dayLabel: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(taskDate),
      periodLabel: formatTimeRange(task.startTime, task.endTime),
      title: task.title,
      startTime: task.startTime,
      endTime: task.endTime,
      completed: Boolean(task.completed),
      category: task.category || (task.urgent ? 'urgent' : task.important ? 'important' : 'free'),
      showInInbox: task.showInInbox === true || task.source === 'manual-calendar',
      color: task.color || '',
      colorMode: task.colorMode || (task.color ? 'manual' : 'automatic'),
    })
  }

  function openInboxTaskEditor(task) {
    setCalendarError('')
    setCalendarEditor({
      mode: 'edit',
      origin: 'inbox',
      taskId: task.id,
      date: task.date || '',
      title: task.title,
      startTime: task.startTime || '',
      endTime: task.endTime || '',
      completed: Boolean(task.completed),
      category: task.category || (task.urgent ? 'urgent' : task.important ? 'important' : 'free'),
      showInInbox: task.showInInbox === true || task.source === 'manual-calendar',
      color: task.color || '',
      colorMode: task.colorMode || (task.color ? 'manual' : 'automatic'),
    })
  }

  async function saveCalendarEntry(values) {
    const isInboxTask = calendarEditor.origin === 'inbox'
    const validationError = isInboxTask ? validateOptionalScheduleEntry(values) : validateCalendarEntry(values)
    if (validationError) {
      setCalendarError(validationError)
      return
    }

    const slot = { date: values.date, startTime: values.startTime, endTime: values.endTime }
    const shouldSchedule = !isInboxTask || values.scheduled
    const conflict = shouldSchedule ? findScheduleConflict(tasks, calendarEditor.taskId || '__new-calendar-task__', slot) : null
    if (shouldSchedule && !values.completed && conflict) {
      setCalendarError(`That time overlaps with “${conflict.title}” (${formatTimeRange(conflict.startTime, conflict.endTime)}). Choose another time first.`)
      return
    }

    setCalendarSaving(true)
    setCalendarError('')
    try {
      const entry = { ...values, ...slot, title: values.title.trim() }
      if (isInboxTask) await updateTaskDetails(user.uid, calendarEditor.taskId, {
        ...entry,
        showInInbox: Boolean(calendarEditor.showInInbox),
        date: values.scheduled ? values.date : '',
        startTime: values.scheduled ? values.startTime : '',
        endTime: values.scheduled ? values.endTime : '',
      })
      else if (calendarEditor.mode === 'edit') await updateScheduledTask(user.uid, calendarEditor.taskId, entry)
      else await createScheduledTask(user.uid, entry)
      setCalendarEditor(null)
    } catch (error) {
      setCalendarError(error.code === 'permission-denied' ? 'Calendar access is blocked. Check the published Firestore rules.' : error.message || 'Could not save this calendar task.')
    } finally {
      setCalendarSaving(false)
    }
  }

  async function deleteCalendarEntry() {
    if (!calendarEditor?.taskId) return

    const deletedTitle = calendarEditor.title
    setCalendarSaving(true)
    setCalendarError('')
    try {
      await deleteTask(user.uid, calendarEditor.taskId)
      setCalendarEditor(null)
      showCalendarNotice('success', `“${deletedTitle}” was deleted.`)
    } catch (error) {
      setCalendarError(error.code === 'permission-denied' ? 'Task deletion is blocked. Check the published Firestore rules.' : error.message || 'Could not delete this task.')
    } finally {
      setCalendarSaving(false)
    }
  }

  function showCalendarNotice(type, text) {
    window.clearTimeout(calendarNoticeTimerRef.current)
    setCalendarNotice({ type, text })
    calendarNoticeTimerRef.current = window.setTimeout(() => setCalendarNotice(null), type === 'error' ? 5200 : 3400)
  }

  function startCalendarDrag(event, task) {
    if (!calendarEditMode || calendarSaving) {
      event.preventDefault()
      return
    }
    suppressCalendarClickRef.current = true
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
    const invisibleDragImage = document.createElement('canvas')
    invisibleDragImage.width = 1
    invisibleDragImage.height = 1
    event.dataTransfer.setDragImage(invisibleDragImage, 0, 0)
    setDraggedTaskId(task.id)
    setCalendarDragPreview({
      title: task.title,
      time: formatTimeRange(task.startTime, task.endTime),
      color: task.color || '',
      x: Math.max(12, Math.min(event.clientX + 18, window.innerWidth - 230)),
      y: Math.max(12, Math.min(event.clientY + 18, window.innerHeight - 100)),
    })
    setCalendarDropTarget('')
    setCalendarNotice({ type: 'moving', text: `Moving “${task.title}”—drop it on another day or time section.` })
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(14)
  }

  function moveCalendarDragPreview(event) {
    if ((!event.clientX && !event.clientY) || !calendarDragPreview) return
    const x = Math.max(12, Math.min(event.clientX + 18, window.innerWidth - 230))
    const y = Math.max(12, Math.min(event.clientY + 18, window.innerHeight - 100))
    setCalendarDragPreview((current) => current ? { ...current, x, y } : current)
  }

  function finishCalendarDrag() {
    setDraggedTaskId('')
    setCalendarDragPreview(null)
    setCalendarDropTarget('')
    setCalendarNotice((current) => current?.type === 'moving' ? null : current)
    window.setTimeout(() => { suppressCalendarClickRef.current = false }, 220)
  }

  async function dropCalendarTask(event, day, period) {
    if (!calendarEditMode) return
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain') || draggedTaskId
    const task = tasks.find((item) => item.id === taskId)
    const targetDate = localDateKey(day.date)
    const targetKey = `${period.label}-${targetDate}`
    setCalendarDropTarget(targetKey)
    if (!task) {
      finishCalendarDrag()
      showCalendarNotice('error', 'That task is no longer available. Refresh the calendar and try again.')
      return
    }

    const slot = getDroppedCalendarSlot(task, targetDate, period, schedulePeriods)
    if (!slot) {
      finishCalendarDrag()
      showCalendarNotice('error', `“${task.title}” could not be placed in that time section.`)
      return
    }
    if (slot.date === task.date && slot.startTime === task.startTime && slot.endTime === task.endTime) {
      finishCalendarDrag()
      showCalendarNotice('info', `“${task.title}” is already in that spot.`)
      return
    }

    const conflict = task.completed ? null : findScheduleConflict(tasks, task.id, slot)
    if (conflict) {
      finishCalendarDrag()
      showCalendarNotice('error', `That spot overlaps with “${conflict.title}” (${formatTimeRange(conflict.startTime, conflict.endTime)}). Nothing was moved.`)
      return
    }

    setCalendarSaving(true)
    try {
      await scheduleTask(user.uid, task.id, slot)
      finishCalendarDrag()
      showCalendarNotice('success', `Moved “${task.title}” to ${formatSlot(slot, weekDays)}.`)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([12, 35, 18])
    } catch (error) {
      finishCalendarDrag()
      showCalendarNotice('error', error.code === 'permission-denied' ? 'Calendar access is blocked. Check the published Firestore rules.' : 'The task could not be moved. Please try again.')
    } finally {
      setCalendarSaving(false)
    }
  }

  const quickMenu = <div className={`floating-s-menu header-s-menu ${menuOpen ? 'is-open' : ''} ${menuSelection ? 'has-selection' : ''}`} ref={floatingMenuRef}>
    <button type="button" className="floating-s-toggle" aria-expanded={menuOpen} aria-controls="floating-s-options" aria-label={menuOpen ? 'Close quick navigation' : 'Open quick navigation'} onClick={() => { if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(12); setMenuSelection(''); setMenuOpen((open) => !open) }}>
      <span className="floating-s-glyph" aria-hidden="true"><span className="floating-s-letter">S</span><span className="floating-s-close">×</span></span>
    </button>
    <nav id="floating-s-options" className="floating-s-options" aria-label="Quick dashboard navigation" aria-hidden={!menuOpen}>
      <a href="#weekly-schedule" style={{ '--menu-index': 0, '--portrait-rotate': '-2deg' }} className={`${activeSection === 'weekly-schedule' ? 'is-active' : ''} ${menuSelection === 'weekly-schedule' ? 'is-selected' : ''}`} aria-current={activeSection === 'weekly-schedule' ? 'page' : undefined} tabIndex={menuOpen ? 0 : -1} onClick={(event) => goToSection(event, 'weekly-schedule')}>
        <span className="floating-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="15" rx="3" /><path d="M7.5 3.5v4M16.5 3.5v4M3.5 9.5h17M7.5 13h2M14.5 13h2M7.5 17h2M14.5 17h2" /></svg></span>
        <span>My week</span>
      </a>
      <a href="#planning-workspace" style={{ '--menu-index': 1, '--portrait-rotate': '-1deg' }} className={`${activeSection === 'planning-workspace' ? 'is-active' : ''} ${menuSelection === 'planning-workspace' ? 'is-selected' : ''}`} aria-current={activeSection === 'planning-workspace' ? 'page' : undefined} tabIndex={menuOpen ? 0 : -1} onClick={(event) => goToSection(event, 'planning-workspace')}>
        <span className="floating-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9.5 9.5h5v5h-5zM9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" /></svg></span>
        <span>SchedMe AI</span>
      </a>
      <a href="#task-priorities" style={{ '--menu-index': 2, '--portrait-rotate': '1.5deg' }} className={`${activeSection === 'task-priorities' ? 'is-active' : ''} ${menuSelection === 'task-priorities' ? 'is-selected' : ''}`} aria-current={activeSection === 'task-priorities' ? 'page' : undefined} tabIndex={menuOpen ? 0 : -1} onClick={(event) => goToSection(event, 'task-priorities')}>
        <span className="floating-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 4.5h9.5l3 3V20H6z" /><path d="M15.5 4.5V8h3M9 12h6M9 15.5h6M4 7.5H3v13h12" /></svg></span>
        <span>My tasks</span>
      </a>
    </nav>
  </div>

  return (
    <main className="app-shell dashboard-shell min-h-screen px-4 py-4 sm:px-7 sm:py-6 lg:px-10">
      <div className="ambient ambient-one" aria-hidden="true" /><div className="ambient ambient-two" aria-hidden="true" />
      <div className="dashboard-page relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-[90rem] flex-col sm:min-h-[calc(100vh-3rem)]">
        <header className="dashboard-header">
          <div className="dashboard-brand-cluster">{quickMenu}<a className="brand-lockup" href="#dashboard-top" aria-label="SchedMe dashboard home"><span className="text-xl font-semibold tracking-tight">SchedMe</span></a></div>
          <div className="dashboard-profile">
            <ThemePicker theme={theme} onChange={onSelectTheme} />
            <span className="dashboard-avatar" aria-hidden="true">{(user.displayName || user.email || 'S').charAt(0).toUpperCase()}</span><button type="button" className="dashboard-signout" onClick={onSignOut}>Sign out</button>
          </div>
        </header>

        <section id="dashboard-top" className="dashboard-welcome" data-reveal><div><p className="dashboard-date">{formattedToday}</p><h1>Make room for what matters.</h1><p className="copy-muted">A clear view of your week, with space for everything else.</p></div><div className="dashboard-schedule-badge"><span className="schedule-badge-dot" /><span><small>ACTIVE SCHEDULE</small><strong>My week</strong></span></div></section>

        <section id="weekly-schedule" className="dashboard-panel dashboard-week-panel" data-reveal>
          <div className="dashboard-panel-topline">
            <div><p className="dashboard-kicker">Your schedule</p><h2>Weekly table</h2></div>
            <div className="week-header-actions">
              <button type="button" className={`calendar-edit-toggle ${calendarEditMode ? 'is-active' : ''}`} aria-pressed={calendarEditMode} onClick={() => { setCalendarEditMode((active) => !active); setCalendarEditor(null); setCalendarError(''); setDraggedTaskId(''); setCalendarDropTarget(''); setCalendarNotice(null) }}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 20 4.3-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.3 16Z" /><path d="m14.8 6.5 2.8 2.8" /></svg>
                <span>{calendarEditMode ? 'Done editing' : 'Edit calendar'}</span>
              </button>
              <div className="week-controls" aria-label="Change displayed week"><button type="button" onClick={() => setWeekOffset((offset) => offset - 1)} aria-label="Previous week">‹</button><button type="button" className="week-today" onClick={() => setWeekOffset(0)}>This week</button><button type="button" onClick={() => setWeekOffset((offset) => offset + 1)} aria-label="Next week">›</button></div>
            </div>
          </div>
          {calendarEditMode && <div className={`calendar-drag-guide ${calendarNotice ? `is-${calendarNotice.type}` : ''}`} role={calendarNotice?.type === 'error' ? 'alert' : 'status'} aria-live="polite">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 11V6.5a1.5 1.5 0 0 1 3 0V10m0-2.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v4.5m0-2a1.5 1.5 0 0 1 3 0V15c0 4-2.7 6.5-6.8 6.5h-1.4c-2.2 0-3.8-.8-5.2-2.5l-3.3-4a1.6 1.6 0 0 1 2.3-2.2L9 15Z" /></svg>
            <span>{calendarNotice?.text || 'Hold and drag a task to another day or time section. Its duration will stay the same.'}</span>
          </div>}
          <div className="week-table-scroll" role="region" aria-label="Weekly schedule, scroll horizontally on small screens" tabIndex="0"><div className="week-table" role="table" aria-label="Weekly schedule">
            <div className="week-table-row week-table-head" role="row"><div className="week-time-heading" role="columnheader">TIME</div>{weekDays.map((day) => <div className={`week-day-heading ${day.isToday && weekOffset === 0 ? 'is-today' : ''}`} role="columnheader" key={day.date.toISOString()}><span>{day.day}</span><strong>{day.number}</strong>{day.isToday && weekOffset === 0 && <small>Today</small>}</div>)}</div>
            {schedulePeriods.map((period) => <div className="week-table-row" role="row" key={period.label}><div className="week-time-label" role="rowheader"><strong>{period.label}</strong><span>{period.range}</span></div>{weekDays.map((day) => {
              const date = localDateKey(day.date)
              const entries = tasks.filter((task) => task.date === date && minuteOfDay(task.startTime) >= period.start && minuteOfDay(task.startTime) < period.end).sort((a, b) => a.startTime.localeCompare(b.startTime))
              const dropKey = `${period.label}-${date}`
              return <div
                className={`week-slot ${day.isToday && weekOffset === 0 ? 'is-today' : ''} ${calendarEditMode ? 'is-editing' : ''} ${calendarDropTarget === dropKey ? 'is-drop-target' : ''}`}
                role="cell"
                key={dropKey}
                data-calendar-drop-target={calendarEditMode ? dropKey : undefined}
                onDragEnter={(event) => { if (calendarEditMode && draggedTaskId) { event.preventDefault(); setCalendarDropTarget(dropKey) } }}
                onDragOver={(event) => { if (calendarEditMode && draggedTaskId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; moveCalendarDragPreview(event) } }}
                onDrop={(event) => dropCalendarTask(event, day, period)}
              >
                {entries.length ? entries.map((task) => {
                  const displayColor = getTaskDisplayColor(task)
                  return calendarEditMode
                  ? <button
                    type="button"
                    draggable={!calendarSaving}
                    aria-grabbed={draggedTaskId === task.id}
                    className={`week-event is-editable ${draggedTaskId === task.id ? 'is-dragging' : ''} ${displayColor ? 'has-color' : ''} ${task.completed ? 'is-complete' : ''} ${task.urgent ? 'urgent' : task.important ? 'lime' : 'green'}`}
                    style={displayColor ? { '--task-color': displayColor } : undefined}
                    key={task.id}
                    onDragStart={(event) => startCalendarDrag(event, task)}
                    onDrag={moveCalendarDragPreview}
                    onDragEnd={finishCalendarDrag}
                    onClick={() => { if (!suppressCalendarClickRef.current) openExistingCalendarEntry(task) }}
                    aria-label={`Edit or drag ${task.title}, ${formatTimeRange(task.startTime, task.endTime)}`}
                  ><span className="week-event-held-content"><span className="week-event-meta"><span>{formatTimeRange(task.startTime, task.endTime)}</span><TaskClassificationSymbols task={task} /></span><strong>{task.title}</strong><i aria-hidden="true">Hold + drag</i></span></button>
                  : <article className={`week-event ${displayColor ? 'has-color' : ''} ${task.completed ? 'is-complete' : ''} ${task.urgent ? 'urgent' : task.important ? 'lime' : 'green'}`} style={displayColor ? { '--task-color': displayColor } : undefined} key={task.id}><span className="week-event-meta"><span>{formatTimeRange(task.startTime, task.endTime)}</span><TaskClassificationSymbols task={task} /></span><strong>{task.title}</strong></article>
                })
                  : !calendarEditMode && <span className="week-free-slot">Open</span>}
                {calendarEditMode && <button type="button" className="week-add-button" onClick={() => openNewCalendarEntry(day, period)} aria-label={`Add a task on ${day.day}, ${period.range}`}><span aria-hidden="true">+</span><small>Add</small></button>}
              </div>
            })}</div>)}
          </div></div><div className="week-legend"><span><i className="legend-dot open" /> {calendarEditMode ? 'Choose + to add, click to edit, or drag to move' : 'Available time'}</span><span className="dashboard-preview-note">{calendarEditMode ? 'Drag changes save automatically.' : 'Schedule in one line: Task / Day / Time.'}</span></div>
        </section>

        <div id="planning-workspace" className="dashboard-main-grid" data-reveal>
          <TaskPanel group={groups[0]} tasks={tasksByGroup.free} onAdd={addTask} onComplete={completeTask} onEdit={openInboxTaskEditor} onTaskDragStart={startTaskListDrag} onTaskDragMove={moveTaskListDragPreview} onTaskDragEnd={finishTaskListDrag} onTaskDragOver={updateTaskListDropTarget} onTaskDrop={moveTaskToList} draggedTaskId={taskListDrag.taskId} dropTarget={taskListDrag.targetGroup} dropTaskId={taskListDrag.targetTaskId} dropPosition={taskListDrag.position} saving={taskBusy} error={taskError} />
          <section id="schedme-ai" className="dashboard-panel dashboard-ai-panel">
            <div className="dashboard-panel-heading"><span className="dashboard-ai-mark" aria-hidden="true">{aiMemory.chatbotName.charAt(0).toUpperCase()}</span><div><h2>{aiMemory.chatbotName}</h2><p>{aiMemory.mood} planning companion · Gemini</p></div><div className="ai-header-actions"><button type="button" className="ai-settings-button" onClick={resetConversation}>Clear chat</button><button type="button" className="ai-settings-button" onClick={() => { setAiMemoryError(''); setSettingsOpen(true) }}>Personalize</button></div></div>
            {getSchedulingQueue(tasks).length > 0 && <button type="button" className="ai-unscheduled-banner" onClick={() => sendChat(null, 'Schedule my unscheduled tasks')} disabled={chatBusy || !conversationReady}><span>{getSchedulingQueue(tasks).length}</span><span><strong>Tasks need a time</strong><small>Schedule them one at a time</small></span><b>→</b></button>}
            <div className="ai-chat-transcript" aria-live="polite">{messages.map((message, index) => <div className={`ai-chat-message ${message.role}`} key={`${index}-${message.role}`}><span className="ai-message-avatar" aria-hidden="true">{message.role === 'model' ? aiMemory.chatbotName.charAt(0).toUpperCase() : (user.displayName || 'Y').charAt(0).toUpperCase()}</span><div className="ai-chat-bubble">{message.kind === 'voice' ? <VoiceMessage duration={message.voiceDurationSeconds} src={voiceAudioUrlsRef.current.get(message.voiceId) || ''} transcript={message.text} /> : <p>{message.text}</p>}{message.role === 'model' && message.plan && <PlanReview plan={message.plan} tasks={tasks} onApply={() => applyPlan(message.plan, index)} busy={planBusy} applied={message.planApplied} error={planError} />}{message.role === 'user' && <button type="button" className="ai-remember-button" onClick={() => rememberPrompt(message.text)} disabled={aiMemoryBusy || aiMemory.preferences.some((item) => item.toLocaleLowerCase() === message.text.trim().slice(0, 240).toLocaleLowerCase())} title="Save this message as a long-term preference">{aiMemory.preferences.some((item) => item.toLocaleLowerCase() === message.text.trim().slice(0, 240).toLocaleLowerCase()) ? 'Remembered' : 'Remember'}</button>}</div></div>)}{chatBusy && <p className="ai-thinking">Thinking…</p>}<span ref={chatEndRef} aria-hidden="true" /></div>
            <div className="ai-prompt-suggestions"><button type="button" onClick={() => setChatInput('Schedule my unscheduled tasks')}>Schedule my tasks</button><button type="button" onClick={() => setChatInput('Make thesis / Monday / 2-3pm')}>Try compact format</button><button type="button" onClick={() => setChatInput('How are you?')}>Talk first</button></div>
            <form className={`ai-input-preview ${voiceRecording ? 'is-recording' : ''} ${voiceDraft ? 'has-voice' : ''}`} onSubmit={sendChat}>
              {voiceRecording ? <div className="voice-recording-live"><div className="voice-recording-controls"><span className="voice-recording-dot" aria-hidden="true" /><span className="voice-recording-label">Recording</span><VoiceWaveform active /><time>{formatVoiceDuration(voiceDuration)}</time><button type="button" className="ai-mic-button is-recording" onClick={stopVoiceRecording} aria-label="Stop voice recording" title="Stop recording"><MicrophoneIcon /></button></div><p className={`voice-live-transcript ${chatInput ? 'has-words' : ''}`} role="status" aria-live="polite"><span>{voiceTranscriptStatus || 'Live transcription'}</span>{chatInput || (voiceTranscriptionSupported ? 'Your words will appear here as you speak.' : 'This browser can record audio but does not offer live transcription. Use Chrome or Edge for live words.')}</p></div> : <>
                {voiceDraft && <VoiceMessage duration={voiceDraft.duration} src={voiceDraft.url} onRemove={discardVoiceDraft} />}
                <div className="ai-input-row"><input aria-label="Message SchedMe AI" value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={voiceDraft ? (voiceTranscriptionSupported ? 'Review or correct the transcript…' : 'Type what you said before sending…') : 'Task / Day / Time — e.g. Thesis / Monday / 2-3pm'} maxLength={2000} /><div className="ai-input-actions"><button type="button" className={`ai-mic-button ${voiceStarting ? 'is-starting' : ''}`} onClick={requestVoiceRecording} disabled={chatBusy || voiceStarting || !conversationReady} aria-label={voiceStarting ? 'Waiting for microphone permission' : 'Record a voice message'} title={voiceStarting ? 'Waiting for microphone permission' : 'Record a voice message'}><MicrophoneIcon /></button><button type="submit" className="ai-send-button" disabled={chatBusy || !chatInput.trim() || !conversationReady} aria-label="Send message">↑</button></div></div>
              </>}
            </form>
            {voiceError && <p className="ai-phase-note" role="alert">{voiceError}</p>}
            {chatError && <p className="ai-phase-note" role="alert">{chatError}</p>}
            {aiMemoryError && <p className="ai-phase-note" role="alert">{aiMemoryError}</p>}
            <p className="ai-phase-note">Conversation history reloads on your account. Use Remember for lasting preferences, or Clear chat to remove the transcript.</p>
          </section>
        </div>

        <section id="task-priorities" className="dashboard-priority-section" data-reveal><div className="dashboard-section-title"><div><p className="dashboard-kicker">Stay focused</p><h2>Your task lists</h2></div><p>Turn on editing, then drag tasks above, below, or into another list.</p></div><div className="dashboard-task-grid">{groups.slice(1).map((group) => <TaskPanel group={group} key={group.id} tasks={tasksByGroup[group.id]} onAdd={addTask} onComplete={completeTask} onEdit={openInboxTaskEditor} onTaskDragStart={startTaskListDrag} onTaskDragMove={moveTaskListDragPreview} onTaskDragEnd={finishTaskListDrag} onTaskDragOver={updateTaskListDropTarget} onTaskDrop={moveTaskToList} draggedTaskId={taskListDrag.taskId} dropTarget={taskListDrag.targetGroup} dropTaskId={taskListDrag.targetTaskId} dropPosition={taskListDrag.position} saving={taskBusy} error={taskError} />)}</div></section>
        <footer className="dashboard-footer">SchedMe · Your schedule stays yours.</footer>
      </div>
      {calendarDragPreview && <div
        className={`calendar-drag-preview ${calendarDragPreview.color ? 'has-color' : ''}`}
        style={{ left: calendarDragPreview.x, top: calendarDragPreview.y, ...(calendarDragPreview.color ? { '--task-color': calendarDragPreview.color } : {}) }}
        aria-hidden="true"
      ><div className="calendar-drag-preview-card"><span className="calendar-drag-preview-grip"><i /><i /><i /><i /><i /><i /></span><span className="calendar-drag-preview-copy"><small>{calendarDragPreview.time}</small><strong>{calendarDragPreview.title}</strong></span><b>Moving</b></div></div>}
      {taskListDrag.taskId && <div
        className="task-list-drag-preview"
        style={{ left: taskListDrag.x, top: taskListDrag.y, ...(taskListDrag.color ? { '--task-color': taskListDrag.color } : {}) }}
        aria-hidden="true"
      ><div className="task-list-drag-preview-card"><span className="task-list-drag-preview-grip"><i /><i /><i /><i /><i /><i /></span><span className="task-list-drag-preview-copy"><strong>{taskListDrag.title}</strong><small>{taskListDrag.label}</small></span><b>Moving</b></div></div>}
      <FloatingAssistant
        assistantName={aiMemory.chatbotName}
        assistantMood={aiMemory.mood}
        userName={user.displayName || user.email || 'You'}
        messages={messages}
        tasks={tasks}
        chatInput={chatInput}
        setChatInput={setChatInput}
        onSend={sendChat}
        chatBusy={chatBusy}
        conversationReady={conversationReady}
        chatError={chatError}
        onApplyPlan={applyPlan}
        planBusy={planBusy}
        planError={planError}
        getVoiceUrl={(voiceId) => voiceAudioUrlsRef.current.get(voiceId) || ''}
      />
      <div className={`floating-menu-backdrop ${menuOpen ? 'is-visible' : ''}`} aria-hidden="true" />
      {settingsOpen && <AssistantSettings memory={aiMemory} onClose={() => setSettingsOpen(false)} onSave={saveAssistantSettings} onForget={forgetPreference} saving={aiMemoryBusy} error={aiMemoryError} />}
      {microphonePermissionPrompt && <MicrophonePermissionModal blocked={microphonePermissionPrompt === 'blocked'} onCancel={() => setMicrophonePermissionPrompt(null)} onContinue={() => { setMicrophonePermissionPrompt(null); startVoiceRecording() }} />}
      {calendarEditor && <CalendarEditorModal editor={calendarEditor} onClose={() => { setCalendarEditor(null); setCalendarError('') }} onConfirm={saveCalendarEntry} onDelete={deleteCalendarEntry} saving={calendarSaving} error={calendarError} />}
    </main>
  )
}

export default Dashboard
