import { describe, it, expect } from 'vitest'
import { useTheme } from '../composables/useTheme'

describe('useTheme', () => {
  it('returns isDark and themeName refs', () => {
    const { isDark, themeName } = useTheme()
    expect(isDark.value).toBe(false)
    expect(typeof themeName.value).toBe('string')
  })
})
