/*
 * 结果页「谁和谁有空」计算验证。
 * 语义：一个区间只有某人在整段内每一格都有空，才算这个人能约；
 *      只在区间一部分有空的人不应出现在名单里。
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

let pageConfig = null
global.Page = function (cfg) { pageConfig = cfg }

require(path.join(ROOT, 'pages/result/result.js'))
const slots = require(path.join(ROOT, 'utils/slots.js'))

const SLOTS = 96
const dayCount = 2

function memberBits(marks) {
  const bytes = slots.emptyBitmap(dayCount)
  marks.forEach(function (i) { slots.setBit(bytes, i, 1) })
  return bytes
}

function makePage() {
  const page = Object.assign({}, pageConfig)
  page.data = {
    room: { dayCount: dayCount, dates: ['2026-10-24', '2026-10-25'] },
    days: [],
  }
  page.setData = function (patch) { Object.assign(page.data, patch) }
  return page
}

// 三个人第 0 天的前 8 格：A、B 全段有空，C 只有前 4 格
const day0Base = 0
const a = memberBits([0, 1, 2, 3, 4, 5, 6, 7])
const b = memberBits([0, 1, 2, 3, 4, 5, 6, 7])
const c = memberBits([0, 1, 2, 3])

const counts = new Array(dayCount * SLOTS).fill(0)
;[a, b, c].forEach(function (bits) {
  for (let i = 0; i < dayCount * SLOTS; i++) {
    if (slots.getBit(bits, i)) counts[i] += 1
  }
})

const page = makePage()
page.counts = counts
page.filledMembers = [
  { bits: a, view: { id: 1, nickname: '小明' } },
  { bits: b, view: { id: 2, nickname: '小红' } },
  { bits: c, view: { id: 3, nickname: '小刚' } },
]

// 阈值 2：0-7 格都至少有 2 人
pageConfig.compute.call(page, 2)

const day0 = page.data.days[0]
if (!day0 || day0.ranges.length !== 1) {
  failures.push('第 0 天区间数量异常: ' + (day0 ? day0.ranges.length : 'no day'))
} else {
  const range = day0.ranges[0]
  if (range.text !== '00:00 – 02:00') failures.push('区间时间异常: ' + range.text)
  if (range.availableCount !== 2) failures.push('全程有空人数异常: ' + range.availableCount)
  const names = range.available.map(function (p) { return p.nickname })
  if (names.join(',') !== '小明,小红') {
    failures.push('名单异常，应只含全程有空的人: ' + names.join(','))
  }
  if (names.indexOf('小刚') >= 0) {
    failures.push('小刚只在部分时段有空，不应列入全程名单')
  }
  console.log('区间 ' + range.text + ' → ' + names.join('、') + '（' + range.availableCount + ' 人全程有空）')
}

// 阈值 3：只有 0-3 格满足，小刚也在其列
pageConfig.compute.call(page, 3)
const strict = page.data.days[0].ranges
if (!strict.length || strict[0].text !== '00:00 – 01:00') {
  failures.push('阈值 3 的区间异常: ' + (strict.length ? strict[0].text : 'none'))
} else {
  const names3 = strict[0].available.map(function (p) { return p.nickname })
  if (names3.join(',') !== '小明,小红,小刚') {
    failures.push('阈值 3 的名单异常: ' + names3.join(','))
  }
  console.log('阈值 3：' + strict[0].text + ' → ' + names3.join('、'))
}

// 第 1 天没有任何重叠，不应产生区间
if (page.data.days[1].ranges.length !== 0) {
  failures.push('无重叠的日子不应出现区间')
}

if (failures.length) {
  console.log('\n❌ 名单计算测试失败:')
  failures.forEach(f => console.log(' - ' + f))
  process.exit(1)
}
console.log('\n✅ 名单计算测试通过：只列全程有空的人')
