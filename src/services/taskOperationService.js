import { collection, doc, runTransaction, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { validateUndoSnapshots } from './operationHistory.js'

function taskDocument(uid, taskId) {
  return doc(db, 'users', uid, 'tasks', taskId)
}

function operationDocument(uid, operationId) {
  return doc(db, 'users', uid, 'operations', operationId)
}

function userDocument(uid) {
  return doc(db, 'users', uid)
}

function withoutId(value) {
  if (!value || typeof value !== 'object') return null
  const { id, ...data } = value
  return data
}

function operationError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function newOperationRequestId(prefix = 'action') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`.slice(0, 180)
}

export async function commitTaskOperation(uid, { requestId, type, changes, description = '' }) {
  if (!db || !uid) throw new Error('Task operations need Firebase and a signed-in account.')
  if (!requestId || !Array.isArray(changes) || !changes.length) throw new Error('The task operation is incomplete.')
  if (changes.length > 20) throw new Error('Update up to 20 tasks in one assistant action.')
  const operationRef = operationDocument(uid, requestId)
  const userRef = userDocument(uid)
  const uniqueIds = [...new Set(changes.map((change) => change?.taskId).filter(Boolean))]
  if (uniqueIds.length !== changes.length) throw new Error('The task operation contains duplicate or missing task IDs.')

  return runTransaction(db, async (transaction) => {
    const existingOperation = await transaction.get(operationRef)
    if (existingOperation.exists()) return { duplicate: true, operation: { id: existingOperation.id, ...existingOperation.data() } }

    const [userSnapshot, ...taskSnapshots] = await Promise.all([
      transaction.get(userRef),
      ...uniqueIds.map((taskId) => transaction.get(taskDocument(uid, taskId))),
    ])
    const now = Timestamp.now()
    const recordedChanges = []

    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index]
      const taskRef = taskDocument(uid, change.taskId)
      const snapshot = taskSnapshots[index]
      const before = snapshot.exists() ? snapshot.data() : null
      let after = null
      if (change.kind === 'create') {
        if (before) throw operationError('operation/task-already-exists', 'That task was already created.')
        after = { ...withoutId(change.data), createdAt: change.data?.createdAt || now, updatedAt: now }
        transaction.set(taskRef, after)
      } else if (change.kind === 'update') {
        if (!before) throw operationError('operation/task-not-found', 'The task changed or no longer exists.')
        const removeFields = new Set(Array.isArray(change.removeFields) ? change.removeFields : [])
        after = Object.fromEntries(Object.entries({ ...before, ...withoutId(change.data), updatedAt: now }).filter(([key]) => !removeFields.has(key)))
        transaction.set(taskRef, after)
      } else if (change.kind === 'delete') {
        if (!before) throw operationError('operation/task-not-found', 'The task was already deleted.')
        transaction.delete(taskRef)
      } else {
        throw new Error('The task operation contains an unsupported change.')
      }
      recordedChanges.push({ taskId: change.taskId, before, after })
    }

    const previousOperationId = userSnapshot.data()?.operationHeadId || null
    const operation = {
      type: String(type || 'task-update').slice(0, 40),
      description: String(description || '').slice(0, 300),
      requestId,
      previousOperationId,
      changes: recordedChanges,
      undone: false,
      committedAt: now,
    }
    transaction.set(operationRef, operation)
    transaction.set(userRef, { operationHeadId: requestId, operationUpdatedAt: now }, { merge: true })
    return { duplicate: false, operation: { id: requestId, ...operation } }
  })
}

export async function undoLastTaskOperation(uid) {
  if (!db || !uid) throw new Error('Undo needs Firebase and a signed-in account.')
  return runTransaction(db, async (transaction) => {
    const userRef = userDocument(uid)
    const userSnapshot = await transaction.get(userRef)
    const operationId = userSnapshot.data()?.operationHeadId
    if (!operationId) throw operationError('operation/nothing-to-undo', 'There is no recent assistant action to undo.')
    const operationRef = operationDocument(uid, operationId)
    const operationSnapshot = await transaction.get(operationRef)
    if (!operationSnapshot.exists() || operationSnapshot.data().undone) throw operationError('operation/nothing-to-undo', 'There is no recent assistant action to undo.')
    const operation = operationSnapshot.data()
    const taskSnapshots = await Promise.all(operation.changes.map((change) => transaction.get(taskDocument(uid, change.taskId))))
    const now = Timestamp.now()

    const currentDocuments = new Map(operation.changes.map((change, index) => [
      change.taskId,
      taskSnapshots[index].exists() ? taskSnapshots[index].data() : null,
    ]))
    if (!validateUndoSnapshots(operation.changes, currentDocuments)) {
      throw operationError('operation/undo-conflict', 'A task changed after that action, so undo was stopped to protect the newer edit.')
    }

    operation.changes.forEach((change) => {
      const taskRef = taskDocument(uid, change.taskId)
      if (change.before === null) transaction.delete(taskRef)
      else transaction.set(taskRef, { ...change.before, updatedAt: now })
    })
    transaction.update(operationRef, { undone: true, undoneAt: now })
    transaction.set(userRef, {
      operationHeadId: operation.previousOperationId || null,
      operationUpdatedAt: now,
    }, { merge: true })
    return { id: operationId, ...operation }
  })
}

export function createTaskDocumentId(uid) {
  if (!db || !uid) throw new Error('Task creation needs Firebase and a signed-in account.')
  return doc(collection(db, 'users', uid, 'tasks')).id
}
