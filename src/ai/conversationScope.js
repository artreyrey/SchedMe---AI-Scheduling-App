const SCHEDULING_LANGUAGE = /\b(?:task|tasks|todo|schedule|scheduled|scheduling|calendar|plan|planning|planner|time|timeslot|availability|available|busy|free|deadline|appointment|meeting|event|reminder|remind|today|tomorrow|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|reschedule|move|cancel|delete|remove|complete|completed|done|finish|finished|urgent|important|priority|priorities|classify|classification|color|colour)\b/i
const TIME_LANGUAGE = /\b(?:[01]?\d(?::[0-5]\d)?\s*(?:am|pm)|[01]?\d(?::[0-5]\d)?\s*(?:-|–|—|to)\s*[01]?\d(?::[0-5]\d)?\s*(?:am|pm))\b/i
const GREETING = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you)[!.?\s]*$/i
const THANKS = /^(?:thanks|thank\s+you|thank\s+you\s+so\s+much|great|awesome)[!.?\s]*$/i
const CAPABILITY_QUESTION = /\b(?:what\s+can\s+you\s+do|how\s+can\s+you\s+help|help\s+me\s+use|your\s+features|your\s+limits?)\b/i
const GENERAL_TASK_HELP = /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?help\s+me\s+(?:with|on)|i\s+need\s+help\s+(?:with|on)|help\s+me\s+(?:with|on))\s+(?:(?:a|my|this|the)\s+)?tasks?[!.?\s]*$/i

export function isSchedulingRelatedMessage(value) {
  const text = String(value || '').trim()
  return Boolean(text && (SCHEDULING_LANGUAGE.test(text) || TIME_LANGUAGE.test(text)))
}

export function getConversationScopeResponse(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (GENERAL_TASK_HELP.test(text)) return 'Of course. What would you like to do with the task—add it, schedule it, change its priority or color, mark it done, or delete it?'
  if (isSchedulingRelatedMessage(text)) return null
  if (GREETING.test(text)) return "Hi! I'm ready to help. What task would you like to schedule today?"
  if (THANKS.test(text)) return "You're welcome! What task would you like to plan next?"
  if (CAPABILITY_QUESTION.test(text)) return "I can add, schedule, reschedule, classify, complete, or delete tasks. Try: “Schedule thesis tomorrow from 2–3 PM.”"
  if (text.length < 3 || !/[a-z0-9]/i.test(text)) return "Sorry, I didn't quite understand. What task would you like to schedule today?"
  return "I’m focused on tasks and scheduling, so I can’t help with that request. I can help you add a task, choose a time, or organize your week."
}

