import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import enUS from './locales/en-US'
import jaJP from './locales/ja-JP'
import thTH from './locales/th-TH'

// 从 URL 参数获取语言设置
function getLanguageFromURL(): string {
  const params = new URLSearchParams(window.location.search)
  const lang = params.get('lang')
  if (lang && ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH'].includes(lang)) {
    return lang
  }
  return 'zh-CN' // 默认简体中文
}

const i18n = createI18n({
  legacy: false,
  locale: getLanguageFromURL(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'en-US': enUS,
    'ja-JP': jaJP,
    'th-TH': thTH,
  },
})

export default i18n
