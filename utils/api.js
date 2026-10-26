const { cloud } = require('./cloud')
const { ensureLogin, userId } = require('./auth')
const { withTimeout } = require('./async')
const time = require('./time')

// 数据库单次往返上限：超时即明确失败，不让页面无限等待
const DB_TIMEOUT = 15000

function friendlyDbError(error) {
  const code = error && error.code
  if (code === 'TIMEOUT') return '请求超时，请检查网络后重试'
  if (code === '42501') return '没有权限执行该操作'
  if (code === '42P01') return '服务暂时不可用，请稍后重试'
  if (code === '23505') return '数据已存在'
  if (code === 'PGRST116') return '这条记录已经不存在了'
  if (code === 'PGRST301') return '数据已失效，请刷新重试'
  return '网络异常，请稍后重试'
}

/** 执行一次查询并把超时统一转成 { data, error } 形态 */
async function exec(builder) {
  try {
    return await withTimeout(builder, DB_TIMEOUT, 'database')
  } catch (err) {
    return {
      data: null,
      error: { code: err && err.timeout ? 'TIMEOUT' : 'NETWORK', message: (err && err.message) || 'database error' },
    }
  }
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function withAuth() {
  const auth = await ensureLogin()
  if (!auth.ok) return { ok: false, error: auth.error || '登录失败，请重试' }
  return { ok: true }
}

/** 创建房间，失败时自动换一个房号重试 */
async function createRoom(options) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const dates = (options.dates || []).slice().sort()
  if (!dates.length) return { ok: false, error: '至少选一天' }

  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await exec(cloud.database
      .from('rooms')
      .insert({
        code: randomCode(),
        title: options.title,
        start_date: dates[0],
        day_count: dates.length,
        selected_dates: JSON.stringify(dates),
        owner_name: options.nickname,
      })
      .select())

    if (!result.error && result.data && result.data.length) {
      return { ok: true, room: result.data[0] }
    }
    if (result.error && result.error.code === '23505') continue
    // 超时换号重试没有意义，直接返回
    if (result.error && result.error.code === 'TIMEOUT') {
      return { ok: false, error: friendlyDbError(result.error) }
    }
    console.warn('[api] createRoom failed', result.error && result.error.code)
    return { ok: false, error: friendlyDbError(result.error) }
  }
  return { ok: false, error: '房号生成失败，请重试' }
}

/** 按房号找房间 */
async function findRoomByCode(code) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const result = await exec(cloud.database
    .from('rooms')
    .select('id, code, title, start_date, day_count, selected_dates, owner_id, owner_name, created_at')
    .eq('code', code)
    .maybeSingle())

  if (result.error) {
    console.warn('[api] findRoomByCode failed', result.error && result.error.code)
    return { ok: false, error: friendlyDbError(result.error) }
  }
  if (!result.data) return { ok: false, error: '没找到这个房间，检查一下房号' }
  return { ok: true, room: result.data }
}

/** 按 id 读房间 */
async function findRoomById(roomId) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const result = await exec(cloud.database
    .from('rooms')
    .select('id, code, title, start_date, day_count, selected_dates, owner_id, owner_name, created_at')
    .eq('id', roomId)
    .maybeSingle())

  if (result.error) {
    console.warn('[api] findRoomById failed', result.error && result.error.code)
    return { ok: false, error: friendlyDbError(result.error) }
  }
  if (!result.data) return { ok: false, error: '这个房间不存在或已被删除' }
  return { ok: true, room: result.data }
}

/** 读取房间内全部成员 */
async function listMembers(roomId) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const result = await exec(cloud.database
    .from('members')
    .select('id, owner_id, nickname, slots, slot_count, updated_at')
    .eq('room_id', roomId)
    .order('id', { ascending: true }))

  if (result.error) {
    console.warn('[api] listMembers failed', result.error && result.error.code)
    return { ok: false, error: friendlyDbError(result.error) }
  }
  return { ok: true, members: result.data || [] }
}

/** 加入房间：已有记录则只更新昵称，避免覆盖别人已填的空闲 */
async function joinRoom(roomId, nickname) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const uid = userId()
  if (!uid) return { ok: false, error: '登录状态异常，请退出小程序后重新进入' }

  const existing = await exec(cloud.database
    .from('members')
    .select('id, nickname, slot_count')
    .eq('room_id', roomId)
    .eq('owner_id', uid)
    .maybeSingle())

  if (existing.error) {
    console.warn('[api] joinRoom lookup failed', existing.error && existing.error.code)
    return { ok: false, error: friendlyDbError(existing.error) }
  }

  if (existing.data) {
    if (existing.data.nickname !== nickname) {
      const updated = await exec(cloud.database
        .from('members')
        .update({ nickname: nickname })
        .eq('id', existing.data.id)
        .select())
      if (updated.error) return { ok: false, error: friendlyDbError(updated.error) }
    }
    return { ok: true, member: existing.data, isNew: false }
  }

  const inserted = await exec(cloud.database
    .from('members')
    .insert({ room_id: roomId, nickname: nickname, slots: '', slot_count: 0 })
    .select())

  if (inserted.error) {
    // 并发下可能已被另一处插入，按已存在处理
    if (inserted.error.code === '23505') return { ok: true, member: null, isNew: false }
    console.warn('[api] joinRoom insert failed', inserted.error && inserted.error.code)
    return { ok: false, error: friendlyDbError(inserted.error) }
  }
  return { ok: true, member: inserted.data[0], isNew: true }
}

/** 保存自己勾选的空闲位图 */
async function saveSlots(roomId, hex, count, nickname) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const payload = {
    slots: hex,
    slot_count: count,
    updated_at: new Date().toISOString(),
  }
  // 昵称缺失时不覆盖已有昵称，避免把成员显示成匿名
  if (nickname) payload.nickname = nickname

  const result = await exec(cloud.database
    .from('members')
    .update(payload)
    .eq('room_id', roomId)
    .eq('owner_id', userId())
    .select())

  if (result.error) {
    console.warn('[api] saveSlots failed', result.error && result.error.code)
    return { ok: false, error: friendlyDbError(result.error) }
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return { ok: false, error: '保存没有生效，请重新进入房间后再试' }
  }
  return { ok: true, member: result.data[0] }
}

/** 改房间名（仅创建者，RLS 会挡住其他人） */
async function renameRoom(roomId, title) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const result = await exec(cloud.database
    .from('rooms')
    .update({ title: title })
    .eq('id', roomId)
    .select())

  if (result.error) {
    console.warn('[api] renameRoom failed', result.error && result.error.code)
    return { ok: false, error: friendlyDbError(result.error) }
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return { ok: false, error: '只有创建者可以改这个局的名字' }
  }
  return { ok: true, room: result.data[0] }
}

/** 删除房间（仅创建者；成员记录由外键级联删除） */
async function deleteRoom(roomId) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const result = await exec(cloud.database
    .from('rooms')
    .delete()
    .eq('id', roomId)
    .select())

  if (result.error) {
    console.warn('[api] deleteRoom failed', result.error && result.error.code)
    return { ok: false, error: friendlyDbError(result.error) }
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return { ok: false, error: '只有创建者可以删除这个局' }
  }
  return { ok: true }
}

/** 我参与过的房间（用于首页列表） */
async function listMyRooms(limit) {
  const auth = await withAuth()
  if (!auth.ok) return auth

  const uid = userId()
  if (!uid) return { ok: true, rooms: [] }

  const memberships = await exec(cloud.database
    .from('members')
    .select('room_id, slot_count, nickname')
    .eq('owner_id', uid)
    .order('id', { ascending: false })
    .limit(limit || 20))

  if (memberships.error) {
    console.warn('[api] listMyRooms failed', memberships.error && memberships.error.code)
    return { ok: false, error: friendlyDbError(memberships.error) }
  }

  const rows = memberships.data || []
  if (!rows.length) return { ok: true, rooms: [] }

  const ids = rows.map(function (r) { return r.room_id })
  const roomsResult = await exec(cloud.database
    .from('rooms')
    .select('id, code, title, start_date, day_count, selected_dates, owner_id')
    .in('id', ids))

  if (roomsResult.error) return { ok: false, error: friendlyDbError(roomsResult.error) }

  const map = {}
  ;(roomsResult.data || []).forEach(function (room) { map[room.id] = room })

  const rooms = rows
    .filter(function (r) { return map[r.room_id] })
    .map(function (r) {
      const room = map[r.room_id]
      const dates = time.resolveRoomDates(room)
      return {
        id: room.id,
        code: room.code,
        title: room.title,
        dates: dates,
        dayCount: dates.length,
        isOwner: room.owner_id === uid,
        mySlotCount: r.slot_count,
      }
    })

  return { ok: true, rooms: rooms }
}

module.exports = {
  createRoom,
  findRoomByCode,
  findRoomById,
  listMembers,
  joinRoom,
  saveSlots,
  listMyRooms,
  renameRoom,
  deleteRoom,
}
