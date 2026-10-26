/* 项目静态自检：JSON 合法性、JS 语法、WXML 事件绑定、页面路径、WXML 表达式限制 */
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const problems = []
const notes = []

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm' || name === '.git') continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(ROOT, [])

/* 1. JSON */
for (const f of files.filter(f => f.endsWith('.json'))) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) {
    problems.push(`JSON 解析失败 ${path.relative(ROOT, f)}: ${e.message}`)
  }
}

/* 2. JS 语法 */
for (const f of files.filter(f => f.endsWith('.js'))) {
  try {
    cp.execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
  } catch (e) {
    problems.push(`JS 语法错误 ${path.relative(ROOT, f)}: ${String(e.stderr || e.message).split('\n')[0]}`)
  }
}

/* 3. app.json 页面完整性 */
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
if (appJson.lazyCodeLoading !== 'requiredComponents') {
  problems.push('app.json 缺少 lazyCodeLoading: requiredComponents')
}
for (const page of appJson.pages) {
  for (const ext of ['.js', '.wxml']) {
    const p = path.join(ROOT, page + ext)
    if (!fs.existsSync(p)) problems.push(`app.json 声明的页面缺文件: ${page}${ext}`)
  }
}

/* 4. WXML 事件绑定 → JS 方法 */
const wxmls = files.filter(f => f.endsWith('.wxml'))
for (const f of wxmls) {
  const wxml = fs.readFileSync(f, 'utf8')
  const jsPath = f.replace(/\.wxml$/, '.js')
  const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''

  const handlers = new Set()
  const re = /\b(?:bind|catch|capture-bind|capture-catch)([a-z]+)\s*=\s*"([^"{}]+)"/g
  let m
  while ((m = re.exec(wxml))) handlers.add(m[2].trim())

  for (const h of handlers) {
    if (!new RegExp('(^|[\\s{,])' + h + '\\s*[(:]').test(js)) {
      problems.push(`${path.relative(ROOT, f)} 绑定的 ${h} 在 ${path.basename(jsPath)} 中未定义`)
    }
  }

  // 5. WXML 表达式限制
  const exprs = wxml.match(/\{\{[^}]*\}\}/g) || []
  for (const expr of exprs) {
    if (/\?\.|\?\?|=>/.test(expr)) {
      problems.push(`${path.relative(ROOT, f)} 含不支持的表达式: ${expr}`)
    }
  }
}

/* 6. require 路径 */
for (const f of files.filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(f, 'utf8')
  const re = /require\(['"]([^'"]+)['"]\)/g
  let m
  while ((m = re.exec(src))) {
    const target = m[1]
    if (!target.startsWith('.')) continue
    const resolved = path.resolve(path.dirname(f), target)
    const ok = fs.existsSync(resolved) || fs.existsSync(resolved + '.js')
    if (!ok) problems.push(`${path.relative(ROOT, f)} require 路径不存在: ${target}`)
  }
}

/* 7. 关键结构 */
const cloudSrc = fs.readFileSync(path.join(ROOT, 'utils/cloud.js'), 'utf8')
if (!/endpoint:\s*publicConfig\.endpoint/.test(cloudSrc)) problems.push('utils/cloud.js 未使用 publicConfig.endpoint')
if (!/publishableKey:\s*publicConfig\.publishableKey/.test(cloudSrc)) problems.push('utils/cloud.js 未使用 publicConfig.publishableKey')
if (/createWorkBuddyCloud\s*\(/.test(cloudSrc.replace(/createMiniProgramWorkBuddyCloud/g, ''))) {
  problems.push('utils/cloud.js 误用了 web 端的 createWorkBuddyCloud')
}
if (/wx\.request\s*\(/.test(cloudSrc)) problems.push('utils/cloud.js 手写了 wx.request')

/* 8. 位图工具自测 */
const slots = require(path.join(ROOT, 'utils/slots.js'))
const time = require(path.join(ROOT, 'utils/time.js'))
const bmp = slots.emptyBitmap(7)
;[0, 5, 95, 96, 200, 671].forEach(i => slots.setBit(bmp, i, 1))
const hex = slots.toHex(bmp)
const back = slots.fromHex(hex, 7)
let bitsOk = true
for (let i = 0; i < 672; i++) {
  const expect = [0, 5, 95, 96, 200, 671].includes(i) ? 1 : 0
  if (slots.getBit(back, i) !== expect) { bitsOk = false; problems.push(`位图往返错误 @${i}`) }
}
if (!bitsOk) problems.push('位图编解码不一致')
if (hex.length !== 7 * 24) problems.push(`位图长度异常: ${hex.length}`)
if (slots.countBits(back) !== 6) problems.push(`位计数异常: ${slots.countBits(back)}`)

/* 8b. 14 天窗口（当前房间默认） */
const bmp14 = slots.emptyBitmap(14)
const marks14 = [0, 95, 96, 671, 672, 1000, 1343]
marks14.forEach(i => slots.setBit(bmp14, i, 1))
const hex14 = slots.toHex(bmp14)
if (hex14.length !== 14 * 24) problems.push(`14 天位图长度异常: ${hex14.length}（应为 336）`)
const back14 = slots.fromHex(hex14, 14)
for (let i = 0; i < 14 * 96; i++) {
  const expect = marks14.includes(i) ? 1 : 0
  if (slots.getBit(back14, i) !== expect) { problems.push(`14 天位图往返错误 @${i}`); break }
}
if (slots.countBits(back14) !== marks14.length) problems.push(`14 天位计数异常: ${slots.countBits(back14)}`)

/* 9. 时间与区间 */
const ranges = time.mergeRanges([0, 1, 2, 10, 11, 96])
if (JSON.stringify(ranges) !== JSON.stringify([[0, 3], [10, 12], [96, 97]])) {
  problems.push('区间合并结果异常: ' + JSON.stringify(ranges))
}
if (time.slotTime(0) !== '00:00' || time.slotTime(32) !== '08:00' || time.slotTime(96) !== '24:00') {
  problems.push('时间标签换算异常')
}
const days = time.buildDays('2026-10-24', 7)
if (days.length !== 7 || days[0].date !== '2026-10-24' || days[6].date !== '2026-10-30') {
  problems.push('日期序列异常')
}

/* 10. 日期集合解析与展示 */
const pickedRoom = {
  selected_dates: JSON.stringify(['2026-10-26', '2026-10-24', '2026-11-02']),
  start_date: '2026-10-24',
  day_count: 3,
}
const picked = time.resolveRoomDates(pickedRoom)
if (JSON.stringify(picked) !== JSON.stringify(['2026-10-24', '2026-10-26', '2026-11-02'])) {
  problems.push('选中日期解析异常（应升序去重）: ' + JSON.stringify(picked))
}
const legacyRoom = { start_date: '2026-10-24', day_count: 3 }
const legacy = time.resolveRoomDates(legacyRoom)
if (legacy.length !== 3 || legacy[2] !== '2026-10-26') {
  problems.push('旧房间回退逻辑异常: ' + JSON.stringify(legacy))
}
const badJson = time.resolveRoomDates({ selected_dates: 'not-json', start_date: '2026-10-24', day_count: 2 })
if (badJson.length !== 2) problems.push('坏 JSON 应回退到连续区间: ' + JSON.stringify(badJson))
if (time.rangeLabel(['2026-10-24', '2026-10-25', '2026-10-26']) !== '10/24 – 10/26') {
  problems.push('连续日期文案异常: ' + time.rangeLabel(['2026-10-24', '2026-10-25', '2026-10-26']))
}
if (time.rangeLabel(['2026-10-24', '2026-10-26']) !== '10/24 等 2 天') {
  problems.push('不连续日期文案异常: ' + time.rangeLabel(['2026-10-24', '2026-10-26']))
}
if (time.rangeLabel(['2026-10-24']) !== '10/24') {
  problems.push('单日文案异常: ' + time.rangeLabel(['2026-10-24']))
}

/* 报告 */
notes.push(`扫描文件 ${files.length} 个`)
notes.push(`页面 ${appJson.pages.length} 个`)
notes.push(`位图: ${hex.length} 字符 / ${slots.countBits(back)} 位`)
console.log(notes.join('\n'))
if (problems.length) {
  console.log('\n❌ 发现 ' + problems.length + ' 个问题:')
  problems.forEach(p => console.log(' - ' + p))
  process.exit(1)
} else {
  console.log('\n✅ 全部检查通过')
}
