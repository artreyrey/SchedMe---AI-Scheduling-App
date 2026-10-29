const SCHEDULING_LANGUAGE = /\b(?:task|tasks|todo|schedule|scheduled|scheduling|calendar|plan|planning|planner|time|timeslot|availability|available|busy|free|deadline|appointment|meeting|event|reminder|remind|today|tomorrow|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|reschedule|move|cancel|delete|remove|complete|completed|done|finish|finished|urgent|important|priority|priorities|classify|classification|color|colour)\b/i
const TIME_LANGUAGE = /\b(?:[01]?\d(?::[0-5]\d)?\s*(?:am|pm)|[01]?\d(?::[0-5]\d)?\s*(?:-|–|—|to)\s*[01]?\d(?::[0-5]\d)?\s*(?:am|pm))\b/i
const GREETING = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))[!.?\s]*$/i
const HOW_ARE_YOU = /^(?:how\s+are\s+you|how(?:'s|\s+is)\s+it\s+going|how\s+do\s+you\s+feel|are\s+you\s+(?:doing\s+)?(?:okay|ok|well|good))[!.?\s]*$/i
const POSITIVE_WELLBEING = /^(?:i(?:'m|\s+am)\s+)?(?:good|great|fine|okay|ok|doing\s+(?:good|great|fine|okay|ok|well)|feeling\s+(?:good|great|fine|okay|ok|well))(?:\s+(?:today|right\s+now))?(?:,?\s*(?:thanks|thank\s+you))?[!.?\s]*$/i
const DIFFICULT_WELLBEING = /^(?:i(?:'m|\s+am|\s+feel)\s+)?(?:not\s+(?:good|great|fine|okay|ok|well)|bad|sad|tired|stressed|overwhelmed|anxious|worried|exhausted|burned\s*out|burnt\s*out|having\s+a\s+(?:bad|hard|rough)\s+day)(?:\s+(?:(?:today|right\s+now)\b|(?:about|because|with)\b.*))?[!.?\s]*$/i
const THANKS = /^(?:thanks|thank\s+you|thank\s+you\s+so\s+much|great|awesome)[!.?\s]*$/i
const CAPABILITY_QUESTION = /\b(?:what\s+(?:can|could)\s+(?:you|schedme|this\s+(?:ai|assistant|bot))\s+do|how\s+can\s+(?:you|schedme|this\s+(?:ai|assistant|bot))\s+help(?:\s+(?:me|users?|its\s+users?))?|help\s+me\s+use|your\s+(?:features|capabilities|limits?))\b/i
const IDENTITY_QUESTION = /^(?:(?:who|what)\s+(?:are|r)\s+you|what\s+(?:is|['’]s)\s+(?:schedme|this\s+(?:ai|assistant|bot|chatbot))|tell\s+me\s+about\s+(?:yourself|schedme)|are\s+you\s+(?:an?\s+)?(?:ai|assistant|bot|chatbot))(?:\s+exactly)?[!.?\s]*$/i
const PURPOSE_QUESTION = /^(?:what\s+(?:is|was|['’]s)\s+(?:(?:this|the)\s+)?(?:ai|assistant|bot|chatbot|it)\s+(?:made\s+)?for|what\s+(?:are|were)\s+you\s+made\s+for|what\s+(?:is|['’]s)\s+your\s+purpose|why\s+(?:were\s+you\s+made|do\s+i\s+need\s+you)|what\s+do\s+you\s+know\s+about\s+my\s+tasks?)[!.?\s]*$/i
const GENERAL_TASK_HELP = /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?help\s+me\s+(?:with|on)|i\s+need\s+help\s+(?:with|on)|help\s+me\s+(?:with|on))\s+(?:(?:a|my|this|the)\s+)?tasks?[!.?\s]*$/i

export function isSchedulingRelatedMessage(value) {
  const text = String(value || '').trim()
  return Boolean(text && (SCHEDULING_LANGUAGE.test(text) || TIME_LANGUAGE.test(text)))
}

function describeKnownTasks(tasks) {
  const safeTasks = Array.isArray(tasks) ? tasks.filter((task) => task && typeof task.title === 'string') : []
  const active = safeTasks.filter((task) => !task.completed)
  const scheduled = active.filter((task) => task.date && task.startTime && task.endTime)
  const completed = safeTasks.length - active.length
  if (!active.length) return completed
    ? `I currently see no active tasks and ${completed} completed ${completed === 1 ? 'task' : 'tasks'}.`
    : 'I currently see no active tasks yet.'
  const preview = active.slice(0, 3).map((task) => `“${task.title}”`).join(', ')
  const remaining = active.length - Math.min(active.length, 3)
  const titles = `${preview}${remaining ? `, and ${remaining} more` : ''}`
  return `I currently see ${active.length} active ${active.length === 1 ? 'task' : 'tasks'}: ${titles}. ${scheduled.length} ${scheduled.length === 1 ? 'is' : 'are'} scheduled and ${active.length - scheduled.length} ${active.length - scheduled.length === 1 ? 'is' : 'are'} unscheduled${completed ? `, with ${completed} completed` : ''}.`
}

function assistantPurpose(name, tasks, prefersConcise = false) {
  const identity = name.toLocaleLowerCase() === 'schedme'
    ? `I’m ${name}, a context-aware task and scheduling assistant.`
    : `I’m ${name}, SchedMe’s context-aware task and scheduling assistant.`
  const knownTasks = describeKnownTasks(tasks)
  if (prefersConcise) {
    return `${identity} ${knownTasks} I help you create, schedule, move, complete, prioritize, and color tasks; remember recent context and availability; find conflict-free time; confirm deletions; and undo changes.`
  }
  return `${identity} I was made to turn natural-language requests into safe, verified changes to your tasks and calendar. ${knownTasks} I can create and organize tasks; schedule, reschedule, bulk-move, or unschedule them; complete or reopen them; change priorities and colors; remember recent task context and availability; find free time; detect conflicts; confirm permanent deletions; and undo recent changes. I ask for clarification instead of guessing, and I stay focused on task and schedule planning.`
}

export function getConversationScopeResponse(value, assistantOptions = 'SchedMe') {
  const text = String(value || '').trim()
  const options = assistantOptions && typeof assistantOptions === 'object' ? assistantOptions : { assistantName: assistantOptions }
  const name = typeof options.assistantName === 'string' && options.assistantName.trim() ? options.assistantName.trim().slice(0, 32) : 'SchedMe'
  if (!text) return null
  if (IDENTITY_QUESTION.test(text) || PURPOSE_QUESTION.test(text) || CAPABILITY_QUESTION.test(text)) return assistantPurpose(name, options.tasks, options.prefersConcise === true)
  if (GENERAL_TASK_HELP.test(text)) return 'Of course. What would you like to do with the task—add it, schedule it, change its priority or color, mark it done, or delete it?'
  if (HOW_ARE_YOU.test(text)) return "I'm doing well—thanks for asking! How are you doing? You can tell me what’s on your mind, and when you’re ready, I’ll help turn it into a manageable plan."
  if (DIFFICULT_WELLBEING.test(text)) return "I’m sorry things feel heavy right now. You can tell me what’s on your mind or which tasks are weighing on you, and we’ll sort through them one step at a time."
  if (POSITIVE_WELLBEING.test(text)) return "I’m glad to hear that. Tell me what’s on your mind or what you’d like to get done, and we can shape it into a plan together."
  if (isSchedulingRelatedMessage(text)) return null
  if (GREETING.test(text)) return "Hi! I'm ready to help. What task would you like to schedule today?"
  if (THANKS.test(text)) return "You're welcome! What task would you like to plan next?"
  if (text.length < 3 || !/[a-z0-9]/i.test(text)) return "Sorry, I didn't quite understand. What task would you like to schedule today?"
  return "I’m focused on tasks and scheduling, so I can’t help with that request. I can help you add a task, choose a time, or organize your week."
}

