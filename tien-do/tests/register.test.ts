import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionStartInput } from 'claude-code'

/** Những gì engine trả lời bên dưới mod trong một phiên thật. */
const nen = (on: On) => {
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('ui.log', () => ({ value: undefined }))
}

const PHIEN: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

const BANG: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 20,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

describe('bảng tiến độ', () => {
  test('tính % và việc đang làm từ danh sách việc', async ($, on) => {
    const dongHo = mock.clock(on, { now: 1_000_000 })
    nen(on)
    on('tool.call', () => ({ result: 'ok' }))

    await $.session.start(PHIEN)
    await $.turn.start({ text: 'làm mod', turnId: 't1' })
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Đọc tài liệu', status: 'completed', activeForm: 'Đang đọc tài liệu' },
        { content: 'Viết mod', status: 'in_progress', activeForm: 'Đang viết mod' },
        { content: 'Kiểm tra', status: 'pending', activeForm: 'Đang kiểm tra' },
        { content: 'Đóng gói', status: 'pending', activeForm: 'Đang đóng gói' },
      ],
    })
    await dongHo.advance(60_000)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'tien-do', surface, component: 'AbovePrompt', props: BANG })
      expect((await ui.find({ type: 'Text', text: 'Đang viết mod' }))?.text, surface).toContain('▶')
      expect((await ui.find({ type: 'Text', text: /38% · 1\/4 việc/ }))?.text, surface).toContain('còn')
    }
  })

  test('subagent có tên, việc và % ước tính', async ($, on) => {
    mock.clock(on, { now: 0 })
    nen(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    on('tool.call', () => ({ result: 'ok' }))

    await $.session.start(PHIEN)
    await $.turn.start({ text: 'tìm', turnId: 't1' })
    await $.tool.call({ tool: 'Agent', description: 'Tìm file cấu hình', prompt: 'tìm', subagent_type: 'Explore' })

    const ui = await $.ui.mount({ plugin: 'tien-do', surface: 'terminal', component: 'AbovePrompt', props: BANG })
    expect(await ui.find({ type: 'Text', text: /Trinh sát #1 — Tìm file cấu hình/ })).toBeDefined()
  })
})

describe('lệnh nguy hiểm', () => {
  test('khi Claude được tự chạy, hỏi lại; bạn không đồng ý thì chặn', async ($, on) => {
    mock.clock(on)
    nen(on)
    let daChay = false
    on('tool.check', () => ({ decision: 'allow' }))
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'đóng hộp hỏi' }))
    on('tool.call', { tool: 'Bash' }, () => {
      daChay = true
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })

    await $.session.start(PHIEN)
    const kq = await $.tool.call({ tool: 'Bash', command: 'rm -rf build', description: 'Dọn thư mục build' })
    expect(daChay).toBe(false)
    expect(kq.deny ?? kq.text ?? '').toContain('chặn')
  })

  test('hàng trong transcript gọi tên việc nguy hiểm thay cho lệnh', async ($, on) => {
    mock.clock(on)
    nen(on)
    await $.session.start(PHIEN)
    const ui = await $.ui.mount({
      plugin: 'tien-do',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'u1',
      props: {
        tool_use_id: 'u1',
        tool: 'Bash',
        input: { command: 'rm -rf build', description: 'Dọn build' },
        isRunning: true,
        isErrored: false,
        isInterrupted: false,
      },
    })
    expect((await ui.find({ type: 'Text', text: /Xoá thư mục: build/ }))?.text).toContain('⚠')
  })

  test('lệnh thường hiện tên việc, không hiện script', async ($, on) => {
    mock.clock(on)
    nen(on)
    await $.session.start(PHIEN)
    const ui = await $.ui.mount({
      plugin: 'tien-do',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'u2',
      props: {
        tool_use_id: 'u2',
        tool: 'Bash',
        input: { command: 'cd app && npm ci && npm run build -- --mode production' },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      },
    })
    expect(await ui.find({ type: 'Text', text: 'Cài thư viện JavaScript' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /npm ci/ })).toBeUndefined()
  })
})
