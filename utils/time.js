const SLOT_MINUTES = 15
const SLOTS_PER_DAY = 96

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function parseDate(str) {
  const parts = String(str).split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function formatDate(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

function todayStr() {
  return formatDate(new Date())
}

function addDays(str, n) {
  const d = parseDate(str)
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000)
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function buildDays(startDate, dayCount) {
  const list = []
  const today = todayStr()
  for (let i = 0; i < dayCount; i++) {
    const ds = addDays(startDate, i)
    const d = parseDate(ds)
    list.push({
      date: ds,
      weekday: '周' + WEEKDAYS[d.getDay()],
      dayNum: d.getDate(),
      month: d.getMonth() + 1,
      isToday: ds === today,
    })
  }
  return list
}

/** 按显式日期列表构建日视图（房间可能只挑了其中几天） */
function buildDaysFromList(dateList) {
  const today = todayStr()
  return dateList.map(function (ds) {
    const d = parseDate(ds)
    return {
      date: ds,
      weekday: '周' + WEEKDAYS[d.getDay()],
      dayNum: d.getDate(),
      month: d.getMonth() + 1,
      isToday: ds === today,
    }
  })
}

/** 日期集合的展示文案：连续显示区间，不连续显示「10/24 等 5 天」 */
function rangeLabel(dateList) {
  if (!dateList || !dateList.length) return ''
  const first = parseDate(dateList[0])
  const firstText = (first.getMonth() + 1) + '/' + first.getDate()
  if (dateList.length === 1) return firstText

  const lastDate = dateList[dateList.length - 1]
  const last = parseDate(lastDate)
  const span = diffDays(dateList[0], lastDate) + 1
  if (span === dateList.length) {
    return firstText + ' – ' + (last.getMonth() + 1) + '/' + last.getDate()
  }
  return firstText + ' 等 ' + dateList.length + ' 天'
}

/**
 * 取房间实际统计的日期集合。
 * 以 selected_dates 为准；旧房间只有 start_date + day_count 时按连续区间展开。
 */
function resolveRoomDates(room) {
  const raw = room.selected_dates || room.selectedDates
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) {
        const valid = parsed.filter(function (d) {
          return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
        })
        if (valid.length) return valid.slice().sort()
      }
    } catch (err) {
      // JSON 解析失败则走回退逻辑
    }
  }

  const start = room.start_date || room.startDate
  const count = room.day_count || room.dayCount || 7
  if (!start) return []
  const out = []
  for (let i = 0; i < count; i++) out.push(addDays(start, i))
  return out
}

/** 0 → "00:00"，4 → "01:00"，96 → "24:00" */
function slotTime(index) {
  const total = index * SLOT_MINUTES
  return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60)
}

function durationText(slotCount) {
  const minutes = slotCount * SLOT_MINUTES
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return m + ' 分钟'
  if (m === 0) return h + ' 小时'
  return h + ' 小时 ' + m + ' 分'
}

/** 把升序索引合并成连续区间 [start, endExclusive) */
function mergeRanges(indices) {
  const ranges = []
  let start = -1
  let prev = -1
  for (let i = 0; i < indices.length; i++) {
    const cur = indices[i]
    if (start === -1) {
      start = cur
      prev = cur
      continue
    }
    if (cur === prev + 1) {
      prev = cur
      continue
    }
    ranges.push([start, prev + 1])
    start = cur
    prev = cur
  }
  if (start !== -1) ranges.push([start, prev + 1])
  return ranges
}

/** 生成网格的行定义：每小时第一行带时间标签 */
function buildRows() {
  const rows = []
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    rows.push({
      index: i,
      label: i % 4 === 0 ? slotTime(i) : '',
      hourStart: i % 4 === 0,
    })
  }
  return rows
}

module.exports = {
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  pad2,
  parseDate,
  formatDate,
  todayStr,
  addDays,
  diffDays,
  buildDays,
  buildDaysFromList,
  rangeLabel,
  resolveRoomDates,
  slotTime,
  durationText,
  mergeRanges,
  buildRows,
}
