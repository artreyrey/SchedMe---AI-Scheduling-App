import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config.js'

const MAX_SAVED_MESSAGES = 120

export const EMPTY_SCHEDULING_STATE = Object.freeze({
  activeTaskId: null,
  mode: 'schedule',
  date: '',
  startTime: '',
  endTime: '',
  queueMode: false,
  deferredTaskIds: [],
  pendingConflict: null,
  pendingDeletionTaskId: null,
  lastAction: null,
  lastGreetingDate: '',
})

export const DEFAULT_INTERACTION_PROFILE = Object.freeze({
  messageCount: 0,
  compactCommandCount: 0,
  averageMessageLength: 0,
  prefersConcise: false,
})

function userDocument(uid) {
  if (!db || !uid) throw new Error('Conversation history needs Firebase and a signed-in account.')
  return doc(db, 'users', uid)
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeSchedulingState(value) {
  return {
    ...EMPTY_SCHEDULING_STATE,
    ...(value && typeof value === 'object' ? value : {}),
    deferredTaskIds: Array.isArray(value?.deferredTaskIds) ? value.deferredTaskIds.filter((item) => typeof item === 'string').slice(0, 100) : [],
    pendingConflict: value?.pendingConflict && typeof value.pendingConflict === 'object' ? value.pendingConflict : null,
    pendingDeletionTaskId: typeof value?.pendingDeletionTaskId === 'string' ? value.pendingDeletionTaskId : null,
    lastAction: value?.lastAction && typeof value.lastAction === 'object' ? value.lastAction : null,
  }
}

function normalizeInteractionProfile(value) {
  return {
    messageCount: Number.isFinite(value?.messageCount) ? Math.max(0, value.messageCount) : 0,
    compactCommandCount: Number.isFinite(value?.compactCommandCount) ? Math.max(0, value.compactCommandCount) : 0,
    averageMessageLength: Number.isFinite(value?.averageMessageLength) ? Math.max(0, value.averageMessageLength) : 0,
    prefersConcise: value?.prefersConcise === true,
  }
}

export function subscribeToConversation(uid, onConversation, onError) {
  try {
    return onSnapshot(userDocument(uid), (snapshot) => {
      const data = snapshot.data() || {}
      const schedulingState = normalizeSchedulingState(data.schedulingState)
      if (typeof data.lastGreetingDate === 'string' && data.lastGreetingDate) schedulingState.lastGreetingDate = data.lastGreetingDate
      onConversation({
        messages: Array.isArray(data.chatHistory) ? data.chatHistory.slice(-MAX_SAVED_MESSAGES) : [],
        schedulingState,
        interactionProfile: normalizeInteractionProfile(data.interactionProfile),
      })
    }, onError)
  } catch (error) {
    onError(error)
    return () => {}
  }
}

export function saveConversation(uid, messages, schedulingState, interactionProfile) {
  const normalizedState = normalizeSchedulingState(schedulingState)
  const safeMessages = jsonSafe(messages.slice(-MAX_SAVED_MESSAGES).map(({ role, text, plan, planApplied, kind, date }) => ({
    role: role === 'user' ? 'user' : 'model',
    text: String(text || '').slice(0, 4000),
    ...(plan ? { plan } : {}),
    ...(planApplied ? { planApplied: true } : {}),
    ...(kind === 'daily-greeting' ? { kind } : {}),
    ...(kind === 'daily-greeting' && /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? { date } : {}),
  })))
  return setDoc(userDocument(uid), {
    chatHistory: safeMessages,
    schedulingState: jsonSafe(normalizedState),
    lastGreetingDate: normalizedState.lastGreetingDate,
    interactionProfile: jsonSafe(normalizeInteractionProfile(interactionProfile)),
    conversationUpdatedAt: serverTimestamp(),
  }, { merge: true })
}

export function clearConversation(uid, lastGreetingDate = '') {
  return setDoc(userDocument(uid), {
    chatHistory: [],
    schedulingState: { ...EMPTY_SCHEDULING_STATE, lastGreetingDate },
    lastGreetingDate,
    conversationUpdatedAt: serverTimestamp(),
  }, { merge: true })
}

export function learnInteractionStyle(profile, message, isCompactCommand) {
  const current = normalizeInteractionProfile(profile)
  const messageCount = current.messageCount + 1
  const averageMessageLength = ((current.averageMessageLength * current.messageCount) + message.trim().length) / messageCount
  const compactCommandCount = current.compactCommandCount + (isCompactCommand ? 1 : 0)
  return {
    messageCount,
    compactCommandCount,
    averageMessageLength: Math.round(averageMessageLength * 10) / 10,
    prefersConcise: compactCommandCount >= 2 || (messageCount >= 4 && averageMessageLength < 42),
  }
}
