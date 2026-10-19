export function prepareDailyGreetingHistory(messages, greetingText, today) {
  let hasTodayGreeting = false
  let changed = false
  const prepared = []

  for (const message of messages) {
    const isTaggedToday = message.kind === 'daily-greeting' && message.date === today
    const isLegacyTodayGreeting = message.role === 'model' && message.text === greetingText
    if (!isTaggedToday && !isLegacyTodayGreeting) {
      prepared.push(message)
      continue
    }

    if (hasTodayGreeting) {
      changed = true
      continue
    }

    hasTodayGreeting = true
    if (isTaggedToday) prepared.push(message)
    else {
      prepared.push({ ...message, kind: 'daily-greeting', date: today })
      changed = true
    }
  }

  return { messages: prepared, hasTodayGreeting, changed }
}

export function preserveGreetingDate(nextState, currentState, sessionGreetingDate = '') {
  return {
    ...nextState,
    lastGreetingDate: nextState.lastGreetingDate || currentState.lastGreetingDate || sessionGreetingDate || '',
  }
}
