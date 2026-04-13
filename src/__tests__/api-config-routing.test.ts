import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('user-management api-config routing semantics', () => {
  it('pluginApi points at /api-config/api/v1/plugin', async () => {
    const { pluginApi } = await import('../api/index')
    expect(pluginApi.defaults.baseURL).toBe('/api-config/api/v1/plugin')
  })

  it('vite dev proxy rewrites /api-config to the system-admin backend', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(viteConfig).toContain("'/api-config'")
    expect(viteConfig).toContain("path.replace(/^\\/api-config/, '')")
  })

  it('docker entrypoint uses APP_CONFIG and /api-config for system-admin upstreams', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8')
    expect(entrypoint).toContain('generate_lb_config "APP_CONFIG" "/api-config/" "config"')
    expect(entrypoint).toContain('APP_CONFIG_${i}_URL')
    expect(entrypoint).not.toContain('generate_lb_config "APP_BACKEND" "/backend/" "backend"')
  })

  it('verifyCurrentToken uses the main backend plugin endpoint instead of api-config', async () => {
    const mod = await import('../api/index')
    const mainGet = vi.spyOn(mod.mainApi, 'get').mockResolvedValue({ data: { code: 0 } } as never)
    const pluginGet = vi.spyOn(mod.pluginApi, 'get').mockResolvedValue({ data: { code: 0 } } as never)

    await mod.verifyCurrentToken()

    expect(mainGet).toHaveBeenCalledWith('/plugin/verify-token')
    expect(pluginGet).not.toHaveBeenCalled()
  })
})
