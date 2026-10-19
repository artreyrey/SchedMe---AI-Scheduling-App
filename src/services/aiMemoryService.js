import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config.js'

export const DEFAULT_AI_MEMORY = Object.freeze({
  chatbotName: 'SchedMe',
  mood: 'calm',
  preferences: [],
  defaultDuration: 60,
  greetingStyle: 'friendly',
})

export const AI_MOODS = Object.freeze(['calm', 'encouraging', 'focused', 'playful'])
const MAX_PREFERENCES = 20
const MAX_PREFERENCE_LENGTH = 240

function memoryDocument(uid) {
  if (!db || !uid) throw new Error('Your saved AI profile needs Firebase and a signed-in account.')
  return doc(db, 'users', uid)
}

function normalizeMemory(value) {
  return {
    chatbotName: typeof value?.chatbotName === 'string' ? value.chatbotName.trim().slice(0, 32) || DEFAULT_AI_MEMORY.chatbotName : DEFAULT_AI_MEMORY.chatbotName,
    mood: AI_MOODS.includes(value?.mood) ? value.mood : DEFAULT_AI_MEMORY.mood,
    preferences: Array.isArray(value?.preferences)
      ? [...new Set(value.preferences.filter((item) => typeof item === 'string').map((item) => item.trim().slice(0, MAX_PREFERENCE_LENGTH)).filter(Boolean))].slice(0, MAX_PREFERENCES)
      : [],
    defaultDuration: [30, 45, 60, 90, 120].includes(Number(value?.defaultDuration)) ? Number(value.defaultDuration) : DEFAULT_AI_MEMORY.defaultDuration,
    greetingStyle: ['friendly', 'short', 'direct'].includes(value?.greetingStyle) ? value.greetingStyle : DEFAULT_AI_MEMORY.greetingStyle,
  }
}

export function subscribeToAiMemory(uid, onMemory, onError) {
  try {
    return onSnapshot(memoryDocument(uid), (snapshot) => {
      onMemory(normalizeMemory(snapshot.data()?.aiMemory))
    }, onError)
  } catch (error) {
    onError(error)
    return () => {}
  }
}

export function saveAiMemory(uid, memory, username) {
  const normalized = normalizeMemory(memory)
  return setDoc(memoryDocument(uid), {
    ...(username ? { username } : {}),
    aiMemory: normalized,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export function addPromptToAiMemory(uid, prompt, memory, username) {
  const cleanedPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, MAX_PREFERENCE_LENGTH) : ''
  if (!cleanedPrompt) throw new Error('There is no prompt to remember.')
  const preferences = normalizeMemory(memory).preferences
  if (!preferences.some((item) => item.toLocaleLowerCase() === cleanedPrompt.toLocaleLowerCase())) {
    if (preferences.length >= MAX_PREFERENCES) throw new Error('AI memory is full. Remove an old preference before saving another.')
    preferences.push(cleanedPrompt)
  }
  return saveAiMemory(uid, { ...normalizeMemory(memory), preferences }, username)
}

export function forgetAiPreference(uid, prompt, memory, username) {
  const preferences = normalizeMemory(memory).preferences.filter((item) => item !== prompt)
  return saveAiMemory(uid, { ...normalizeMemory(memory), preferences }, username)
}
