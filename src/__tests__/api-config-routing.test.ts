import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('user-management api-config routing semantics', () => {
  it('pluginApi points at /api-config/v1/plugin', async () => {
    const { pluginApi } = await import('../api/index')
    expect(pluginApi.defaults.baseURL).toBe('/api-config/v1/plugin')
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
})
