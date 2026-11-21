// Hàm thuần của mod "xem-ket-qua": không gọi engine, nên test được trực tiếp.

export type LoaiTep = 'anh' | 'png' | 'html'

const DUOI_ANH = new Set(['jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'heic', 'heif'])
const DUOI_HTML = new Set(['html', 'htm'])

/** Loại tệp theo đuôi: `png`, ảnh khác cần đổi sang PNG, hoặc trang HTML. */
export const loaiTep = (duongDan: string): LoaiTep | undefined => {
  const duoi = duongDan.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (duoi === 'png') return 'png'
  if (DUOI_ANH.has(duoi)) return 'anh'
  if (DUOI_HTML.has(duoi)) return 'html'
  return undefined
}

/** Chiều rộng × cao của một file PNG, đọc từ 24 byte đầu (khối IHDR). */
export const kichThuocPng = (dau: Uint8Array): { rong: number; cao: number } | undefined => {
  const chuKy = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (dau.length < 24 || chuKy.some((b, i) => dau[i] !== b)) return undefined
  const b = (i: number) => dau[i] ?? 0
  const so = (i: number) => ((b(i) << 24) | (b(i + 1) << 16) | (b(i + 2) << 8) | b(i + 3)) >>> 0
  const rong = so(16)
  const cao = so(20)
  return rong > 0 && cao > 0 ? { rong, cao } : undefined
}

/**
 * Số cột × dòng terminal để vẽ ảnh giữ đúng tỉ lệ. Một ô chữ cao gấp đôi
 * chiều rộng, nên số dòng = số cột × (cao / rộng) / 2.
 */
export const oCuaAnh = (
  rong: number,
  cao: number,
  cotToiDa: number,
  dongToiDa: number,
): { columns: number; rows: number } => {
  const tiLe = cao / rong / 2
  let columns = Math.max(1, Math.min(255, Math.floor(cotToiDa)))
  let rows = Math.round(columns * tiLe)
  if (rows > dongToiDa) {
    rows = Math.max(1, Math.floor(dongToiDa))
    columns = Math.max(1, Math.min(columns, Math.round(rows / tiLe)))
  }
  return { columns, rows: Math.max(1, Math.min(255, rows)) }
}

/** Chỉ cho chụp trang chạy trên máy này (localhost / 127.0.0.1 / [::1]). */
export const laUrlNoiBo = (url: string): boolean => {
  const m = url.match(/^https?:\/\/(\[[^\]]+\]|[^/:?#]+)(?::\d+)?(?:[/?#]|$)/i)
  if (!m?.[1]) return false
  const may = m[1].toLowerCase()
  return may === 'localhost' || may.endsWith('.localhost') || may === '127.0.0.1' || may === '[::1]'
}

/** Đường dẫn tuyệt đối → URL file:// (mã hoá ký tự đặc biệt, giữ dấu /). */
export const urlTuDuongDan = (duongDan: string): string =>
  `file://${duongDan.split('/').map(encodeURIComponent).join('/')}`

export type KhaNang =
  | { ve: 'duoc'; nguon: 'file' | 'bytes' }
  | { ve: 'co-the'; nguon: 'bytes'; vi: string }
  | { ve: 'khong'; vi: string }

/** Terminal này có vẽ được ảnh không, đọc từ biến môi trường và bề mặt của phiên. */
export const khaNangTerminal = (moiTruong: {
  surface: string | null
  termProgram?: string
  term?: string
  kittyWindowId?: string
  tmux?: string
}): KhaNang => {
  if (moiTruong.surface !== null && moiTruong.surface !== 'terminal')
    return { ve: 'khong', vi: `phiên đang chạy trong ${moiTruong.surface}, không phải terminal` }
  const tp = (moiTruong.termProgram ?? '').toLowerCase()
  const term = (moiTruong.term ?? '').toLowerCase()
  const kittyHoacGhostty =
    tp === 'ghostty' || tp === 'kitty' || term.includes('ghostty') || term.includes('kitty') || !!moiTruong.kittyWindowId
  // Trong tmux chỉ ảnh dạng byte đi qua được (cần allow-passthrough on).
  if (moiTruong.tmux)
    return kittyHoacGhostty
      ? { ve: 'co-the', nguon: 'bytes', vi: 'đang trong tmux: cần `set -g allow-passthrough on` và `focus-events on`' }
      : { ve: 'khong', vi: 'đang trong tmux trên terminal không vẽ được ảnh' }
  if (kittyHoacGhostty) return { ve: 'duoc', nguon: 'file' }
  if (tp === 'iterm.app')
    return { ve: 'co-the', nguon: 'bytes', vi: 'iTerm2 chỉ vẽ ảnh khi Claude Code chạy toàn màn hình (iTerm2 3.5 trở lên)' }
  return { ve: 'khong', vi: `terminal ${moiTruong.termProgram || moiTruong.term || 'này'} không vẽ được ảnh (cần Ghostty, kitty hoặc iTerm2)` }
}

/** Một dòng ngữ cảnh gửi kèm tin nhắn đầu: nhắc Claude tự cho người dùng xem kết quả. */
export const loiNhac = (kha: KhaNang, coChrome: boolean): string => {
  if (kha.ve === 'khong')
    return `xem-ket-qua: phiên này không vẽ được ảnh (${kha.vi}). Ảnh gửi qua show_image / show_html chỉ hiện thành đường dẫn file; đừng nói người dùng đã xem thấy.`
  const trang = coChrome ? ', một trang HTML hoặc localhost bằng show_html' : ''
  return `Terminal này hiện được ảnh ngay trong khung chat. Sau khi làm xong việc có giao diện, hãy chụp lại và cho người dùng xem trước khi báo xong, thay vì bảo họ tự mở file hay localhost: ảnh hoặc ảnh chụp màn hình bằng show_image${trang}. Sửa lỗi giao diện thì cho xem cả trước và sau (tham số compare).`
}

export type BanLuu = { duongDan: string; rong: number; cao: number }

const moTa = (b: BanLuu) => `${b.duongDan} (${b.rong}x${b.cao})`

/** Kết quả công cụ Claude đọc. Dòng "Bản lưu" cũng là nơi giao diện đọc lại ảnh để vẽ. */
export const vanBanKetQua = (p: { tieuDe: string; sau: BanLuu; truoc?: BanLuu; kha: KhaNang }): string => {
  const luu = `Bản lưu: ${moTa(p.sau)}${p.truoc ? ` | Trước: ${moTa(p.truoc)}` : ''}`
  if (p.kha.ve === 'khong')
    return `Chưa hiện được ảnh "${p.tieuDe}": ${p.kha.vi}. Người dùng chỉ thấy đường dẫn file, đừng nói họ đã xem.\n${luu}`
  const ghiChu = p.kha.ve === 'co-the' ? ` (${p.kha.vi})` : ''
  return `Đã hiện cho người dùng: "${p.tieuDe}"${p.truoc ? ', trước và sau đặt cạnh nhau' : ''}${ghiChu}. Ảnh đến màn hình người dùng, không đến bạn.\n${luu}`
}

/** Chữ trong kết quả công cụ: chuỗi, hoặc các khối `{ type: 'text', text }` lồng nhau. */
export const layChu = (v: unknown, sau = 0): string => {
  if (typeof v === 'string') return v
  if (sau > 4 || v === null || typeof v !== 'object') return ''
  if (Array.isArray(v)) return v.map(x => layChu(x, sau + 1)).join('\n')
  const o = v as Record<string, unknown>
  return [o.text, o.content, o.result].map(x => layChu(x, sau + 1)).filter(Boolean).join('\n')
}

/** Đọc lại các bản lưu từ kết quả công cụ (để vẽ, kể cả sau khi resume phiên). */
export const docBanLuu = (ketQua: unknown): { sau: BanLuu; truoc?: BanLuu } | undefined => {
  const dong = layChu(ketQua)
    .split('\n')
    .find(d => d.startsWith('Bản lưu: '))
  if (!dong) return undefined
  const mau = /(.+?\.png) \((\d+)x(\d+)\)/
  const [phanSau, phanTruoc] = dong.slice('Bản lưu: '.length).split(' | Trước: ')
  const tach = (s: string | undefined): BanLuu | undefined => {
    const m = s?.match(mau)
    return m?.[1] ? { duongDan: m[1], rong: Number(m[2]), cao: Number(m[3]) } : undefined
  }
  const sau = tach(phanSau)
  return sau ? { sau, truoc: tach(phanTruoc) } : undefined
}

/** Tên file an toàn cho bản lưu, lấy từ id của lần gọi công cụ. */
export const tenBanLuu = (id: string, phan: 'sau' | 'truoc'): string =>
  `${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-40) || 'anh'}-${phan}.png`

export type ThayDoi = { title: string; detail?: string }
export type KiemTra = { name: string; ok: boolean; detail?: string }

const laBanGhi = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

/** Lọc `changes` Claude gửi: bỏ mục sai dạng thay vì làm hỏng cả khung. */
export const docThayDoi = (v: unknown): ThayDoi[] =>
  Array.isArray(v)
    ? v.filter(laBanGhi).flatMap(x =>
        typeof x.title === 'string'
          ? [{ title: x.title, detail: typeof x.detail === 'string' ? x.detail : undefined }]
          : [],
      )
    : []

export const docKiemTra = (v: unknown): KiemTra[] =>
  Array.isArray(v)
    ? v.filter(laBanGhi).flatMap(x =>
        typeof x.name === 'string' && typeof x.ok === 'boolean'
          ? [{ name: x.name, ok: x.ok, detail: typeof x.detail === 'string' ? x.detail : undefined }]
          : [],
      )
    : []
