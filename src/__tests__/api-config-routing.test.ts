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

  it('allows the same idempotency headers in every nginx runtime config', () => {
    const configPaths = ['nginx.conf', 'docker-local.conf', 'nginx.conf.template']
    const allowHeaders = configPaths.map((configPath) => {
      const config = readFileSync(resolve(process.cwd(), configPath), 'utf8')
      const match = config.match(/Access-Control-Allow-Headers'\s+'([^']+)'/)

      expect(match, `${configPath} must declare Access-Control-Allow-Headers`).not.toBeNull()
      return match![1].split(',').map(header => header.trim())
    })

    expect(allowHeaders[1]).toEqual(allowHeaders[0])
    expect(allowHeaders[2]).toEqual(allowHeaders[0])
    expect(allowHeaders[0]).toEqual(expect.arrayContaining([
      'Idempotency-Key',
      'X-Idempotency-Key',
    ]))
  })

  it('keeps CORS headers and handles preflight inside generated proxy locations', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8')
    const allowHeaders = "add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,Idempotency-Key,X-Idempotency-Key' always;"

    // Single-backend, weighted primary, and failover locations each declare
    // their own headers because any add_header in a location disables Nginx's
    // inheritance from the server block.
    expect(entrypoint.split(allowHeaders)).toHaveLength(4)
    // OPTIONS is terminated before either direct or weighted proxying.
    expect(entrypoint.split("if (\\$request_method = 'OPTIONS')")).toHaveLength(3)
  })

  it('docker runtime wires /api-auth to APP_AUTH upstreams', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8')

    expect(entrypoint).toContain('generate_lb_config "APP_AUTH" "/api-auth/" "auth"')
    expect(entrypoint).toContain('APP_AUTH_${i}_URL')
    expect(entrypoint).toContain('${API_LOCATIONS}${AUTH_LOCATIONS}')
  })

  it('exposes the selected upstream host and address on direct, primary and failover responses', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8')

    expect(entrypoint).toContain('add_header X-XRUGC-Upstream-Host ${host} always;')
    expect(entrypoint).toContain('add_header X-XRUGC-Upstream-Host \\$${PREFIX_NAME}_backend_host always;')
    expect(entrypoint).toContain('add_header X-XRUGC-Upstream-Host \\$${PREFIX_NAME}_fb_host always;')
    expect(entrypoint.split('add_header X-Upstream-Addr \\$upstream_addr always;')).toHaveLength(4)
  })

  it('formats debug-env JSON with a conditional upstream comma', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8')

    expect(entrypoint).toContain('DEBUG_LIST="${API_LIST}"')
    expect(entrypoint).toContain('DEBUG_LIST="${DEBUG_LIST}\\"APP_AUTH_${i}_URL\\": \\"${url}\\""')
    expect(entrypoint).toContain('${DEBUG_LIST}${DEBUG_LIST:+, }')
    expect(entrypoint).not.toContain('  ${API_LIST},')
  })
})
