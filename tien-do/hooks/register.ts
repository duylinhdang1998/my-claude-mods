// Mod "tien-do": thay lệnh bash / code dài bằng tên việc + % + thời gian ước tính,
// gọi tên rõ lệnh xoá / nguy hiểm, và theo dõi từng subagent.
import type { EngineInterface, Register } from 'claude-code'

import {
  capNhatTrungBinh,
  conLai,
  dongDau,
  dongHo,
  kyVongMacDinh,
  nguoiDungYeuCauXoaDb,
  nhanDienMcpXoaDb,
  nhanDienNguyHiem,
  soDong,
  tenSubagent,
  tenViecCongCu,
  thanhTienDo,
  thuGonCode,
  tienDoTheoGio,
  tienDoTheoViec,
  tomTatNguyHiem,
} from './lib'
import type { NguyHiem, TienDo, TrangThaiViec, Viec } from './lib'

const CHINH = 'main'
const CONG_CU_AGENT = new Set(['Agent', 'Task'])
const CONG_CU_KE_HOACH = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
const CONG_CU_SUA = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

type KeHoach = { batDau: number; viec: Viec[] }

type Sub = {
  tuid: string
  ten: string
  loai: string
  moTa: string
  batDau: number
  ketThuc?: number
  agentId?: string
  chayNgam: boolean
  soThaoTac: number
  dangLam?: string
  trangThai: 'dang-chay' | 'xong' | 'loi' | 'dung'
}

type Nhan = { chu: string; phu?: string; mau?: string; dam?: boolean; dangChay?: boolean }

const laChuoi = (v: unknown): v is string => typeof v === 'string'
const banGhi = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}

// ── trạng thái của phiên (biến của module: đủ cho một phiên làm việc) ──
let anBang = false
let xemChiTiet = false
let dangChay = false
let batDauLuot = 0
let soThaoTac = 0
let viecVuaLam = ''
let demSub = 0
/** Tin nhắn gần nhất NGƯỜI DÙNG gõ (prompt.submit — subagent không đi qua đây).
 *  Rỗng sau mỗi lần nạp lại mod: mặc định là chưa cho phép xoá database. */
let tinNhanNguoiDung = ''
const keHoach = new Map<string, KeHoach>()
const subs = new Map<string, Sub>()
const agentSangTuid = new Map<string, string>()
const trungBinh: Record<string, number> = {}
let ve: () => void = () => {}

const subTheoAgent = (agentId: string | undefined) => {
  if (!agentId) return undefined
  const tuid = agentSangTuid.get(agentId)
  return tuid ? subs.get(tuid) : undefined
}
const coSubDangChay = () => [...subs.values()].some(s => s.trangThai === 'dang-chay')
const coKeHoachDo = () => {
  const kh = keHoach.get(CHINH)
  return !!kh && kh.viec.some(v => v.trangThai !== 'completed')
}

function ketThucSub($: EngineInterface, s: Sub, bayGio: number, tt: Sub['trangThai']): void {
  if (s.trangThai !== 'dang-chay') return
  s.trangThai = tt
  s.ketThuc = bayGio
  s.dangLam = undefined
  if (tt === 'xong') {
    trungBinh[s.loai] = capNhatTrungBinh(trungBinh[s.loai], bayGio - s.batDau)
    void $.store.set('trungBinh', trungBinh).catch(() => {})
  }
}

const tienDoSub = (s: Sub, bayGio: number): TienDo => {
  const kh = s.agentId ? keHoach.get(s.agentId) : undefined
  if (kh && kh.viec.length > 0) return tienDoTheoViec(kh.viec, kh.batDau, bayGio)
  const den = s.ketThuc ?? bayGio
  return tienDoTheoGio(den - s.batDau, trungBinh[s.loai] ?? kyVongMacDinh(s.loai))
}

const timViec = (taskId: string): Viec | undefined => {
  for (const kh of keHoach.values()) {
    const v = kh.viec.find(x => x.id === taskId)
    if (v) return v
  }
  return undefined
}

// ── kế hoạch: TodoWrite thay cả danh sách; TaskCreate / TaskUpdate sửa từng việc ──
const ganTodo = (vong: string, todos: unknown, bayGio: number) => {
  if (!Array.isArray(todos)) return
  const cu = keHoach.get(vong)
  const conDo = cu && cu.viec.some(v => v.trangThai !== 'completed')
  const viec: Viec[] = todos.map((t, i) => {
    const r = banGhi(t)
    const trangThai: TrangThaiViec =
      r.status === 'completed' || r.status === 'in_progress' ? r.status : 'pending'
    return {
      id: String(i),
      tieuDe: laChuoi(r.content) ? r.content : `Việc ${i + 1}`,
      dangLam: laChuoi(r.activeForm) ? r.activeForm : laChuoi(r.content) ? r.content : '',
      trangThai,
    }
  })
  if (viec.length === 0) keHoach.delete(vong)
  else keHoach.set(vong, { batDau: conDo && cu ? cu.batDau : bayGio, viec })
}

const themTask = (vong: string, id: string, tieuDe: string, dangLam: string, bayGio: number) => {
  let kh = keHoach.get(vong)
  if (!kh || kh.viec.every(v => v.trangThai === 'completed')) {
    kh = { batDau: bayGio, viec: [] }
    keHoach.set(vong, kh)
  }
  kh.viec.push({ id, tieuDe, dangLam: dangLam || tieuDe, trangThai: 'pending' })
}

const suaTask = (input: Record<string, unknown>) => {
  const id = laChuoi(input.taskId) ? input.taskId : ''
  for (const kh of keHoach.values()) {
    const i = kh.viec.findIndex(v => v.id === id)
    if (i < 0) continue
    const v = kh.viec[i]
    if (!v) continue
    if (input.status === 'deleted') kh.viec.splice(i, 1)
    else {
      if (input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed') v.trangThai = input.status
      if (laChuoi(input.subject)) v.tieuDe = input.subject
      if (laChuoi(input.activeForm)) v.dangLam = input.activeForm
    }
    return
  }
}

// ── tên hiển thị cho một hàng công cụ trong transcript ──
const nhanHang = (tool: string, inputRaw: unknown, tuid: string, bayGio: number): Nhan | undefined => {
  const input = banGhi(inputRaw)
  if (tool === 'Bash') {
    const lenh = laChuoi(input.command) ? input.command : ''
    const nh = nhanDienNguyHiem(lenh)
    if (nh.length > 0) {
      const t = tomTatNguyHiem(nh)
      return { chu: `${nh.some(x => x.xoaDatabase) ? '⛔' : '⚠'} ${t.cau}`, mau: t.mucDo === 'cao' ? 'error' : 'warning', dam: true }
    }
    return { chu: tenViecCongCu('Bash', input) }
  }
  if (CONG_CU_SUA.has(tool)) return { chu: tenViecCongCu(tool, input) }
  if (CONG_CU_AGENT.has(tool)) {
    const s = subs.get(tuid)
    const moTa = laChuoi(input.description) ? input.description : 'một việc'
    if (!s) return { chu: `Giao việc cho subagent: ${moTa}`, dam: true }
    const td = tienDoSub(s, bayGio)
    const phu =
      s.trangThai === 'dang-chay'
        ? `${td.phanTram}%${td.laUocTinhTheoGio ? '~' : ''} · ${td.quaHan ? 'lâu hơn thường lệ' : 'còn ' + conLai(td.conLaiMs)}${s.chayNgam ? ' · chạy ngầm' : ''}`
        : s.trangThai === 'xong'
          ? `xong sau ${dongHo((s.ketThuc ?? bayGio) - s.batDau)} · ${s.soThaoTac} thao tác`
          : s.trangThai === 'dung' ? 'đã dừng' : 'gặp lỗi'
    return { chu: `Giao việc cho ${s.ten}: ${s.moTa}`, phu, dam: true, dangChay: s.trangThai === 'dang-chay' }
  }
  if (tool === 'TodoWrite') {
    const ds = Array.isArray(input.todos) ? input.todos.map(banGhi) : []
    const xong = ds.filter(t => t.status === 'completed').length
    return { chu: `Cập nhật kế hoạch: ${xong}/${ds.length} việc xong` }
  }
  if (tool === 'TaskUpdate') {
    const v = laChuoi(input.taskId) ? timViec(input.taskId) : undefined
    const ten = v?.tieuDe ?? (laChuoi(input.subject) ? input.subject : 'một việc')
    if (input.status === 'completed') return { chu: `Xong việc: ${ten}`, mau: 'success' }
    if (input.status === 'in_progress') return { chu: `Bắt đầu: ${ten}` }
    if (input.status === 'deleted') return { chu: `Bỏ việc: ${ten}` }
    return { chu: `Cập nhật việc: ${ten}` }
  }
  if (tool === 'TaskCreate') return { chu: tenViecCongCu(tool, input) }
  const mcp = nhanDienMcpXoaDb(tool, input)
  if (mcp.length > 0) return { chu: `⛔ ${tomTatNguyHiem(mcp).cau}`, mau: 'error', dam: true }
  return undefined
}

// ── tóm tắt kết quả công cụ (thay cho output dài) ──
const tomTatKetQua = (tool: string, output: unknown, loi: boolean, tuid: string): string | undefined => {
  const r = banGhi(output)
  const vanBan = laChuoi(output) ? output : laChuoi(r.stderr) && r.stderr ? r.stderr : laChuoi(r.stdout) ? r.stdout : ''
  if (loi) return `Lỗi: ${dongDau(vanBan, 110) || 'không rõ'} · gõ /chi-tiet để xem đầy đủ`
  if (tool === 'Bash') {
    const n = soDong(laChuoi(r.stdout) ? r.stdout : '')
    if (r.interrupted === true) return 'đã dừng giữa chừng'
    return n > 0 ? `xong · ${n} dòng kết quả (đã ẩn)` : 'xong'
  }
  if (CONG_CU_SUA.has(tool)) return 'đã lưu'
  if (CONG_CU_KE_HOACH.has(tool)) return 'đã cập nhật'
  if (CONG_CU_AGENT.has(tool)) {
    const s = subs.get(tuid)
    if (s?.chayNgam && s.trangThai === 'dang-chay') return `${s.ten} đang chạy ngầm`
    return `${s?.ten ?? 'Subagent'} đã báo cáo xong (nội dung đã ẩn)`
  }
  return undefined
}

// Đồng bộ trạng thái subagent chạy ngầm với danh sách của engine.
async function dongBoSub($: EngineInterface): Promise<void> {
  try {
    const ds = await $.agent.list()
    const bayGio = await $.clock.now()
    for (const a of ds) {
      const s = subTheoAgent(a.id)
      if (!s || s.trangThai !== 'dang-chay') continue
      if (a.status === 'completed') ketThucSub($, s, bayGio, 'xong')
      else if (a.status === 'failed') ketThucSub($, s, bayGio, 'loi')
      else if (a.status === 'killed') ketThucSub($, s, bayGio, 'dung')
    }
  } catch {
    // không có danh sách: bỏ qua lần này
  }
}

const LY_DO_CAM_XOA_DB = (viec: string) =>
  `NGHIÊM CẤM: ${viec} làm mất dữ liệu database, mà tin nhắn của người dùng chưa yêu cầu xoá database. ` +
  'Không chạy lệnh này và không tìm cách khác làm mất dữ liệu database (reset, drop, truncate, xoá volume…). ' +
  'Nếu thật sự cần, dừng lại, giải thích vì sao và chờ người dùng gõ yêu cầu rõ ràng.'

/** Cổng xoá database, chung cho Bash và MCP: chặn cứng nếu người dùng chưa yêu cầu; có yêu cầu thì vẫn hỏi lại. */
async function congXoaDatabase($: EngineInterface, ds: NguyHiem[], nguon: string): Promise<{ deny: string } | undefined> {
  const db = ds.filter(x => x.xoaDatabase)
  if (db.length === 0) return undefined
  const { cau } = tomTatNguyHiem(db)
  if (!nguoiDungYeuCauXoaDb(tinNhanNguoiDung)) {
    $.ui.log(`⛔ Đã chặn ${nguon}: ${cau} — bạn chưa yêu cầu xoá database`)
    return { deny: LY_DO_CAM_XOA_DB(cau) }
  }
  let traLoi = 'Chặn'
  try {
    traLoi = await $.ui.ask(`⛔ ${nguon} muốn XOÁ DỮ LIỆU DATABASE: ${cau}. Cho phép chạy?`, {
      options: ['Cho chạy', 'Chặn'],
      header: 'Xoá database',
    })
  } catch {
    // không hỏi được: giữ "Chặn"
  }
  return traLoi === 'Cho chạy' ? undefined : { deny: `Người dùng đã chặn việc xoá database (${cau}). Không thử cách khác; hỏi lại người dùng.` }
}

export const register: Register = (on, options) => {
  const tuyChon = banGhi(options)
  const xacNhan = tuyChon.xacNhanLenhNguyHiem !== false
  const toiDaCode = typeof tuyChon.soDongCodeToiDa === 'number' ? tuyChon.soDongCodeToiDa : 12
  const huongDan = tuyChon.huongDanClaude !== false

  // ───────────────────────── vòng đời phiên ─────────────────────────

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tien-do',
      description: 'Ẩn / hiện bảng tiến độ phía trên ô nhập',
      immediate: true,
    })
    await $.command.register({
      name: 'chi-tiet',
      description: 'Bật / tắt xem đầy đủ lệnh, output và code (mặc định thu gọn)',
      immediate: true,
    })
    const luu = await $.store.get('trungBinh')
    for (const [k, v] of Object.entries(banGhi(luu))) if (typeof v === 'number') trungBinh[k] = v
    anBang = (await $.store.get('anBang')) === true

    ve = () => $.ui.invalidate('ui.render')
    let nhip = 0
    $.clock.every(1000, () => {
      if (!dangChay && !coSubDangChay()) return
      nhip += 1
      if (nhip % 2 === 0) ve()
      if (nhip % 4 === 0) void dongBoSub($)
    })
    return next(e)
  })

  on('command.run', { command: 'tien-do' }, async $ => {
    anBang = !anBang
    await $.store.set('anBang', anBang)
    $.ui.invalidate('ui.render')
    return { text: anBang ? 'Đã ẩn bảng tiến độ. Gõ /tien-do để hiện lại.' : 'Đã hiện bảng tiến độ.' }
  })

  on('command.run', { command: 'chi-tiet' }, async $ => {
    xemChiTiet = !xemChiTiet
    $.ui.invalidate('ui.render')
    return {
      text: xemChiTiet
        ? 'Đang xem đầy đủ: lệnh, output và code hiện nguyên văn. Gõ /chi-tiet lần nữa để thu gọn.'
        : 'Đã thu gọn: chỉ hiện tên việc, tiến độ và tóm tắt kết quả.',
    }
  })

  if (huongDan) {
    on('prompt.compose', async ($, e, next) => {
      const kq = await next(e)
      return {
        ...kq,
        sections: [
          ...kq.sections,
          {
            id: 'tien-do:huong-dan',
            scope: 'session',
            text: [
              '# Báo tiến độ cho người dùng (mod tien-do)',
              'Người dùng không xem lệnh hay code thô; họ xem tên việc, % tiến độ và thời gian ước tính. Vì vậy:',
              '- Mỗi lần gọi Bash, luôn điền `description`: một cụm ngắn bằng tiếng Việt nói việc đang làm (vd "Cài thư viện", "Chạy test đăng nhập").',
              '- Việc có từ 3 bước trở lên: lập danh sách việc trước (công cụ todo/task của phiên), và cập nhật trạng thái ngay khi bắt đầu và khi xong từng việc, để thanh tiến độ tính được %. Ghi tiêu đề việc bằng tiếng Việt.',
              '- Khi giao việc cho subagent: điền `description` 3-5 chữ tiếng Việt nói rõ việc, và `name` ngắn gợi nhớ (kebab-case, vd "tim-cau-hinh").',
              '- Trong câu trả lời, không dán khối code dài trừ khi người dùng hỏi; nói đã sửa gì ở file nào.',
            ].join('\n'),
          },
        ],
      }
    })
  }

  // Chỉ tin nhắn chính người dùng gõ (ô nhập, hoặc điện thoại/web qua Remote Control)
  // mới được cấp quyền xoá database. Tin từ kênh chat, peer, notification, lịch chạy…
  // không cấp, và thu hồi quyền tin trước đã cấp.
  on('prompt.submit', async ($, e, next) => {
    tinNhanNguoiDung = e.origin.kind === 'composer' || e.origin.kind === 'bridge' ? e.text : ''
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    dangChay = true
    batDauLuot = await $.clock.now()
    soThaoTac = 0
    viecVuaLam = 'Đang suy nghĩ'
    const kh = keHoach.get(CHINH)
    if (kh && kh.viec.every(v => v.trangThai === 'completed')) keHoach.delete(CHINH)
    for (const [k, s] of subs) if (s.trangThai !== 'dang-chay') subs.delete(k)
    ve()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const bayGio = await $.clock.now()
    if (e.agentId) {
      const s = subTheoAgent(e.agentId)
      if (s) ketThucSub($, s, bayGio, e.reason === 'answer' ? 'xong' : e.reason === 'aborted' ? 'dung' : 'loi')
    } else {
      dangChay = false
      viecVuaLam = ''
    }
    ve()
    return next(e)
  })

  // ───────────────────────── theo dõi mọi lần gọi công cụ ─────────────────────────

  on('tool.call', async ($, e, next) => {
    const bayGio = await $.clock.now()
    const tool = String(e.tool)
    const input = banGhi(e)
    const vong = e.agentId ?? CHINH
    const tuid = e.tool_use_id

    let ten = tenViecCongCu(tool, input)
    if (CONG_CU_AGENT.has(tool)) {
      demSub += 1
      const loai = laChuoi(input.subagent_type) ? input.subagent_type : 'general-purpose'
      const s: Sub = {
        tuid,
        ten: tenSubagent(loai, demSub, laChuoi(input.name) ? input.name : undefined),
        loai,
        moTa: laChuoi(input.description) ? input.description : 'một việc',
        batDau: bayGio,
        chayNgam: input.run_in_background === true,
        soThaoTac: 0,
        trangThai: 'dang-chay',
      }
      subs.set(tuid, s)
      ten = `Giao việc cho ${s.ten}: ${s.moTa}`
    }

    if (vong === CHINH) {
      soThaoTac += 1
      viecVuaLam = ten
    } else {
      const s = subTheoAgent(vong)
      if (s) {
        s.soThaoTac += 1
        s.dangLam = ten
      }
    }
    ve()

    const kq = await next(e)
    const thanhCong = kq.deny === undefined && kq.isError !== true
    const sau = await $.clock.now()

    if (thanhCong && tool === 'TodoWrite') ganTodo(vong, input.todos, sau)
    if (thanhCong && tool === 'TaskUpdate') suaTask(input)
    if (thanhCong && tool === 'TaskCreate') {
      const id = banGhi(banGhi(kq.result).task).id
      if (laChuoi(id)) {
        themTask(
          vong,
          id,
          laChuoi(input.subject) ? input.subject : 'Việc mới',
          laChuoi(input.activeForm) ? input.activeForm : '',
          sau,
        )
      }
    }
    if (CONG_CU_AGENT.has(tool)) {
      const s = subs.get(tuid)
      if (s && !thanhCong) ketThucSub($, s, sau, 'loi')
      else if (s && !s.chayNgam) ketThucSub($, s, sau, 'xong')
    }
    ve()
    return kq
  })

  on('agent.spawn', async ($, e, next) => {
    const kq = await next(e)
    const bayGio = await $.clock.now()
    let s = subs.get(e.tool_use_id)
    if (!s && kq.agentId) {
      // subagent do plugin khác khởi chạy, không qua tool.call của Claude
      demSub += 1
      s = {
        tuid: e.tool_use_id,
        ten: tenSubagent(e.subagentType, demSub, e.name),
        loai: e.subagentType,
        moTa: e.description || 'một việc',
        batDau: bayGio,
        chayNgam: e.background,
        soThaoTac: 0,
        trangThai: 'dang-chay',
      }
      subs.set(e.tool_use_id, s)
    }
    if (s) {
      s.loai = e.subagentType || s.loai
      s.chayNgam = e.background
      if (kq.agentId) {
        s.agentId = kq.agentId
        agentSangTuid.set(kq.agentId, s.tuid)
      }
      if (kq.deny !== undefined) ketThucSub($, s, bayGio, 'loi')
    }
    ve()
    return kq
  })

  // ───────────────────────── lệnh nguy hiểm ─────────────────────────

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ds = nhanDienNguyHiem(e.command)
    if (ds.length === 0) return next(e)
    const nguon = subTheoAgent(e.agentId)?.ten ?? 'Claude'
    if (ds.some(x => x.xoaDatabase)) {
      const chan = await congXoaDatabase($, ds, nguon)
      return chan ?? next(e)
    }
    const { cau, mucDo } = tomTatNguyHiem(ds)
    $.ui.log(`⚠ ${nguon} sắp làm việc nguy hiểm — ${cau}`)
    if (!xacNhan) return next(e)

    // Engine sẽ tự xin phép (hoặc tự chặn) thì không hỏi thêm lần nữa.
    let quyetDinh = 'ask'
    try {
      quyetDinh = (await $.tool.check({ tool: 'Bash', input: { command: e.command } })).decision
    } catch {
      quyetDinh = 'allow'
    }
    if (quyetDinh !== 'allow') return next(e)

    let traLoi = 'Chặn'
    try {
      traLoi = await $.ui.ask(`⚠ ${nguon} muốn: ${cau}. Cho phép chạy?`, {
        options: ['Cho chạy', 'Chặn'],
        header: mucDo === 'cao' ? 'Nguy hiểm' : 'Cẩn thận',
      })
    } catch {
      // bị đóng, hoặc không có ai để hỏi (claude -p): giữ "Chặn"
    }
    if (traLoi !== 'Cho chạy') {
      return {
        deny: `Người dùng đã chặn việc nguy hiểm này (${ds[0]?.nhan ?? 'lệnh nguy hiểm'}). Không thử cách khác để làm điều tương tự; hỏi lại người dùng trước.`,
      }
    }
    return next(e)
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { deny: 'Bộ kiểm tra lệnh nguy hiểm (mod tien-do) gặp lỗi nên lệnh chưa chạy. Thử lại, hoặc tắt mod trong /plugin.' },
  )

  // Công cụ MCP xoá / reset database (Supabase reset_branch, execute_sql với DROP…): cùng cổng.
  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const ds = nhanDienMcpXoaDb(String(e.tool), banGhi(e))
    if (ds.length === 0) return next(e)
    const chan = await congXoaDatabase($, ds, subTheoAgent(e.agentId)?.ten ?? 'Claude')
    return chan ?? next(e)
  }).catch(($, e, next) =>
    next.called || nhanDienMcpXoaDb(String(e.tool), banGhi(e)).length === 0
      ? next(e)
      : { deny: 'Bộ chặn xoá database (mod tien-do) gặp lỗi nên lệnh chưa chạy.' },
  )

  // Khi engine tự xin phép: ghi tên việc nguy hiểm vào hộp xin phép.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const d = await next(e)
    if (d.decision !== 'ask') return d
    const lenh = banGhi(e.input).command
    if (!laChuoi(lenh)) return d
    const ds = nhanDienNguyHiem(lenh)
    if (ds.length === 0) return d
    return { ...d, reason: `⚠ ${tomTatNguyHiem(ds).cau}` }
  })

  // ───────────────────────── vẽ lại transcript ─────────────────────────

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (xemChiTiet) return next(e)
    const p = e.props
    const nhan = nhanHang(String(p.tool), p.input, p.tool_use_id, await $.clock.now())
    if (!nhan) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const [ky, mauKy] = p.isInterrupted
      ? ['■', 'warning']
      : p.isErrored
        ? ['✗', 'error']
        : p.isRunning || nhan.dangChay
          ? ['…', 'claude']
          : ['✓', 'success']
    const chu = nhan.mau
      ? Text({ color: nhan.mau, bold: nhan.dam === true, wrap: 'truncate-end', children: [nhan.chu] })
      : Text({ bold: nhan.dam === true, wrap: 'truncate-end', children: [nhan.chu] })
    const con = [Text({ color: mauKy, children: [ky + ' '] }), chu]
    if (nhan.phu) con.push(Text({ dimColor: true, wrap: 'truncate-end', children: ['  · ' + nhan.phu] }))
    return Box({ flexDirection: 'row', children: con })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (xemChiTiet) return next(e)
    const p = e.props
    const tool = String(p.tool)
    if (!(tool === 'Bash' || CONG_CU_SUA.has(tool) || CONG_CU_KE_HOACH.has(tool) || CONG_CU_AGENT.has(tool))) return next(e)
    const chu = tomTatKetQua(tool, p.output, p.isErrored, p.tool_use_id)
    if (chu === undefined) return next(e)
    const { Text } = $.ui.resolve(e)
    return p.isErrored
      ? Text({ color: 'error', wrap: 'truncate-end', children: ['  ⎿ ' + chu] })
      : Text({ dimColor: true, wrap: 'truncate-end', children: ['  ⎿ ' + chu] })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (xemChiTiet) return next(e)
    const gon = thuGonCode(e.props.text, toiDaCode)
    return gon === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: gon } })
  })

  // ───────────────────────── bảng tiến độ phía trên ô nhập ─────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (anBang || e.props.hasSurvey) return next(e)
    const dsSub = [...subs.values()]
    if (!dangChay && !coKeHoachDo() && !dsSub.some(s => s.trangThai === 'dang-chay')) return next(e)

    const bayGio = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const rong = Math.max(30, e.props.bodyColumns)
    const doRongThanh = Math.max(8, Math.min(24, rong - 56))
    const dong: ReturnType<typeof Text>[] = []
    const them = (props: Parameters<typeof Text>[0]) => dong.push(Text({ wrap: 'truncate-end', ...props }))

    // Việc chính
    const kh = keHoach.get(CHINH)
    const td = kh && kh.viec.length > 0 ? tienDoTheoViec(kh.viec, kh.batDau, bayGio) : undefined
    const tieuDiem = td?.hienTai?.dangLam || viecVuaLam || (dangChay ? 'Đang suy nghĩ' : 'Tạm dừng')
    them({ bold: true, color: 'claude', children: [`▶ ${dangChay ? '' : '(tạm dừng) '}${tieuDiem}`] })
    if (td) {
      const daChay = bayGio - (kh?.batDau ?? bayGio)
      them({
        children: [
          `  ${thanhTienDo(td.phanTram, doRongThanh)} ${td.phanTram}% · ${td.xong}/${td.tong} việc · đã chạy ${dongHo(daChay)} · còn ${conLai(td.conLaiMs)}`,
        ],
      })
      if (kh) {
        const chips = kh.viec
          .map(v => `${v.trangThai === 'completed' ? '✓' : v.trangThai === 'in_progress' ? '▶' : '○'} ${v.tieuDe}`)
          .join('   ')
        them({ dimColor: true, children: [`  ${chips}`] })
      }
    } else if (dangChay) {
      them({
        dimColor: true,
        children: [`  đã chạy ${dongHo(bayGio - batDauLuot)} · ${soThaoTac} thao tác · chưa có danh sách việc nên chưa tính được %`],
      })
    }
    if (td && viecVuaLam && viecVuaLam !== tieuDiem && dangChay) {
      them({ dimColor: true, children: [`  · vừa làm: ${viecVuaLam}`] })
    }

    // Subagent: đang chạy trước, rồi các con đã xong trong lượt này
    const sapXep = dsSub
      .sort((a, b) => (a.trangThai === 'dang-chay' ? 0 : 1) - (b.trangThai === 'dang-chay' ? 0 : 1) || a.batDau - b.batDau)
      .slice(0, 6)
    if (sapXep.length > 0) {
      const dangChaySub = sapXep.filter(s => s.trangThai === 'dang-chay').length
      them({ bold: true, children: [`◆ Subagent (${dangChaySub} đang chạy / ${dsSub.length})`] })
      for (const s of sapXep) {
        const t = tienDoSub(s, bayGio)
        if (s.trangThai === 'dang-chay') {
          const uocTinh = t.laUocTinhTheoGio ? '~' : ''
          const thoiGian = t.quaHan ? 'lâu hơn thường lệ' : `còn ${conLai(t.conLaiMs)}`
          them({
            children: [
              `  … ${s.ten} — ${s.moTa}  ${thanhTienDo(t.phanTram, Math.min(10, doRongThanh))} ${t.phanTram}%${uocTinh} · ${thoiGian} · ${s.soThaoTac} thao tác`,
            ],
          })
          if (s.dangLam) them({ dimColor: true, children: [`      đang: ${s.dangLam}`] })
        } else {
          const ky = s.trangThai === 'xong' ? '✓' : s.trangThai === 'dung' ? '■' : '✗'
          const mau = s.trangThai === 'xong' ? 'success' : s.trangThai === 'dung' ? 'warning' : 'error'
          const ketQua =
            s.trangThai === 'xong'
              ? `xong sau ${dongHo((s.ketThuc ?? bayGio) - s.batDau)}`
              : s.trangThai === 'dung' ? 'đã dừng' : 'gặp lỗi'
          them({ color: mau, children: [`  ${ky} ${s.ten} — ${s.moTa} · ${ketQua}`] })
        }
      }
    }

    const toiDa = Math.max(3, e.props.maxRows - 1)
    const hien = dong.length > toiDa ? [...dong.slice(0, toiDa - 1), Text({ dimColor: true, children: [`  … và ${dong.length - toiDa + 1} dòng nữa`] })] : dong
    return Box({ flexDirection: 'column', children: hien })
  })
}
