const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/auth')
const time = require('../../utils/time')
const slots = require('../../utils/slots')
const ui = require('../../utils/ui')
const theme = require('../../utils/theme')

const SLOTS = 96
const PALETTE = ['#3B5BFF', '#0BA5EC', '#12B76A', '#F79009', '#7A5AF8', '#EE46BC', '#F04438', '#6172F3']

function colorOf(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973
  return PALETTE[h % PALETTE.length]
}

Page({
  data: {
    roomId: 0,
    room: null,
    members: [],
    pendingMembers: [],
    filledCount: 0,
    totalMembers: 0,
    threshold: 0,
    thresholdOptions: [],
    days: [],
    totalRanges: 0,
    loading: true,
    error: '',

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
      console.error('[result] init threw', (err && err.message) || '')
      that.setData({ loading: false, error: '加载失败，请重试' })
    })
  },

  onShow() {
    theme.sync(this)
  },

  onShareAppMessage() {
    const room = this.data.room
    return {
      title: room ? room.title + '｜大家都空的时间出来了' : '同空时刻',
      path: room ? '/pages/room/room?id=' + room.id : '/pages/index/index',
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
    if (!membersResult.ok) {
      this.setData({ loading: false, error: membersResult.error })
      return
    }

    const all = membersResult.members
    const filled = all.filter(function (m) { return m.slot_count > 0 })
    const dateList = time.resolveRoomDates(room)
    const dayCount = dateList.length
    if (!dayCount) {
      this.setData({ loading: false, error: '这个房间没有可选日期' })
      return
    }

    // 逐格统计重叠人数，同时保留每个人的位图用于回溯「谁有空」
    const counts = new Array(dayCount * SLOTS).fill(0)
    const filledMembers = []
    filled.forEach(function (m) {
      const bytes = slots.fromHex(m.slots, dayCount)
      const name = m.nickname || '匿名'
      filledMembers.push({
        bits: bytes,
        view: {
          id: m.id,
          nickname: name,
          initial: name.slice(0, 1),
          color: colorOf(name),
        },
      })
      for (let i = 0; i < dayCount * SLOTS; i++) {
        if (slots.getBit(bytes, i)) counts[i] += 1
      }
    })
    this.counts = counts
    this.filledMembers = filledMembers

    const options = []
    for (let n = filled.length; n >= 2; n--) {
      options.push({ value: n, label: n === filled.length ? '全员 ' + n + ' 人' : n + ' 人及以上' })
    }

    const memberView = all.map(function (m) {
      const name = m.nickname || '匿名'
      return {
        id: m.id,
        nickname: name,
        initial: name.slice(0, 1),
        color: colorOf(name),
        filled: m.slot_count > 0,
        statusText: m.slot_count > 0 ? '已填 ' + m.slot_count + ' 格' : '还没填',
      }
    })

    this.setData({
      room: {
        id: room.id,
        title: room.title,
        code: room.code,
        dates: dateList,
        dayCount: dayCount,
      },
      members: memberView,
      pendingMembers: memberView.filter(function (m) { return !m.filled }),
      filledCount: filled.length,
      totalMembers: all.length,
      thresholdOptions: options,
      threshold: filled.length >= 2 ? filled.length : 0,
      loading: false,
    })

    this.compute(filled.length >= 2 ? filled.length : 2)
  },

  compute(threshold) {
    const room = this.data.room
    if (!room) return
    const dayCount = room.dayCount
    const counts = this.counts || []
    const members = this.filledMembers || []
    const dayMeta = time.buildDaysFromList(room.dates || [])
    const days = []
    let totalRanges = 0

    for (let d = 0; d < dayCount; d++) {
      const hits = []
      for (let i = 0; i < SLOTS; i++) {
        if ((counts[d * SLOTS + i] || 0) >= threshold) hits.push(i)
      }

      const ranges = time.mergeRanges(hits).map(function (range) {
        let minPeople = 99
        for (let i = range[0]; i < range[1]; i++) {
          const c = counts[d * SLOTS + i] || 0
          if (c < minPeople) minPeople = c
        }

        // 这一段里从头到尾都有空的人，才是真正能约的人
        const available = []
        members.forEach(function (m) {
          let allFree = true
          for (let i = range[0]; i < range[1]; i++) {
            if (!slots.getBit(m.bits, d * SLOTS + i)) {
              allFree = false
              break
            }
          }
          if (allFree) available.push(m.view)
        })

        return {
          text: time.slotTime(range[0]) + ' – ' + time.slotTime(range[1]),
          duration: time.durationText(range[1] - range[0]),
          people: minPeople,
          available: available,
          availableCount: available.length,
        }
      })

      totalRanges += ranges.length
      days.push({
        date: dayMeta[d].date,
        label: dayMeta[d].weekday + ' ' + dayMeta[d].month + '/' + dayMeta[d].dayNum,
        isToday: dayMeta[d].isToday,
        ranges: ranges,
      })
    }

    this.setData({ days: days, totalRanges: totalRanges, threshold: threshold })
  },

  pickThreshold(e) {
    const value = Number(e.currentTarget.dataset.value)
    if (value === this.data.threshold) return
    this.compute(value)
  },

  goSelect() {
    // 用 redirect 把结果页替换成勾选页，勾选完成后返回房间
    ui.redirect('/pages/select/select?id=' + this.data.roomId)
  },

  goRoom() {
    const pages = getCurrentPages()
    const prev = pages.length > 1 ? pages[pages.length - 2] : null
    if (prev && prev.route && prev.route.indexOf('pages/room/room') >= 0) {
      ui.back()
      return
    }
    ui.redirect('/pages/room/room?id=' + this.data.roomId)
  },

  retry() {
    this.setData({ loading: true, error: '' })
    this.init()
  },
})
