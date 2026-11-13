/**
 * zip.js — minimal ZIP writer ("stored", no compression), pure (Fase 5B).
 *
 * Used to download the stems as one file: browsers block or ask permission
 * for several downloads fired by one click (in the final review Chrome only
 * kept the first stem). WAV barely compresses, so storing is enough and the
 * writer stays small. File names are UTF-8 (general purpose flag bit 11).
 */

let CRC_TABLE = null

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE
  CRC_TABLE = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    CRC_TABLE[n] = c >>> 0
  }
  return CRC_TABLE
}

/** CRC-32 (the one ZIP uses) of a byte array. */
export function crc32(bytes) {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date()
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

const toBytes = (data) => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (typeof data === 'string') return new TextEncoder().encode(data)
  throw new TypeError('zip: unsupported file data')
}

/**
 * Build a ZIP archive.
 * @param {{ name: string, data: Uint8Array|ArrayBuffer|string }[]} files
 * @param {{ date?: Date }} [options]
 * @returns {Uint8Array}
 */
export function createZip(files, { date } = {}) {
  const encoder = new TextEncoder()
  const { time, date: dosDate } = dosDateTime(date)
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(String(file.name))
    const data = toBytes(file.data)
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)
    locals.push(local, data)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // central directory header
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    // extra, comment, disk, internal attrs, external attrs: 0
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + data.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central directory
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let pos = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}

/**
 * Read back a stored ZIP (tests / debugging): [{ name, data }].
 * Only what createZip writes (no compression, no ZIP64).
 */
export function readZip(bytes) {
  const u8 = toBytes(bytes)
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let eocd = -1
  for (let i = u8.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const files = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory')
    const crc = view.getUint32(p + 16, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = decoder.decode(u8.subarray(p + 46, p + 46 + nameLen))
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLen + localExtraLen
    const data = u8.slice(start, start + size)
    files.push({ name, data, crc, crcOk: crc32(data) === crc })
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}
