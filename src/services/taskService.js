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
import { getTaskOrderField } from '../taskListOrder.js'

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

export function createTask(uid, title, category, alsoPriority = false, color = '', colorMode = 'automatic') {
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
    color: safeTaskColor(color),
    colorMode: colorMode === 'manual' ? 'manual' : 'automatic',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function createScheduledTask(uid, { title, date, startTime, endTime, category = 'notUrgent', alsoPriority = false, completed = false, color = '', colorMode = 'automatic' }) {
  const cleanedTitle = title.trim()
  if (!cleanedTitle || cleanedTitle.length > 240) throw new Error('Enter a task under 240 characters.')
  const normalizedCategory = ['urgent', 'important', 'notUrgent'].includes(category) ? category : 'notUrgent'
  const urgent = normalizedCategory === 'urgent' || (normalizedCategory === 'important' && alsoPriority)
  const important = normalizedCategory === 'important' || (normalizedCategory === 'urgent' && alsoPriority)
  return addDoc(tasksCollection(uid), {
    title: cleanedTitle,
    category: normalizedCategory,
    urgent,
    important,
    completed: Boolean(completed),
    date,
    startTime,
    endTime,
    color: safeTaskColor(color),
    colorMode: colorMode === 'manual' ? 'manual' : 'automatic',
    showInInbox: true,
    source: 'manual-calendar',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function updateScheduledTask(uid, taskId, { title, date, startTime, endTime, completed = false, color = '', colorMode = 'automatic', category = 'notUrgent' }) {
  const cleanedTitle = title.trim()
  if (!cleanedTitle || cleanedTitle.length > 240) throw new Error('Enter a task under 240 characters.')
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const normalizedCategory = ['urgent', 'important', 'notUrgent'].includes(category) ? category : 'notUrgent'
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    title: cleanedTitle,
    category: normalizedCategory,
    urgent: normalizedCategory === 'urgent',
    important: normalizedCategory === 'important',
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

export function updateTaskDetails(uid, taskId, { title, completed = false, color = '', colorMode = 'automatic', category = 'free', showInInbox = false, date = '', startTime = '', endTime = '' }) {
  const cleanedTitle = title.trim()
  if (!cleanedTitle || cleanedTitle.length > 240) throw new Error('Enter a task under 240 characters.')
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const scheduled = Boolean(date && startTime && endTime)
  const normalizedCategory = ['free', 'urgent', 'important', 'notUrgent'].includes(category) ? category : 'free'
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    title: cleanedTitle,
    category: normalizedCategory,
    urgent: normalizedCategory === 'urgent',
    important: normalizedCategory === 'important',
    completed: Boolean(completed),
    color: safeTaskColor(color),
    colorMode: colorMode === 'manual' ? 'manual' : 'automatic',
    showInInbox: Boolean(showInInbox),
    date: scheduled ? date : deleteField(),
    startTime: scheduled ? startTime : deleteField(),
    endTime: scheduled ? endTime : deleteField(),
    source: scheduled ? 'manual-task-editor' : deleteField(),
    updatedAt: serverTimestamp(),
  })
}

export function setTaskCompleted(uid, taskId, completed) {
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    completed,
    updatedAt: serverTimestamp(),
  })
}

export function setTasksCompleted(uid, taskIds, completed) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const uniqueTaskIds = [...new Set(Array.isArray(taskIds) ? taskIds.filter((taskId) => typeof taskId === 'string' && taskId) : [])]
  if (!uniqueTaskIds.length) return Promise.resolve()
  if (uniqueTaskIds.length > 500) throw new Error('Update up to 500 tasks at a time.')
  const batch = writeBatch(db)
  for (const taskId of uniqueTaskIds) {
    batch.update(doc(db, 'users', uid, 'tasks', taskId), {
      completed: Boolean(completed),
      updatedAt: serverTimestamp(),
    })
  }
  return batch.commit()
}

export function setTaskPriority(uid, taskId, category, alsoPriority = false) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const normalizedCategory = ['free', 'urgent', 'important', 'notUrgent'].includes(category) ? category : 'free'
  const urgent = normalizedCategory === 'urgent' || (normalizedCategory === 'important' && alsoPriority)
  const important = normalizedCategory === 'important' || (normalizedCategory === 'urgent' && alsoPriority)
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    category: normalizedCategory,
    urgent,
    important,
    updatedAt: serverTimestamp(),
  })
}

export function setTasksPriority(uid, taskIds, category, alsoPriority = false) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const uniqueTaskIds = [...new Set(Array.isArray(taskIds) ? taskIds.filter((taskId) => typeof taskId === 'string' && taskId) : [])]
  if (!uniqueTaskIds.length) return Promise.resolve()
  if (uniqueTaskIds.length > 500) throw new Error('Update up to 500 tasks at a time.')
  const normalizedCategory = ['free', 'urgent', 'important', 'notUrgent'].includes(category) ? category : 'free'
  const urgent = normalizedCategory === 'urgent' || (normalizedCategory === 'important' && alsoPriority)
  const important = normalizedCategory === 'important' || (normalizedCategory === 'urgent' && alsoPriority)
  const batch = writeBatch(db)
  for (const taskId of uniqueTaskIds) {
    batch.update(doc(db, 'users', uid, 'tasks', taskId), {
      category: normalizedCategory,
      urgent,
      important,
      updatedAt: serverTimestamp(),
    })
  }
  return batch.commit()
}

export function setTaskListOrder(uid, groupId, taskIds) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const uniqueTaskIds = [...new Set(Array.isArray(taskIds) ? taskIds.filter((taskId) => typeof taskId === 'string' && taskId) : [])]
  if (!uniqueTaskIds.length) return Promise.resolve()
  if (uniqueTaskIds.length > 500) throw new Error('Reorder up to 500 tasks at a time.')
  const orderField = getTaskOrderField(groupId)
  const batch = writeBatch(db)
  uniqueTaskIds.forEach((taskId, index) => {
    batch.update(doc(db, 'users', uid, 'tasks', taskId), {
      [orderField]: index,
      updatedAt: serverTimestamp(),
    })
  })
  return batch.commit()
}

export function moveTaskToPriorityList(uid, taskId, targetGroup, orderedTaskIds) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const uniqueTaskIds = [...new Set(Array.isArray(orderedTaskIds) ? orderedTaskIds.filter((id) => typeof id === 'string' && id) : [])]
  if (!taskId || !uniqueTaskIds.includes(taskId)) throw new Error('The task move is invalid.')
  if (uniqueTaskIds.length > 500) throw new Error('Move among up to 500 tasks at a time.')
  const normalizedCategory = ['free', 'urgent', 'important', 'notUrgent'].includes(targetGroup) ? targetGroup : 'free'
  const orderField = getTaskOrderField(normalizedCategory)
  const movedIndex = uniqueTaskIds.indexOf(taskId)
  const batch = writeBatch(db)
  batch.update(doc(db, 'users', uid, 'tasks', taskId), {
    category: normalizedCategory,
    urgent: normalizedCategory === 'urgent',
    important: normalizedCategory === 'important',
    [orderField]: movedIndex,
    updatedAt: serverTimestamp(),
  })
  uniqueTaskIds.forEach((orderedTaskId, index) => {
    if (orderedTaskId === taskId) return
    batch.update(doc(db, 'users', uid, 'tasks', orderedTaskId), {
      [orderField]: index,
      updatedAt: serverTimestamp(),
    })
  })
  return batch.commit()
}

export function setTaskColor(uid, taskId, color, colorMode = 'manual') {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  return updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    color: safeTaskColor(color),
    colorMode: colorMode === 'manual' ? 'manual' : 'automatic',
    updatedAt: serverTimestamp(),
  })
}

export function deleteTask(uid, taskId) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  return deleteDoc(doc(db, 'users', uid, 'tasks', taskId))
}

export function deleteTasks(uid, taskIds) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  const uniqueTaskIds = [...new Set(Array.isArray(taskIds) ? taskIds.filter((taskId) => typeof taskId === 'string' && taskId) : [])]
  if (!uniqueTaskIds.length) return Promise.resolve()
  if (uniqueTaskIds.length > 500) throw new Error('Delete up to 500 tasks at a time.')
  const batch = writeBatch(db)
  for (const taskId of uniqueTaskIds) batch.delete(doc(db, 'users', uid, 'tasks', taskId))
  return batch.commit()
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

export function moveScheduledTasks(uid, taskMoves) {
  if (!db || !uid) throw new Error('Your task storage is not configured yet.')
  if (!Array.isArray(taskMoves) || taskMoves.length === 0) return Promise.resolve()
  if (taskMoves.length > 500) throw new Error('Move up to 500 tasks at a time.')
  const batch = writeBatch(db)
  for (const move of taskMoves) {
    if (!move?.taskId || !/^\d{4}-\d{2}-\d{2}$/.test(move.date || '')) throw new Error('One of the requested task moves is invalid.')
    batch.update(doc(db, 'users', uid, 'tasks', move.taskId), {
      date: move.date,
      source: 'user-directed-bulk-move',
      updatedAt: serverTimestamp(),
    })
  }
  return batch.commit()
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
