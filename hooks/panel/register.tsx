import { atom, read, update } from 'claude-code'
import type { Color, Register } from 'claude-code'

import type { Filter, View } from '../../types'
import {
  bar,
  CLOSED,
  estimateOf,
  formatMinutes,
  matches,
  minutesByTask,
  parseLog,
  parseTasks,
} from './data'
import type { Task } from './data'

const PANE = 'task-pilot'
const TITLE = 'Tareas'

const view = atom({ plugin: 'task-pilot', key: 'view' } as const, {
  query: '',
  filter: 'open',
  selected: null,
  page: 0,
} as View)
const tick = atom({ plugin: 'task-pilot', key: 'tick' } as const, 0)

const STATUS_COLOR: Record<string, Color> = {
  in_progress: 'suggestion',
  blocked: 'error',
  review: 'warning',
  done: 'success',
  cancelled: 'inactive',
  planned: 'text',
  backlog: 'subtle',
}

const STATUS_LABEL: Record<string, string> = {
  backlog: 'backlog',
  planned: 'planificada',
  in_progress: 'en curso',
  blocked: 'bloqueada',
  review: 'revisión',
  done: 'hecha',
  cancelled: 'cancelada',
}

const STEP_MARK: Record<string, string> = { done: '✔', doing: '▶', todo: '○', skipped: '⤼' }

const isOpen = (task: Task) => !CLOSED.includes(task.status)

const byFilter = (filter: Filter) => (task: Task) =>
  filter === 'all' ? true : filter === 'open' ? isOpen(task) : !isOpen(task)

const pad = (text: string, width: number) =>
  text.length >= width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width)

const basename = (path?: string) => path?.split('/').filter(Boolean).pop()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tareas',
      description: 'Abre el panel de tareas de task-pilot (opcional: texto a buscar o ID)',
      argumentHint: '[búsqueda | ID]',
    })

    return next(e)
  })

  on('command.run', { command: 'tareas' }, async ($, e) => {
    const arg = e.args.trim()
    // An argument that is a task ID opens its detail; anything else is a search (see the render hook).
    if (arg) await update($, view, v => ({ ...v, query: arg, filter: 'all' as const, selected: arg, page: 0 }))
    await update($, tick, n => n + 1)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return {}
  })

  // Claude may have changed a task during the turn (task_plan, task_checkpoint...): redraw with fresh data.
  on('turn.complete', async ($, e, next) => {
    await update($, tick, n => n + 1)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    // Mobile has no text field: the search is then the /tareas argument.
    const Input = 'Input' in elements ? elements.Input : undefined
    const v = await read($, view)
    await read($, tick)
    const root =
      (await $.env.get('TASK_PILOT_HOME')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude-tasks`
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const rows = e.viewport?.rows ?? 30

    const readOr = (path: string) => $.fs.read(path).catch(() => '')
    const taskDirs = (await $.fs.list(`${root}/tasks`).catch(() => [])).filter(d => d.kind === 'dir')
    const timeFiles = (await $.fs.list(`${root}/time`).catch(() => [])).filter(f => f.name.endsWith('.jsonl'))
    const [taskTexts, timeTexts, configText] = await Promise.all([
      Promise.all(taskDirs.map(d => readOr(`${root}/tasks/${d.name}/task.json`))),
      Promise.all(timeFiles.map(f => readOr(`${root}/time/${f.name}`))),
      readOr(`${root}/config.json`),
    ])
    const tasks = parseTasks(taskTexts)
    const minutes = minutesByTask(configText, timeTexts)

    if (tasks.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No hay tareas en {root}.</Text>
          <Text dimColor>Crea una con /task-pilot:new.</Text>
        </Box>
      )
    }

    const selected = v.selected ? tasks.find(t => t.id.toLowerCase() === v.selected?.toLowerCase()) : undefined

    if (selected) {
      const [contextText, logText] = await Promise.all([
        readOr(`${root}/tasks/${selected.id}/context.md`),
        readOr(`${root}/tasks/${selected.id}/log.md`),
      ])
      const context = contextText.trim()
      const log = parseLog(logText)
      const spent = minutes.get(selected.id) ?? 0
      const estimate = estimateOf(selected)
      const done = selected.steps.filter(s => s.status === 'done' || s.status === 'skipped').length
      const total = selected.steps.length
      const isOver = estimate !== undefined && spent > estimate
      const meta = [
        selected.type,
        basename(selected.project),
        selected.branch && `rama ${selected.branch}`,
        selected.externalRef && selected.externalRef !== selected.id && selected.externalRef,
        ...selected.tags.map(t => `#${t}`),
      ].filter(Boolean)

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="back" hotkey="b" onPress={() => update($, view, x => ({ ...x, selected: null }))}>
              ← Volver
            </Button>
            <Button key="refresh" hotkey="r" onPress={() => update($, tick, n => n + 1)}>
              Refrescar
            </Button>
            <Button
              key="copy"
              onPress={press => $.ui.copy({ text: `/task-pilot:resume ${selected.id}`, surface: press.surface })}
            >
              Copiar /resume
            </Button>
          </Box>

          <Box flexDirection="column">
            <Text bold>
              {selected.id} · {selected.title}
            </Text>
            <Text>
              <Text color={STATUS_COLOR[selected.status] ?? 'text'} bold>
                {STATUS_LABEL[selected.status] ?? selected.status}
              </Text>
              <Text dimColor> · {meta.join(' · ')}</Text>
            </Text>
            {selected.description && <Text dimColor>{selected.description}</Text>}
          </Box>

          <Box flexDirection="column">
            {total > 0 && (
              <Text>
                Progreso <Text color="success">{bar(done, total, 20)}</Text> {done}/{total} pasos
              </Text>
            )}
            <Text>
              Tiempo{'   '}
              <Text color={isOver ? 'error' : 'text'} bold>
                {formatMinutes(spent)}
              </Text>
              <Text dimColor>
                {' '}
                de {formatMinutes(estimate)}
                {estimate ? ` (${Math.round((spent / estimate) * 100)}%)` : ''}
              </Text>
            </Text>
            <Text dimColor>
              Creada {selected.createdAt.slice(0, 10)} · actualizada {selected.updatedAt.slice(0, 16).replace('T', ' ')}
              {selected.closedAt ? ` · cerrada ${selected.closedAt.slice(0, 10)}` : ''}
            </Text>
          </Box>

          {total > 0 && (
            <Box flexDirection="column">
              <Text bold>Pasos</Text>
              {selected.steps.map(step => (
                <Text dimColor={step.status === 'done' || step.status === 'skipped'}>
                  <Text color={step.status === 'doing' ? 'suggestion' : step.status === 'done' ? 'success' : 'text'}>
                    {STEP_MARK[step.status] ?? '○'}
                  </Text>{' '}
                  {step.id}. {step.text}
                  {step.estimateMin ? ` (${formatMinutes(step.estimateMin)})` : ''}
                </Text>
              ))}
            </Box>
          )}

          {context && (
            <Box flexDirection="column">
              <Text bold>Dónde se quedó</Text>
              <Markdown key="context" text={context} />
            </Box>
          )}

          {log.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Historial</Text>
              {log
                .slice(-6)
                .reverse()
                .map(entry => (
                  <Text wrap="truncate-end">
                    <Text dimColor>{entry.when}</Text> <Text color="claude">{entry.kind}</Text>{' '}
                    {entry.text.split('\n')[0]}
                  </Text>
                ))}
            </Box>
          )}
        </Box>
      )
    }

    const filtered = tasks.filter(byFilter(v.filter)).filter(t => matches(t, v.query))
    const perPage = Math.max(3, rows - 8)
    const pages = Math.max(1, Math.ceil(filtered.length / perPage))
    const page = Math.min(v.page, pages - 1)
    const shown = filtered.slice(page * perPage, (page + 1) * perPage)
    const titleWidth = Math.max(10, columns - 12 - 12 - 14 - 16 - 6)
    const openCount = tasks.filter(isOpen).length

    const filterButton = (filter: Filter, label: string, hotkey: string) => (
      <Button
        key={`filter-${filter}`}
        hotkey={hotkey}
        variant={v.filter === filter ? 'primary' : 'secondary'}
        onPress={() => update($, view, x => ({ ...x, filter, page: 0 }))}
      >
        {label}
      </Button>
    )

    return (
      <Box flexDirection="column">
        {Input && (
        <Input
          key="search"
          label="Buscar "
          placeholder="ID, título, rama, proyecto, paso…"
          value={v.query}
          submitLabel="buscar"
          autoFocus
          onInput={(query: string) => update($, view, x => ({ ...x, query, page: 0 }))}
          onSubmit={(query: string) => update($, view, x => ({ ...x, query, page: 0 }))}
        />
        )}
        {!Input && v.query && <Text dimColor>Búsqueda: {v.query}</Text>}
        <Box flexDirection="row" gap={1}>
          {filterButton('open', `Abiertas (${openCount})`, 'a')}
          {filterButton('all', `Todas (${tasks.length})`, 't')}
          {filterButton('closed', `Cerradas (${tasks.length - openCount})`, 'c')}
          <Button key="refresh" hotkey="r" onPress={() => update($, tick, n => n + 1)}>
            Refrescar
          </Button>
        </Box>
        <Text dimColor>
          {pad('ID', 12)} {pad('Estado', 12)} {pad('Progreso', 14)} {pad('Tiempo', 16)} Título
        </Text>
        {shown.length === 0 && <Text dimColor>Ninguna tarea coincide.</Text>}
        {shown.map(task => {
          const done = task.steps.filter(s => s.status === 'done' || s.status === 'skipped').length
          const spent = minutes.get(task.id) ?? 0
          const estimate = estimateOf(task)
          const isOver = estimate !== undefined && spent > estimate

          return (
            <Button key={`task-${task.id}`} plain onPress={() => update($, view, x => ({ ...x, selected: task.id }))}>
              <Text bold>{pad(task.id, 12)}</Text>{' '}
              <Text color={STATUS_COLOR[task.status] ?? 'text'}>{pad(STATUS_LABEL[task.status] ?? task.status, 12)}</Text>{' '}
              <Text color="success">{task.steps.length ? pad(`${bar(done, task.steps.length, 8)} ${done}/${task.steps.length}`, 14) : pad('', 14)}</Text>{' '}
              <Text color={isOver ? 'error' : 'text'}>{pad(`${formatMinutes(spent)}/${formatMinutes(estimate)}`, 16)}</Text>{' '}
              {pad(task.title, titleWidth)}
            </Button>
          )
        })}
        {pages > 1 && (
          <Box flexDirection="row" gap={1}>
            <Button key="prev" hotkey="p" onPress={() => update($, view, x => ({ ...x, page: Math.max(0, page - 1) }))}>
              ◀
            </Button>
            <Text dimColor>
              página {page + 1}/{pages}
            </Text>
            <Button key="next" hotkey="n" onPress={() => update($, view, x => ({ ...x, page: Math.min(pages - 1, page + 1) }))}>
              ▶
            </Button>
          </Box>
        )}
      </Box>
    )
  })
}
