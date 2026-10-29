import { after, before, beforeEach, describe, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { readFile } from 'node:fs/promises'

const emulatorConfigured = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const projectId = 'demo-schedme'
let testEnvironment

function timestamp(milliseconds = 1_700_000_000_000) {
  return Timestamp.fromMillis(milliseconds)
}

function validTask(overrides = {}) {
  return {
    title: 'Security review',
    category: 'important',
    urgent: false,
    important: true,
    completed: false,
    color: '#884466',
    colorMode: 'manual',
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  }
}

function validOperation(operationId, overrides = {}) {
  return {
    type: 'task-update',
    description: 'Updated one task',
    requestId: operationId,
    previousOperationId: null,
    changes: [{ taskId: 'task-1', before: null, after: validTask() }],
    undone: false,
    committedAt: timestamp(),
    ...overrides,
  }
}

function validProfile() {
  return {
    username: 'SchedMe user',
    aiMemory: {
      chatbotName: 'SchedMe',
      mood: 'calm',
      preferences: ['Keep replies concise'],
      defaultDuration: 60,
      greetingStyle: 'friendly',
    },
    updatedAt: timestamp(),
  }
}

function authenticatedDatabase(userId, emailVerified = true) {
  return testEnvironment.authenticatedContext(userId, {
    email: `${userId}@example.test`,
    email_verified: emailVerified,
  }).firestore()
}

describe('Firestore security rules', { skip: !emulatorConfigured }, () => {
  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId,
      firestore: {
        rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
      },
    })
  })

  beforeEach(async () => {
    await testEnvironment.clearFirestore()
  })

  after(async () => {
    await testEnvironment?.cleanup()
  })

  test('allows an owner to create and read a valid task', async () => {
    const database = authenticatedDatabase('alice')
    const taskReference = doc(database, 'users/alice/tasks/task-1')

    await assertSucceeds(setDoc(taskReference, validTask()))
    await assertSucceeds(getDoc(taskReference))
  })

  test('denies anonymous and cross-user access', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice/tasks/task-1'), validTask())
    })

    const anonymousReference = doc(
      testEnvironment.unauthenticatedContext().firestore(),
      'users/alice/tasks/task-1',
    )
    const otherUserReference = doc(
      authenticatedDatabase('bob'),
      'users/alice/tasks/task-1',
    )

    await assertFails(getDoc(anonymousReference))
    await assertFails(getDoc(otherUserReference))
    await assertFails(setDoc(otherUserReference, validTask()))
  })

  test('rejects unknown task fields and malformed schedules', async () => {
    const database = authenticatedDatabase('alice')

    await assertFails(setDoc(
      doc(database, 'users/alice/tasks/unknown-field'),
      validTask({ admin: true }),
    ))
    await assertFails(setDoc(
      doc(database, 'users/alice/tasks/bad-date'),
      validTask({ date: 'tomorrow', startTime: '09:00', endTime: '10:00' }),
    ))
    await assertFails(setDoc(
      doc(database, 'users/alice/tasks/bad-range'),
      validTask({ date: '2026-10-30', startTime: '10:00', endTime: '09:00' }),
    ))
  })

  test('keeps a task creation timestamp immutable', async () => {
    const database = authenticatedDatabase('alice')
    const taskReference = doc(database, 'users/alice/tasks/task-1')
    await assertSucceeds(setDoc(taskReference, validTask()))

    await assertFails(updateDoc(taskReference, { createdAt: timestamp(1_800_000_000_000) }))
    await assertSucceeds(updateDoc(taskReference, {
      completed: true,
      updatedAt: timestamp(1_800_000_000_000),
    }))
  })

  test('validates profile fields and denies deleting the profile document', async () => {
    const database = authenticatedDatabase('alice')
    const profileReference = doc(database, 'users/alice')

    await assertSucceeds(setDoc(profileReference, validProfile()))
    await assertFails(updateDoc(profileReference, { unexpectedRole: 'admin' }))
    await assertFails(deleteDoc(profileReference))
  })

  test('denies unknown nested collections', async () => {
    const database = authenticatedDatabase('alice')
    await assertFails(setDoc(
      doc(database, 'users/alice/privateNotes/note-1'),
      { text: 'not an approved schema' },
    ))
  })

  test('allows only the valid undo transition on operation history', async () => {
    const database = authenticatedDatabase('alice')
    const operationId = 'operation-1'
    const operationReference = doc(database, `users/alice/operations/${operationId}`)

    await assertSucceeds(setDoc(operationReference, validOperation(operationId)))
    await assertFails(updateDoc(operationReference, { description: 'tampered' }))
    await assertSucceeds(updateDoc(operationReference, {
      undone: true,
      undoneAt: timestamp(1_800_000_000_000),
    }))
    await assertFails(updateDoc(operationReference, { undone: false }))
    await assertFails(deleteDoc(operationReference))
  })

  test('denies an owner whose email is not verified', async () => {
    const database = authenticatedDatabase('alice', false)

    await assertFails(setDoc(
      doc(database, 'users/alice/tasks/task-1'),
      validTask(),
    ))
    await assertFails(setDoc(doc(database, 'users/alice'), validProfile()))
  })
})
