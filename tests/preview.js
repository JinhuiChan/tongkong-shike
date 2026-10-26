/*
 * 预览环境回归测试：复现「点创建一直卡在创建中」的现场。
 * 条件：wx 缺少 showLoading/hideLoading/showToast/createSelectorQuery，且 wx.login 直接 fail。
 * 期望：提交后 submitting 必须回到 false，并给出可读错误，而不是永远停在创建中。
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const failures = []

// 只实现预览面板会提供的接口，故意不提供 showLoading / showToast / createSelectorQuery
global.wx = {
  login(options) {
    setTimeout(function () {
      if (options.fail) options.fail({ errMsg: 'login:fail 微信登录需在微信中体验，请发布小程序后扫码使用。' })
    }, 0)
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

let pageConfig = null
global.Page = function (config) { pageConfig = config }
global.getCurrentPages = function () { return [{}] }

function setByPath(root, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (cursor[parts[i]] === undefined || cursor[parts[i]] === null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function createPage() {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) {
    Object.keys(patch).forEach(function (key) {
      setByPath(page.data, key, patch[key])
    })
  }
  return page
}

async function main() {
  // 1. ui 封装在不完整 wx 环境下不能抛异常
  const ui = require(path.join(ROOT, 'utils/ui.js'))
  const tasks = [
    ['loading', function () { ui.loading('x') }],
    ['hideLoading', function () { ui.hideLoading() }],
    ['toast', function () { ui.toast('x') }],
    ['copy', function () { ui.copy('123456') }],
    ['scrollTo', function () { ui.scrollTo(100) }],
    ['navigate', function () { ui.navigate('/pages/index/index') }],
    ['back', function () { ui.back() }],
  ]
  tasks.forEach(function (item) {
    try {
      item[1]()
    } catch (err) {
      failures.push('ui.' + item[0] + ' 在预览环境抛异常: ' + err.message)
    }
  })
  if (ui.query() !== null) failures.push('ui.query 在无 createSelectorQuery 时应返回 null')
  console.log('ui 封装在残缺环境下全部安全')

  // 2. 加载首页，走一遍创建流程
  require(path.join(ROOT, 'pages/index/index.js'))
  if (!pageConfig) {
    failures.push('页面未注册')
    return report()
  }

  const page = createPage()
  page.onLoad()
  page.data.formNickname = '111'
  page.data.titleInput = '111'

  // 先走一次首屏准备，确认预览环境被识别并给出可执行指引
  await page.prepare()
  if (!page.data.previewMode) {
    failures.push('预览环境下未识别 previewMode，用户看不到发布指引')
  }
  if (page.data.loginError) {
    failures.push('预览模式下仍显示原始错误红条: ' + page.data.loginError)
  }

  // 起始日改为多选：今天起 14 天，默认全选，可任意增删
  const options = page.data.candidateDates
  if (!options || options.length !== 14) {
    failures.push('候选日期数量异常: ' + (options ? options.length : 0))
  } else {
    if (options[0].weekday !== '今天') failures.push('首项未标记为今天: ' + options[0].weekday)
    if (!/^\d+\/\d+$/.test(options[0].label)) failures.push('日期标签格式异常: ' + options[0].label)
    if (page.data.pickedCount !== 0) failures.push('默认应一天都不选，实际 ' + page.data.pickedCount)

    page.toggleDate({ currentTarget: { dataset: { index: 0 } } })
    if (page.data.pickedCount !== 1) failures.push('选中一天后应为 1，实际 ' + page.data.pickedCount)
    if (page.data.candidateDates[0].checked !== 1) failures.push('选中后该天未打勾')

    page.selectAllDates()
    if (page.data.pickedCount !== 14) failures.push('全选后应为 14，实际 ' + page.data.pickedCount)

    page.toggleDate({ currentTarget: { dataset: { index: 0 } } })
    if (page.data.pickedCount !== 13) failures.push('取消一天后应为 13，实际 ' + page.data.pickedCount)
    if (page.data.candidateDates[0].checked !== 0) failures.push('取消后该天仍为选中')

    page.clearDates()
    if (page.data.pickedCount !== 0) failures.push('清空后应为 0，实际 ' + page.data.pickedCount)

    console.log('日期多选可用：' + options[0].label + ' ~ ' + options[options.length - 1].label + '，默认不选，可全选 / 清空')
  }

  // 创建流程前先选日期（默认是不选的）
  page.selectAllDates()

  const started = Date.now()
  let threw = null
  try {
    await page.submitCreate()
  } catch (err) {
    threw = err
  }
  const elapsed = Date.now() - started

  if (threw) failures.push('submitCreate 抛出未捕获异常: ' + threw.message)
  if (elapsed > 20000) failures.push('创建流程耗时过长: ' + elapsed + 'ms')

  if (page.data.submitting !== false) {
    failures.push('创建失败后 submitting 仍为 true，按钮会一直卡在「创建中…」')
  }
  if (!page.data.formError) {
    failures.push('创建失败后没有可读的错误提示')
  }
  if (!page.data.creating) {
    // 失败时应保留弹层让用户修改，这里只记录不作为失败
    console.log('弹层已关闭（失败场景下会保留）')
  }

  console.log('创建流程耗时 ' + elapsed + 'ms')
  console.log('submitting: ' + page.data.submitting)
  console.log('错误提示: ' + page.data.formError)

  // 3. 失败后必须能再次提交，不能被锁死
  const second = createPage()
  second.data.formNickname = '111'
  second.data.titleInput = '111'
  second.data.startDate = '2026-10-24'
  await second.submitCreate()
  if (second.data.submitting !== false) failures.push('第二次提交同样卡住')

  report()
}

function report() {
  if (failures.length) {
    console.log('\n❌ 预览环境回归测试失败:')
    failures.forEach(f => console.log(' - ' + f))
    process.exit(1)
  }
  console.log('\n✅ 预览环境回归测试通过：不再卡在「创建中」')
}

main().catch(function (err) {
  console.log('❌ 测试异常: ' + (err && err.message))
  process.exit(1)
})
