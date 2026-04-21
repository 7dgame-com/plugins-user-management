import { computed, readonly, ref } from 'vue'
import { verifyCurrentToken } from '../api'

export type AuthSessionUser = {
  id?: number
  username: string
  nickname?: string
  roles: string[]
}

const user = ref<AuthSessionUser | null>(null)
const loaded = ref(false)
const loading = ref(false)
let loadingPromise: Promise<void> | null = null

const isRootUser = computed(() => Array.isArray(user.value?.roles) && user.value.roles.includes('root'))
const isAdminUser = computed(() => Array.isArray(user.value?.roles) && user.value.roles.includes('admin'))
const hasRootAccess = computed(() => isRootUser.value)

function extractSessionPayload(
  responseBody: { data?: Partial<AuthSessionUser> } | Partial<AuthSessionUser>
): Partial<AuthSessionUser> {
  if ('data' in responseBody && responseBody.data) {
    return responseBody.data
  }

  return responseBody as Partial<AuthSessionUser>
}

export function useAuthSession() {
  async function fetchSession(force = false) {
    if (loaded.value && !force) {
      return
    }

    if (loadingPromise && !force) {
      await loadingPromise
      return
    }

    loading.value = true
    loadingPromise = (async () => {
      try {
        const response = await verifyCurrentToken()
        const responseBody = response.data as { data?: Partial<AuthSessionUser> } | Partial<AuthSessionUser>
        const payload = extractSessionPayload(responseBody)

        user.value = {
          id: payload.id,
          username: payload.username ?? '',
          nickname: payload.nickname,
          roles: Array.isArray(payload?.roles) ? payload.roles : [],
        }
        loaded.value = true
      } catch (error) {
        user.value = null
        loaded.value = false
        throw error
      } finally {
        loading.value = false
        loadingPromise = null
      }
    })()

    await loadingPromise
  }

  return {
    user: readonly(user),
    loaded: readonly(loaded),
    loading: readonly(loading),
    isRootUser,
    isAdminUser,
    hasRootAccess,
    fetchSession,
  }
}
