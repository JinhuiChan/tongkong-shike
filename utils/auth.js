const { cloud } = require('./cloud')
const { withTimeout } = require('./async')

// 各步骤的超时上限：宁可明确失败，也不要无限转圈
const STEP_TIMEOUT = 6000
const LOGIN_TIMEOUT = 12000

let sessionCache = null
let loginPromise = null
let lastError = ''

function getSession() {
  return sessionCache
}

function userId() {
  return sessionCache && sessionCache.user ? sessionCache.user.id : ''
}

function getLastError() {
  return lastError
}

function wxLoginCode() {
  return new Promise(function (resolve, reject) {
    if (!wx || typeof wx.login !== 'function') {
      reject(new Error('当前环境不支持微信登录'))
      return
    }
    wx.login({
      success: function (res) {
        if (res && res.code) resolve(res.code)
        else reject(new Error('未获取到微信登录凭证'))
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '微信登录失败'))
      },
    })
  })
}

function friendlyAuthError(err) {
  const message = (err && err.message) || ''

  if (err && err.timeout) {
    // 电脑端预览拿不到真实 wx.login 凭证，最容易表现为超时
    return '登录超时。如果是在电脑里预览，请发布后扫码在微信中打开再试。'
  }
  if (/not support|不支持|not supported/i.test(message)) {
    return '当前环境无法完成微信登录，请在微信中打开小程序'
  }
  const kind = err && err.kind
  if (kind === 'network' || kind === 'backend-unavailable') {
    return '网络不太稳定，请检查网络后重试'
  }
  if (/wx\.login/i.test(message)) {
    return '微信登录没有返回结果，请退出小程序后重新进入'
  }
  // 服务端返回的中文原因（如「未打开微信登录」）直接透出，便于定位
  if (message && message.length <= 40 && /[\u4e00-\u9fa5]/.test(message)) {
    return message
  }
  return '登录失败，请重试'
}

async function doLogin(force) {
  if (!force) {
    try {
      const cached = await withTimeout(cloud.auth.getSession(), STEP_TIMEOUT, 'getSession')
      if (!cached.error && cached.data) {
        sessionCache = cached.data
        lastError = ''
        return { ok: true, session: cached.data }
      }
    } catch (err) {
      console.warn('[auth] getSession failed', (err && err.message) || '')
    }
  }

  let code = ''
  try {
    code = await withTimeout(wxLoginCode(), STEP_TIMEOUT, 'wx.login')
  } catch (err) {
    console.error('[auth] wx.login failed', (err && err.message) || '')
    lastError = friendlyAuthError(err)
    return { ok: false, error: lastError }
  }

  let appid = ''
  try {
    appid = wx.getAccountInfoSync().miniProgram.appId
  } catch (err) {
    appid = ''
  }

  try {
    const result = await withTimeout(cloud.auth.signInWithWechat(code, appid), LOGIN_TIMEOUT, 'signInWithWechat')
    if (result.error) {
      console.error('[auth] signInWithWechat failed', JSON.stringify({
        stage: 'signInWithWechat',
        message: (result.error && result.error.message) || '',
      }))
      lastError = friendlyAuthError(result.error)
      return { ok: false, error: lastError }
    }
    sessionCache = result.data
    lastError = ''
    return { ok: true, session: result.data }
  } catch (err) {
    console.error('[auth] signInWithWechat failed', (err && err.message) || '')
    lastError = friendlyAuthError(err)
    return { ok: false, error: lastError }
  }
}

/**
 * 静默登录：优先复用已有会话，否则走 wx.login 换取云端会话。
 * 并发调用共享同一次请求；任一环节超时都会释放，不会永久卡住后续调用。
 */
function ensureLogin(force) {
  if (sessionCache && !force) return Promise.resolve({ ok: true, session: sessionCache })
  if (loginPromise) return loginPromise
  loginPromise = doLogin(force).then(function (res) {
    loginPromise = null
    return res
  }, function (err) {
    loginPromise = null
    lastError = friendlyAuthError(err)
    return { ok: false, error: lastError }
  })
  return loginPromise
}

function clearSession() {
  sessionCache = null
  loginPromise = null
}

module.exports = { ensureLogin, getSession, userId, clearSession, getLastError }
