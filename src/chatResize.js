export const CHAT_RESIZE_DIRECTIONS = Object.freeze(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])
export const CHAT_POPUP_MARGIN = 12

export function chatSizeLimits(viewport) {
  const maximumWidth = Math.max(1, viewport.width - (CHAT_POPUP_MARGIN * 2))
  const maximumHeight = Math.max(1, viewport.height - (CHAT_POPUP_MARGIN * 2))
  return {
    minimumWidth: Math.min(300, maximumWidth),
    minimumHeight: Math.min(360, maximumHeight),
    maximumWidth,
    maximumHeight,
  }
}

export function clampChatRectangle(rectangle, viewport) {
  const limits = chatSizeLimits(viewport)
  const width = Math.max(limits.minimumWidth, Math.min(limits.maximumWidth, rectangle.width))
  const height = Math.max(limits.minimumHeight, Math.min(limits.maximumHeight, rectangle.height))
  return {
    width,
    height,
    left: Math.max(CHAT_POPUP_MARGIN, Math.min(viewport.width - CHAT_POPUP_MARGIN - width, rectangle.left)),
    top: Math.max(CHAT_POPUP_MARGIN, Math.min(viewport.height - CHAT_POPUP_MARGIN - height, rectangle.top)),
  }
}

export function resizeChatRectangle(activeResize, clientX, clientY, viewport) {
  const { direction, startX, startY, rectangle } = activeResize
  const limits = chatSizeLimits(viewport)
  const deltaX = clientX - startX
  const deltaY = clientY - startY
  const startingRight = rectangle.left + rectangle.width
  const startingBottom = rectangle.top + rectangle.height
  let { left, top, width, height } = rectangle

  if (direction.includes('e')) {
    const right = Math.max(rectangle.left + limits.minimumWidth, Math.min(viewport.width - CHAT_POPUP_MARGIN, startingRight + deltaX))
    width = right - rectangle.left
  }
  if (direction.includes('w')) {
    left = Math.max(CHAT_POPUP_MARGIN, Math.min(startingRight - limits.minimumWidth, rectangle.left + deltaX))
    width = startingRight - left
  }
  if (direction.includes('s')) {
    const bottom = Math.max(rectangle.top + limits.minimumHeight, Math.min(viewport.height - CHAT_POPUP_MARGIN, startingBottom + deltaY))
    height = bottom - rectangle.top
  }
  if (direction.includes('n')) {
    top = Math.max(CHAT_POPUP_MARGIN, Math.min(startingBottom - limits.minimumHeight, rectangle.top + deltaY))
    height = startingBottom - top
  }

  return clampChatRectangle({ left, top, width, height }, viewport)
}
