let apiBases = []
let wsBase = null

const stripTrailingSlash = (s) => String(s || '').replace(/\/+$/, '')

const computeWsBase = (origin) => {
  try {
    const u = new URL(origin)
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${u.host}`
  } catch (_) {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
  }
}

const setApiBases = (values) => {
  apiBases = values.map(v => stripTrailingSlash(v)).filter(v => v)
  if (apiBases.length === 0) {
    apiBases = [stripTrailingSlash(window.location.origin)]
  }
  wsBase = computeWsBase(apiBases[0])
  window.__APP_API_BASES__ = apiBases
  window.__APP_WS_BASE__ = wsBase
}

export const initConfig = async () => {
  setApiBases([window.location.origin])

  // 从 meta 标签读取 apiBase
  const metaApiBase = document.querySelector('meta[name="apiBase"]')?.content
  if (metaApiBase) {
    const bases = metaApiBase.split(',').map(s => s.trim()).filter(Boolean)
    if (bases.length > 0) {
      setApiBases(bases)
    }
  }

  return apiBases
}

export const getApiBases = () => {
  if (apiBases.length > 0) return apiBases
  if (window.__APP_API_BASES__?.length > 0) return window.__APP_API_BASES__
  return [stripTrailingSlash(window.location.origin)]
}

export const getWsBase = () => {
  if (wsBase) return wsBase
  if (window.__APP_WS_BASE__) return window.__APP_WS_BASE__
  return computeWsBase(getApiBases()[0])
}

export const hasMultipleApiBases = () => {
  return getApiBases().length > 1
}

// title 和背景图已在构建时注入 HTML，此处保留空实现以兼容 api.js
export const getTitle = () => ''
export const getBackgroundImage = () => ''

export default { initConfig, getApiBases, getWsBase, hasMultipleApiBases, getTitle, getBackgroundImage }
