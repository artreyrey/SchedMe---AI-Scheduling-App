function normalizedComparable(value) {
  if (value === null || value === undefined) return value
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (Array.isArray(value)) return value.map(normalizedComparable)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'updatedAt')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizedComparable(item)]))
  }
  return value
}

export function taskDocumentsMatch(left, right) {
  return JSON.stringify(normalizedComparable(left)) === JSON.stringify(normalizedComparable(right))
}

export function validateUndoSnapshots(changes, currentDocuments) {
  for (const change of changes) {
    const current = currentDocuments.get(change.taskId) ?? null
    if (!taskDocumentsMatch(current, change.after)) return false
  }
  return true
}
