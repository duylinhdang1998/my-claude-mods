import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionStartInput } from 'claude-code'

import { nhanDienNguyHiem, timLenhPush } from '../hooks/lib'

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

describe('tìm lệnh git push', () => {
  test('ref sẽ đẩy và remote so sánh', async () => {
    expect(timLenhPush('git push')).toEqual([{ doiSoLog: ['HEAD', '--not', '--remotes'] }])
    expect(timLenhPush('git push -u origin fix/x')).toEqual([{ doiSoLog: ['fix/x', '--not', '--remotes=origin'] }])
    expect(timLenhPush('git push origin +HEAD:main')).toEqual([{ doiSoLog: ['HEAD', '--not', '--remotes=origin'] }])
    expect(timLenhPush('git push --all origin')).toEqual([{ doiSoLog: ['--branches', '--not', '--remotes=origin'] }])
    expect(timLenhPush('git add -A && git commit -m "push x" && git push -q', '/work')).toEqual([
      { thuMuc: '/work', doiSoLog: ['HEAD', '--not', '--remotes'] },
    ])
    expect(timLenhPush('git -C app push origin main', '/work')).toEqual([{ thuMuc: '/work/app', doiSoLog: ['main', '--not', '--remotes=origin'] }])
  })

  test('không phải push đẩy commit', async () => {
    expect(timLenhPush('git push origin --delete old')).toEqual([])
    expect(timLenhPush('git push origin :old')).toEqual([])
    expect(timLenhPush('git log --oneline')).toEqual([])
    expect(timLenhPush('echo "git push"')).toEqual([])
  })
})

// ── qua hook thật ──

const nen = (on: On, gitLog: string) => {
  mock.store(on)
  mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: gitLog, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.check', () => ({ decision: 'allow' }))
}
const PHIEN: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

describe('qua hook', () => {
  test('rm -rf build trong project chạy luôn, không hỏi', async ($, on) => {
    nen(on, '')
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
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build dist', description: 'Dọn thư mục build' })
    expect(daHoi).toBe(false)
    expect(daChay).toBe(true)
  })

  test('push có commit xoá file → hỏi; người dùng chặn thì không push', async ($, on) => {
    nen(on, '\nsrc/old.ts\n\nsrc/legacy/index.ts\n')
    let daChay = false
    let cauHoi = ''
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
      cauHoi = JSON.stringify(e)
      return { result: 'Chặn' }
    })
    on('tool.call', { tool: 'Bash' }, () => {
      daChay = true
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    await $.session.start(PHIEN)
    const kq = await $.tool.call({ tool: 'Bash', command: 'git push origin main', description: 'Đẩy code' })
    expect(cauHoi).toContain('src/old.ts')
    expect(daChay).toBe(false)
    expect(kq.deny ?? '').toContain('chặn')
  })

  test('push không xoá file nào chạy luôn', async ($, on) => {
    nen(on, '')
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
    await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/x', description: 'Đẩy code' })
    expect(daHoi).toBe(false)
    expect(daChay).toBe(true)
  })
})
