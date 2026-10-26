const api = require('../../utils/api')
const { ensureLogin } = require('../../utils/auth')
const time = require('../../utils/time')
const ui = require('../../utils/ui')
const theme = require('../../utils/theme')
const { BUILD_STAMP } = require('../../config')

// 创建时可选的天数范围：今天起 14 天
const CANDIDATE_DAYS = 14
// 左滑达到按钮宽度的 25% 就展开；滑到 75% 松手直接进入删除确认
const SWIPE_REVEAL_RATIO = 0.25
const SWIPE_DELETE_RATIO = 0.75

/** 候选日期：今天起 14 天，默认一天都不选，由用户自己挑 */
function buildCandidates(allChecked) {
  const days = time.buildDays(time.todayStr(), CANDIDATE_DAYS)
  return days.map(function (day, index) {
    let weekday = day.weekday
    if (index === 0) weekday = '今天'
    else if (index === 1) weekday = '明天'
    else if (index === 2) weekday = '后天'
    return {
      value: day.date,
      weekday: weekday,
      label: day.month + '/' + day.dayNum,
      checked: allChecked ? 1 : 0,
    }
  })
}

function countChecked(list) {
  let n = 0
  for (let i = 0; i < list.length; i++) if (list[i].checked) n += 1
  return n
}

Page({
  data: {
    nickname: '',
    myRooms: [],
    loadingRooms: true,
    loginError: '',
    previewMode: false,
    submitting: false,

    creating: false,
    joining: false,
    titleInput: '',
    candidateDates: [],
    pickedCount: 0,
    codeInput: '',
    formNickname: '',
    formError: '',
    buildStamp: BUILD_STAMP,

    deletingRoom: null,
    confirmingDelete: false,
    deleting: false,

    themeClass: theme.className(),
    nightMode: false,
  },

  onLoad() {
    theme.sync(this)
    const nickname = ui.storage.get('nickname', '')
    const candidates = buildCandidates(false)
    // 左滑露出的删除按钮宽度（160rpx 换算成 px）
    let windowWidth = 375
    try {
      if (typeof wx.getSystemInfoSync === 'function') windowWidth = wx.getSystemInfoSync().windowWidth || 375
    } catch (err) {
      windowWidth = 375
    }
    this.deleteWidth = Math.round(160 * windowWidth / 750)
    this.setData({
      nickname: nickname,
      formNickname: nickname,
      candidateDates: candidates,
      pickedCount: countChecked(candidates),
    })
    this.prepare()
  },

  onShow() {
    theme.sync(this)
    if (this.loadedOnce) this.loadMyRooms()
  },

  toggleTheme() {
    theme.toggle(this)
  },

  async prepare() {
    try {
      const auth = await ensureLogin()
      if (!auth.ok) {
        const message = auth.error || '登录失败，请重试'
        // 预览面板本身无法完成微信登录，单独给出可执行的指引
        const isPreview = /微信中体验|预览|preview/i.test(message)
        this.setData({
          loginError: isPreview ? '' : message,
          previewMode: isPreview,
          loadingRooms: false,
        })
        return
      }
      this.setData({ loginError: '', previewMode: false })
      this.loadedOnce = true
      await this.loadMyRooms()
    } catch (err) {
      console.error('[index] prepare failed', (err && err.message) || '')
      this.setData({ loginError: '加载失败，请重试', loadingRooms: false })
    }
  },

  async loadMyRooms() {
    try {
      const result = await api.listMyRooms(20)
      if (!result.ok) {
        this.setData({ loadingRooms: false })
        return
      }
      const rooms = result.rooms.map(function (room) {
        return {
          id: room.id,
          code: room.code,
          title: room.title,
          dayText: room.dayCount > 1 ? '选定 ' + room.dayCount + ' 天' : '单日',
          slotText: room.mySlotCount > 0 ? '我已填 ' + room.mySlotCount + ' 格' : '我还没填',
          filled: room.mySlotCount > 0,
          isOwner: room.isOwner,
          canSwipe: room.isOwner,
          offset: 0,
          animating: false,
        }
      })
      this.setData({ myRooms: rooms, loadingRooms: false })
    } catch (err) {
      console.error('[index] loadMyRooms failed', (err && err.message) || '')
      this.setData({ loadingRooms: false })
    }
  },

  retryLogin() {
    if (this.data.submitting) return
    this.setData({ loginError: '', loadingRooms: true })
    this.prepare()
  },

  /* ---------- 创建 ---------- */
  openCreate() {
    const candidates = buildCandidates(false)
    this.setData({
      creating: true,
      joining: false,
      titleInput: '',
      formError: '',
      formNickname: this.data.nickname || ui.storage.get('nickname', ''),
      candidateDates: candidates,
      pickedCount: countChecked(candidates),
    })
  },

  openJoin() {
    this.setData({
      joining: true,
      creating: false,
      codeInput: '',
      formError: '',
      formNickname: this.data.nickname || ui.storage.get('nickname', ''),
    })
  },

  closeSheet() {
    if (this.data.submitting) return
    this.setData({ creating: false, joining: false })
  },

  noop() {},

  onTitleInput(e) {
    this.setData({ titleInput: e.detail.value })
  },

  onCodeInput(e) {
    this.setData({ codeInput: (e.detail.value || '').replace(/\D/g, '').slice(0, 6) })
  },

  onFormNickname(e) {
    this.setData({ formNickname: e.detail.value })
  },

  /** 单日切换 */
  toggleDate(e) {
    const index = Number(e.currentTarget.dataset.index)
    const current = this.data.candidateDates[index]
    if (!current) return
    const next = current.checked ? 0 : 1
    const patch = {}
    patch['candidateDates[' + index + '].checked'] = next
    patch.pickedCount = this.data.pickedCount + (next ? 1 : -1)
    this.setData(patch)
  },

  selectAllDates() {
    if (this.data.pickedCount === this.data.candidateDates.length) return
    const patch = {}
    for (let i = 0; i < this.data.candidateDates.length; i++) {
      if (!this.data.candidateDates[i].checked) patch['candidateDates[' + i + '].checked'] = 1
    }
    patch.pickedCount = this.data.candidateDates.length
    this.setData(patch)
  },

  clearDates() {
    if (this.data.pickedCount === 0) return
    const patch = {}
    for (let i = 0; i < this.data.candidateDates.length; i++) {
      if (this.data.candidateDates[i].checked) patch['candidateDates[' + i + '].checked'] = 0
    }
    patch.pickedCount = 0
    this.setData(patch)
  },

  saveNickname(name) {
    const trimmed = (name || '').trim().slice(0, 12)
    if (!trimmed) return ''
    ui.storage.set('nickname', trimmed)
    this.setData({ nickname: trimmed })
    return trimmed
  },

  async submitCreate() {
    if (this.data.submitting) return
    const nickname = this.saveNickname(this.data.formNickname)
    if (!nickname) {
      ui.toast('先填一个昵称')
      return
    }
    const title = (this.data.titleInput || '').trim() || '约时间'
    const dates = this.data.candidateDates
      .filter(function (c) { return c.checked })
      .map(function (c) { return c.value })
    if (!dates.length) {
      ui.toast('至少选一天')
      return
    }

    this.setData({ submitting: true, formError: '' })

    let result
    try {
      ui.loading('创建中')
      result = await api.createRoom({
        title: title.slice(0, 20),
        dates: dates,
        nickname: nickname,
      })
    } catch (err) {
      console.error('[index] createRoom threw', (err && err.message) || '')
      result = { ok: false, error: '创建失败，请重试' }
    } finally {
      ui.hideLoading()
      this.setData({ submitting: false })
    }

    if (!result.ok) {
      this.setData({ formError: result.error || '创建失败，请重试' })
      return
    }

    // 创建者自动成为第一位成员；这一步失败不影响已建好的房间
    try {
      await api.joinRoom(result.room.id, nickname)
    } catch (err) {
      console.warn('[index] joinRoom after create failed', (err && err.message) || '')
    }

    this.setData({ creating: false, formError: '', loginError: '' })
    this.loadedOnce = true
    this.loadMyRooms()
    ui.navigate('/pages/room/room?id=' + result.room.id)
  },

  async submitJoin() {
    if (this.data.submitting) return
    const nickname = this.saveNickname(this.data.formNickname)
    if (!nickname) {
      ui.toast('先填一个昵称')
      return
    }
    const code = this.data.codeInput
    if (code.length !== 6) {
      ui.toast('请输入 6 位房号')
      return
    }

    this.setData({ submitting: true, formError: '' })

    let found
    let joined
    try {
      ui.loading('查找中')
      found = await api.findRoomByCode(code)
      if (found.ok) joined = await api.joinRoom(found.room.id, nickname)
    } catch (err) {
      console.error('[index] join threw', (err && err.message) || '')
      found = { ok: false, error: '加入失败，请重试' }
    } finally {
      ui.hideLoading()
      this.setData({ submitting: false })
    }

    if (!found.ok) {
      this.setData({ formError: found.error || '加入失败，请重试' })
      return
    }
    if (!joined || !joined.ok) {
      this.setData({ formError: (joined && joined.error) || '加入失败，请重试' })
      return
    }

    this.setData({ joining: false, formError: '', loginError: '' })
    this.loadedOnce = true
    this.loadMyRooms()
    ui.navigate('/pages/room/room?id=' + found.room.id)
  },

  openRoom(e) {
    if (this.suppressTap) {
      this.suppressTap = false
      return
    }
    if (this.openedIndex !== undefined) {
      this.resetRow(this.openedIndex)
      return
    }
    ui.navigate('/pages/room/room?id=' + e.currentTarget.dataset.id)
  },

  /* ---------- 左滑删除 ---------- */

  onRowTouchStart(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.myRooms[index]
    if (!item || !item.canSwipe) {
      this.touchIndex = undefined
      return
    }
    if (this.openedIndex !== undefined && this.openedIndex !== index) {
      this.resetRow(this.openedIndex)
    }
    this.touchIndex = index
    this.startX = e.touches[0].clientX
    this.startY = e.touches[0].clientY
    this.baseOffset = item.offset || 0
    this.horizontal = null
    this.moved = false
  },

  onRowTouchMove(e) {
    const index = this.touchIndex
    if (index === undefined) return
    const dx = e.touches[0].clientX - this.startX
    const dy = e.touches[0].clientY - this.startY

    // 先判断是横向还是纵向，纵向交给页面滚动
    if (this.horizontal === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      this.horizontal = Math.abs(dx) > Math.abs(dy)
    }
    if (!this.horizontal) return

    this.moved = true
    let offset = this.baseOffset + dx
    if (offset > 0) offset = 0
    if (offset < -this.deleteWidth) offset = -this.deleteWidth

    const patch = {}
    patch['myRooms[' + index + '].offset'] = offset
    this.setData(patch)
  },

  onRowTouchEnd() {
    const index = this.touchIndex
    if (index === undefined) return
    const item = this.data.myRooms[index]
    const distance = Math.abs((item && item.offset) || 0)
    const open = distance > this.deleteWidth * SWIPE_REVEAL_RATIO
    const triggerDelete = open && distance >= this.deleteWidth * SWIPE_DELETE_RATIO

    const patch = {}
    patch['myRooms[' + index + '].offset'] = open ? -this.deleteWidth : 0
    patch['myRooms[' + index + '].animating'] = true
    this.setData(patch)
    this.openedIndex = open ? index : undefined

    // 滑过之后不应再触发点击进入
    if (this.moved) this.suppressTap = true

    const that = this
    setTimeout(function () {
      if (!that.data.myRooms[index]) return
      const reset = {}
      reset['myRooms[' + index + '].animating'] = false
      that.setData(reset)
    }, 220)

    // 大幅左滑：松手后直接进入删除确认，不再要求用户找红色按钮
    if (triggerDelete) this.requestDelete(index)

    this.touchIndex = undefined
    this.moved = false
  },

  onRowTouchCancel() {
    this.onRowTouchEnd()
  },

  resetRow(index) {
    if (!this.data.myRooms[index]) return
    const patch = {}
    patch['myRooms[' + index + '].offset'] = 0
    patch['myRooms[' + index + '].animating'] = true
    this.setData(patch)
    if (this.openedIndex === index) this.openedIndex = undefined
  },

  requestDelete(index) {
    const room = this.data.myRooms[index]
    if (!room) return
    this.setData({ deletingRoom: room, confirmingDelete: true })
  },

  askDelete(e) {
    const id = Number(e.currentTarget.dataset.id)
    const index = this.data.myRooms.findIndex(function (r) { return r.id === id })
    if (index < 0) return
    this.requestDelete(index)
  },

  closeDelete() {
    if (this.data.deleting) return
    this.setData({ confirmingDelete: false, deletingRoom: null })
    if (this.openedIndex !== undefined) this.resetRow(this.openedIndex)
  },

  async doDelete() {
    const room = this.data.deletingRoom
    if (!room || this.data.deleting) return
    this.setData({ deleting: true })

    let result
    try {
      result = await api.deleteRoom(room.id)
    } catch (err) {
      result = { ok: false, error: '删除失败，请重试' }
    } finally {
      this.setData({ deleting: false })
    }

    if (!result.ok) {
      this.setData({ confirmingDelete: false, deletingRoom: null })
      ui.toast(result.error || '删除失败，请重试')
      this.loadMyRooms()
      return
    }

    this.setData({ confirmingDelete: false, deletingRoom: null })
    this.openedIndex = undefined
    ui.toast('已删除')
    this.loadMyRooms()
  },
})
