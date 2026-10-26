/*
 * 勾选页回归测试：
 * 1. 14 天必须真的拆成两页，每页 7 天
 * 2. 点「清空」只能清掉勾选，日期列不能消失
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const failures = []

global.wx = {
  getStorageSync() { return '' },
  setStorageSync() {},
  removeStorageSync() {},
  getAccountInfoSync() { return { miniProgram: { appId: 'wxtestappid' } } },
  request(o) { setTimeout(() => { if (o.fail) o.fail({ errMsg: 'request:fail mock' }) }, 0); return { abort() {} } },
}

const PAGE_SIZE = 14
const time = require(path.join(ROOT, 'utils/time.js'))

// 可在测试中替换的房间数据
let currentRoom = {
  id: 1,
  code: '123456',
  title: '测试局',
  start_date: '2026-10-24',
  day_count: PAGE_SIZE,
  selected_dates: JSON.stringify(time.buildDays('2026-10-24', PAGE_SIZE).map(function (d) { return d.date })),
}

// 注入 api / auth 的替身，避免真实网络
const apiPath = require.resolve(path.join(ROOT, 'utils/api.js'))
const authPath = require.resolve(path.join(ROOT, 'utils/auth.js'))

require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  exports: {
    findRoomById: async function () {
      return { ok: true, room: currentRoom }
    },
    listMembers: async function () {
      return { ok: true, members: [{ id: 1, owner_id: 'u1', nickname: '我', slots: '', slot_count: 0, updated_at: '' }] }
    },
    saveSlots: async function () { return { ok: true, member: {} } },
  },
}

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    ensureLogin: async function () { return { ok: true, session: { user: { id: 'u1' } } } },
    userId: function () { return 'u1' },
    getSession: function () { return { user: { id: 'u1' } } },
    clearSession: function () {},
    getLastError: function () { return '' },
  },
}

let pageConfig = null
global.Page = function (cfg) { pageConfig = cfg }

require(path.join(ROOT, 'pages/select/select.js'))

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
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach(function (key) {
      setByPath(page.data, key, patch[key])
    })
    if (typeof cb === 'function') cb()
  }
  return page
}

async function main() {
  const page = createPage()
  page.data.roomId = 1
  await page.init()

  // 1. 14 天 / 两页
  if (page.data.days.length !== PAGE_SIZE) {
    failures.push('天数异常: ' + page.data.days.length)
  }
  if (page.data.weekTabs.length !== 2) {
    failures.push('周切换页数异常: ' + page.data.weekTabs.length)
  }
  const week0 = page.data.days.filter(function (d) { return d.page === 0 })
  const week1 = page.data.days.filter(function (d) { return d.page === 1 })
  if (week0.length !== 7 || week1.length !== 7) {
    failures.push('分页不均: 第一周 ' + week0.length + ' 天，第二周 ' + week1.length + ' 天')
  }
  if (page.data.days.some(function (d) { return d.page === undefined })) {
    failures.push('存在缺少 page 字段的日期，该列将无法渲染')
  }

  // 2. 勾一格、全选，再清空；日期列必须始终保留
  page.toggleCell({ currentTarget: { dataset: { di: 0, ri: 32 } } })
  if (page.data.selectedCount !== 1) failures.push('勾选未生效')
  if (page.data.days[0].cells[32].on !== 1) failures.push('格子状态未更新')

  page.selectAll()
  const allSlots = PAGE_SIZE * 96
  if (page.data.selectedCount !== allSlots) {
    failures.push('全选后格数应为 ' + allSlots + '，实际 ' + page.data.selectedCount)
  }
  if (page.data.colCounts.some(function (n) { return n !== 96 })) {
    failures.push('全选后每日列计数应均为 96')
  }
  if (page.data.days.some(function (d) { return d.cells.some(function (c) { return !c.on }) })) {
    failures.push('全选后仍有未选中的格子')
  }

  page.clearAll()

  if (page.data.selectedCount !== 0) failures.push('清空后已选数不为 0')
  if (page.data.days.length !== PAGE_SIZE) failures.push('清空后天数被改变: ' + page.data.days.length)

  const visible0 = page.data.days.filter(function (d) { return d.page === 0 })
  const visible1 = page.data.days.filter(function (d) { return d.page === 1 })
  if (visible0.length !== 7) failures.push('清空后第一周只剩 ' + visible0.length + ' 天（日期列消失）')
  if (visible1.length !== 7) failures.push('清空后第二周只剩 ' + visible1.length + ' 天')
  if (page.data.days.some(function (d) { return d.page === undefined })) {
    failures.push('清空后有日期丢失 page 字段 → 表头和网格会整排消失')
  }
  const anyOn = page.data.days.some(function (d) {
    return d.cells.some(function (c) { return c.on })
  })
  if (anyOn) failures.push('清空后仍有格子处于选中态')

  // 3. 切换周
  page.switchWeek({ currentTarget: { dataset: { index: 1 } } })
  if (page.data.weekIndex !== 1) failures.push('周切换未生效')

  console.log('14 天分两页：' + page.data.weekTabs.map(function (t) { return t.label }).join(' / '))
  console.log('全选覆盖 ' + allSlots + ' 格；清空后仍保留 ' + visible0.length + ' + ' + visible1.length + ' 天，勾选已归零')

  // 4. 只挑若干天（不连续）时，只渲染被挑中的日期
  currentRoom = {
    id: 2,
    code: '654321',
    title: '跳着选',
    start_date: '2026-10-24',
    day_count: 3,
    selected_dates: JSON.stringify(['2026-10-24', '2026-10-26', '2026-11-02']),
  }
  const page2 = createPage()
  page2.data.roomId = 2
  await page2.init()

  const pickedDates = page2.data.days.map(function (d) { return d.date })
  if (JSON.stringify(pickedDates) !== JSON.stringify(['2026-10-24', '2026-10-26', '2026-11-02'])) {
    failures.push('未按选中日期渲染: ' + JSON.stringify(pickedDates))
  }
  if (page2.data.weekTabs.length !== 1) {
    failures.push('3 天不应分页，实际页数: ' + page2.data.weekTabs.length)
  }
  if (page2.data.room.rangeText !== '10/24 等 3 天') {
    failures.push('不连续日期的范围文案异常: ' + page2.data.room.rangeText)
  }
  console.log('只选 3 天（10/24、10/26、11/2）→ 渲染 ' + pickedDates.length + ' 列，文案「' + page2.data.room.rangeText + '」')

  if (failures.length) {
    console.log('\n❌ 勾选页测试失败:')
    failures.forEach(f => console.log(' - ' + f))
    process.exit(1)
  }
  console.log('\n✅ 勾选页测试通过')
}

main().catch(function (err) {
  console.log('❌ 测试异常: ' + (err && err.message))
  process.exit(1)
})
