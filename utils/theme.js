const ui = require('./ui')

const STORAGE_KEY = 'theme_mode'

/** 首次进入跟随微信/系统主题，用户手动切换后以保存的选择为准 */
function systemMode() {
  if (typeof wx === 'undefined') return 'light'
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync()
      if (info && info.theme === 'dark') return 'dark'
    }
  } catch (err) {
    // 预览环境或低版本基础库取不到系统主题时按浅色处理
  }
  return 'light'
}

function mode() {
  const saved = ui.storage.get(STORAGE_KEY, '')
  if (saved === 'dark' || saved === 'light') return saved
  return systemMode()
}

function className() {
  return mode() === 'dark' ? 'theme-dark' : 'theme-light'
}

/** 同步原生导航栏和窗口背景，避免深色页面顶部/回弹区域仍是白色 */
function applyChrome(current) {
  if (typeof wx === 'undefined') return
  const dark = (current || mode()) === 'dark'
  try {
    if (typeof wx.setNavigationBarColor === 'function') {
      wx.setNavigationBarColor({
        frontColor: dark ? '#ffffff' : '#000000',
        backgroundColor: dark ? '#11151f' : '#ffffff',
        animation: { duration: 0, timingFunc: 'linear' },
      })
    }
  } catch (err) {
    // 部分预览环境不支持，忽略
  }
  try {
    if (typeof wx.setBackgroundColor === 'function') {
      wx.setBackgroundColor({
        backgroundColor: dark ? '#11151f' : '#fafafb',
        backgroundColorTop: dark ? '#11151f' : '#fafafb',
        backgroundColorBottom: dark ? '#11151f' : '#fafafb',
      })
    }
  } catch (err) {
    // 同上
  }
}

function sync(page) {
  const current = mode()
  applyChrome(current)
  if (page && typeof page.setData === 'function' && !page.unloaded) {
    page.setData({
      themeClass: 'theme-' + current,
      nightMode: current === 'dark',
    })
  }
  return current
}

function toggle(page) {
  const next = mode() === 'dark' ? 'light' : 'dark'
  ui.storage.set(STORAGE_KEY, next)
  return sync(page)
}

module.exports = {
  mode,
  className,
  sync,
  toggle,
  applyChrome,
}
