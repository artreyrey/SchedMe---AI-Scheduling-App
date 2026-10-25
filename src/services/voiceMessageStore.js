const DATABASE_NAME = 'schedme-voice-messages'
const STORE_NAME = 'recordings'

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Local voice storage is unavailable.'))
      return
    }
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      store.createIndex('ownerId', 'ownerId')
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function voiceKey(ownerId, voiceId) {
  return `${ownerId}:${voiceId}`
}

export async function saveVoiceMessage(ownerId, voiceId, blob) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ key: voiceKey(ownerId, voiceId), ownerId, blob, savedAt: Date.now() })
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error) }
  })
}

export async function loadVoiceMessage(ownerId, voiceId) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(voiceKey(ownerId, voiceId))
    request.onsuccess = () => resolve(request.result?.blob || null)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
  })
}

export async function deleteUserVoiceMessages(ownerId) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).index('ownerId').openCursor(IDBKeyRange.only(ownerId))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error) }
  })
}
