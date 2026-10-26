/* 冒烟测试：在小程序运行时之外验证云 SDK 初始化与模块形态（不发起真实请求） */
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

global.wx = {
  request(options) {
    // 返回一个可取消的任务对象，模拟小程序请求接口
    const task = {
      abort() {},
      onHeadersReceived() {},
      offHeadersReceived() {},
    }
    setTimeout(function () {
      if (options.fail) options.fail({ errMsg: 'request:fail mock' })
    }, 0)
    return task
  },
  getStorageSync() { return '' },
  setStorageSync() {},
  removeStorageSync() {},
  getAccountInfoSync() {
    return { miniProgram: { appId: 'wxtestappid' } }
  },
}

const failures = []

try {
  const { cloud } = require(path.join(ROOT, 'utils/cloud.js'))

  if (!cloud) failures.push('cloud 实例为空')
  if (!cloud.auth || typeof cloud.auth.signInWithWechat !== 'function') {
    failures.push('cloud.auth.signInWithWechat 不可用')
  }
  if (!cloud.auth || typeof cloud.auth.getSession !== 'function') {
    failures.push('cloud.auth.getSession 不可用')
  }
  if (!cloud.database || typeof cloud.database.from !== 'function') {
    failures.push('cloud.database.from 不可用')
  }

  // 查询构造器能否链式搭建（不执行）
  const builder = cloud.database
    .from('rooms')
    .select('id, code')
    .eq('code', '123456')
    .maybeSingle()
  if (!builder || typeof builder.then !== 'function' && typeof builder.then === 'undefined') {
    // builder 为 thenable 查询对象即可
    failures.push('查询构造器异常')
  }

  const { publicConfig } = require(path.join(ROOT, 'config.js'))
  if (!publicConfig.endpoint.startsWith('https://')) failures.push('endpoint 必须是 https')
  if (!publicConfig.publishableKey.startsWith('wbpk_')) failures.push('publishableKey 形态异常')
  if (/wbapp_/.test(publicConfig.publishableKey)) {
    failures.push('publishableKey 不应混入 applicationId 以外的用途')
  }

  console.log('云端客户端初始化正常')
  console.log('endpoint:', publicConfig.endpoint)
  console.log('模块: auth / database 均已挂载')
} catch (err) {
  failures.push('初始化抛出异常: ' + (err && err.message))
}

if (failures.length) {
  console.log('\n❌ 冒烟测试失败:')
  failures.forEach(f => console.log(' - ' + f))
  process.exit(1)
} else {
  console.log('\n✅ 冒烟测试通过')
}
