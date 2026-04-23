import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('user-management auth-session routing semantics', () => {
  it('removes the standalone plugin api-config client and keeps verify-token on the main backend', async () => {
    const source = readFileSync(resolve(process.cwd(), 'src/api/index.ts'), 'utf8')
    const mod = await import('../api/index')
    const mainGet = vi.spyOn(mod.mainApi, 'get').mockResolvedValue({ data: { code: 0 } } as never)

    expect(source).not.toContain('/api-config/api/v1/plugin')
    expect('pluginApi' in mod).toBe(false)

    await mod.verifyCurrentToken()

    expect(mainGet).toHaveBeenCalledWith('/plugin/verify-token')
  })

  it('vite dev proxy no longer exposes /api-config', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

    expect(viteConfig).not.toContain("'/api-config'")
    expect(viteConfig).not.toContain('path.replace(/^\\/api-config/, \'\')')
    expect(viteConfig).toContain("'/api'")
  })

  it('docker runtime wiring no longer generates api-config upstreams', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8')
    const nginxTemplate = readFileSync(resolve(process.cwd(), 'nginx.conf.template'), 'utf8')

    expect(entrypoint).not.toContain('generate_lb_config "APP_CONFIG" "/api-config/" "config"')
    expect(entrypoint).not.toContain('APP_CONFIG_${i}_URL')
    expect(nginxTemplate).not.toContain('# __CONFIG_LOCATIONS__')
  })

  it('formats debug-env JSON with a conditional upstream comma', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8')

    expect(entrypoint).toContain('DEBUG_LIST="${API_LIST}"')
    expect(entrypoint).toContain('${DEBUG_LIST}${DEBUG_LIST:+, }')
    expect(entrypoint).not.toContain('  ${API_LIST},')
  })
})
