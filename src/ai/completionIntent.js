export function isTaskCompletionMessage(value) {
  const text = String(value || '').trim().toLocaleLowerCase()
  if (!text) return false
  return /\b(?:mark|set|make)\b.{0,50}\b(?:done|complete|completed)\b/i.test(text)
    || /\b(?:task|it|this|that|[a-z][a-z0-9'-]*)\s+(?:is|was|are)\s+(?:already\s+)?(?:done|complete|completed)\b/i.test(text)
    || /\b(?:i(?:'ve| have)?\s+)?(?:finished|completed|did)\b.{0,50}\b(?:task|it|this|that|[a-z][a-z0-9'-]*)\b/i.test(text)
    || /\b(?:done|finished)\s+with\b/i.test(text)
}
