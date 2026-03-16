import { describe, it, expect } from 'vitest'
import i18n from '../i18n'

describe('i18n', () => {
  it('defaults to zh-CN locale', () => {
    expect(i18n.global.locale.value).toBe('zh-CN')
  })

  it('has all supported locales', () => {
    const messages = i18n.global.messages.value
    expect(Object.keys(messages)).toEqual(
      expect.arrayContaining(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH'])
    )
  })

  it('fallback locale is zh-CN', () => {
    expect(i18n.global.fallbackLocale.value).toBe('zh-CN')
  })
})
