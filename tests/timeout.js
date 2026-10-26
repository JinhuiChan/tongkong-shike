/*
 * 超时护栏测试：验证 wx.login 挂起时登录会主动失败而不是永久卡死。
 * 这是「点创建一直转圈」的根因回归测试。
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const failures = []

// 关键：login 故意既不回调 success 也不回调 fail，模拟 wx.login 挂起
let loginCalls = 0
global.wx = {
  login() {
    loginCalls += 1
  },
  request(options) {
    setTimeout(function () {
      if (options.fail) options.fail({ errMsg: 'request:fail mock' })
    }, 0)
    return { abort() {}, onHeadersReceived() {}, offHeadersReceived() {} }
  },
  getStorageSync() { return '' },
  setStorageSync() {},
  removeStorageSync() {},
  getAccountInfoSync() { return { miniProgram: { appId: 'wxtestappid' } } },
}

async function main() {
  const { withTimeout } = require(path.join(ROOT, 'utils/async.js'))

  // 1. withTimeout 对正常 Promise 直接透传
  const okValue = await withTimeout(Promise.resolve('ok'), 1000, 'demo')
  if (okValue !== 'ok') failures.push('withTimeout 未透传正常结果')

  // 2. withTimeout 对永不 resolve 的 Promise 必须超时
  const t0 = Date.now()
  let timedOut = false
  try {
    await withTimeout(new Promise(function () {}), 120, 'hang')
  } catch (err) {
    timedOut = true
    if (!err.timeout) failures.push('超时错误未标记 timeout 字段')
  }
  const elapsedQuick = Date.now() - t0
  if (!timedOut) failures.push('withTimeout 未对挂起的 Promise 超时')
  if (elapsedQuick > 2000) failures.push('短超时耗时异常: ' + elapsedQuick + 'ms')

  // 3. 登录流程在 wx.login 挂起时必须自行失败，而不是一直 pending
  const { ensureLogin, clearSession } = require(path.join(ROOT, 'utils/auth.js'))
  clearSession()

  const t1 = Date.now()
  let settled = false
  let result = null

  await Promise.race([
    ensureLogin().then(function (res) {
      settled = true
      result = res
    }),
    new Promise(function (resolve) { setTimeout(resolve, 15000) }),
  ])
  const elapsed = Date.now() - t1

  if (!settled) {
    failures.push('ensureLogin 在 15 秒内仍未返回，仍然会卡死')
  } else {
    if (result.ok) failures.push('wx.login 挂起时不应返回登录成功')
    if (!result.error) failures.push('登录失败时未返回错误文案')
    if (elapsed > 14000) failures.push('登录超时过长: ' + elapsed + 'ms')
    if (loginCalls === 0) failures.push('wx.login 从未被调用')
    console.log('登录在 ' + elapsed + 'ms 后主动失败，文案：' + result.error)
  }

  // 4. 失败后必须能再次发起，而不是永远复用同一个挂起的 Promise
  const callsBefore = loginCalls
  const second = await ensureLogin()
  if (!second.ok && loginCalls > callsBefore) {
    console.log('第二次调用重新发起登录，未复用挂起请求')
  } else if (second.ok) {
    failures.push('第二次调用不应成功')
  }

  if (failures.length) {
    console.log('\n❌ 超时护栏测试失败:')
    failures.forEach(f => console.log(' - ' + f))
    process.exit(1)
  }
  console.log('\n✅ 超时护栏测试通过')
}

main().catch(function (err) {
  console.log('❌ 测试异常: ' + (err && err.message))
  process.exit(1)
})
