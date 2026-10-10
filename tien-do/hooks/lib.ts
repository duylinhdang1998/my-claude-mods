// Các hàm thuần (không gọi $): đặt tên việc, nhận diện lệnh nguy hiểm, tính % và thời gian.
// Tách riêng để test được mà không cần phiên Claude Code.

export type MucDo = 'cao' | 'trung'

export type NguyHiem = {
  /** Tên việc nguy hiểm, đọc là hiểu: "Xoá thư mục", "Ghi đè lịch sử git trên remote" */
  nhan: string
  /** Đối tượng bị ảnh hưởng: đường dẫn, nhánh, bảng... */
  doiTuong: string
  mucDo: MucDo
  /** Làm mất dữ liệu database: bị chặn cứng nếu tin nhắn của người dùng chưa yêu cầu. */
  xoaDatabase?: boolean
}

export type TrangThaiViec = 'pending' | 'in_progress' | 'completed'

export type Viec = {
  id: string
  tieuDe: string
  dangLam: string
  trangThai: TrangThaiViec
}

// ───────────────────────── tách lệnh ─────────────────────────

export type ThanHeredoc = { lenhNhan: string; noiDung: string }

/**
 * Tách thân heredoc (`<<EOF … EOF`) ra khỏi dòng lệnh. Thân heredoc là DỮ LIỆU đưa vào
 * lệnh nhận (message commit, nội dung file…), không phải lệnh: chỉ khi lệnh nhận là
 * shell hay client SQL thì thân mới được xét như lệnh.
 */
export function tachHeredoc(lenh: string): { dongLenh: string; than: ThanHeredoc[] } {
  const dong = lenh.split('\n')
  const giu: string[] = []
  const than: ThanHeredoc[] = []
  const cho: { ketThuc: string; lenhNhan: string }[] = []
  let dangDoc: { ketThuc: string; lenhNhan: string; dong: string[] } | undefined
  for (const d of dong) {
    if (dangDoc) {
      if (d.trim() === dangDoc.ketThuc) {
        than.push({ lenhNhan: dangDoc.lenhNhan, noiDung: dangDoc.dong.join('\n') })
        dangDoc = undefined
      } else dangDoc.dong.push(d)
      if (!dangDoc && cho.length > 0) {
        const tiep = cho.shift()
        if (tiep) dangDoc = { ...tiep, dong: [] }
      }
      continue
    }
    giu.push(d)
    const re = /(^|[^<])<<-?\s*(['"]?)([A-Za-z_][\w-]*)\2/g
    let m: RegExpExecArray | null
    while ((m = re.exec(d)) !== null) cho.push({ ketThuc: m[3] ?? '', lenhNhan: d.slice(0, m.index + (m[1]?.length ?? 0)) })
    const dau = cho.shift()
    if (dau) dangDoc = { ...dau, dong: [] }
  }
  if (dangDoc) than.push({ lenhNhan: dangDoc.lenhNhan, noiDung: dangDoc.dong.join('\n') })
  return { dongLenh: giu.join('\n'), than }
}

/** Tách một dòng lệnh shell thành các đoạn theo && || ; | và xuống dòng — bỏ qua các dấu nằm trong nháy. */
export function tachDoan(lenh: string): string[] {
  const out: string[] = []
  let cur = ''
  let nhay: '"' | "'" | undefined
  for (let i = 0; i < lenh.length; i++) {
    const c = lenh[i] ?? ''
    if (nhay) {
      if (c === '\\' && nhay === '"' && i + 1 < lenh.length) { cur += c + (lenh[i + 1] ?? ''); i++; continue }
      if (c === nhay) nhay = undefined
      cur += c
      continue
    }
    if (c === '\\' && i + 1 < lenh.length) { cur += c + (lenh[i + 1] ?? ''); i++; continue }
    if (c === '"' || c === "'") { nhay = c; cur += c; continue }
    const hai = lenh.slice(i, i + 2)
    if (hai === '&&' || hai === '||') { out.push(cur); cur = ''; i++; continue }
    if (c === ';' || c === '|' || c === '\n') { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out.map(s => s.trim()).filter(s => s.length > 0)
}

/** Bỏ các tiền tố không đổi ý nghĩa: sudo, env VAR=1, time, nohup, xargs. */
function boTienTo(doan: string): string {
  let s = doan.trim()
  for (let i = 0; i < 4; i++) {
    const truoc = s
    s = s
      .replace(/^(sudo|doas|time|nohup|exec|command)\s+(-\S+\s+)*/, '')
      .replace(/^xargs\s+((-I\s+\S+|-[0-9A-Za-z]+)\s+)*/, '')
      .replace(/^env\s+/, '')
      .replace(/^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')
    if (s === truoc) break
  }
  return s
}

function cacDoiSo(doan: string): string[] {
  // Tách đơn giản theo khoảng trắng, giữ chuỗi trong nháy.
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(doan)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

function rutGon(s: string, toiDa: number): string {
  const mot = s.replace(/\s+/g, ' ').trim()
  return mot.length <= toiDa ? mot : mot.slice(0, toiDa - 1) + '…'
}

function tenFile(duongDan: string): string {
  const s = duongDan.replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) || s : s
}

// ─────────────────────── lệnh nguy hiểm ───────────────────────

const DUONG_DAN_RONG = /^(\/|~|~\/|\$HOME|\.|\.\/|\*|\/\*|~\/\*|\.\.)$/
const SQL_CLIENT = /^(psql|mysql|mariadb|sqlite3|sqlcmd|clickhouse-client|cockroach)$/
const SHELL = /^(sh|bash|zsh|dash)$/
const DUONG_DAN_DATABASE = /(pgdata|postgres(ql)?[-_]?data|mysql[-_]?data|\.sqlite3?$|\.db$|(^|\/)data\/db\b)/i

/** Đoạn lệnh có đưa SQL vào database không: psql/mysql/sqlite3… (kể cả qua docker exec) hoặc `prisma db execute`. */
function laSqlClient(ds: readonly string[]): boolean {
  if (ds.some(a => SQL_CLIENT.test(tenFile(a)))) return true
  const i = ds.findIndex(a => tenFile(a) === 'prisma')
  return i >= 0 && ds[i + 1] === 'db' && ds[i + 2] === 'execute'
}

const doiSoCuaDoan = (doan: string) => cacDoiSo(boTienTo(doan))

/** SQL làm mất dữ liệu. Chỉ gọi với văn bản THẬT SỰ được gửi vào database. */
function nguyHiemSql(sql: string, them: (nhan: string, doiTuong: string, mucDo: MucDo, xoaDatabase?: boolean) => void): void {
  if (/\bdrop\s+(database|schema|table)\b/i.test(sql)) them('Xoá bảng / cơ sở dữ liệu (DROP)', sql, 'cao', true)
  else if (/\bdrop\s+(view|index|materialized\s+view)\b/i.test(sql)) them('Xoá view / index (DROP)', sql, 'cao')
  if (/\btruncate\s+(table\s+)?\w/i.test(sql)) them('Xoá sạch dữ liệu bảng (TRUNCATE)', sql, 'cao', true)
  for (const cau of sql.split(';')) {
    if (/\bdelete\s+from\s+\S+/i.test(cau) && !/\bwhere\b/i.test(cau)) {
      them('Xoá toàn bộ dòng trong bảng (DELETE không WHERE)', cau, 'cao', true)
      break
    }
  }
}

/** Nhận diện lệnh xoá / nguy hiểm trong một lệnh Bash. Trả về mọi việc nguy hiểm tìm thấy. */
export function nhanDienNguyHiem(lenh: string, doSau = 0): NguyHiem[] {
  const ketQua: NguyHiem[] = []
  const them = (nhan: string, doiTuong: string, mucDo: MucDo, xoaDatabase = false) => {
    const dt = rutGon(doiTuong, 80)
    if (ketQua.some(k => k.nhan === nhan && k.doiTuong === dt)) return
    ketQua.push(xoaDatabase ? { nhan, doiTuong: dt, mucDo, xoaDatabase } : { nhan, doiTuong: dt, mucDo })
  }
  const longVao = (con: string) => {
    if (doSau < 3) for (const k of nhanDienNguyHiem(con, doSau + 1)) them(k.nhan, k.doiTuong, k.mucDo, k.xoaDatabase)
  }

  const { dongLenh, than } = tachHeredoc(lenh)
  const cacDoan = tachDoan(dongLenh)

  for (const tho of cacDoan) {
    const doan = boTienTo(tho)
    const ds = cacDoiSo(doan)
    const lenhChinh = tenFile(ds[0] ?? '')
    const coSudo = /^(sudo|doas)\b/.test(tho)
    const truoc = ketQua.length

    // sh -c "…" / docker exec db bash -c "…": phần trong nháy là lệnh thật
    ds.forEach((a, i) => {
      if (SHELL.test(tenFile(a)) && ds[i + 1] === '-c' && ds[i + 2]) longVao(ds[i + 2] ?? '')
    })

    // ── xoá database: bị chặn cứng nếu người dùng chưa yêu cầu ──
    const iPrisma = ds.findIndex(a => tenFile(a) === 'prisma')
    if (iPrisma >= 0) {
      const p = ds.slice(iPrisma + 1).join(' ')
      if (/^migrate\s+reset\b/.test(p)) them('Xoá sạch database (prisma migrate reset)', p, 'cao', true)
      else if (/^db\s+push\b.*(--force-reset|--accept-data-loss)/.test(p)) them('Đẩy schema làm mất dữ liệu (prisma db push)', p, 'cao', true)
    }
    if (ds.some(a => tenFile(a) === 'supabase') && /\bdb\s+reset\b/.test(doan)) them('Xoá sạch database (supabase db reset)', doan, 'cao', true)
    if (lenhChinh === 'dropdb') them('Xoá database (dropdb)', ds.slice(1).join(' '), 'cao', true)
    if (lenhChinh === 'mysqladmin' && ds.includes('drop')) them('Xoá database (mysqladmin drop)', ds.slice(1).join(' '), 'cao', true)
    if (ds.some(a => tenFile(a) === 'redis-cli') && /\bflush(all|db)\b/i.test(doan)) them('Xoá sạch dữ liệu Redis (FLUSHALL)', doan, 'cao', true)

    if (lenhChinh === 'rm') {
      const co = ds.slice(1).filter(a => a.startsWith('-')).join('')
      const dich = ds.slice(1).filter(a => !a.startsWith('-'))
      const deQuy = /r|R|--recursive/.test(co)
      const rong = dich.some(d => DUONG_DAN_RONG.test(d))
      if (dich.some(d => DUONG_DAN_DATABASE.test(d))) them('Xoá file / thư mục dữ liệu database', dich.join(' '), 'cao', true)
      else if (rong) them('XOÁ DIỆN RỘNG', dich.join(' '), 'cao')
      else if (deQuy) them(dich.length > 1 ? 'Xoá các thư mục' : 'Xoá thư mục', dich.join(' ') || '(không rõ)', 'cao')
      else them(dich.length > 1 ? `Xoá ${dich.length} file` : 'Xoá file', dich.join(' ') || '(không rõ)', 'trung')
      continue
    }
    if (lenhChinh === 'rmdir') { them('Xoá thư mục rỗng', ds.slice(1).join(' '), 'trung'); continue }
    if (lenhChinh === 'unlink' || lenhChinh === 'shred') { them('Xoá vĩnh viễn file', ds.slice(1).join(' '), 'cao'); continue }
    if (lenhChinh === 'find' && /\s-delete\b|-exec\s+rm\b/.test(doan)) {
      them('Xoá hàng loạt bằng find', ds.slice(1).join(' '), 'cao'); continue
    }

    if (lenhChinh === 'git') {
      const g = ds.slice(1).join(' ')
      if (/^reset\b.*--hard/.test(g)) them('Huỷ mọi thay đổi chưa commit (git reset --hard)', g, 'cao')
      else if (/^clean\b.*-[a-zA-Z]*f/.test(g)) them('Xoá các file git chưa theo dõi (git clean)', g, 'cao')
      else if (/^push\b.*(--force\b|--force-with-lease|\s-f\b|\s\+\S)/.test(g)) them('Ghi đè lịch sử trên remote (force push)', g, 'cao')
      else if (/^push\b.*(--delete|\s:\S)/.test(g)) them('Xoá nhánh trên remote', g, 'cao')
      else if (/^branch\b.*\s-D\b/.test(g)) them('Xoá nhánh git (kể cả chưa merge)', g, 'trung')
      else if (/^checkout\b.*(\s--\s|\s--$|\s\.$)/.test(g) || /^restore\b(?!.*--staged(?!.*--worktree))/.test(g)) them('Bỏ thay đổi đang sửa trong file', g, 'trung')
      else if (/^stash\s+(drop|clear)\b/.test(g)) them('Xoá stash git', g, 'trung')
      else if (/^rebase\b/.test(g)) them('Viết lại lịch sử commit (rebase)', g, 'trung')
      continue
    }

    if (lenhChinh === 'docker' || lenhChinh === 'podman' || lenhChinh === 'docker-compose') {
      const d = (lenhChinh === 'docker-compose' ? 'compose ' : '') + ds.slice(1).join(' ')
      if (/^compose\b.*\bdown\b.*(\s-v\b|\s--volumes\b)/.test(d)) them('Xoá container kèm volume dữ liệu (compose down -v)', d, 'cao', true)
      else if (/^volume\s+(rm|prune)\b|^system\s+prune\b.*--volumes/.test(d)) them('Xoá volume Docker (dữ liệu database)', d, 'cao', true)
      else if (/^(rm|rmi)\b|^(container|image|network)\s+(rm|prune)\b|^system\s+prune\b/.test(d)) them('Xoá container / image Docker', d, 'trung')
      continue
    }
    if (lenhChinh === 'kubectl' && /\bdelete\b/.test(doan)) { them('Xoá tài nguyên Kubernetes', ds.slice(1).join(' '), 'cao'); continue }
    if (lenhChinh === 'terraform' && /\bdestroy\b/.test(doan)) { them('Phá huỷ hạ tầng (terraform destroy)', ds.slice(1).join(' '), 'cao'); continue }
    if ((lenhChinh === 'aws' && /\bs3\s+(rm|rb)\b/.test(doan)) || (lenhChinh === 'gsutil' && /\brm\b/.test(doan)) || (lenhChinh === 'gcloud' && /\bdelete\b/.test(doan)) || (lenhChinh === 'az' && /\bdelete\b/.test(doan))) {
      them('Xoá dữ liệu / tài nguyên trên cloud', ds.slice(1).join(' '), 'cao'); continue
    }
    if (lenhChinh === 'mkfs' || lenhChinh.startsWith('mkfs.') || (lenhChinh === 'dd' && /\bof=/.test(doan))) { them('Ghi đè ổ đĩa', ds.slice(1).join(' '), 'cao'); continue }
    if ((lenhChinh === 'chmod' || lenhChinh === 'chown') && /\s-R\b|--recursive/.test(doan)) { them('Đổi quyền hàng loạt', ds.slice(1).join(' '), 'trung'); continue }
    if (lenhChinh === 'kill' && /\s-(9|KILL)\b/.test(doan)) { them('Buộc dừng tiến trình', ds.slice(1).join(' '), 'trung'); continue }
    if (lenhChinh === 'killall' || lenhChinh === 'pkill') { them('Dừng hàng loạt tiến trình', ds.slice(1).join(' '), 'trung'); continue }
    if (['shutdown', 'reboot', 'halt', 'poweroff'].includes(lenhChinh)) { them('Tắt / khởi động lại máy', doan, 'cao'); continue }
    if ((lenhChinh === 'npm' || lenhChinh === 'pnpm' || lenhChinh === 'yarn') && /\bpublish\b/.test(doan)) { them('Phát hành gói lên npm', doan, 'trung'); continue }
    if (lenhChinh === 'twine' && /\bupload\b/.test(doan)) { them('Phát hành gói lên PyPI', doan, 'trung'); continue }
    if (coSudo && ketQua.length === truoc) them('Chạy với quyền quản trị (sudo)', doan, 'trung')
  }

  // SQL chỉ được xét khi thật sự đi vào database (psql -c "…", echo "…" | psql),
  // không phải khi nó chỉ là chuỗi trong grep / message commit.
  if (cacDoan.some(d => laSqlClient(doiSoCuaDoan(d)))) nguyHiemSql(dongLenh, them)
  for (const t of than) {
    const nhan = tachDoan(t.lenhNhan).map(doiSoCuaDoan)
    if (nhan.some(laSqlClient)) nguyHiemSql(t.noiDung, them)
    if (nhan.some(ds => ds.some(a => SHELL.test(tenFile(a))))) longVao(t.noiDung)
  }

  // Tải script từ mạng rồi chạy ngay: nhìn cả dòng vì nó nối bằng dấu |
  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|)sh\b/.test(dongLenh)) {
    them('Tải script từ internet và chạy ngay', dongLenh, 'cao')
  }
  // Ghi đè file bằng > vào file hệ thống
  if (/(^|[^>])>\s*\/(etc|usr|bin|boot)\//.test(dongLenh)) {
    them('Ghi đè file hệ thống', dongLenh, 'cao')
  }
  return ketQua
}

/** Bỏ dấu tiếng Việt, chữ thường: "Xoá Database" → "xoa database". */
function khongDau(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
}

const DONG_TU_XOA = '(xoa|reset|drop|truncate|wipe|flush|flushall|lam sach|don sach|delete|purge|destroy)'
const DOI_TUONG_DB = '(database|databases|db|co so du lieu|csdl|du lieu|data|bang|table|tables|schema|volume|volumes|pgdata|postgres|redis)'
const PHU_DINH = /\b(khong|ko|cam|nghiem cam|dung|chua|khoan|chang|never|not|dont|don't|no)\b/

/**
 * Tin nhắn của NGƯỜI DÙNG có ra lệnh xoá database không. Chặt: câu phủ định
 * ("đừng / cấm / không xoá db") và câu hỏi ("có nên xoá db không?") không tính.
 * "dùng" và "đừng" cùng thành "dung" khi bỏ dấu: hiểu là phủ định — thà chặn nhầm.
 */
export function nguoiDungYeuCauXoaDb(tinNhan: string): boolean {
  const s = khongDau(tinNhan)
  const mau = [
    new RegExp(`\\b${DONG_TU_XOA}\\b[^.!?\\n]{0,30}?\\b${DOI_TUONG_DB}\\b`, 'g'),
    new RegExp(`\\b${DOI_TUONG_DB}\\b[^.!?\\n]{0,10}?\\b${DONG_TU_XOA}\\b`, 'g'),
    /\b(migrate reset|db reset|down -v|dropdb|flushall)\b/g,
  ]
  for (const re of mau) {
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      const dauCau = Math.max(s.lastIndexOf('.', m.index), s.lastIndexOf('!', m.index), s.lastIndexOf('?', m.index), s.lastIndexOf('\n', m.index)) + 1
      const truoc = s.slice(dauCau, m.index + m[0].length)
      const cuoiCau = s.slice(m.index).search(/[.!?\n]/)
      const laCauHoi = cuoiCau >= 0 && s[m.index + cuoiCau] === '?'
      if (!PHU_DINH.test(truoc) && !laCauHoi) return true
    }
  }
  return false
}

const MCP_XOA_DB = /__(reset_branch|delete_branch|delete_project|pause_project|drop_[a-z_]+|delete_database|reset_database)$/
const MCP_CHAY_SQL = /__(execute_sql|apply_migration|query|run_sql|execute_query)$/

/** Công cụ MCP làm mất dữ liệu database (reset branch Supabase, execute_sql với DROP…). */
export function nhanDienMcpXoaDb(tool: string, input: Record<string, unknown>): NguyHiem[] {
  if (!tool.startsWith('mcp__')) return []
  if (MCP_XOA_DB.test(tool)) return [{ nhan: 'Xoá / reset database qua MCP', doiTuong: tool.replace(/^mcp__/, ''), mucDo: 'cao', xoaDatabase: true }]
  if (!MCP_CHAY_SQL.test(tool)) return []
  const sql = ['query', 'sql', 'statement'].map(k => input[k]).find((v): v is string => typeof v === 'string') ?? ''
  const ketQua: NguyHiem[] = []
  nguyHiemSql(sql, (nhan, doiTuong, mucDo, xoaDatabase) =>
    ketQua.push(xoaDatabase ? { nhan, doiTuong: rutGon(doiTuong, 80), mucDo, xoaDatabase } : { nhan, doiTuong: rutGon(doiTuong, 80), mucDo }),
  )
  return ketQua
}

/** Một câu gom các việc nguy hiểm, mức cao nhất đứng trước. */
export function tomTatNguyHiem(ds: NguyHiem[]): { cau: string; mucDo: MucDo } {
  const sap = [...ds].sort((a, b) => (a.mucDo === b.mucDo ? 0 : a.mucDo === 'cao' ? -1 : 1))
  const dau = sap[0]
  if (!dau) return { cau: '', mucDo: 'trung' }
  const them = sap.length > 1 ? ` (+${sap.length - 1} việc nguy hiểm khác)` : ''
  return { cau: `${dau.nhan}: ${dau.doiTuong}${them}`, mucDo: dau.mucDo }
}

// ─────────────────────── đặt tên việc ───────────────────────

/** Tên dễ hiểu cho một lệnh Bash khi Claude không ghi description. */
export function tenLenhBash(lenh: string): string {
  const doan = tachDoan(lenh).map(boTienTo).filter(d => !/^cd\s/.test(d))
  const chinh = doan[0] ?? lenh
  const ds = cacDoiSo(chinh)
  const c = tenFile(ds[0] ?? '')
  const a1 = ds[1] ?? ''
  const a2 = ds[2] ?? ''

  if (['npm', 'pnpm', 'yarn', 'bun'].includes(c)) {
    if (/^(i|install|add|ci)$/.test(a1)) return 'Cài thư viện JavaScript'
    if (/^(test|t)$/.test(a1) || (a1 === 'run' && /test/.test(a2))) return 'Chạy test'
    if (a1 === 'run' && /build/.test(a2)) return 'Build dự án'
    if (a1 === 'run' && /lint/.test(a2)) return 'Kiểm tra code (lint)'
    if (a1 === 'run' && /dev|start|serve/.test(a2)) return 'Khởi động server'
    if (a1 === 'run') return `Chạy script ${a2}`
    return `Chạy ${c} ${a1}`.trim()
  }
  if (c === 'npx' || c === 'pnpx' || c === 'bunx') {
    if (/^(tsc|vue-tsc)$/.test(a1)) return 'Kiểm tra kiểu TypeScript'
    if (/jest|vitest|playwright|mocha/.test(a1)) return 'Chạy test'
    if (/eslint|prettier|biome/.test(a1)) return 'Kiểm tra / định dạng code'
    return `Chạy công cụ ${a1}`
  }
  if (c === 'tsc') return 'Kiểm tra kiểu TypeScript'
  if (/^(pytest|jest|vitest|mocha)$/.test(c) || (c === 'go' && a1 === 'test') || (c === 'cargo' && a1 === 'test')) return 'Chạy test'
  if ((c === 'cargo' || c === 'go') && a1 === 'build') return 'Build dự án'
  if (c === 'make') return a1 ? `Chạy make ${a1}` : 'Build bằng make'
  if (/^pip3?$/.test(c) || c === 'uv' || c === 'poetry') return /install|add|sync/.test(a1 + a2) ? 'Cài thư viện Python' : `Quản lý gói Python (${a1})`
  if (/^python3?$/.test(c)) return a1 === '-m' ? `Chạy module Python ${a2}` : a1 === '-c' ? 'Chạy đoạn Python ngắn' : `Chạy script Python ${tenFile(a1)}`
  if (c === 'node' || c === 'deno' || c === 'tsx' || c === 'ts-node') return a1 === '-e' ? 'Chạy đoạn JavaScript ngắn' : `Chạy script ${tenFile(a1)}`
  if (c === 'git') {
    const map: Record<string, string> = {
      status: 'Xem trạng thái git', diff: 'Xem thay đổi trong code', log: 'Xem lịch sử commit', show: 'Xem một commit',
      add: 'Đưa file vào git', commit: 'Tạo commit', push: 'Đẩy code lên remote', pull: 'Lấy code mới từ remote',
      fetch: 'Lấy thông tin từ remote', clone: 'Tải repo về', checkout: 'Chuyển nhánh / phục hồi file', switch: 'Chuyển nhánh',
      branch: 'Quản lý nhánh', merge: 'Gộp nhánh', rebase: 'Sắp lại commit', stash: 'Cất tạm thay đổi', tag: 'Gắn tag phiên bản',
    }
    return map[a1] ?? `Thao tác git (${a1})`
  }
  if (c === 'gh') return a1 === 'pr' ? `GitHub: ${a2 === 'create' ? 'tạo pull request' : 'pull request ' + a2}` : `GitHub CLI: ${a1} ${a2}`.trim()
  if (/^(ls|tree|du|df)$/.test(c)) return 'Xem danh sách file'
  if (c === 'find' || c === 'fd') return 'Tìm file'
  if (/^(cat|head|tail|less|more|bat|wc|nl)$/.test(c)) return `Đọc file ${tenFile(ds.find((x, i) => i > 0 && !x.startsWith('-')) ?? '')}`.trim()
  if (/^(grep|rg|ag|ack)$/.test(c)) return 'Tìm kiếm trong code'
  if (c === 'mkdir') return 'Tạo thư mục'
  if (c === 'touch') return 'Tạo file'
  if (c === 'cp' || c === 'rsync') return 'Sao chép file'
  if (c === 'mv') return 'Di chuyển / đổi tên file'
  if (c === 'rm') return 'Xoá file'
  if (/^(zip|tar|unzip|gzip|gunzip|7z)$/.test(c)) return /^(unzip|gunzip)$/.test(c) || /x/.test(a1) ? 'Giải nén' : 'Nén file'
  if (c === 'curl' || c === 'wget' || c === 'http') return 'Gọi / tải dữ liệu từ mạng'
  if (c === 'docker' || c === 'podman') return a1 === 'compose' ? `Docker compose ${a2}` : `Docker: ${a1}`
  if (c === 'kubectl') return `Kubernetes: ${a1}`
  if (c === 'echo' || c === 'printf') return 'In thông tin'
  if (c === 'sed' || c === 'awk' || c === 'perl') return 'Xử lý văn bản'
  if (c === 'jq') return 'Đọc dữ liệu JSON'
  if (c === 'which' || c === 'type' || c === 'command') return 'Kiểm tra công cụ đã cài'
  if (c === 'sleep') return 'Chờ'
  if (c === 'claude') return `Claude CLI: ${a1}`
  return c ? `Chạy lệnh ${c}` : 'Chạy lệnh'
}

/** Mô tả của Claude nếu có (đã gọn), không thì tự đặt tên từ lệnh. */
export function tenViecBash(lenh: string, moTa?: string): string {
  const m = (moTa ?? '').trim()
  return m ? rutGon(m, 90) : tenLenhBash(lenh)
}

export function soDong(s: string): number {
  if (!s) return 0
  const t = s.endsWith('\n') ? s.slice(0, -1) : s
  return t.length === 0 ? 0 : t.split('\n').length
}

/** Tên việc cho các công cụ sửa file. */
export function tenViecSuaFile(tool: string, input: Record<string, unknown>): string | undefined {
  const fp = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
  const f = tenFile(fp) || 'file'
  if (tool === 'Write') {
    const n = soDong(typeof input.content === 'string' ? input.content : '')
    return `Ghi file ${f} (${n} dòng)`
  }
  if (tool === 'Edit') {
    const cu = soDong(typeof input.old_string === 'string' ? input.old_string : '')
    const moi = soDong(typeof input.new_string === 'string' ? input.new_string : '')
    return `Sửa file ${f} (−${cu} +${moi} dòng)`
  }
  if (tool === 'MultiEdit') {
    const n = Array.isArray(input.edits) ? input.edits.length : 0
    return `Sửa file ${f} (${n} chỗ)`
  }
  if (tool === 'NotebookEdit') return `Sửa notebook ${f}`
  return undefined
}

/** Tên việc cho các công cụ còn lại (đọc file, tìm kiếm, web, MCP...). */
export function tenViecCongCu(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Read': return `Đọc file ${tenFile(s('file_path'))}`
    case 'Grep': return `Tìm "${rutGon(s('pattern'), 40)}" trong code`
    case 'Glob': return `Tìm file ${rutGon(s('pattern'), 40)}`
    case 'LS': return 'Xem danh sách file'
    case 'WebSearch': return `Tìm trên web: ${rutGon(s('query'), 50)}`
    case 'WebFetch': return `Đọc trang web ${s('url').replace(/^https?:\/\//, '').split('/')[0] ?? ''}`
    case 'TodoWrite': return 'Cập nhật kế hoạch'
    case 'TaskCreate': return `Thêm việc vào kế hoạch: ${rutGon(s('subject'), 60)}`
    case 'TaskUpdate': return 'Cập nhật kế hoạch'
    case 'Skill': return `Dùng skill ${s('skill')}`
    case 'AskUserQuestion': return 'Hỏi bạn một câu'
    case 'ToolSearch': return 'Tìm công cụ phù hợp'
    case 'EnterPlanMode': case 'ExitPlanMode': return 'Lập kế hoạch'
  }
  const sua = tenViecSuaFile(tool, input)
  if (sua) return sua
  if (tool === 'Bash') return tenViecBash(s('command'), s('description'))
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) return `Dùng ${mcp[1]?.replace(/_/g, ' ')}: ${mcp[2]?.replace(/_/g, ' ')}`
  return `Dùng công cụ ${tool}`
}

// ─────────────────────── subagent ───────────────────────

const TEN_LOAI: Record<string, string> = {
  Explore: 'Trinh sát',
  Plan: 'Kiến trúc sư',
  'general-purpose': 'Trợ lý',
  claude: 'Trợ lý',
  'claude-code-guide': 'Cố vấn',
  'statusline-setup': 'Kỹ thuật viên',
  fork: 'Bản sao',
}

/** Tên hiển thị cho subagent: tên Claude đặt (nếu có), không thì theo loại + số thứ tự. */
export function tenSubagent(loai: string, thuTu: number, tenDat?: string): string {
  const goc = TEN_LOAI[loai] ?? loai.replace(/^.*:/, '')
  if (tenDat && tenDat.trim()) return `${tenDat.trim()} (${goc})`
  return `${goc} #${thuTu}`
}

const KY_VONG_MAC_DINH: Record<string, number> = {
  Explore: 60_000,
  Plan: 120_000,
  'general-purpose': 180_000,
  claude: 180_000,
}

export function kyVongMacDinh(loai: string): number {
  return KY_VONG_MAC_DINH[loai] ?? 150_000
}

/** Trung bình trượt cho thời gian chạy theo loại subagent. */
export function capNhatTrungBinh(cu: number | undefined, moi: number): number {
  return cu === undefined ? moi : Math.round(cu * 0.7 + moi * 0.3)
}

// ─────────────────────── tiến độ ───────────────────────

export type TienDo = {
  /** 0-100 */
  phanTram: number
  xong: number
  tong: number
  /** undefined khi chưa đủ dữ liệu để ước tính */
  conLaiMs?: number
  hienTai?: Viec
  laUocTinhTheoGio: boolean
  quaHan: boolean
}

/** % theo danh sách việc: việc đang làm tính nửa phần; thời gian còn lại = tốc độ hiện tại × phần còn lại. */
export function tienDoTheoViec(viec: readonly Viec[], batDau: number, bayGio: number): TienDo {
  const tong = viec.length
  const xong = viec.filter(v => v.trangThai === 'completed').length
  const dang = viec.filter(v => v.trangThai === 'in_progress').length
  const donVi = xong + dang * 0.5
  const phanTram = tong === 0 ? 0 : Math.min(100, Math.round((donVi / tong) * 100))
  const daChay = Math.max(0, bayGio - batDau)
  const conLaiMs = donVi > 0 && tong > donVi ? Math.round((daChay / donVi) * (tong - donVi)) : tong > 0 && donVi >= tong ? 0 : undefined
  return {
    phanTram,
    xong,
    tong,
    conLaiMs,
    hienTai: viec.find(v => v.trangThai === 'in_progress'),
    laUocTinhTheoGio: false,
    quaHan: false,
  }
}

/** % theo thời gian khi subagent không có danh sách việc: so với thời gian chạy trung bình của loại đó. Giữ tối đa 95% đến khi xong thật. */
export function tienDoTheoGio(daChayMs: number, kyVongMs: number): TienDo {
  const ty = kyVongMs > 0 ? daChayMs / kyVongMs : 1
  const quaHan = ty >= 1
  return {
    phanTram: Math.min(95, Math.max(1, Math.round(ty * 100))),
    xong: 0,
    tong: 0,
    conLaiMs: quaHan ? undefined : Math.max(0, kyVongMs - daChayMs),
    laUocTinhTheoGio: true,
    quaHan,
  }
}

// ─────────────────────── định dạng ───────────────────────

/** 75000 → "1:15"; 3725000 → "1:02:05" */
export function dongHo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Thời gian còn lại, làm tròn cho dễ đọc: "~40 giây", "~3 phút", "~1 giờ 10 phút" */
export function conLai(ms: number | undefined): string {
  if (ms === undefined) return 'đang ước tính…'
  const s = Math.round(ms / 1000)
  if (s <= 5) return 'sắp xong'
  if (s < 60) return `~${Math.ceil(s / 5) * 5} giây`
  const m = Math.round(s / 60)
  if (m < 60) return `~${m} phút`
  return `~${Math.floor(m / 60)} giờ ${m % 60} phút`
}

export function thanhTienDo(phanTram: number, doRong: number): string {
  const w = Math.max(4, doRong)
  const day = Math.round((Math.min(100, Math.max(0, phanTram)) / 100) * w)
  return '█'.repeat(day) + '░'.repeat(w - day)
}

// ─────────────────────── thu gọn code ───────────────────────

/** Thay khối code dài trong câu trả lời bằng một dòng tóm tắt. Khối chưa đóng (đang stream) giữ nguyên. */
export function thuGonCode(text: string, toiDa: number): string {
  if (toiDa <= 0 || !text.includes('```')) return text
  return text.replace(/(^|\n)```([^\n`]*)\n([\s\S]*?)\n```(?=\n|$)/g, (khop, dau: string, ngonNgu: string, than: string) => {
    const n = soDong(than)
    if (n <= toiDa) return khop
    const nn = ngonNgu.trim() || 'code'
    return `${dau}> ▤ *Đoạn ${nn} · ${n} dòng đã thu gọn — gõ \`/chi-tiet\` để xem đầy đủ*`
  })
}

/** Dòng đầu tiên có chữ của một khối văn bản, rút gọn. */
export function dongDau(s: string, toiDa = 100): string {
  const d = s.split('\n').map(x => x.trim()).find(x => x.length > 0) ?? ''
  return rutGon(d, toiDa)
}
