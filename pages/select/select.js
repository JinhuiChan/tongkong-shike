const api = require('../../utils/api')
const { ensureLogin, userId } = require('../../utils/auth')
const time = require('../../utils/time')
const slots = require('../../utils/slots')
const ui = require('../../utils/ui')
const theme = require('../../utils/theme')

const SLOTS = 96

Page({
  data: {
    roomId: 0,
    room: null,
    days: [],
    rows: [],
    colCounts: [],
    selectedCount: 0,
    weekIndex: 0,
    weekTabs: [],
    loading: true,
    error: '',
    saveState: 'idle',
    saveStateText: '',
    nickname: '',

    themeClass: theme.className(),
    nightMode: false,
  },

  onLoad(options) {
    theme.sync(this)
    const id = Number(options.id)
    if (!id) {
      this.setData({ loading: false, error: '房间信息不完整' })
      return
    }
    this.setData({ roomId: id })
    const that = this
    this.init().catch(function (err) {
      console.error('[select] init threw', (err && err.message) || '')
      that.setData({ loading: false, error: '加载失败，请重试' })
    })
  },

  onShow() {
    theme.sync(this)
  },

  onUnload() {
    this.unloaded = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.dirty) {
      this.persist(true).catch(function () {
        // 页面已销毁，失败也无法再提示，忽略
      })
    }
  },

  async init() {
    const auth = await ensureLogin()
    if (!auth.ok) {
      this.setData({ loading: false, error: auth.error || '登录失败，请重试' })
      return
    }

    const found = await api.findRoomById(this.data.roomId)
    if (!found.ok) {
      this.setData({ loading: false, error: found.error })
      return
    }
    const room = found.room

    const membersResult = await api.listMembers(this.data.roomId)
    const uid = userId()
    let mine = null
    if (membersResult.ok) {
      mine = membersResult.members.filter(function (m) { return m.owner_id === uid })[0] || null
    }

    // 房间可能只挑了 14 天里的若干天，以 selected_dates 为准
    const dateList = time.resolveRoomDates(room)
    if (!dateList.length) {
      this.setData({ loading: false, error: '这个房间没有可选日期' })
      return
    }
    const dayCount = dateList.length

    const bytes = mine ? slots.fromHex(mine.slots, dayCount) : slots.emptyBitmap(dayCount)
    const dayMeta = time.buildDaysFromList(dateList)
    const days = []
    const colCounts = []
    let total = 0

    for (let d = 0; d < dayCount; d++) {
      const cells = []
      let colCount = 0
      for (let i = 0; i < SLOTS; i++) {
        const on = slots.getBit(bytes, d * SLOTS + i)
        cells.push({ i: i, on: on })
        colCount += on
      }
      days.push({
        date: dayMeta[d].date,
        weekday: dayMeta[d].weekday,
        dayNum: dayMeta[d].dayNum,
        month: dayMeta[d].month,
        isToday: dayMeta[d].isToday,
        page: Math.floor(d / 7),
        cells: cells,
      })
      colCounts.push(colCount)
      total += colCount
    }

    // 天数多于 7 天时拆成每 7 天一页
    const weekCount = Math.ceil(dayCount / 7)
    const weekTabs = []
    for (let w = 0; w < weekCount; w++) {
      const first = dayMeta[w * 7]
      const last = dayMeta[Math.min(w * 7 + 6, dayCount - 1)]
      weekTabs.push({
        index: w,
        label: first.month + '/' + first.dayNum + ' – ' + last.month + '/' + last.dayNum,
      })
    }

    const rangeText = time.rangeLabel(dateList)

    const hasData = total > 0
    this.setData({
      room: {
        title: room.title,
        code: room.code,
        dayCount: dayCount,
        rangeText: rangeText,
      },
      days: days,
      rows: time.buildRows(),
      colCounts: colCounts,
      selectedCount: total,
      weekIndex: 0,
      weekTabs: weekTabs,
      nickname: mine ? mine.nickname : (ui.storage.get('nickname') || ''),
      loading: false,
      saveState: hasData ? 'saved' : 'idle',
      saveStateText: hasData ? '已保存' : '',
    }, () => {
      this.scrollToContent()
    })
  },

  switchWeek(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.weekIndex) return
    this.setData({ weekIndex: index })
  },

  /** 有已选内容时定位到第一格，否则定位到 08:00，避免用户从 00:00 开始滚 */
  scrollToContent() {
    const weekIndex = this.data.weekIndex || 0
    const startDay = weekIndex * 7
    const endDay = Math.min(startDay + 7, this.data.days.length)
    let anchorIndex = 32
    outer:
    for (let d = startDay; d < endDay; d++) {
      const cells = this.data.days[d].cells
      for (let i = 0; i < SLOTS; i++) {
        if (cells[i].on) {
          anchorIndex = i
          break outer
        }
      }
    }

    const query = ui.query()
    if (!query) return
    try {
      query
        .select('#row' + anchorIndex)
        .boundingClientRect()
        .selectViewport()
        .scrollOffset()
        .exec(function (res) {
          if (!res || !res[0] || !res[1]) return
          const target = res[0].top + res[1].scrollTop - 140
          ui.scrollTo(target)
        })
    } catch (err) {
      // 预览环境不支持节点查询时直接跳过定位，不影响勾选
    }
  },

  /* ---------- 选择操作 ---------- */

  toggleCell(e) {
    const di = Number(e.currentTarget.dataset.di)
    const ri = Number(e.currentTarget.dataset.ri)
    const current = this.data.days[di].cells[ri].on
    const next = current ? 0 : 1
    const patch = {}
    patch['days[' + di + '].cells[' + ri + '].on'] = next
    patch.selectedCount = this.data.selectedCount + (next ? 1 : -1)
    patch['colCounts[' + di + ']'] = this.data.colCounts[di] + (next ? 1 : -1)
    this.setData(patch)
    this.markDirty()
  },

  /** 点日期表头：整列全选 / 取消 */
  toggleColumn(e) {
    const di = Number(e.currentTarget.dataset.di)
    const target = this.data.colCounts[di] === SLOTS ? 0 : 1
    const patch = {}
    for (let i = 0; i < SLOTS; i++) {
      patch['days[' + di + '].cells[' + i + '].on'] = target
    }
    patch['colCounts[' + di + ']'] = target ? SLOTS : 0
    patch.selectedCount = this.data.selectedCount - this.data.colCounts[di] + (target ? SLOTS : 0)
    this.setData(patch)
    this.markDirty()
  },

  /** 点时间标签：该时段在所有日期上全选 / 取消 */
  toggleRow(e) {
    const ri = Number(e.currentTarget.dataset.ri)
    const days = this.data.days
    let allOn = true
    for (let di = 0; di < days.length; di++) {
      if (days[di].cells[ri].on !== 1) {
        allOn = false
        break
      }
    }
    const target = allOn ? 0 : 1
    const patch = {}
    const colCounts = this.data.colCounts.slice()
    let delta = 0

    for (let di = 0; di < days.length; di++) {
      if (days[di].cells[ri].on !== target) {
        patch['days[' + di + '].cells[' + ri + '].on'] = target
        delta += target ? 1 : -1
        colCounts[di] += target ? 1 : -1
      }
    }
    if (delta === 0) return
    patch.selectedCount = this.data.selectedCount + delta
    patch.colCounts = colCounts
    this.setData(patch)
    this.markDirty()
  },

  /** 全选：把房间内所有日期的 96 格全部标为有空 */
  selectAll() {
    const days = this.data.days
    const total = days.length * SLOTS
    if (!total) return
    if (this.data.selectedCount === total) {
      ui.toast('已经全选了')
      return
    }

    const patch = {}
    for (let di = 0; di < days.length; di++) {
      const cells = days[di].cells
      if (this.data.colCounts[di] !== SLOTS) {
        for (let i = 0; i < SLOTS; i++) {
          if (!cells[i].on) patch['days[' + di + '].cells[' + i + '].on'] = 1
        }
      }
    }
    patch.colCounts = days.map(function () { return SLOTS })
    patch.selectedCount = total
    this.setData(patch)
    this.markDirty()
    ui.toast('已全选所有时段')
  },

  clearAll() {
    if (this.data.selectedCount === 0) return
    // 只重置 cells，其余字段（尤其是分页用的 page）原样保留，
    // 否则重建对象会丢掉 page，整排日期列会从页面上消失
    const days = this.data.days.map(function (day) {
      return Object.assign({}, day, {
        cells: day.cells.map(function (cell) { return { i: cell.i, on: 0 } }),
      })
    })
    this.setData({
      days: days,
      colCounts: days.map(function () { return 0 }),
      selectedCount: 0,
    })
    this.markDirty()
  },

  /* ---------- 保存 ---------- */

  markDirty() {
    this.version = (this.version || 0) + 1
    this.dirty = true
    this.setData({ saveState: 'unsaved', saveStateText: '未保存' })
    if (this.saveTimer) clearTimeout(this.saveTimer)
    const that = this
    this.saveTimer = setTimeout(function () {
      that.persist(false)
    }, 1200)
  },

  buildHex() {
    const dayCount = this.data.room.dayCount
    const bytes = slots.emptyBitmap(dayCount)
    for (let d = 0; d < dayCount; d++) {
      const cells = this.data.days[d].cells
      for (let i = 0; i < SLOTS; i++) {
        if (cells[i].on) slots.setBit(bytes, d * SLOTS + i, 1)
      }
    }
    return slots.toHex(bytes)
  },

  /**
   * 保存队列：同一时刻只跑一次请求，期间的再次调用合并成一次补存。
   * 完成后才可能标记为已保存，避免保存途中又改动却被误判为已存。
   */
  persist(silent) {
    this.saveQueued = true
    if (this.saveRunning) return this.saveRunning
    const that = this
    this.saveRunning = this.runSaveLoop(silent).then(function (res) {
      that.saveRunning = null
      return res
    }, function (err) {
      that.saveRunning = null
      throw err
    })
    return this.saveRunning
  },

  async runSaveLoop(silent) {
    let last = { ok: true }
    while (this.saveQueued) {
      this.saveQueued = false
      last = await this.saveOnce(silent)
    }
    return last
  },

  async saveOnce(silent) {
    const version = this.version || 0
    if (!silent && !this.unloaded) this.setData({ saveState: 'saving', saveStateText: '保存中…' })

    const hex = this.buildHex()
    const count = this.data.selectedCount
    const result = await api.saveSlots(this.data.roomId, hex, count, this.data.nickname)

    if (result.ok) {
      // 只有这期间没有新的改动，才算真的存到了最新状态
      if ((this.version || 0) === version) {
        this.dirty = false
        if (!this.unloaded) this.setData({ saveState: 'saved', saveStateText: '已保存' })
      }
    } else {
      if (!this.unloaded) {
        this.setData({ saveState: 'error', saveStateText: '保存失败' })
        ui.toast(result.error)
      }
    }
    return result
  },

  async finish() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    await this.persist(false)
    if (this.dirty) await this.persist(false)
    if (this.data.saveState === 'error') {
      ui.toast('还没保存成功，再试一次')
      return
    }
    if (getCurrentPages().length > 1) ui.back()
    else ui.relaunch('/pages/index/index')
  },

  retry() {
    this.setData({ loading: true, error: '' })
    this.init()
  },
})
