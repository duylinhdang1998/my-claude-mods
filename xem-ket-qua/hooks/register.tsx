// Mod "xem-ket-qua": Claude cho người dùng xem kết quả (ảnh, ảnh chụp trang HTML /
// localhost) ngay trong terminal, kèm so sánh trước/sau, danh sách thay đổi và kiểm tra.
import type { EngineInterface, ImageSource, Register } from 'claude-code'

import {
  docBanLuu,
  docKiemTra,
  docThayDoi,
  kichThuocPng,
  khaNangTerminal,
  laUrlNoiBo,
  loaiTep,
  loiNhac,
  oCuaAnh,
  tenBanLuu,
  urlTuDuongDan,
  vanBanKetQua,
} from './lib'
import type { BanLuu, KhaNang } from './lib'

const TEN = 'xem-ket-qua'
const CC_ANH = `mcp__${TEN}__show_image`
const CC_TRANG = `mcp__${TEN}__show_html`
const HAI_MIB = 2 * 1024 * 1024
const CANH_TOI_DA = 1600

const CHROME_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]
const CHROME_LINUX = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']

const GHI_CHU_THU_MUC =
  'Lưu ảnh chụp / bản ghi chỉ để cho xem vào thư mục tạm ($TMPDIR, /tmp hoặc scratchpad của phiên), không lưu vào project, trừ khi người dùng muốn giữ hoặc project đã có thư mục cho chúng.'

const THAY_DOI = {
  type: 'array',
  description: 'Đã thay đổi gì, mỗi mục vài chữ: { title, detail? }',
  items: {
    type: 'object',
    properties: { title: { type: 'string' }, detail: { type: 'string' } },
    required: ['title'],
  },
}
const KIEM_TRA = {
  type: 'array',
  description:
    'Chỉ những kiểm tra đã chạy thật (đo được, không phải nhìn ước chừng): { name (một câu nói đã kiểm tra gì, có giá trị cụ thể), ok, detail? (bắt buộc khi ok=false: mong đợi vs thực tế) }',
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } },
    required: ['name', 'ok'],
  },
}

const MO_TA_ANH = `Hiện một file ảnh cho người dùng xem ngay trong terminal. Nhận PNG, JPEG, WebP, GIF, TIFF, BMP, HEIC.

Tự dùng, không cần được yêu cầu, mỗi khi bạn vừa làm hoặc sửa thứ gì có hình ảnh, trước khi báo xong: chụp trang / component bằng Playwright headless, hoặc cho xem bản thiết kế, biểu đồ, slide, ảnh đã tạo. Dùng thay cho việc bảo người dùng tự mở file hay localhost. Không dùng khi không có gì thay đổi về hình ảnh.

Khi ảnh là kết quả bạn vừa sửa, truyền thêm \`changes\` (đã sửa gì) và \`compare\` (ảnh cùng góc nhìn chụp trước khi sửa) để người dùng thấy trước và sau đặt cạnh nhau. Chỉ truyền \`checks\` cho kiểm tra đã chạy thật.

Ảnh đến màn hình người dùng, không đến bạn; tự đọc file nếu bạn cần kiểm tra.

${GHI_CHU_THU_MUC}`

const MO_TA_TRANG = `Chụp một trang HTML trên máy rồi hiện ảnh chụp cho người dùng ngay trong terminal (Chrome headless, khung ${1280}×${800} mặc định, không tương tác được). Truyền \`path\` (file .html/.htm) hoặc \`url\` (chỉ http://localhost, 127.0.0.1, [::1]: dev server đang chạy).

Tự dùng, không cần được yêu cầu, sau khi làm trang, báo cáo HTML hoặc sửa giao diện web, trước khi báo xong, thay cho việc bảo người dùng tự mở trình duyệt. \`changes\`, \`checks\` như show_image; \`compare\` là trang (file .html hoặc URL localhost) hoặc ảnh của bản trước khi sửa, để hiện trước và sau cạnh nhau.

Trang có thể chạy script khi Chrome mở nó; chỉ dùng cho trang bạn định mở. Người dùng xem ảnh chụp; bạn thì không.`

const VAO_CHUNG = {
  title: { type: 'string', description: 'Chú thích ngắn' },
  changes: THAY_DOI,
  checks: KIEM_TRA,
}

type Loi = { loi: string }
const laLoi = (v: unknown): v is Loi => typeof v === 'object' && v !== null && 'loi' in v

// ── trạng thái của phiên (biến module: một lần reload chỉ làm nhắc lại một lần) ──
let kha: KhaNang = { ve: 'khong', vi: 'mod chưa khởi động xong' }
let chrome: string | undefined
let laMac = false
let thuMuc = ''
let daNhac = false

/** Chạy một lệnh; báo lỗi bằng dòng stderr đầu tiên. */
async function chayLenh($: EngineInterface, argv: string[], timeoutMs = 30_000) {
  const kq = await $.process.run(argv, { timeoutMs })
  if (kq.exitCode !== 0) {
    const dong = (kq.stderr || kq.stdout).trim().split('\n')[0] ?? ''
    throw new Error(`${(argv[0] ?? '').split('/').pop()} thất bại${dong ? `: ${dong.slice(0, 200)}` : ''}`)
  }
  return kq
}

async function coLenh($: EngineInterface, ten: string): Promise<string | undefined> {
  try {
    const kq = await $.process.run(['which', ten], { timeoutMs: 5_000 })
    const duong = kq.stdout.trim().split('\n')[0]
    return kq.exitCode === 0 && duong ? duong : undefined
  } catch {
    return undefined
  }
}

async function timChrome($: EngineInterface): Promise<string | undefined> {
  if (laMac) {
    for (const p of CHROME_MAC) if (await $.fs.exists(p)) return p
    return undefined
  }
  for (const ten of CHROME_LINUX) {
    const p = await coLenh($, ten)
    if (p) return p
  }
  return undefined
}

async function docKichThuoc($: EngineInterface, duongDan: string) {
  const { base64 } = await $.fs.read(duongDan, { as: 'bytes', length: 24 })
  return kichThuocPng(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
}

async function tuyetDoi($: EngineInterface, duongDan: string): Promise<string> {
  if (duongDan.startsWith('/')) return duongDan
  if (duongDan.startsWith('~/')) return `${(await $.env.get('HOME')) ?? ''}${duongDan.slice(1)}`
  const cwd = await $.session.cwd()
  return `${cwd.replace(/\/$/, '')}/${duongDan.replace(/^\.\//, '')}`
}

/** Thu nhỏ ảnh PNG (tại chỗ) khi cạnh dài vượt CANH_TOI_DA. */
async function thuNho($: EngineInterface, dich: string) {
  const kt = await docKichThuoc($, dich)
  if (!kt || Math.max(kt.rong, kt.cao) <= CANH_TOI_DA) return
  if (laMac) await chayLenh($, ['sips', '-Z', String(CANH_TOI_DA), dich])
  else if (await coLenh($, 'magick'))
    await chayLenh($, ['magick', dich, '-resize', `${CANH_TOI_DA}x${CANH_TOI_DA}>`, dich])
}

/** Đổi một file ảnh bất kỳ thành bản lưu PNG riêng (để file gốc có bị ghi đè, ảnh cũ vẫn còn). */
async function luuAnh($: EngineInterface, nguon: string, dich: string, png: boolean): Promise<BanLuu> {
  const tt = await $.fs.stat(nguon)
  if (tt.kind !== 'file') throw new Error(`không phải file: ${nguon}`)
  if (png) {
    if (!(await docKichThuoc($, nguon))) throw new Error(`file không phải PNG hợp lệ: ${nguon}`)
    await chayLenh($, ['cp', nguon, dich])
  } else if (laMac) {
    await chayLenh($, ['sips', '-s', 'format', 'png', nguon, '--out', dich])
  } else if (await coLenh($, 'magick')) {
    await chayLenh($, ['magick', `${nguon}[0]`, dich])
  } else if (await coLenh($, 'ffmpeg')) {
    await chayLenh($, ['ffmpeg', '-y', '-loglevel', 'error', '-i', nguon, '-frames:v', '1', dich])
  } else {
    throw new Error('cần ImageMagick (magick) hoặc ffmpeg để đổi ảnh không phải PNG')
  }
  await thuNho($, dich)
  const kt = await docKichThuoc($, dich)
  if (!kt) throw new Error(`không đọc được ảnh sau khi đổi: ${nguon}`)
  return { duongDan: dich, ...kt }
}

async function chupTrang($: EngineInterface, url: string, dich: string, rong: number, cao: number): Promise<BanLuu> {
  if (!chrome) throw new Error('không tìm thấy Chrome / Chromium trên máy')
  await chayLenh(
    $,
    [
      chrome,
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      `--user-data-dir=${thuMuc}/chrome-profile`,
      `--window-size=${rong},${cao}`,
      '--virtual-time-budget=4000',
      `--screenshot=${dich}`,
      url,
    ],
    60_000,
  )
  const kt = await docKichThuoc($, dich).catch(() => undefined)
  if (!kt) throw new Error('Chrome không tạo được ảnh chụp')
  return { duongDan: dich, ...kt }
}

/** Một nguồn (file ảnh, file HTML, URL localhost) → bản lưu PNG. */
async function chuanBi(
  $: EngineInterface,
  nguon: string,
  dich: string,
  khung: { rong: number; cao: number },
): Promise<BanLuu> {
  if (/^https?:\/\//i.test(nguon)) {
    if (!laUrlNoiBo(nguon)) throw new Error(`chỉ chụp được trang localhost, không mở ${nguon}`)
    return chupTrang($, nguon, dich, khung.rong, khung.cao)
  }
  const duong = await tuyetDoi($, nguon)
  if (!(await $.fs.exists(duong))) throw new Error(`không tìm thấy file: ${duong}`)
  const loai = loaiTep(duong)
  if (loai === 'html') return chupTrang($, urlTuDuongDan(duong), dich, khung.rong, khung.cao)
  if (loai) return luuAnh($, duong, dich, loai === 'png')
  throw new Error(`không hỗ trợ loại file này: ${duong}`)
}

async function xuLyHien($: EngineInterface, e: Record<string, unknown>, laTrang: boolean): Promise<string | Loi> {
  const id = String(e.tool_use_id ?? Date.now())
  const nguon = typeof e.path === 'string' && e.path ? e.path : typeof e.url === 'string' ? e.url : ''
  if (!nguon) return { loi: laTrang ? 'cần `path` (file .html) hoặc `url` (localhost)' : 'cần `path` tới file ảnh' }
  if (!laTrang && loaiTep(nguon) === 'html') return { loi: 'đây là trang HTML: dùng show_html' }
  const khung = {
    rong: typeof e.width === 'number' ? Math.min(3840, Math.max(320, Math.round(e.width))) : 1280,
    cao: typeof e.height === 'number' ? Math.min(2160, Math.max(240, Math.round(e.height))) : 800,
  }
  await chayLenh($, ['mkdir', '-p', thuMuc])
  try {
    const sau = await chuanBi($, nguon, `${thuMuc}/${tenBanLuu(id, 'sau')}`, khung)
    const truoc =
      typeof e.compare === 'string' && e.compare
        ? await chuanBi($, e.compare, `${thuMuc}/${tenBanLuu(id, 'truoc')}`, khung)
        : undefined
    const tieuDe = typeof e.title === 'string' && e.title ? e.title : (nguon.split('/').pop() ?? nguon)
    return vanBanKetQua({ tieuDe, sau, truoc, kha })
  } catch (loi) {
    return { loi: loi instanceof Error ? loi.message : String(loi) }
  }
}

async function nguonAnh($: EngineInterface, b: BanLuu): Promise<ImageSource | undefined> {
  if (!(await $.fs.exists(b.duongDan))) return undefined
  if (kha.ve === 'co-the') {
    const tt = await $.fs.stat(b.duongDan)
    if (tt.size <= HAI_MIB) {
      const { base64 } = await $.fs.read(b.duongDan, { as: 'bytes' })
      return { png: base64 }
    }
  }
  return { file: b.duongDan, format: 'png' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const kq = await next(e)
    const info = await $.session.info()
    laMac = info.platform === 'macos'
    kha = khaNangTerminal({
      surface: e.surface,
      termProgram: await $.env.get('TERM_PROGRAM'),
      term: await $.env.get('TERM'),
      kittyWindowId: await $.env.get('KITTY_WINDOW_ID'),
      tmux: await $.env.get('TMUX'),
    })
    const tam = info.scratchpadDir ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    thuMuc = `${tam.replace(/\/$/, '')}/xem-ket-qua`
    chrome = await timChrome($)

    await $.tool.register({
      name: 'show_image',
      description: MO_TA_ANH,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Đường dẫn tuyệt đối tới file ảnh' },
          compare: { type: 'string', description: 'Ảnh của bản trước khi sửa (cùng góc nhìn)' },
          ...VAO_CHUNG,
        },
        required: ['path'],
      },
    })
    if (chrome)
      await $.tool.register({
        name: 'show_html',
        description: MO_TA_TRANG,
        isDeferred: false,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Đường dẫn tuyệt đối tới file .html' },
            url: { type: 'string', description: 'URL localhost của dev server, thay cho path' },
            compare: { type: 'string', description: 'Bản trước khi sửa: file .html, URL localhost hoặc ảnh' },
            width: { type: 'number', description: 'Chiều rộng khung, mặc định 1280' },
            height: { type: 'number', description: 'Chiều cao khung, mặc định 800' },
            ...VAO_CHUNG,
          },
        },
      })
    return kq
  })

  on('session.compact', async ($, e, next) => {
    daNhac = false
    return next(e)
  })

  // Nhắc Claude một lần mỗi phiên (và lại sau khi nén ngữ cảnh). Dùng prompt.submit
  // chứ không dùng prompt.compose, vì prompt.compose có thể bị mod của tổ chức bỏ qua.
  on('prompt.submit', async ($, e, next) => {
    if (daNhac || e.command || e.isMeta) return next(e)
    daNhac = true
    return next({ ...e, context: [...(e.context ?? []), loiNhac(kha, !!chrome)] })
  })

  on('tool.run', { tool: CC_ANH }, async ($, e) => {
    const kq = await xuLyHien($, e as Record<string, unknown>, false)
    return laLoi(kq) ? { deny: `Không hiện được ảnh: ${kq.loi}` } : { result: kq }
  })

  on('tool.run', { tool: CC_TRANG }, async ($, e) => {
    const kq = await xuLyHien($, e as Record<string, unknown>, true)
    return laLoi(kq) ? { deny: `Không chụp được trang: ${kq.loi}` } : { result: kq }
  })

  // Dòng kết quả dưới hàng công cụ: chỉ giữ câu đầu, bỏ dòng "Bản lưu" dành cho máy.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== CC_ANH && e.props.tool !== CC_TRANG) return next(e)
    if (e.props.isErrored || e.props.isExpanded || typeof e.props.output !== 'string') return next(e)
    return next({ ...e, props: { ...e.props, output: e.props.output.split('\n')[0] } })
  })

  // Vẽ ảnh ngay dưới hàng công cụ: một ảnh, hoặc trước / sau đặt cạnh nhau.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== CC_ANH && e.props.tool !== CC_TRANG) return next(e)
    const hang = await next(e)
    if (e.props.isRunning || e.props.isErrored || e.props.output === undefined) return hang
    const luu = docBanLuu(e.props.output)
    if (!luu) return hang

    const vao = (typeof e.props.input === 'object' && e.props.input !== null ? e.props.input : {}) as Record<
      string,
      unknown
    >
    const thayDoi = docThayDoi(vao.changes)
    const kiemTra = docKiemTra(vao.checks)
    const tieuDe = typeof vao.title === 'string' ? vao.title : ''
    const cot = Math.max(20, (e.viewport?.columns ?? 100) - 6)

    const { Box, Text } = $.ui.resolve(e)
    const danhSach = (
      <Box flexDirection="column">
        {thayDoi.length > 0 && <Text bold>Đã thay đổi</Text>}
        {thayDoi.map(t => (
          <Text>
            {'  • '}
            {t.title}
            {t.detail ? <Text dimColor> — {t.detail}</Text> : ''}
          </Text>
        ))}
        {kiemTra.length > 0 && (
          <Text bold>
            Kiểm tra {kiemTra.filter(k => k.ok).length}/{kiemTra.length}
          </Text>
        )}
        {kiemTra.map(k => (
          <Text color={k.ok ? 'success' : 'error'}>
            {k.ok ? '  ✓ ' : '  ✗ '}
            {k.name}
            {k.detail ? <Text dimColor> — {k.detail}</Text> : ''}
          </Text>
        ))}
      </Box>
    )

    if (e.surface !== 'terminal') {
      return (
        <Box flexDirection="column">
          {hang}
          <Text dimColor>
            {luu.truoc ? `Trước: ${luu.truoc.duongDan}\nSau: ` : 'Ảnh: '}
            {luu.sau.duongDan}
          </Text>
          {danhSach}
        </Box>
      )
    }

    const { Image } = $.ui.resolve(e)
    const motAnh = async (b: BanLuu, nhan: string, cotToiDa: number, dongToiDa: number) => {
      const nguon = await nguonAnh($, b)
      if (!nguon) return <Text dimColor>{`(${nhan}: bản lưu đã bị xoá — ${b.duongDan})`}</Text>
      const o = oCuaAnh(b.rong, b.cao, cotToiDa, dongToiDa)
      return (
        <Box flexDirection="column">
          {nhan ? <Text bold>{nhan}</Text> : ''}
          <Image source={nguon} columns={o.columns} rows={o.rows} alt={`${nhan || 'Ảnh'}: ${b.duongDan}`} />
        </Box>
      )
    }

    let anh: Awaited<ReturnType<typeof motAnh>>
    if (!luu.truoc) {
      anh = await motAnh(luu.sau, tieuDe, Math.min(cot, 120), 28)
    } else if (cot >= 90) {
      const nua = Math.floor((cot - 2) / 2)
      anh = (
        <Box flexDirection="row" gap={2}>
          {await motAnh(luu.truoc, 'Trước', nua, 20)}
          {await motAnh(luu.sau, 'Sau', nua, 20)}
        </Box>
      )
    } else {
      anh = (
        <Box flexDirection="column">
          {await motAnh(luu.truoc, 'Trước', cot, 16)}
          {await motAnh(luu.sau, 'Sau', cot, 16)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {hang}
        {luu.truoc && tieuDe ? <Text bold>{tieuDe}</Text> : ''}
        {anh}
        {kha.ve === 'khong' ? <Text dimColor>{`Terminal không vẽ được ảnh: ${kha.vi}.`}</Text> : ''}
        {danhSach}
      </Box>
    )
  })
}

