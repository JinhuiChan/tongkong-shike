/*
 * 「我参与的」房间权限回归：
 * 列表查询必须返回 owner_id，否则 api 会把所有房间都判成“不是我的”，
 * 导致首页左滑删除的 canSwipe 永远为 false。
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const failures = []

const memberRows = [
  { room_id: 7, slot_count: 9, nickname: '我' },
  { room_id: 8, slot_count: 0, nickname: '我' },
]
const roomRows = [
  {
    id: 7,
    code: '123456',
    title: '我创建的局',
    start_date: '2026-10-26',
    day_count: 2,
    selected_dates: JSON.stringify(['2026-10-26', '2026-10-27']),
    owner_id: 'u1',
  },
  {
    id: 8,
    code: '654321',
    title: '别人创建的局',
    start_date: '2026-10-28',
    day_count: 1,
    selected_dates: JSON.stringify(['2026-10-28']),
    owner_id: 'u2',
  },
]

/** 模拟 PostgREST 的 select 投影：没选的字段不会出现在结果里 */
function project(row, columns) {
  if (!columns) return Object.assign({}, row)
  const out = {}
  columns.split(',').map(function (s) { return s.trim() }).filter(Boolean).forEach(function (key) {
    out[key] = row[key]
  })
  return out
}

function makeQuery(table) {
  const source = table === 'members' ? memberRows : roomRows
  let columns = ''
  const q = {
    select(value) { columns = value; return q },
    eq() { return q },
    order() { return q },
    limit() { return Promise.resolve({ data: source.map(function (r) { return project(r, columns) }), error: null }) },
    in() { return Promise.resolve({ data: source.map(function (r) { return project(r, columns) }), error: null }) },
  }
  return q
}

const cloudPath = require.resolve(path.join(ROOT, 'utils/cloud.js'))
const authPath = require.resolve(path.join(ROOT, 'utils/auth.js'))

require.cache[cloudPath] = {
  id: cloudPath,
  filename: cloudPath,
  loaded: true,
  exports: { cloud: { database: { from: makeQuery } } },
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

const api = require(path.join(ROOT, 'utils/api.js'))

async function main() {
  const result = await api.listMyRooms(20)
  if (!result.ok || result.rooms.length !== 2) {
    failures.push('房间列表加载失败: ' + JSON.stringify(result))
  } else {
    const mine = result.rooms.filter(function (r) { return r.id === 7 })[0]
    const other = result.rooms.filter(function (r) { return r.id === 8 })[0]
    if (!mine || mine.isOwner !== true) failures.push('自己创建的房间被误判为不可删除')
    if (!other || other.isOwner !== false) failures.push('别人创建的房间被误判为可删除')
  }

  console.log('房间列表返回 owner_id：自己的局可滑，别人的局不可滑')

  if (failures.length) {
    console.log('\n❌ 房间权限测试失败:')
    failures.forEach(f => console.log(' - ' + f))
    process.exit(1)
  }
  console.log('\n✅ 房间权限测试通过')
}

main().catch(function (err) {
  console.log('❌ 测试异常: ' + (err && err.message))
  process.exit(1)
})
