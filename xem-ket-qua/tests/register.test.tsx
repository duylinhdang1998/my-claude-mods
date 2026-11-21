import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionStartInput } from 'claude-code'

const ANH = 'mcp__xem-ket-qua__show_image'
const TAM = '/tmp/phien'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const PHIEN: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

/** 24 byte đầu của một PNG rộng × cao, dạng base64. */
const dauPng = (rong: number, cao: number): string => {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, rong)
  new DataView(b.buffer).setUint32(20, cao)
  return btoa(String.fromCharCode(...b))
}

/** Máy giả bên dưới mod: macOS, Ghostty, có Chrome, các file liệt kê trong `tep`. */
const may = (on: On, tep: Record<string, [number, number]>, coChrome = true) => {
  const lenh: string[][] = []
  const congCu: string[] = []
  const coFile = (p: string) => p in tep || p.startsWith(`${TAM}/xem-ket-qua/`)
  mock.env(on, { TERM_PROGRAM: 'ghostty', HOME: '/Users/a' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: '', scratchpadDir: TAM, platform: 'macos' } as never }))
  on('session.cwd', () => ({ value: '/work' }))
  on('tool.register', ($, e) => {
    congCu.push(e.name)
    return { value: { tool: `mcp__xem-ket-qua__${e.name}` } }
  })
  on('fs.exists', ($, e) => ({ value: e.path === CHROME ? coChrome : coFile(e.path) }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } }))
  on('fs.read', ($, e) => {
    const goc = e.path.startsWith(`${TAM}/xem-ket-qua/`) ? (Object.values(tep)[0] ?? [1, 1]) : (tep[e.path] ?? [1, 1])
    return { value: { base64: dauPng(goc[0], goc[1]) } }
  })
  on('process.run', ($, e) => {
    lenh.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { lenh, congCu }
}

describe('công cụ', () => {
  test('đăng ký show_image, và show_html khi có Chrome', async ($, on) => {
    const { congCu } = may(on, {})
    await $.session.start(PHIEN)
    expect(congCu).toEqual(['show_image', 'show_html'])
  })

  test('không có Chrome thì không đăng ký show_html', async ($, on) => {
    const { congCu } = may(on, {}, false)
    await $.session.start(PHIEN)
    expect(congCu).toEqual(['show_image'])
  })

  test('show_image lưu một bản PNG riêng và báo đã hiện', async ($, on) => {
    const { lenh } = may(on, { '/work/shot.png': [1280, 800] })
    await $.session.start(PHIEN)
    const kq = await $.tool.call({ tool: ANH, path: 'shot.png', title: 'Trang chủ' })
    expect(kq.deny).toBeUndefined()
    expect(String(kq.result)).toContain('Đã hiện cho người dùng: "Trang chủ"')
    expect(String(kq.result)).toContain(`Bản lưu: ${TAM}/xem-ket-qua/`)
    expect(lenh.some(a => a[0] === 'cp' && a[1] === '/work/shot.png')).toBe(true)
  })

  test('file không có thì từ chối, nói rõ lý do', async ($, on) => {
    may(on, {})
    await $.session.start(PHIEN)
    const kq = await $.tool.call({ tool: ANH, path: '/work/khong-co.png' })
    expect(String(kq.deny ?? kq.text)).toContain('không tìm thấy file')
  })

  test('show_html không mở trang ngoài localhost', async ($, on) => {
    const { lenh } = may(on, {})
    await $.session.start(PHIEN)
    const kq = await $.tool.call({ tool: 'mcp__xem-ket-qua__show_html', url: 'https://example.com' })
    expect(String(kq.deny ?? kq.text)).toContain('chỉ chụp được trang localhost')
    expect(lenh.some(a => a[0] === CHROME)).toBe(false)
  })
})

describe('lời nhắc', () => {
  test('gửi kèm tin nhắn đầu, một lần mỗi phiên', async ($, on) => {
    may(on, {})
    const ngucanh: (readonly string[] | undefined)[] = []
    on('prompt.submit', ($, e) => {
      ngucanh.push(e.context)
      return { text: e.text }
    })
    await $.session.start(PHIEN)
    await $.prompt.submit({ text: 'sửa nút đăng nhập', wait: false, origin: { kind: 'composer' } })
    await $.prompt.submit({ text: 'tiếp', wait: false, origin: { kind: 'composer' } })
    expect(ngucanh[0]?.[0]).toContain('show_image')
    expect(ngucanh[1]).toBeUndefined()
  })
})

describe('giao diện', () => {
  const hang = (output: string) => ({
    plugin: 'xem-ket-qua',
    component: 'ToolUse',
    requestId: 'u1',
    props: {
      tool_use_id: 'u1',
      tool: ANH,
      input: {
        path: '/work/b.png',
        compare: '/work/a.png',
        title: 'Nút đăng nhập',
        changes: [{ title: 'Đổi màu nút' }],
        checks: [{ name: 'Nút cao 44px', ok: true }, { name: 'Tương phản 4.5:1', ok: false, detail: 'đo được 3.9' }],
      },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output,
    },
  }) as const

  const KQ = `Đã hiện cho người dùng: "Nút đăng nhập".\nBản lưu: ${TAM}/xem-ket-qua/u1-sau.png (1280x800) | Trước: ${TAM}/xem-ket-qua/u1-truoc.png (1280x800)`

  test('terminal: trước / sau, thay đổi và kiểm tra', async ($, on) => {
    may(on, {})
    await $.session.start(PHIEN)
    const ui = await $.ui.mount({ ...hang(KQ), surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Trước' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Sau' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Kiểm tra 1\/2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Đổi màu nút/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Tương phản/ }))?.text).toContain('3.9')
  })

  test('bề mặt khác terminal: hiện đường dẫn thay cho ảnh', async ($, on) => {
    may(on, {})
    await $.session.start(PHIEN)
    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...hang(KQ), surface })
      expect((await ui.find({ type: 'Text', text: /u1-sau\.png/ }))?.text, surface).toContain('Sau:')
    }
  })
})
