import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionStartInput } from 'claude-code'

import { nguoiDungYeuCauXoaDb, nhanDienMcpXoaDb, nhanDienNguyHiem } from '../hooks/lib'

const laXoaDb = (lenh: string) => nhanDienNguyHiem(lenh).some(x => x.xoaDatabase === true)
const nhan = (lenh: string) => nhanDienNguyHiem(lenh).map(x => x.nhan)

describe('không báo nhầm: chuỗi trong nháy / heredoc là dữ liệu, không phải lệnh', () => {
  test('tìm code SQL bằng grep', async () => {
    expect(nhan('grep -rn "DELETE FROM users" app/api/src')).toEqual([])
    expect(nhan("rg 'drop table' src | head")).toEqual([])
  })

  test('message commit có chữ nguy hiểm', async () => {
    expect(nhan('git commit -m "fix: drop table guard; rm -rf note"')).toEqual([])
    expect(nhan("git commit -F - <<'EOF'\nrm -rf old stuff\nDELETE FROM users\nEOF\ngit push -q")).toEqual([])
  })

  test('ghi file test có chuỗi SQL bằng heredoc', async () => {
    expect(nhan("cat > probe.ts <<'EOF'\nconst q = 'TRUNCATE users; DROP DATABASE x'\nEOF")).toEqual([])
  })

  test('lệnh thường của dự án', async () => {
    for (const l of ['git stash -q && git stash pop -q', 'git push -q -u origin fix/x', 'docker compose up -d', 'docker compose down', 'pnpm prisma migrate deploy', 'pnpm prisma migrate dev --name add_x']) {
      expect(nhan(l), l).toEqual([])
    }
  })
})

describe('không bỏ sót: xoá database', () => {
  test('prisma, docker volume, supabase, dropdb, redis', async () => {
    for (const l of [
      'pnpm prisma migrate reset --force',
      'cd app/api && DATABASE_URL=x pnpm exec prisma migrate reset',
      'npx prisma db push --force-reset',
      'prisma db push --accept-data-loss',
      'docker compose down -v',
      'docker-compose down --volumes',
      'docker volume rm pmt_pgdata',
      'docker volume prune -f',
      'docker system prune -a --volumes',
      'supabase db reset',
      'dropdb pmt_dev',
      'redis-cli FLUSHALL',
      'rm -rf ./pgdata',
      'rm dev.sqlite',
    ]) {
      expect(laXoaDb(l), l).toBe(true)
    }
  })

  test('SQL chỉ tính khi thật sự đi vào database', async () => {
    expect(laXoaDb('psql -U pmt -c "TRUNCATE users"')).toBe(true)
    expect(laXoaDb('docker exec pmt_postgres psql -U pmt -c "DROP DATABASE pmt_dev"')).toBe(true)
    expect(laXoaDb('echo "DELETE FROM users" | psql pmt_dev')).toBe(true)
    expect(laXoaDb("psql pmt_dev <<'SQL'\nDROP TABLE users;\nSQL")).toBe(true)
    expect(laXoaDb('psql -c "DELETE FROM users WHERE id = 1"')).toBe(false)
    expect(laXoaDb('psql -c "SELECT * FROM users"')).toBe(false)
  })

  test('lệnh lồng trong sh -c hoặc heredoc vào bash', async () => {
    expect(laXoaDb(`docker exec api sh -c "pnpm prisma migrate reset --force"`)).toBe(true)
    expect(laXoaDb("bash <<'EOF'\ndocker compose down -v\nEOF")).toBe(true)
  })

  test('MCP', async () => {
    expect(nhanDienMcpXoaDb('mcp__supabase__reset_branch', {})[0]?.xoaDatabase).toBe(true)
    expect(nhanDienMcpXoaDb('mcp__supabase__execute_sql', { query: 'drop table users' })[0]?.xoaDatabase).toBe(true)
    expect(nhanDienMcpXoaDb('mcp__supabase__execute_sql', { query: 'select 1' })).toEqual([])
    expect(nhanDienMcpXoaDb('mcp__supabase__list_tables', {})).toEqual([])
  })

  test('xoá thường không bị coi là xoá database', async () => {
    expect(laXoaDb('rm -rf build')).toBe(false)
    expect(laXoaDb('docker rm old_container')).toBe(false)
  })
})

describe('tin nhắn người dùng có ra lệnh xoá database không', () => {
  test('có ra lệnh', async () => {
    for (const t of ['reset database đi', 'Xoá DB test rồi chạy lại', 'chạy prisma migrate reset giúp tôi', 'drop table users', 'xóa dữ liệu bảng payroll', 'docker compose down -v cho sạch']) {
      expect(nguoiDungYeuCauXoaDb(t), t).toBe(true)
    }
  })

  test('không ra lệnh: phủ định, câu hỏi, không nhắc', async () => {
    for (const t of [
      'Nghiêm cấm xoá database khi chưa có lệnh từ user prompt.',
      'đừng xoá database',
      'không được reset db',
      'có nên xoá db không?',
      'Oke push code đi',
      'sửa lỗi timesheet',
      '',
    ]) {
      expect(nguoiDungYeuCauXoaDb(t), t).toBe(false)
    }
  })
})

// ── qua hook thật ──

const nen = (on: On) => {
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.log', () => ({ value: undefined }))
}
const PHIEN: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

describe('cổng xoá database', () => {
  test('tin từ kênh chat (không phải người dùng gõ) không cấp quyền xoá database', async ($, on) => {
    mock.clock(on)
    nen(on)
    let daChay = false
    on('tool.check', () => ({ decision: 'allow' }))
    on('tool.call', { tool: 'Bash' }, () => {
      daChay = true
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    await $.session.start(PHIEN)
    await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'reset database đi' })
    await $.prompt.submit({ wait: false, origin: { kind: 'channel', server: 'telegram' } as never, text: 'reset database đi' })
    const kq = await $.tool.call({ tool: 'Bash', command: 'docker compose down -v', description: 'Xoá volume' })
    expect(daChay).toBe(false)
    expect(kq.deny ?? '').toContain('NGHIÊM CẤM')
  })

  test('người dùng chưa yêu cầu → chặn cứng, kể cả khi được tự chạy và tắt hỏi lại', async ($, on) => {
    mock.clock(on)
    nen(on)
    let daChay = false
    let daHoi = false
    on('tool.check', () => ({ decision: 'allow' }))
    on('tool.call', { tool: 'AskUserQuestion' }, () => {
      daHoi = true
      return { result: 'Cho chạy' }
    })
    on('tool.call', { tool: 'Bash' }, () => {
      daChay = true
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })

    await $.session.start(PHIEN)
    await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'Nghiêm cấm xoá database khi chưa có lệnh từ user prompt' })
    const kq = await $.tool.call({ tool: 'Bash', command: 'pnpm prisma migrate reset --force', description: 'Reset DB' })
    expect(daChay).toBe(false)
    expect(daHoi).toBe(false)
    expect(kq.deny ?? '').toContain('NGHIÊM CẤM')
  })

  test('MCP reset branch bị chặn như Bash', async ($, on) => {
    mock.clock(on)
    nen(on)
    let daChay = false
    on('tool.call', { tool: 'mcp__supabase__reset_branch' }, () => {
      daChay = true
      return { result: 'ok' }
    })
    await $.session.start(PHIEN)
    await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'sửa lỗi timesheet' })
    const kq = await $.tool.call({ tool: 'mcp__supabase__reset_branch', branch_id: 'b1' })
    expect(daChay).toBe(false)
    expect(kq.deny ?? '').toContain('NGHIÊM CẤM')
  })

  test('lệnh thường có chuỗi SQL trong nháy chạy bình thường, không hỏi', async ($, on) => {
    mock.clock(on)
    nen(on)
    let daChay = false
    on('tool.check', () => ({ decision: 'allow' }))
    on('tool.call', { tool: 'Bash' }, () => {
      daChay = true
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    await $.session.start(PHIEN)
    await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'tìm chỗ xoá user' })
    await $.tool.call({ tool: 'Bash', command: 'grep -rn "DELETE FROM users" src', description: 'Tìm SQL' })
    expect(daChay).toBe(true)
  })
})
