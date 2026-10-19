import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc,
  writeBatch,
  deleteField,
  deleteDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config.js'

function tasksCollection(uid) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  return collection(db, 'users', uid, 'tasks')
}

function safeTaskColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : ''
}

export function subscribeToTasks(uid, onTasks, onError) {
  try {
    return onSnapshot(query(tasksCollection(uid), orderBy('createdAt', 'desc')), (snapshot) => {
      onTasks(snapshot.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() })))
    }, onError)
  } catch (error) {
    onError(error)
    return () => {}
  }
}

export function createTask(uid, title, category, alsoPriority = false) {
  const cleanedTitle = title.trim()
  if (!cleanedTitle || cleanedTitle.length > 240) throw new Error('Enter a task under 240 characters.')
  const urgent = category === 'urgent' || (category === 'important' && alsoPriority)
  const important = category === 'important' || (category === 'urgent' && alsoPriority)
  return addDoc(tasksCollection(uid), {
    title: cleanedTitle,
    category,
    urgent,
    important,
    completed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function createScheduledTask(uid, { title, date, startTime, endTime, completed = false, color = '', colorMode = 'automatic' }) {
  const cleanedTitle = title.trim()
  if (!cleanedTitle || cleanedTitle.length > 240) throw new Error('Enter a task under 240 characters.')
  return addDoc(tasksCollection(uid), {
    title: cleanedTitle,
    category: 'notUrgent',
    urgent: false,
    important: false,
    completed: Boolean(completed),
    date,
    startTime,
    endTime,
    color: safeTaskColor(color),
    colorMode: colorMode === 'manual' ? 'manual' : 'automatic',
    source: 'manual-calendar',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function updateScheduledTask(uid, taskId, { title, date, startTime, endTime, completed = false, color = '', colorMode = 'automatic' }) {
  const cleanedTitle = title.trim()
  if (!cleanedTitle || cleanedTitle.length > 240) throw new Error('Enter a task under 240 characters.')
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    title: cleanedTitle,
    date,
    startTime,
    endTime,
    color: safeTaskColor(color),
    colorMode: colorMode === 'manual' ? 'manual' : 'automatic',
    completed: Boolean(completed),
    source: 'manual-calendar',
    updatedAt: serverTimestamp(),
  })
}

export function setTaskCompleted(uid, taskId, completed) {
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    completed,
    updatedAt: serverTimestamp(),
  })
}

export function deleteTask(uid, taskId) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  return deleteDoc(doc(db, 'users', uid, 'tasks', taskId))
}

export function scheduleTask(uid, taskId, { date, startTime, endTime }) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    date,
    startTime,
    endTime,
    source: 'user-directed-schedule',
    updatedAt: serverTimestamp(),
  })
}

export function unscheduleTask(uid, taskId, { returnToInbox = true } = {}) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    date: deleteField(),
    startTime: deleteField(),
    endTime: deleteField(),
    source: deleteField(),
    ...(returnToInbox ? { category: 'free', urgent: false, important: false } : {}),
    updatedAt: serverTimestamp(),
  })
}

export function replaceScheduledTask(uid, incomingTaskId, displacedTaskId, slot) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const batch = writeBatch(db)
  batch.update(doc(db, 'users', uid, 'tasks', incomingTaskId), {
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    source: 'user-directed-schedule',
    updatedAt: serverTimestamp(),
  })
  batch.update(doc(db, 'users', uid, 'tasks', displacedTaskId), {
    date: deleteField(),
    startTime: deleteField(),
    endTime: deleteField(),
    source: deleteField(),
    category: 'free',
    urgent: false,
    important: false,
    updatedAt: serverTimestamp(),
  })
  return batch.commit()
}

export function applyAiPlanning(uid, taskUpdates, scheduleProposal) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const batch = writeBatch(db)
  const priorityByTask = new Map(taskUpdates.map((item) => [item.taskId, item]))
  const scheduleByTask = new Map(scheduleProposal.map((item) => [item.taskId, item]))
  const taskIds = new Set([...priorityByTask.keys(), ...scheduleByTask.keys()])
  for (const taskId of taskIds) {
    const priority = priorityByTask.get(taskId)
    const schedule = scheduleByTask.get(taskId)
    const category = priority ? priority.urgent ? 'urgent' : priority.important ? 'important' : 'notUrgent' : null
    batch.update(doc(db, 'users', uid, 'tasks', taskId), {
      ...(priority ? { urgent: priority.urgent, important: priority.important, category } : {}),
      ...(schedule ? { date: schedule.date, startTime: schedule.startTime, endTime: schedule.endTime } : {}),
      source: 'user-approved-ai-plan',
      updatedAt: serverTimestamp(),
    })
  }
  return batch.commit()
}
