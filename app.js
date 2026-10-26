const { ensureLogin } = require('./utils/auth')
const ui = require('./utils/ui')
const theme = require('./utils/theme')

App({
  globalData: {
    nickname: '',
    pendingRoomCode: '',
  },

  onLaunch(options) {
    theme.applyChrome()
    // 有新版本就静默应用，避免用户反复看到旧包
    this.checkUpdate()
    // 预热登录，不阻塞首屏渲染
    ensureLogin()
    this.globalData.nickname = ui.storage.get('nickname')
    if (options && options.query && options.query.code) {
      this.globalData.pendingRoomCode = options.query.code
    }
  },

  checkUpdate() {
    if (typeof wx === 'undefined' || typeof wx.getUpdateManager !== 'function') return
    try {
      const manager = wx.getUpdateManager()
      manager.onUpdateReady(function () {
        manager.applyUpdate()
      })
    } catch (err) {
      // 预览环境或低版本基础库没有该能力，忽略
    }
  },

  onShow(options) {
    if (options && options.query && options.query.code) {
      this.globalData.pendingRoomCode = options.query.code
    }
  },
})
