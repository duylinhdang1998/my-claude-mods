import { describe, expect, test } from 'claude-code/testing'

import {
  docBanLuu,
  docKiemTra,
  kichThuocPng,
  khaNangTerminal,
  laUrlNoiBo,
  loaiTep,
  loiNhac,
  oCuaAnh,
  tenBanLuu,
  urlTuDuongDan,
  vanBanKetQua,
} from '../hooks/lib'

/** 24 byte đầu của một PNG rộng × cao. */
const dauPng = (rong: number, cao: number): Uint8Array => {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, rong)
  new DataView(b.buffer).setUint32(20, cao)
  return b
}

describe('đọc file', () => {
  test('loại tệp theo đuôi', async () => {
    expect(loaiTep('/a/b.PNG')).toBe('png')
    expect(loaiTep('/a/b.jpeg')).toBe('anh')
    expect(loaiTep('/a/index.htm')).toBe('html')
    expect(loaiTep('/a/b.mp4')).toBeUndefined()
  })

  test('kích thước PNG từ khối IHDR', async () => {
    expect(kichThuocPng(dauPng(1280, 800))).toEqual({ rong: 1280, cao: 800 })
    expect(kichThuocPng(new Uint8Array(24))).toBeUndefined()
  })
})

describe('kích thước khung ảnh', () => {
  test('giữ tỉ lệ, một ô chữ cao gấp đôi bề rộng', async () => {
    expect(oCuaAnh(1280, 800, 100, 50)).toEqual({ columns: 100, rows: 31 })
  })

  test('ảnh cao bị giới hạn số dòng thì thu hẹp số cột theo', async () => {
    const o = oCuaAnh(400, 1600, 100, 20)
    expect(o.rows).toBe(20)
    expect(o.columns).toBe(10)
  })
})

describe('an toàn', () => {
  test('chỉ chụp trang localhost', async () => {
    expect(laUrlNoiBo('http://localhost:3000/')).toBe(true)
    expect(laUrlNoiBo('http://127.0.0.1:5173')).toBe(true)
    expect(laUrlNoiBo('http://[::1]:8080/a')).toBe(true)
    expect(laUrlNoiBo('http://app.localhost/')).toBe(true)
    expect(laUrlNoiBo('https://example.com')).toBe(false)
    expect(laUrlNoiBo('http://localhost.evil.com/')).toBe(false)
    expect(laUrlNoiBo('file:///etc/passwd')).toBe(false)
  })

  test('tên bản lưu không chứa ký tự lạ', async () => {
    expect(tenBanLuu('toolu_01/../x', 'sau')).toBe('toolu_01x-sau.png')
  })

  test('URL file:// mã hoá khoảng trắng', async () => {
    expect(urlTuDuongDan('/Users/a/My Site/index.html')).toBe('file:///Users/a/My%20Site/index.html')
  })
})

describe('terminal', () => {
  test('Ghostty và kitty vẽ được, đọc ảnh từ file', async () => {
    expect(khaNangTerminal({ surface: 'terminal', termProgram: 'ghostty' })).toEqual({ ve: 'duoc', nguon: 'file' })
    expect(khaNangTerminal({ surface: 'terminal', term: 'xterm-kitty' }).ve).toBe('duoc')
  })

  test('iTerm2 và tmux: có thể, gửi ảnh dạng byte', async () => {
    expect(khaNangTerminal({ surface: 'terminal', termProgram: 'iTerm.app' }).ve).toBe('co-the')
    expect(khaNangTerminal({ surface: 'terminal', termProgram: 'ghostty', tmux: '/tmp/t,1,0' }).ve).toBe('co-the')
  })

  test('Terminal.app và app desktop không vẽ được', async () => {
    expect(khaNangTerminal({ surface: 'terminal', termProgram: 'Apple_Terminal' }).ve).toBe('khong')
    expect(khaNangTerminal({ surface: 'desktop', termProgram: 'ghostty' }).ve).toBe('khong')
  })

  test('lời nhắc nói thật khi không vẽ được', async () => {
    expect(loiNhac({ ve: 'khong', vi: 'x' }, true)).toContain('đừng nói người dùng đã xem')
    expect(loiNhac({ ve: 'duoc', nguon: 'file' }, true)).toContain('show_html')
    expect(loiNhac({ ve: 'duoc', nguon: 'file' }, false)).not.toContain('show_html')
  })
})

describe('kết quả công cụ', () => {
  test('ghi rồi đọc lại bản lưu trước / sau', async () => {
    const chu = vanBanKetQua({
      tieuDe: 'Trang chủ',
      sau: { duongDan: '/tmp/x y/a-sau.png', rong: 1280, cao: 800 },
      truoc: { duongDan: '/tmp/x y/a-truoc.png', rong: 1280, cao: 720 },
      kha: { ve: 'duoc', nguon: 'file' },
    })
    expect(chu.split('\n')[0]).toContain('Đã hiện cho người dùng')
    expect(docBanLuu(chu)).toEqual({
      sau: { duongDan: '/tmp/x y/a-sau.png', rong: 1280, cao: 800 },
      truoc: { duongDan: '/tmp/x y/a-truoc.png', rong: 1280, cao: 720 },
    })
    expect(docBanLuu([{ type: 'text', text: chu }])?.sau.rong).toBe(1280)
  })

  test('không vẽ được thì kết quả nói rõ người dùng chưa xem', async () => {
    const chu = vanBanKetQua({
      tieuDe: 'a',
      sau: { duongDan: '/tmp/a.png', rong: 1, cao: 1 },
      kha: { ve: 'khong', vi: 'Terminal.app' },
    })
    expect(chu).toContain('đừng nói họ đã xem')
  })

  test('bỏ mục kiểm tra sai dạng', async () => {
    expect(docKiemTra([{ name: 'a', ok: true }, { name: 'b' }, 'c', null])).toEqual([
      { name: 'a', ok: true, detail: undefined },
    ])
  })
})
