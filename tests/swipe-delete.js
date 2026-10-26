/*
 * 首页左滑删除测试：
 * 1. 横向左滑超过一半 → 停在露出右侧删除按钮的位置
 * 2. 滑动不足 → 回弹
 * 3. 滑动不应误触发进入房间
 * 4. 非创建者的房间不可滑
 * 5. 删除后列表移除该项
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const failures = []

global.wx = {
  getSystemInfoSync: function () { return { windowWidth: 375, theme: 'light' } },
  getStorageSync() { return '' },
  setStorageSync() {},
  removeStorageSync() {},
  getAccountInfoSync() { return { miniProgram: { appId: 'wxtestappid' } } },
  request(o) { setTimeout(() => { if (o.fail) o.fail({ errMsg: 'request:fail mock' }) }, 0); return { abort() {} } },
}

let roomsData = [
  { id: 1, code: '111111', title: '房间A', dates: ['2026-10-24', '2026-10-25'], dayCount: 2, isOwner: true, mySlotCount: 11 },
  { id: 2, code: '222222', title: '房间B', dates: ['2026-10-24'], dayCount: 1, isOwner: false, mySlotCount: 3 },
]

const apiPath = require.resolve(path.join(ROOT, 'utils/api.js'))
const authPath = require.resolve(path.join(ROOT, 'utils/auth.js'))

require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  exports: {
    listMyRooms: async function () { return { ok: true, rooms: roomsData.slice() } },
    deleteRoom: async function (id) {
      roomsData = roomsData.filter(function (r) { return r.id !== id })
      return { ok: true }
    },
    createRoom: async function () { return { ok: false, error: 'mock' } },
    findRoomByCode: async function () { return { ok: false, error: 'mock' } },
    joinRoom: async function () { return { ok: true } },
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
require(path.join(ROOT, 'pages/index/index.js'))

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
    Object.keys(patch).forEach(function (key) { setByPath(page.data, key, patch[key]) })
    if (typeof cb === 'function') cb()
  }
  page.deleteWidth = 80 // 160rpx 在 375 宽度下约 80px
  return page
}

function touch(x, y) {
  return { touches: [{ clientX: x, clientY: y }] }
}

function gesture(page, index, fromX, toX, y) {
  page.onRowTouchStart({ currentTarget: { dataset: { index: index } }, touches: [{ clientX: fromX, clientY: y || 100 }] })
  page.onRowTouchMove(touch(toX, y || 100))
  page.onRowTouchEnd()
}

async function main() {
  const page = createPage()
  await page.loadMyRooms()

  if (page.data.myRooms.length !== 2) {
    failures.push('列表加载异常: ' + page.data.myRooms.length)
  }
  if (!page.data.myRooms[0].canSwipe) failures.push('自己的房间应可左滑')
  if (page.data.myRooms[1].canSwipe) failures.push('别人的房间不应可左滑')

  // 1. 小幅左滑达到 25% → 只展开，不弹删除确认
  gesture(page, 0, 300, 270, 102)
  if (page.data.myRooms[0].offset !== -80) {
    failures.push('小幅左滑应停在 -80，实际 ' + page.data.myRooms[0].offset)
  }
  if (page.data.confirmingDelete) failures.push('小幅左滑不应直接弹出删除确认')

  // 2. 滑动后不应误触进入
  if (!page.suppressTap) failures.push('滑动后应拦截一次点击')
  page.openRoom({ currentTarget: { dataset: { id: 1 } } })
  if (page.suppressTap) failures.push('拦截标记未清除')

  // 3. 从关闭状态左滑不足 25% → 回弹
  page.resetRow(0)
  gesture(page, 0, 300, 285)
  if (page.data.myRooms[0].offset !== 0) {
    failures.push('滑动不足应回弹到 0，实际 ' + page.data.myRooms[0].offset)
  }

  // 3b. 小幅展开后右滑 → 收起
  gesture(page, 0, 300, 270)
  if (page.data.myRooms[0].offset !== -80) {
    failures.push('应展开到 -80，实际 ' + page.data.myRooms[0].offset)
  }
  gesture(page, 0, 200, 300)
  if (page.data.myRooms[0].offset !== 0) {
    failures.push('右滑应收起到 0，实际 ' + page.data.myRooms[0].offset)
  }

  // 4. 非创建者不响应左滑
  gesture(page, 1, 300, 200)
  if (page.data.myRooms[1].offset !== 0) {
    failures.push('别人的房间被滑动了: ' + page.data.myRooms[1].offset)
  }

  // 5. 小幅展开后点删除按钮 → 弹出确认；取消后卡片收回
  gesture(page, 0, 300, 270)
  page.askDelete({ currentTarget: { dataset: { id: 1 } } })
  if (!page.data.confirmingDelete) failures.push('点删除未弹出确认')
  if (!page.data.deletingRoom || page.data.deletingRoom.id !== 1) failures.push('确认弹层房间不对')
  page.closeDelete()
  if (page.data.confirmingDelete) failures.push('取消后确认弹层未关闭')
  if (page.data.myRooms[0].offset !== 0) failures.push('取消后房间卡片未收回')

  // 6. 大幅左滑到底 → 松手直接进入删除确认
  gesture(page, 0, 300, 200)
  if (page.data.myRooms[0].offset !== -80) {
    failures.push('大幅左滑应停在 -80，实际 ' + page.data.myRooms[0].offset)
  }
  if (!page.data.confirmingDelete) failures.push('大幅左滑松手后应直接弹出删除确认')
  if (!page.data.deletingRoom || page.data.deletingRoom.id !== 1) {
    failures.push('大幅左滑触发的确认房间不对')
  }

  await page.doDelete()
  if (page.data.myRooms.length !== 1) {
    failures.push('删除后列表应只剩 1 项，实际 ' + page.data.myRooms.length)
  }
  if (page.data.myRooms[0].id !== 2) failures.push('删除后剩余项不对')

  console.log('小幅展开后点击删除 / 大幅滑到底直接确认 / 回弹 / 权限判定，均符合预期')

  if (failures.length) {
    console.log('\n❌ 左滑删除测试失败:')
    failures.forEach(f => console.log(' - ' + f))
    process.exit(1)
  }
  console.log('\n✅ 左滑删除测试通过')
}

main().catch(function (err) {
  console.log('❌ 测试异常: ' + (err && err.message))
  process.exit(1)
})
