/**
 * wx 接口的安全封装。
 *
 * 电脑端预览面板只模拟了部分交互能力，wx.showLoading 之类的方法可能根本不存在。
 * 直接调用会抛 TypeError，把 setData 之后的流程整段中断，
 * 表现就是按钮永远停在「处理中」。所以这里统一做存在性检查。
 */
function call(name, options, onFallback) {
  if (typeof wx === 'undefined' || typeof wx[name] !== 'function') {
    if (typeof onFallback === 'function') onFallback()
    return false
  }
  try {
    wx[name](options)
    return true
  } catch (err) {
    console.warn('[ui] ' + name + ' failed', (err && err.message) || '')
    if (typeof onFallback === 'function') onFallback()
    return false
  }
}

const ui = {
  loading(title) {
    return call('showLoading', { title: title || '处理中', mask: true })
  },

  hideLoading() {
    return call('hideLoading')
  },

  toast(title) {
    const text = String(title == null ? '' : title)
    if (!text) return false
    return call('showToast', { title: text, icon: 'none', duration: 2200 })
  },

  copy(text) {
    return call('setClipboardData', { data: String(text == null ? '' : text) })
  },

  scrollTo(top) {
    return call('pageScrollTo', { scrollTop: Math.max(0, top || 0), duration: 0 })
  },

  query() {
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return null
    try {
      return wx.createSelectorQuery()
    } catch (err) {
      return null
    }
  },

  navigate(url) {
    return call('navigateTo', { url: url })
  },

  redirect(url) {
    return call('redirectTo', { url: url })
  },

  relaunch(url) {
    return call('reLaunch', { url: url })
  },

  /** 有上一页就返回，否则回首页；两种都不可用时静默忽略 */
  back() {
    let depth = 0
    try {
      depth = typeof getCurrentPages === 'function' ? getCurrentPages().length : 0
    } catch (err) {
      depth = 0
    }
    if (depth > 1) return call('navigateBack')
    return call('reLaunch', { url: '/pages/index/index' })
  },

  storage: {
    get(key, fallback) {
      if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') {
        return fallback === undefined ? '' : fallback
      }
      try {
        const value = wx.getStorageSync(key)
        return value === '' || value === undefined || value === null
          ? (fallback === undefined ? '' : fallback)
          : value
      } catch (err) {
        return fallback === undefined ? '' : fallback
      }
    },
    set(key, value) {
      if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
      try {
        wx.setStorageSync(key, value)
        return true
      } catch (err) {
        return false
      }
    },
  },
}

module.exports = ui
