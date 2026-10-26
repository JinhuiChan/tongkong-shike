const { SLOTS_PER_DAY } = require('./time')

const BYTES_PER_DAY = SLOTS_PER_DAY / 8

function emptyBitmap(dayCount) {
  return new Uint8Array(dayCount * BYTES_PER_DAY)
}

function getBit(bytes, index) {
  return (bytes[index >> 3] >> (index & 7)) & 1
}

function setBit(bytes, index, value) {
  const byte = index >> 3
  const mask = 1 << (index & 7)
  if (value) bytes[byte] = bytes[byte] | mask
  else bytes[byte] = bytes[byte] & ~mask
}

function toHex(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

function fromHex(hex, dayCount) {
  const expected = dayCount * BYTES_PER_DAY * 2
  let src = typeof hex === 'string' ? hex : ''
  if (src.length < expected) src = src + new Array(expected - src.length + 1).join('0')
  const bytes = new Uint8Array(dayCount * BYTES_PER_DAY)
  for (let i = 0; i < bytes.length; i++) {
    const parsed = parseInt(src.substr(i * 2, 2), 16)
    bytes[i] = isNaN(parsed) ? 0 : parsed
  }
  return bytes
}

function countBits(bytes) {
  let total = 0
  for (let i = 0; i < bytes.length; i++) {
    let v = bytes[i]
    while (v) {
      total += v & 1
      v >>= 1
    }
  }
  return total
}

module.exports = { BYTES_PER_DAY, emptyBitmap, getBit, setBit, toHex, fromHex, countBits }
