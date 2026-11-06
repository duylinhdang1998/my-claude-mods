import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionStartInput } from 'claude-code'

import { nhanDienNguyHiem } from '../hooks/lib'

const BC = { duAn: '/work', thuMuc: '/work' }
const nhan = (lenh: string) => nhanDienNguyHiem(lenh, BC).map(x => x.nhan)

describe('lệnh xoá trong project: chạy bình thường', () => {
  test('xoá file / thư mục bên trong project', async () => {
    for (const l of [
      'rm -rf build',
      'rm -rf node_modules dist .next',
      'rm src/old.ts',
      'rm -f /work/tmp/a.log',
      'cd app && rm -rf .turbo',
      'rmdir empty-dir',
      'find . -name "*.pyc" -delete',
      'find src -type f -name "*.orig" -exec rm {} +',
    ]) {
      expect(nhan(l), l).toEqual([])
    }
  })

  test('vẫn báo: ngoài project, diện rộng, .git, đường dẫn không chắc, sudo', async () => {
    for (const l of [
      'rm -rf /tmp/x',
      'rm -rf ~/Downloads',
      'rm -rf ../other-project',
      'rm -rf .',
      'rm -rf *',
      'rm -rf /work',
      'rm -rf .git',
      'rm -rf $OUT/build',
      'cd /tmp && rm -rf x',
      'sudo rm -rf build',
      'find . -delete',
      'find /tmp -name "*.log" -delete',
    ]) {
      expect(nhan(l).length, l).toBeGreaterThan(0)
    }
  })

  test('file dữ liệu database trong project vẫn bị chặn cứng', async () => {
    expect(nhanDienNguyHiem('rm -rf ./pgdata', BC).some(x => x.xoaDatabase)).toBe(true)
    expect(nhanDienNguyHiem('rm dev.sqlite', BC).some(x => x.xoaDatabase)).toBe(true)
  })

  test('không có thông tin project thì giữ hành vi cũ', async () => {
    expect(nhanDienNguyHiem('rm -rf build').length).toBeGreaterThan(0)
  })
})

// ── qua hook thật ──

const nen = (on: On) => {
  mock.store(on)
  mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.check', () => ({ decision: 'allow' }))
}
const PHIEN: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

describe('qua hook: không hỏi thêm', () => {
  for (const [ten, lenh] of [
    ['xoá trong project', 'rm -rf build dist'],
    ['xoá ngoài project', 'rm -rf /tmp/build'],
    ['push (kể cả có commit xoá file)', 'git push origin main'],
    ['force push', 'git push --force origin main'],
  ] as const) {
    test(`${ten}: chạy luôn`, async ($, on) => {
      nen(on)
      let daChay = false
      let daHoi = false
      on('tool.call', { tool: 'AskUserQuestion' }, () => {
        daHoi = true
        return { result: 'Chặn' }
      })
      on('tool.call', { tool: 'Bash' }, () => {
        daChay = true
        return { result: { stdout: '', stderr: '', interrupted: false } }
      })
      await $.session.start(PHIEN)
      await $.tool.call({ tool: 'Bash', command: lenh, description: ten })
      expect(daHoi).toBe(false)
      expect(daChay).toBe(true)
    })
  }
})
