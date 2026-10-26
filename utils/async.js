/**
 * 给任意 Promise 加超时护栏。
 * 小程序里 wx.request / wx.login 在某些环境下可能既不回调 success 也不回调 fail，
 * 一旦挂起，复用同一 Promise 的调用方会全部卡死，所以每个外部调用都必须有上限。
 */
function withTimeout(promise, ms, label) {
  return new Promise(function (resolve, reject) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      const err = new Error((label || 'request') + ' timeout')
      err.timeout = true
      err.label = label || 'request'
      reject(err)
    }, ms)

    Promise.resolve(promise).then(function (value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }, function (error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

module.exports = { withTimeout, sleep }
