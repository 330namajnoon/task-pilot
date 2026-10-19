import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/h/.claude-tasks'

const task = (id: string, title: string, status: string, steps: string[], done: number) =>
  JSON.stringify({
    id,
    title,
    type: 'feature',
    status,
    tags: [],
    branch: id,
    project: '/code/store',
    steps: steps.map((text, i) => ({ id: i + 1, text, status: i < done ? 'done' : 'todo', estimateMin: 30 })),
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: status === 'done' ? '2026-10-11T09:00:00.000Z' : '2026-10-12T09:00:00.000Z',
  })

const FILES: Record<string, string> = {
  [`${ROOT}/config.json`]: JSON.stringify({ idleTimeoutMin: 15, maxTurnMin: 240 }),
  [`${ROOT}/tasks/STORE-1/task.json`]: task('STORE-1', 'Migrar webhook de pagos', 'in_progress', ['Leer API', 'Firmar', 'Tests'], 1),
  [`${ROOT}/tasks/STORE-2/task.json`]: task('STORE-2', 'Arreglar login', 'done', ['Fix'], 1),
  [`${ROOT}/tasks/STORE-1/context.md`]: 'Firma pendiente de revisar.',
  [`${ROOT}/tasks/STORE-1/log.md`]: '## 2026-10-12 11:00 · progress\nStep 1 done: Leer API\n',
  [`${ROOT}/time/2026-10-12.jsonl`]: [
    { kind: 'hb', ts: '2026-10-12T09:00:00.000Z', sessionId: 's', taskId: 'STORE-1', event: 'UserPromptSubmit' },
    { kind: 'hb', ts: '2026-10-12T09:45:00.000Z', sessionId: 's', taskId: 'STORE-1', event: 'Stop' },
  ]
    .map(e => JSON.stringify(e))
    .join('\n'),
}

const DIRS: Record<string, string[]> = {
  [`${ROOT}/tasks`]: ['STORE-1', 'STORE-2'],
  [`${ROOT}/time`]: ['2026-10-12.jsonl'],
}

const PANE = {
  component: 'Pane',
  requestId: 'task-pilot',
  props: {
    title: 'Tareas',
    isFocused: true,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { columns: 120, rows: 40 },
} as const

test('lists, searches and opens a task', async ($, on) => {
  mock.env(on, { HOME: '/h' })
  on('fs.list', async (_$, e) => {
    const names = DIRS[e.path]
    if (!names) return { deny: 'ENOENT' }

    return {
      value: names.map(name => ({ name, kind: name.endsWith('.jsonl') ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false }) as const),
    }
  })
  on('fs.read', async (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) return { deny: 'ENOENT' }

    return { value: text }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task-pilot', surface, ...PANE })

    // Open tasks by default: STORE-1 with 45m tracked of a 1h 30m estimate.
    expect(await ui.find({ key: 'task-STORE-1' })).toBeDefined()
    expect(await ui.find({ key: 'task-STORE-2' })).toBeUndefined()
    expect((await ui.find({ key: 'task-STORE-1' }))?.text).toMatch(/45m\/1h 30m/)

    await ui.press({ key: 'filter-all' })
    expect(await ui.find({ key: 'task-STORE-2' })).toBeDefined()

    await ui.input({ key: 'search', text: 'login', kind: 'change' })
    expect(await ui.find({ key: 'task-STORE-1' })).toBeUndefined()
    expect(await ui.find({ key: 'task-STORE-2' })).toBeDefined()

    await ui.input({ key: 'search', text: '', kind: 'change' })
    await ui.press({ key: 'task-STORE-1' })
    expect(await ui.find({ type: 'Text', text: /Firma pendiente|Firmar/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3 pasos/ })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'search' })).toBeDefined()
    await ui.press({ key: 'filter-open' })
    await ui.unmount()
  }
})
