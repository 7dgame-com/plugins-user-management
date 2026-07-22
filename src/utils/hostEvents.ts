import { isInIframe } from './token'

type HostEventPayload = {
  event: string
  pluginUrl?: string
}

type HostEventMessage = {
  type: 'EVENT'
  id: string
  payload: HostEventPayload
}

const ROLE_WRITE_HANDOFF_TARGET_PATH = '/users'

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function postHostEvent(payload: HostEventPayload): void {
  const message: HostEventMessage = {
    type: 'EVENT',
    id: createMessageId(),
    payload,
  }

  window.parent.postMessage(message, '*')
}

export function notifyHostPluginUrlChanged(pluginUrl: string): void {
  postHostEvent({ event: 'plugin-url-changed', pluginUrl })
}

export function requestPendingRoleWriteHostHandoff(pathname: string): boolean {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'
  if (
    !isInIframe()
    || normalizedPath !== ROLE_WRITE_HANDOFF_TARGET_PATH
  ) {
    return false
  }

  window.parent.postMessage({
    type: 'ROLE_WRITE_CANARY_HANDOFF_REQUEST',
    id: createMessageId(),
    payload: { targetPath: ROLE_WRITE_HANDOFF_TARGET_PATH },
  }, '*')
  return true
}
