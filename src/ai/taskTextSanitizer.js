const STRUCTURED_FIELD = /["'“”]?(date|startTime|endTime|category|completed|color)["'“”]?\s*(?::|\bis\b)/gi
const STRUCTURED_MARKER = /(?:\r?\n|\\n|,)\s*["'“”]?(?:date|startTime|endTime|category|completed|color)["'“”]?\s*(?::|\bis\b)/gi

function structuredSuffixStart(value) {
  for (const match of value.matchAll(STRUCTURED_MARKER)) {
    const suffix = value.slice(match.index)
    const fields = new Set([...suffix.matchAll(STRUCTURED_FIELD)].map((item) => item[1].toLocaleLowerCase()))
    if (fields.size >= 2) return match.index
  }
  return -1
}

export function sanitizeTaskTitle(value) {
  let title = String(value || '').replace(/```(?:json)?/gi, '').trim()
  const objectTitle = title.match(/^\s*\{?\s*["'“”]?title["'“”]?\s*:\s*["'“”]([^\r\n"'“”]{1,240})/i)
  if (objectTitle) title = objectTitle[1]
  const suffixStart = structuredSuffixStart(title)
  if (suffixStart >= 0) title = title.slice(0, suffixStart)
  return title
    .replace(/^[\s"'“”‘’{[]+|[\s"'“”‘’}\],;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

export function sanitizeAssistantTaskText(value) {
  const text = String(value || '')
  return text.replace(
    /(Done[—-]\s*[“"])([\s\S]*?)([”"]\s+(?:was created|was added|is scheduled|is marked|is active|is now|now uses|was removed))/gi,
    (whole, opening, rawTitle, ending) => {
      const title = sanitizeTaskTitle(rawTitle)
      return title ? `${opening}${title}${ending}` : whole
    },
  )
}
