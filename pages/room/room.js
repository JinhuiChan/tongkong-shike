const api = require('../../utils/api')
const { ensureLogin, userId } = require('../../utils/auth')
const time = require('../../utils/time')
const ui = require('../../utils/ui')
const theme = require('../../utils/theme')

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
    isMember: false,
    isOwner: false,
    filledCount: 0,
    loading: true,
    error: '',
    needNickname: false,
    nicknameInput: '',
    submitting: false,
    memberError: false,

    renaming: false,
    renameInput: '',
    renameError: '',
    confirmingDelete: false,
    deleting: false,

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
    this.bootstrap().catch(function (err) {
      console.error('[room] bootstrap threw', (err && err.message) || '')
    })
  },

  onShow() {
    theme.sync(this)
    if (this.loadedOnce) this.refreshMembers()
  },

  async bootstrap() {
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

    const dateList = time.resolveRoomDates(found.room)
    this.setData({
      isOwner: found.room.owner_id === userId(),
      room: {
        id: found.room.id,
        code: found.room.code,
        title: found.room.title,
        rangeText: time.rangeLabel(dateList),
        dayCount: dateList.length,
        dates: dateList,
      },
    })

    await this.refreshMembers()

    const nickname = ui.storage.get('nickname')
    const mine = this.data.members.filter(function (m) { return m.isMe })
    if (mine.length === 0) {
      if (nickname) {
        await api.joinRoom(this.data.roomId, nickname)
        await this.refreshMembers()
      } else {
        this.setData({ needNickname: true, nicknameInput: '' })
      }
    } else {
      ui.storage.set('nickname', mine[0].nickname)
    }

    this.loadedOnce = true
    this.setData({ loading: false })
  },

  async refreshMembers() {
    const result = await api.listMembers(this.data.roomId)
    if (!result.ok) {
      this.setData({ memberError: true })
      return false
    }

    const uid = userId()
    let filled = 0
    const members = result.members.map(function (m) {
      const hasData = m.slot_count > 0
      if (hasData) filled += 1
      const nickname = m.nickname || '匿名'
      return {
        id: m.id,
        nickname: nickname,
        initial: nickname.slice(0, 1),
        color: colorOf(nickname),
        slotCount: m.slot_count,
        statusText: hasData ? '已填 ' + m.slot_count + ' 格' : '还没填',
        filled: hasData,
        isMe: m.owner_id === uid,
      }
    })

    this.setData({
      members: members,
      memberError: false,
      filledCount: filled,
      isMember: members.some(function (m) { return m.isMe }),
      progressPercent: members.length ? Math.round(filled / members.length * 100) : 0,
    })
    return true
  },

  async submitNickname() {
    const name = (this.data.nicknameInput || '').trim().slice(0, 12)
    if (!name) {
      ui.toast('先填一个昵称')
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })

    let joined
    try {
      joined = await api.joinRoom(this.data.roomId, name)
    } catch (err) {
      joined = { ok: false, error: '加入失败，请重试' }
    } finally {
      this.setData({ submitting: false })
    }

    if (!joined.ok) {
      ui.toast(joined.error)
      return
    }
    ui.storage.set('nickname', name)
    this.setData({ needNickname: false })
    await this.refreshMembers()
  },

  onNicknameInput(e) {
    this.setData({ nicknameInput: e.detail.value })
  },

  noop() {},

  askJoin() {
    this.setData({ needNickname: true, nicknameInput: ui.storage.get('nickname') })
  },

  dismissJoin() {
    this.setData({ needNickname: false })
  },

  copyCode() {
    if (!this.data.room) return
    const ok = ui.copy(this.data.room.code)
    ui.toast(ok ? '房号已复制' : '请长按房号手动复制')
  },

  /* ---------- 改名（仅创建者） ---------- */
  openRename() {
    if (!this.data.isOwner || !this.data.room) return
    this.setData({ renaming: true, renameInput: this.data.room.title, renameError: '' })
  },

  closeRename() {
    if (this.data.submitting) return
    this.setData({ renaming: false, renameError: '' })
  },

  onRenameInput(e) {
    this.setData({ renameInput: e.detail.value })
  },

  async submitRename() {
    if (this.data.submitting) return
    const title = (this.data.renameInput || '').trim().slice(0, 20)
    if (!title) {
      ui.toast('名字不能为空')
      return
    }
    if (title === this.data.room.title) {
      this.setData({ renaming: false })
      return
    }

    this.setData({ submitting: true, renameError: '' })
    let result
    try {
      result = await api.renameRoom(this.data.roomId, title)
    } catch (err) {
      result = { ok: false, error: '改名失败，请重试' }
    } finally {
      this.setData({ submitting: false })
    }

    if (!result.ok) {
      this.setData({ renameError: result.error || '改名失败，请重试' })
      return
    }
    this.setData({
      renaming: false,
      'room.title': result.room.title,
    })
    ui.toast('名字已更新')
  },

  /* ---------- 删除（仅创建者） ---------- */
  confirmDelete() {
    if (!this.data.isOwner) return
    this.setData({ confirmingDelete: true })
  },

  closeDelete() {
    if (this.data.deleting) return
    this.setData({ confirmingDelete: false })
  },

  async doDelete() {
    if (this.data.deleting) return
    this.setData({ deleting: true })

    let result
    try {
      result = await api.deleteRoom(this.data.roomId)
    } catch (err) {
      result = { ok: false, error: '删除失败，请重试' }
    } finally {
      this.setData({ deleting: false })
    }

    if (!result.ok) {
      this.setData({ confirmingDelete: false })
      ui.toast(result.error || '删除失败，请重试')
      return
    }
    this.setData({ confirmingDelete: false })
    ui.toast('已删除')
    ui.relaunch('/pages/index/index')
  },

  goSelect() {
    if (!this.data.room) return
    if (!this.data.isMember) {
      this.askJoin()
      return
    }
    ui.navigate('/pages/select/select?id=' + this.data.roomId)
  },

  goResult() {
    if (this.data.filledCount < 2) {
      ui.toast('至少 2 人填写后才能看结果')
      return
    }
    ui.navigate('/pages/result/result?id=' + this.data.roomId)
  },

  goHome() {
    ui.relaunch('/pages/index/index')
  },

  retry() {
    this.setData({ loading: true, error: '' })
    this.bootstrap()
  },

  onShareAppMessage() {
    const room = this.data.room
    if (!room) {
      return { title: '来一起找共同空闲时间', path: '/pages/index/index' }
    }
    return {
      title: room.title + '｜选一下你哪天有空',
      path: '/pages/room/room?id=' + room.id,
    }
  },

  onShareTimeline() {
    const room = this.data.room
    if (!room) return { title: '同空时刻' }
    return {
      title: room.title + '｜选一下你哪天有空',
      query: 'id=' + room.id,
    }
  },
})
