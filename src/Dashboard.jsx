import { useEffect, useMemo, useRef, useState } from 'react'
import { applyAiPlanning, createScheduledTask, createTask, deleteTask, replaceScheduledTask, scheduleTask, setTaskCompleted, subscribeToTasks, unscheduleTask, updateScheduledTask } from './services/taskService.js'
import { askPlanningAssistant } from './ai/planningAgent.js'
import { validatePlanningResponse } from './ai/planValidation.js'
import { addPromptToAiMemory, AI_MOODS, DEFAULT_AI_MEMORY, forgetAiPreference, saveAiMemory, subscribeToAiMemory } from './services/aiMemoryService.js'
import { clearConversation, DEFAULT_INTERACTION_PROFILE, EMPTY_SCHEDULING_STATE, learnInteractionStyle, saveConversation, subscribeToConversation } from './services/conversationService.js'
import { findScheduleConflict, findTaskMatch, formatSlot, formatTimeRange, getMondayWeek, getSchedulingQueue, parseDirectScheduleRequest, parseSchedulingInput, suggestAvailableSlots } from './ai/schedulingIntent.js'
import { prepareDailyGreetingHistory, preserveGreetingDate } from './ai/conversationGreeting.js'
import { confirmsTaskDeletion, declinesTaskDeletion, isCancellationMessage, wantsFullCancellationRemoval, wantsToScheduleAnotherTask } from './ai/cancellationIntent.js'
import { getDefaultPeriodTimes, getDroppedCalendarSlot, validateCalendarEntry } from './ai/calendarEditor.js'
import { isTaskCompletionMessage } from './ai/completionIntent.js'
import { parseTaskCreationIntent } from './ai/taskCreationIntent.js'
import ThemePicker from './components/ThemePicker.jsx'

const groups = [
  { id: 'free', title: "What's on my mind", subtitle: 'A place to get thoughts out', tone: 'free', icon: '\u25cb', placeholder: 'Write down anything on your mind...' },
  { id: 'urgent', title: 'Urgent', subtitle: 'Needs attention soon', tone: 'urgent', icon: '!', placeholder: 'Add an urgent task...' },
  { id: 'important', title: 'Important', subtitle: 'Moves your priorities forward', tone: 'important', icon: '\u2726', placeholder: 'Add an important task...' },
  { id: 'notUrgent', title: 'Not urgent', subtitle: 'Flexible timing', tone: 'calm', icon: '\u2197', placeholder: 'Add a flexible task...' },
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
    && !/\b(urgent|important|priority|categor(?:y|ize)|classify|not urgent)\b/i.test(userMessage)
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

function getWeekDays(offset) {
  const today = new Date()
  return getMondayWeek(offset, today).map(({ date, key, label }) => ({
    date,
    key,
    day: label.slice(0, 3),
    number: date.getDate(),
    isToday: date.toDateString() === today.toDateString(),
  }))
}

function TaskPanel({ group, tasks, onAdd, onComplete, saving, error }) {
  const [draft, setDraft] = useState('')
  const [alsoPriority, setAlsoPriority] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (!draft.trim()) return
    const value = draft
    setDraft('')
    await onAdd(value, group.id, alsoPriority)
    setAlsoPriority(false)
  }
  return (
    <section id={`${group.id}-tasks`} className={`dashboard-panel dashboard-task-panel ${group.tone}`}>
      <div className="dashboard-panel-heading">
        <span className={`dashboard-panel-icon ${group.tone}`} aria-hidden="true">{group.icon}</span>
        <div><h2>{group.title}</h2><p>{group.subtitle}</p></div>
        <span className="dashboard-count">{tasks.length}</span>
      </div>
      <form className="task-entry-form" onSubmit={submit}>
        <input aria-label={`New ${group.title} item`} maxLength={240} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={group.placeholder} />
        <button type="submit" disabled={saving || !draft.trim()} aria-label={`Add to ${group.title}`}>+</button>
      </form>
      {(group.id === 'urgent' || group.id === 'important') && <label className="task-overlap-toggle"><input type="checkbox" checked={alsoPriority} onChange={(event) => setAlsoPriority(event.target.checked)} /> Also mark as {group.id === 'urgent' ? 'important' : 'urgent'}</label>}
      {error && <p className="task-storage-error" role="alert">{error}</p>}
      <div className="dashboard-task-list">
        {tasks.length === 0 && <p className="empty-task-note">Nothing here yet. Add a thought above.</p>}
        {tasks.map((task) => (
          <article className={`dashboard-task-item ${task.completed ? 'is-complete' : ''}`} key={task.id}>
            <button type="button" className="dashboard-task-check" onClick={() => onComplete(task)} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} aria-pressed={Boolean(task.completed)} />
            <div className="dashboard-task-content"><h4>{task.title}</h4><p>{task.completed ? 'Completed' : task.urgent && task.important ? 'Urgent · Important' : task.urgent ? 'Urgent' : task.important ? 'Important' : task.category === 'notUrgent' ? 'Not urgent' : 'Unscheduled'}</p></div>
          </article>
        ))}
      </div>
    </section>
  )
}

function AssistantSettings({ memory, onClose, onSave, onForget, saving, error }) {
  const [name, setName] = useState(memory.chatbotName)
  const [mood, setMood] = useState(memory.mood)
  const [defaultDuration, setDefaultDuration] = useState(memory.defaultDuration || 60)
  const [greetingStyle, setGreetingStyle] = useState(memory.greetingStyle || 'friendly')
  const [editingPreference, setEditingPreference] = useState(null)
  const [preferenceDraft, setPreferenceDraft] = useState('')
  return (
    <div className="assistant-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="assistant-settings" role="dialog" aria-modal="true" aria-labelledby="assistant-settings-title">
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close AI settings">×</button>
        <p className="dashboard-kicker">Your AI, your way</p>
        <h2 id="assistant-settings-title">Personalize your assistant</h2>
        <p className="copy-muted">Its default personality stays thoughtful, warm, and practical. Your choices adjust how it speaks and what it remembers.</p>
        <form className="assistant-settings-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...memory, chatbotName: name.trim() || 'SchedMe', mood, defaultDuration: Number(defaultDuration), greetingStyle }) }}>
          <label htmlFor="assistant-name">Assistant name</label>
          <input id="assistant-name" maxLength={32} value={name} onChange={(event) => setName(event.target.value)} placeholder="SchedMe" />
          <label htmlFor="assistant-mood">Chat mood</label>
          <select id="assistant-mood" value={mood} onChange={(event) => setMood(event.target.value)}>
            {AI_MOODS.map((option) => <option value={option} key={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>)}
          </select>
          <label htmlFor="assistant-duration">Default task duration</label>
          <select id="assistant-duration" value={defaultDuration} onChange={(event) => setDefaultDuration(event.target.value)}>
            {[30, 45, 60, 90, 120].map((minutes) => <option value={minutes} key={minutes}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`}</option>)}
          </select>
          <label htmlFor="assistant-greeting">Opening style</label>
          <select id="assistant-greeting" value={greetingStyle} onChange={(event) => setGreetingStyle(event.target.value)}>
            <option value="friendly">Friendly check-in</option>
            <option value="short">Short greeting</option>
            <option value="direct">Go directly to planning</option>
          </select>
          <button className="auth-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save assistant settings'}</button>
        </form>
        <div className="assistant-memory-section">
          <h3>Saved preferences</h3>
          <p>In chat, choose <strong>Remember</strong> on a message to save it. Other chat messages aren’t stored as long-term memory.</p>
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

function TaskColorPicker({ value, mode, onChange }) {
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
    onChange({ color: automatic ? pickRandomTaskColor(value) : option.value, mode: automatic ? 'automatic' : 'manual' })
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 260)
  }

  return (
    <div className={`calendar-color-picker ${open ? 'is-open' : ''}`} ref={pickerRef}>
      <button type="button" className="calendar-color-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)}>
        <span className={`calendar-color-current ${mode === 'automatic' ? 'is-automatic' : ''}`} style={{ '--choice-color': value }} aria-hidden="true" />
        <span className="calendar-color-trigger-copy"><strong>Task color</strong><small>Optional · {mode === 'automatic' ? `Automatic · ${selected?.label || 'Random'}` : selected?.label}</small></span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
      </button>
      {open && <div className="calendar-color-popover" role="dialog" aria-label="Choose a task color">
        <div className="calendar-color-popover-head"><div><strong>Choose a color</strong><small>Automatic picks a different palette color for you.</small></div><span>{mode === 'automatic' ? `Auto · ${selected?.label || 'Random'}` : selected?.label}</span></div>
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

function CalendarEditorModal({ editor, onClose, onConfirm, saving, error }) {
  const [title, setTitle] = useState(editor.title || '')
  const [startTime, setStartTime] = useState(editor.startTime)
  const [endTime, setEndTime] = useState(editor.endTime)
  const [completed, setCompleted] = useState(Boolean(editor.completed))
  const [color, setColor] = useState(() => editor.color || pickRandomTaskColor())
  const [colorMode, setColorMode] = useState(editor.colorMode || (editor.color ? 'manual' : 'automatic'))

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  return (
    <div className="calendar-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="calendar-editor-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-editor-title">
        <button type="button" className="auth-close" onClick={onClose} disabled={saving} aria-label="Close calendar editor">×</button>
        <span className="calendar-editor-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="m4 20 4.3-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.3 16Z" /><path d="m14.8 6.5 2.8 2.8" /></svg>
        </span>
        <p className="dashboard-kicker">{editor.mode === 'create' ? 'Add to calendar' : 'Edit calendar task'}</p>
        <h2 id="calendar-editor-title">{editor.mode === 'create' ? 'Create a time block' : 'Update this time block'}</h2>
        <p className="calendar-editor-date">{editor.dayLabel}<span>{editor.periodLabel}</span></p>
        <form className="calendar-editor-form" onSubmit={(event) => { event.preventDefault(); onConfirm({ title, startTime, endTime, completed, color, colorMode }) }}>
          <label htmlFor="calendar-task-title">Task</label>
          <input id="calendar-task-title" autoFocus maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What are you planning?" />
          <TaskColorPicker value={color} mode={colorMode} onChange={({ color: nextColor, mode: nextMode }) => { setColor(nextColor); setColorMode(nextMode) }} />
          <div className="calendar-time-fields">
            <div className="calendar-time-control"><label htmlFor="calendar-start-time">Time start</label><TimePicker id="calendar-start-time" label="Start time" value={startTime} onChange={setStartTime} /></div>
            <span aria-hidden="true">→</span>
            <div className="calendar-time-control"><label htmlFor="calendar-end-time">End</label><TimePicker id="calendar-end-time" label="End time" value={endTime} onChange={setEndTime} /></div>
          </div>
          {editor.mode === 'edit' && <fieldset className="calendar-completion-choice">
            <legend>Mark as done?</legend>
            <button type="button" className={completed ? 'is-selected' : ''} aria-pressed={completed} onClick={() => setCompleted(true)}>Yes</button>
            <button type="button" className={!completed ? 'is-selected' : ''} aria-pressed={!completed} onClick={() => setCompleted(false)}>No</button>
            <small>{completed ? 'The title will appear crossed out.' : 'The task will stay active on your calendar.'}</small>
          </fieldset>}
          {error && <p className="calendar-editor-error" role="alert">{error}</p>}
          <div className="calendar-editor-actions">
            <button type="button" className="calendar-cancel-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="calendar-confirm-button" disabled={saving}>{saving ? 'Saving…' : editor.mode === 'create' ? 'Add to calendar' : 'Confirm changes'}</button>
          </div>
        </form>
      </section>
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
      {proposal.length > 0 && <ul>{proposal.map((item) => <li key={item.taskId}><span>{taskNames.get(item.taskId) || 'Task'} · {item.urgent && item.important ? 'Urgent + important' : item.urgent ? 'Urgent' : item.important ? 'Important' : 'Not urgent'}</span><small>{item.date} · {item.startTime}–{item.endTime}</small></li>)}</ul>}
      {updates.length > 0 && <ul>{updates.map((item) => <li key={item.taskId}><span>{taskNames.get(item.taskId) || 'Task'} · {item.urgent && item.important ? 'Urgent + important' : item.urgent ? 'Urgent' : item.important ? 'Important' : 'Not urgent'}</span><small>Category</small></li>)}</ul>}
      {error && <p className="task-storage-error" role="alert">{error}</p>}
      <button type="button" onClick={onApply} disabled={busy || applied}>{applied ? proposal.length ? 'Added to your week' : 'Categories saved' : busy ? 'Saving…' : proposal.length ? 'Approve and add to my week' : 'Apply these categories'}</button>
    </div>
  )
}

function explainAiError(error) {
  const code = String(error?.code || '').toLowerCase()
  const detail = String(error?.message || '').toLowerCase()
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
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
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
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset])
  const planningDates = useMemo(() => weekDays.map((day) => day.key), [weekDays])
  const formattedToday = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  useEffect(() => subscribeToTasks(user.uid, setTasks, (error) => {
    setTaskError(error.code === 'permission-denied' ? 'Task access is blocked. Deploy the provided Firestore rules in Firebase Console.' : 'Could not load saved tasks. Check that Firestore is enabled for this Firebase project.')
  }), [user.uid])

  useEffect(() => subscribeToAiMemory(user.uid, setAiMemory, (error) => {
    setAiMemoryError(error.code === 'permission-denied' ? 'Firestore blocked access to your AI preferences. Check the published owner-only rules.' : 'Could not load your saved AI preferences.')
  }), [user.uid])

  useEffect(() => subscribeToConversation(user.uid, ({ messages: savedMessages, schedulingState: savedState, interactionProfile: savedProfile }) => {
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
    setSchedulingState(nextState)
    setInteractionProfile(savedProfile)
    setConversationReady(true)
    if (needsGreeting || preparedHistory.changed || savedState.lastGreetingDate !== today) saveConversation(user.uid, visibleMessages, nextState, savedProfile).catch(() => {})
  }, () => {
    setMessages([{ role: 'model', text: 'Ready when you are. Choose a task to schedule, or type Task / Day / Time.' }])
    setConversationReady(true)
  }), [user.uid, aiMemory.chatbotName, aiMemory.greetingStyle])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [messages, chatBusy])

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
    free: tasks.filter((task) => task.category === 'free'),
    urgent: tasks.filter((task) => task.urgent),
    important: tasks.filter((task) => task.important),
    notUrgent: tasks.filter((task) => !task.urgent && !task.important && task.category !== 'free'),
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

  async function resetConversation() {
    if (!window.confirm('Clear this saved conversation? Your tasks and assistant preferences will stay unchanged.')) return
    const today = localDateKey(new Date())
    const freshMessages = [{ role: 'model', text: 'Chat cleared. Choose a task to schedule whenever you’re ready.' }]
    await clearConversation(user.uid, today)
    setMessages(freshMessages)
    setSchedulingState({ ...EMPTY_SCHEDULING_STATE, lastGreetingDate: today })
    setInteractionProfile({ ...DEFAULT_INTERACTION_PROFILE })
  }

  async function persistConversation(nextMessages, nextState = schedulingState, nextProfile = interactionProfile) {
    const stateWithGreeting = preserveGreetingDate(nextState, schedulingState, greetedDateRef.current)
    setMessages(nextMessages)
    setSchedulingState(stateWithGreeting)
    setInteractionProfile(nextProfile)
    try { await saveConversation(user.uid, nextMessages, stateWithGreeting, nextProfile) }
    catch { setChatError('Your reply worked, but the conversation history could not be saved.') }
  }

  async function sendChat(event, directMessage = '') {
    event?.preventDefault()
    const text = (directMessage || chatInput).trim()
    if (!text || chatBusy || !conversationReady) return

    const preliminary = parseSchedulingInput(text, tasks, weekDays, schedulingState.activeTaskId, aiMemory.defaultDuration || 60)
    const nextProfile = learnInteractionStyle(interactionProfile, text, preliminary.isCompact)
    const next = [...messages, { role: 'user', text }]
    setMessages(next)
    setChatInput('')
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
        await complete(`That time has already passed today. What later time should I use for “${task.title}”?`, { ...state, activeTaskId: task.id, date: slot.date, startTime: '', endTime: '', pendingConflict: null })
        return
      }
      const conflict = findScheduleConflict(tasks, task.id, slot)
      if (conflict) {
        const alternatives = suggestAvailableSlots(tasks, task.id, slot).map((item) => formatSlot(item, weekDays).split(', ')[1]).join(' or ')
        await complete(
          `${formatSlot(slot, weekDays)} overlaps with “${conflict.title}.” Would you like to put “${task.title}” there and return “${conflict.title}” to What’s on my mind, or keep it and choose another time${alternatives ? ` such as ${alternatives}` : ''}?`,
          { ...state, activeTaskId: task.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime, pendingConflict: { incomingTaskId: task.id, displacedTaskId: conflict.id, slot } },
        )
        return
      }

      await scheduleTask(user.uid, task.id, slot)
      const lastAction = {
        type: task.date ? 'move' : 'schedule',
        taskId: task.id,
        previousSlot: task.date ? { date: task.date, startTime: task.startTime, endTime: task.endTime } : null,
      }
      if (state.queueMode) {
        const following = nextQueuedTask(state, [task.id])
        if (following) {
          await complete(
            `Done—“${task.title}” is scheduled ${formatSlot(slot, weekDays)}. Next is “${following.title}.” What day and time work for it? You can reply like Monday-2-3pm, skip, or stop.`,
            { ...EMPTY_SCHEDULING_STATE, queueMode: true, activeTaskId: following.id, deferredTaskIds: state.deferredTaskIds, lastAction },
          )
          return
        }
      }
      await complete(`Done—“${task.title}” is scheduled ${formatSlot(slot, weekDays)}. You can say “undo” if you want to change it.`, { ...EMPTY_SCHEDULING_STATE, lastAction })
    }

    try {
      const creationRequest = parseTaskCreationIntent(text)
      if (creationRequest.isCreation) {
        if (!creationRequest.title) {
          await complete('What should I call the new task?', { ...EMPTY_SCHEDULING_STATE })
          return
        }

        const hasCompleteSlot = preliminary.day && !preliminary.day.ambiguous && preliminary.time
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
              color: pickRandomTaskColor(),
              colorMode: 'automatic',
            })
            await complete(`Done—“${creationRequest.title}” was created and scheduled ${formatSlot(slot, weekDays)}.`, { ...EMPTY_SCHEDULING_STATE })
            return
          }

          await createTask(user.uid, creationRequest.title, 'free')
          await complete(
            conflict
              ? `I’ve put “${creationRequest.title}” in What’s on my mind because that time overlaps with “${conflict.title}.” Tell me another day and time when you’re ready.`
              : `I’ve put “${creationRequest.title}” in What’s on my mind because that time has already passed. Tell me another day and time when you’re ready.`,
            { ...EMPTY_SCHEDULING_STATE },
          )
          return
        }

        await createTask(user.uid, creationRequest.title, 'free')
        await complete(`I’ve put “${creationRequest.title}” in your What’s on my mind task list. Tell me when you’re ready to schedule it or any other task.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      if (isTaskCompletionMessage(text)) {
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
        if (completedTask.completed) {
          await complete(`“${completedTask.title}” is already done.`, { ...EMPTY_SCHEDULING_STATE })
          return
        }
        await setTaskCompleted(user.uid, completedTask.id, true)
        await complete(`Already done—“${completedTask.title}” is marked complete.`, { ...EMPTY_SCHEDULING_STATE })
        return
      }

      const directSchedule = parseDirectScheduleRequest(text, tasks, weekDays, aiMemory.defaultDuration || 60)
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
          const createdTask = await createTask(user.uid, directSchedule.title, 'free')
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
          await createTask(user.uid, directSchedule.title, 'free')
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
          color: pickRandomTaskColor(),
          colorMode: 'automatic',
        })
        await complete(`Done—“${directSchedule.title}” was created and scheduled ${formatSlot(slot, weekDays)}.`, { ...EMPTY_SCHEDULING_STATE })
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
          await deleteTask(user.uid, canceledTask.id)
          await complete(`Done—“${canceledTask.title}” was removed from your calendar and from What’s on my mind.`, { ...EMPTY_SCHEDULING_STATE })
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

      if (/^undo[.!\s]*$/i.test(text) && schedulingState.lastAction) {
        const action = schedulingState.lastAction
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

      const history = normalizedGeminiHistory(messages)
      const response = await askPlanningAssistant({ message: text, history, tasks, memory: aiMemory, planningDates, availability, currentDate: localDateKey(new Date()), interactionProfile: nextProfile })
      const correctedResponse = stopRepeatedPriorityPrompt(response, tasks, text)
      const plan = validatePlanningResponse(correctedResponse, tasks, planningDates, availability)
      setAvailability(plan.availability)
      const hasActions = plan.taskUpdates.length > 0 || plan.scheduleProposal.length > 0
      await persistConversation([...next, { role: 'model', text: correctedResponse.message, ...(hasActions ? { plan } : {}) }], schedulingState, nextProfile)
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
      await applyAiPlanning(user.uid, checkedPlan.taskUpdates, checkedPlan.scheduleProposal)
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
      color: task.color || '',
      colorMode: task.colorMode || (task.color ? 'manual' : 'automatic'),
    })
  }

  async function saveCalendarEntry(values) {
    const validationError = validateCalendarEntry(values)
    if (validationError) {
      setCalendarError(validationError)
      return
    }

    const slot = { date: calendarEditor.date, startTime: values.startTime, endTime: values.endTime }
    const conflict = findScheduleConflict(tasks, calendarEditor.taskId || '__new-calendar-task__', slot)
    if (!values.completed && conflict) {
      setCalendarError(`That time overlaps with “${conflict.title}” (${formatTimeRange(conflict.startTime, conflict.endTime)}). Choose another time first.`)
      return
    }

    setCalendarSaving(true)
    setCalendarError('')
    try {
      const entry = { ...values, ...slot, title: values.title.trim() }
      if (calendarEditor.mode === 'edit') await updateScheduledTask(user.uid, calendarEditor.taskId, entry)
      else await createScheduledTask(user.uid, entry)
      setCalendarEditor(null)
    } catch (error) {
      setCalendarError(error.code === 'permission-denied' ? 'Calendar access is blocked. Check the published Firestore rules.' : error.message || 'Could not save this calendar task.')
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
      <a href="#task-priorities" style={{ '--menu-index': 1, '--portrait-rotate': '1.5deg' }} className={`${activeSection === 'task-priorities' ? 'is-active' : ''} ${menuSelection === 'task-priorities' ? 'is-selected' : ''}`} aria-current={activeSection === 'task-priorities' ? 'page' : undefined} tabIndex={menuOpen ? 0 : -1} onClick={(event) => goToSection(event, 'task-priorities')}>
        <span className="floating-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 4.5h9.5l3 3V20H6z" /><path d="M15.5 4.5V8h3M9 12h6M9 15.5h6M4 7.5H3v13h12" /></svg></span>
        <span>My tasks</span>
      </a>
      <a href="#planning-workspace" style={{ '--menu-index': 2, '--portrait-rotate': '-1deg' }} className={`${activeSection === 'planning-workspace' ? 'is-active' : ''} ${menuSelection === 'planning-workspace' ? 'is-selected' : ''}`} aria-current={activeSection === 'planning-workspace' ? 'page' : undefined} tabIndex={menuOpen ? 0 : -1} onClick={(event) => goToSection(event, 'planning-workspace')}>
        <span className="floating-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9.5 9.5h5v5h-5zM9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" /></svg></span>
        <span>SchedMe AI</span>
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
                {entries.length ? entries.map((task) => calendarEditMode
                  ? <button
                    type="button"
                    draggable={!calendarSaving}
                    aria-grabbed={draggedTaskId === task.id}
                    className={`week-event is-editable ${draggedTaskId === task.id ? 'is-dragging' : ''} ${task.color ? 'has-color' : ''} ${task.completed ? 'is-complete' : ''} ${task.urgent ? 'urgent' : task.important ? 'lime' : 'green'}`}
                    style={task.color ? { '--task-color': task.color } : undefined}
                    key={task.id}
                    onDragStart={(event) => startCalendarDrag(event, task)}
                    onDrag={moveCalendarDragPreview}
                    onDragEnd={finishCalendarDrag}
                    onClick={() => { if (!suppressCalendarClickRef.current) openExistingCalendarEntry(task) }}
                    aria-label={`Edit or drag ${task.title}, ${formatTimeRange(task.startTime, task.endTime)}`}
                  ><span className="week-event-held-content"><span>{formatTimeRange(task.startTime, task.endTime)}</span><strong>{task.title}</strong><i aria-hidden="true">Hold + drag</i></span></button>
                  : <article className={`week-event ${task.color ? 'has-color' : ''} ${task.completed ? 'is-complete' : ''} ${task.urgent ? 'urgent' : task.important ? 'lime' : 'green'}`} style={task.color ? { '--task-color': task.color } : undefined} key={task.id}><span>{formatTimeRange(task.startTime, task.endTime)}</span><strong>{task.title}</strong></article>)
                  : !calendarEditMode && <span className="week-free-slot">Open</span>}
                {calendarEditMode && <button type="button" className="week-add-button" onClick={() => openNewCalendarEntry(day, period)} aria-label={`Add a task on ${day.day}, ${period.range}`}><span aria-hidden="true">+</span><small>Add</small></button>}
              </div>
            })}</div>)}
          </div></div><div className="week-legend"><span><i className="legend-dot open" /> {calendarEditMode ? 'Choose + to add, click to edit, or drag to move' : 'Available time'}</span><span className="dashboard-preview-note">{calendarEditMode ? 'Drag changes save automatically.' : 'Schedule in one line: Task / Day / Time.'}</span></div>
        </section>

        <div id="planning-workspace" className="dashboard-main-grid" data-reveal>
          <TaskPanel group={groups[0]} tasks={tasksByGroup.free} onAdd={addTask} onComplete={completeTask} saving={taskBusy} error={taskError} />
          <section id="schedme-ai" className="dashboard-panel dashboard-ai-panel">
            <div className="dashboard-panel-heading"><span className="dashboard-ai-mark" aria-hidden="true">{aiMemory.chatbotName.charAt(0).toUpperCase()}</span><div><h2>{aiMemory.chatbotName}</h2><p>{aiMemory.mood} planning companion · Gemini</p></div><div className="ai-header-actions"><button type="button" className="ai-settings-button" onClick={resetConversation}>Clear chat</button><button type="button" className="ai-settings-button" onClick={() => { setAiMemoryError(''); setSettingsOpen(true) }}>Personalize</button></div></div>
            {getSchedulingQueue(tasks).length > 0 && <button type="button" className="ai-unscheduled-banner" onClick={() => sendChat(null, 'Schedule my unscheduled tasks')} disabled={chatBusy || !conversationReady}><span>{getSchedulingQueue(tasks).length}</span><span><strong>Tasks need a time</strong><small>Schedule them one at a time</small></span><b>→</b></button>}
            <div className="ai-chat-transcript" aria-live="polite">{messages.map((message, index) => <div className={`ai-chat-message ${message.role}`} key={`${index}-${message.role}`}><span className="ai-message-avatar" aria-hidden="true">{message.role === 'model' ? aiMemory.chatbotName.charAt(0).toUpperCase() : (user.displayName || 'Y').charAt(0).toUpperCase()}</span><div className="ai-chat-bubble"><p>{message.text}</p>{message.role === 'model' && message.plan && <PlanReview plan={message.plan} tasks={tasks} onApply={() => applyPlan(message.plan, index)} busy={planBusy} applied={message.planApplied} error={planError} />}{message.role === 'user' && <button type="button" className="ai-remember-button" onClick={() => rememberPrompt(message.text)} disabled={aiMemoryBusy || aiMemory.preferences.some((item) => item.toLocaleLowerCase() === message.text.trim().slice(0, 240).toLocaleLowerCase())} title="Save this message as a long-term preference">{aiMemory.preferences.some((item) => item.toLocaleLowerCase() === message.text.trim().slice(0, 240).toLocaleLowerCase()) ? 'Remembered' : 'Remember'}</button>}</div></div>)}{chatBusy && <p className="ai-thinking">Thinking…</p>}<span ref={chatEndRef} aria-hidden="true" /></div>
            <div className="ai-prompt-suggestions"><button type="button" onClick={() => setChatInput('Schedule my unscheduled tasks')}>Schedule my tasks</button><button type="button" onClick={() => setChatInput('Make thesis / Monday / 2-3pm')}>Try compact format</button><button type="button" onClick={() => setChatInput('How are you?')}>Talk first</button></div>
            <form className="ai-input-preview" onSubmit={sendChat}><input aria-label="Message SchedMe AI" value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Task / Day / Time — e.g. Thesis / Monday / 2-3pm" maxLength={2000} /><button type="submit" disabled={chatBusy || !chatInput.trim() || !conversationReady} aria-label="Send message">↑</button></form>
            {chatError && <p className="ai-phase-note" role="alert">{chatError}</p>}
            {aiMemoryError && <p className="ai-phase-note" role="alert">{aiMemoryError}</p>}
            <p className="ai-phase-note">Conversation history reloads on your account. Use Remember for lasting preferences, or Clear chat to remove the transcript.</p>
          </section>
        </div>

        <section id="task-priorities" className="dashboard-priority-section" data-reveal><div className="dashboard-section-title"><div><p className="dashboard-kicker">Stay focused</p><h2>Your task lists</h2></div><p>Urgent and important can overlap.</p></div><div className="dashboard-task-grid">{groups.slice(1).map((group) => <TaskPanel group={group} key={group.id} tasks={tasksByGroup[group.id]} onAdd={addTask} onComplete={completeTask} saving={taskBusy} error={taskError} />)}</div></section>
        <footer className="dashboard-footer">SchedMe · Your schedule stays yours.</footer>
      </div>
      {calendarDragPreview && <div
        className={`calendar-drag-preview ${calendarDragPreview.color ? 'has-color' : ''}`}
        style={{ left: calendarDragPreview.x, top: calendarDragPreview.y, ...(calendarDragPreview.color ? { '--task-color': calendarDragPreview.color } : {}) }}
        aria-hidden="true"
      ><div className="calendar-drag-preview-card"><span className="calendar-drag-preview-grip"><i /><i /><i /><i /><i /><i /></span><span className="calendar-drag-preview-copy"><small>{calendarDragPreview.time}</small><strong>{calendarDragPreview.title}</strong></span><b>Moving</b></div></div>}
      <div className={`floating-menu-backdrop ${menuOpen ? 'is-visible' : ''}`} aria-hidden="true" />
      {settingsOpen && <AssistantSettings memory={aiMemory} onClose={() => setSettingsOpen(false)} onSave={saveAssistantSettings} onForget={forgetPreference} saving={aiMemoryBusy} error={aiMemoryError} />}
      {calendarEditor && <CalendarEditorModal editor={calendarEditor} onClose={() => { setCalendarEditor(null); setCalendarError('') }} onConfirm={saveCalendarEntry} saving={calendarSaving} error={calendarError} />}
    </main>
  )
}

export default Dashboard
