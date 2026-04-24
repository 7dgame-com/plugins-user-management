import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('user-management documentation runtime configuration', () => {
  it('documents APP_API_N_URL instead of legacy API_UPSTREAM for Docker runs', () => {
    const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')

    expect(readme).toContain('APP_API_N_URL')
    expect(readme).toContain('APP_API_1_URL=http://xrugc-api:80')
    expect(readme).not.toContain('API_UPSTREAM')
  })
})
