const ORDER_FIELDS = {
  free: 'orderFree',
  urgent: 'orderUrgent',
  important: 'orderImportant',
  notUrgent: 'orderFlexible',
}

export function getTaskOrderField(groupId) {
  return ORDER_FIELDS[groupId] || ORDER_FIELDS.free
}

export function sortTasksForGroup(tasks, groupId) {
  const field = getTaskOrderField(groupId)
  return tasks
    .map((task, originalIndex) => ({ task, originalIndex }))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.task[field]) ? left.task[field] : null
      const rightOrder = Number.isFinite(right.task[field]) ? right.task[field] : null
      if (leftOrder !== null && rightOrder !== null) return leftOrder - rightOrder || left.originalIndex - right.originalIndex
      if (leftOrder === null && rightOrder !== null) return -1
      if (leftOrder !== null && rightOrder === null) return 1
      return left.originalIndex - right.originalIndex
    })
    .map(({ task }) => task)
}

export function planTaskListDrop(tasks, taskId, targetTaskId = '', position = 'after') {
  const ordered = tasks.filter((task) => task.id !== taskId)
  const targetIndex = targetTaskId ? ordered.findIndex((task) => task.id === targetTaskId) : -1
  const insertAt = targetIndex < 0 ? ordered.length : targetIndex + (position === 'after' ? 1 : 0)
  const movingTask = tasks.find((task) => task.id === taskId) || { id: taskId }
  ordered.splice(insertAt, 0, movingTask)
  return ordered.map((task) => task.id)
}
