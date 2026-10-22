import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/h/.claude-tasks'

const SPEC = '/h/.claude-tasks/tasks/STORE-1/attachments/1-spec.md'

const task = (id: string, title: string, status: string, steps: string[], done: number, parentId?: string) =>
  JSON.stringify({
    id,
    parentId,
    title,
    type: 'feature',
    status,
    tags: [],
    branch: id,
    project: '/code/store',
    steps: steps.map((text, i) => ({ id: i + 1, text, status: i < done ? 'done' : 'todo', estimateMin: 30 })),
    attachments:
      id === 'STORE-1'
        ? [{ id: 1, name: 'spec.md', path: SPEC, source: '/code/spec.md', mode: 'copy', size: 24, note: 'Criterios', addedAt: '2026-10-12T09:00:00.000Z' }]
        : undefined,
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: status === 'done' ? '2026-10-11T09:00:00.000Z' : '2026-10-12T09:00:00.000Z',
  })

const FILES: Record<string, string> = {
  [`${ROOT}/config.json`]: JSON.stringify({ idleTimeoutMin: 15, maxTurnMin: 240 }),
  [`${ROOT}/tasks/STORE-1/task.json`]: task('STORE-1', 'Migrar webhook de pagos', 'in_progress', ['Leer API', 'Firmar', 'Tests'], 1),
  [`${ROOT}/tasks/STORE-2/task.json`]: task('STORE-2', 'Arreglar login', 'done', ['Fix'], 1),
  [`${ROOT}/tasks/STORE-1.1/task.json`]: task('STORE-1.1', 'Validar firma', 'blocked', ['Leer doc'], 0, 'STORE-1'),
  [`${ROOT}/tasks/STORE-1.1.1/task.json`]: task('STORE-1.1.1', 'Pedir claves', 'backlog', [], 0, 'STORE-1.1'),
  [SPEC]: '# Spec\nLa firma usa HMAC.\n',
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
  [`${ROOT}/tasks`]: ['STORE-1', 'STORE-2', 'STORE-1.1', 'STORE-1.1.1'],
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
  on('fs.stat', async (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) return { deny: 'ENOENT' }

    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } as const }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task-pilot', surface, ...PANE })

    // Open tasks by default: STORE-1 with 45m tracked of a 1h 30m estimate.
    expect(await ui.find({ key: 'task-STORE-1' })).toBeDefined()
    expect(await ui.find({ key: 'task-STORE-2' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /45m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /de 1h 30m/ })).toBeDefined()

    await ui.press({ key: 'filter-all' })
    expect(await ui.find({ key: 'task-STORE-2' })).toBeDefined()

    await ui.input({ key: 'search', text: 'login', kind: 'change' })
    expect(await ui.find({ key: 'task-STORE-1' })).toBeUndefined()
    expect(await ui.find({ key: 'task-STORE-2' })).toBeDefined()

    await ui.input({ key: 'search', text: '', kind: 'change' })
    await ui.press({ key: 'task-STORE-1' })
    expect(await ui.find({ type: 'Text', text: /Firma pendiente|Firmar/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3 pasos/ })).toBeDefined()

    // Attachments: listed with their note, and a press opens the preview of the copy.
    expect(await ui.find({ type: 'Text', text: /Criterios/ })).toBeDefined()
    await ui.press({ key: 'att-1' })
    expect(await ui.find({ key: 'att-md-1' })).toBeDefined()
    await ui.press({ key: 'att-close' })
    expect(await ui.find({ key: 'att-md-1' })).toBeUndefined()

    // Subtasks: nested under STORE-1, each one opening its own detail with the path back up.
    expect(await ui.find({ key: 'sub-STORE-1.1' })).toBeDefined()
    expect(await ui.find({ key: 'sub-STORE-1.1.1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0\/2 cerradas/ })).toBeDefined()
    await ui.press({ key: 'sub-STORE-1.1.1' })
    expect(await ui.find({ key: 'parent-STORE-1' })).toBeDefined()
    expect(await ui.find({ key: 'parent-STORE-1.1' })).toBeDefined()
    await ui.press({ key: 'parent-STORE-1.1' })
    expect(await ui.find({ type: 'Text', text: /Validar firma/ })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'search' })).toBeDefined()
    // In the list, subtasks live inside their parent's card unless the parent is filtered out.
    expect(await ui.find({ key: 'task-STORE-1.1' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /2 subtareas/ })).toBeDefined()
    await ui.input({ key: 'search', text: 'claves', kind: 'change' })
    expect(await ui.find({ key: 'task-STORE-1.1.1' })).toBeDefined()
    await ui.input({ key: 'search', text: '', kind: 'change' })
    await ui.press({ key: 'filter-open' })
    await ui.unmount()
  }
})

test('/task-pilot:tasks opens the panel on the given task', async ($, on) => {
  mock.env(on, { HOME: '/h' })
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  const { text } = await $.command.run({ command: 'task-pilot:tasks', args: 'STORE-1' })
  expect(text).toBeUndefined()
  expect(opened).toEqual(['task-pilot'])
})
