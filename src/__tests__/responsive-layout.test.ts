import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('narrow viewport layout', () => {
  it.each([
    'src/views/UserList.vue',
    'src/views/OrganizationList.vue',
    'src/views/InvitationList.vue',
    'src/views/UserForm.vue',
    'src/views/BatchCreateForm.vue',
  ])('keeps %s inside the route viewport', (relativePath) => {
    expect(readSource(relativePath)).toContain('responsive-page')
  })

  it.each([
    'src/views/UserList.vue',
    'src/views/OrganizationList.vue',
    'src/views/InvitationList.vue',
    'src/views/BatchCreateForm.vue',
  ])('constrains tables in %s to their own scroll surface', (relativePath) => {
    expect(readSource(relativePath)).toContain('responsive-table-surface')
  })

  it('defines one shared responsive contract for tables, forms, and toolbars', () => {
    const source = readSource('src/styles/index.css')

    expect(source).toContain('.responsive-page')
    expect(source).toContain('.responsive-table-surface .el-table')
    expect(source).toContain('.responsive-form')
    expect(source).toContain('@media (max-width: 640px)')
  })
})
