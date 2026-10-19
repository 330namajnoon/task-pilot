import { atom, read, update } from 'claude-code'
import type { Color, Register } from 'claude-code'

import type { Filter, View } from '../../types'
import {
  ancestorsOf,
  bar,
  childrenOf,
  CLOSED,
  descendantsOf,
  estimateOf,
  formatMinutes,
  matches,
  minutesByTask,
  parseLog,
  parseTasks,
  timeAgo,
} from './data'
import type { Task } from './data'

const PANE = 'task-pilot'
const TITLE = 'Tareas'
// The plugin's markdown command (commands/tasks.md): the panel answers it so it opens without a turn.
const COMMAND = 'task-pilot:tasks'

const view = atom({ plugin: 'task-pilot', key: 'view' } as const, {
  query: '',
  filter: 'open',
  selected: null,
  page: 0,
} as View)
const tick = atom({ plugin: 'task-pilot', key: 'tick' } as const, 0)

type StatusInfo = { icon: string; label: string; plural: string; color: Color }

// Ordered as the list groups them: what needs attention first.
const STATUS: Record<string, StatusInfo> = {
  in_progress: { icon: '▶', label: 'En curso', plural: 'En curso', color: 'suggestion' },
  blocked: { icon: '■', label: 'Bloqueada', plural: 'Bloqueadas', color: 'error' },
  review: { icon: '◐', label: 'En revisión', plural: 'En revisión', color: 'warning' },
  planned: { icon: '○', label: 'Planificada', plural: 'Planificadas', color: 'text' },
  backlog: { icon: '·', label: 'Pendiente', plural: 'Pendientes', color: 'subtle' },
  done: { icon: '✔', label: 'Hecha', plural: 'Hechas', color: 'success' },
  cancelled: { icon: '✕', label: 'Cancelada', plural: 'Canceladas', color: 'inactive' },
}
const STATUS_ORDER = Object.keys(STATUS)
const statusOf = (status: string): StatusInfo =>
  STATUS[status] ?? { icon: '○', label: status, plural: status, color: 'text' }

const STEP: Record<string, { icon: string; color: Color }> = {
  done: { icon: '✔', color: 'success' },
  doing: { icon: '▶', color: 'suggestion' },
  todo: { icon: '○', color: 'subtle' },
  skipped: { icon: '⤼', color: 'inactive' },
}

const LOG_KIND: Record<string, { icon: string; label: string; color: Color }> = {
  progress: { icon: '✔', label: 'Avance', color: 'success' },
  decision: { icon: '◆', label: 'Decisión', color: 'claude' },
  blocker: { icon: '⚠', label: 'Bloqueo', color: 'error' },
  note: { icon: '✎', label: 'Nota', color: 'text' },
  checkpoint: { icon: '⚑', label: 'Checkpoint', color: 'suggestion' },
  status: { icon: '↻', label: 'Estado', color: 'warning' },
}

const isOpen = (task: Task) => !CLOSED.includes(task.status)
const isStepDone = (status: string) => status === 'done' || status === 'skipped'

const byFilter = (filter: Filter) => (task: Task) =>
  filter === 'all' ? true : filter === 'open' ? isOpen(task) : !isOpen(task)

const rank = (task: Task) => {
  const i = STATUS_ORDER.indexOf(task.status)

  return i === -1 ? STATUS_ORDER.length : i
}

/** Green while within the estimate, amber past 80 %, red once it is exceeded. */
const timeColor = (spent: number, estimate?: number): Color =>
  !estimate ? 'text' : spent > estimate ? 'error' : spent > estimate * 0.8 ? 'warning' : 'success'

const basename = (path?: string) => path?.split('/').filter(Boolean).pop()

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const register: Register = on => {
  on('command.run', { command: COMMAND }, async ($, e) => {
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
    // Mobile has no text field: the search is then the /task-pilot:tasks argument.
    const Input = 'Input' in elements ? elements.Input : undefined
    const showHotkeys = e.surface === 'terminal'
    const v = await read($, view)
    await read($, tick)
    const root =
      (await $.env.get('TASK_PILOT_HOME')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude-tasks`
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const rows = e.viewport?.rows ?? 30
    const narrow = columns < 70

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

    const hint = (text: string) => showHotkeys && <Text dimColor>{text}</Text>

    if (tasks.length === 0) {
      return (
        <Box flexDirection="column" alignItems="center" paddingY={2} gap={1}>
          <Text size="heading" bold>
            Todavía no hay tareas
          </Text>
          <Text dimColor>Crea la primera con /task-pilot:new y aparecerá aquí,</Text>
          <Text dimColor>con su progreso, el tiempo dedicado y dónde lo dejaste.</Text>
        </Box>
      )
    }

    const selected = v.selected ? tasks.find(t => t.id.toLowerCase() === v.selected?.toLowerCase()) : undefined

    // Every subtask below `id`, depth first, with how deep it sits.
    const subtaskTree = (id: string, depth: number): { task: Task; depth: number }[] =>
      childrenOf(tasks, id).flatMap(task => [{ task, depth }, ...subtaskTree(task.id, depth + 1)])

    if (selected) {
      const [contextText, logText] = await Promise.all([
        readOr(`${root}/tasks/${selected.id}/context.md`),
        readOr(`${root}/tasks/${selected.id}/log.md`),
      ])
      const context = contextText.trim()
      const log = parseLog(logText)
      const spent = minutes.get(selected.id) ?? 0
      const parents = ancestorsOf(tasks, selected)
      const below = descendantsOf(tasks, selected.id)
      const belowOpen = below.filter(isOpen).length
      const spentWithSubtasks = below.reduce((n, t) => n + (minutes.get(t.id) ?? 0), spent)
      const estimate = estimateOf(selected)
      const done = selected.steps.filter(s => isStepDone(s.status)).length
      const total = selected.steps.length
      const status = statusOf(selected.status)
      const tColor = timeColor(spent, estimate)
      const pct = estimate ? Math.round((spent / estimate) * 100) : undefined
      const meta = [
        selected.type,
        basename(selected.project),
        selected.branch && `⎇ ${selected.branch}`,
        selected.externalRef && selected.externalRef !== selected.id && selected.externalRef,
        ...selected.tags.map(t => `#${t}`),
      ].filter(Boolean)
      const statWidth = narrow ? undefined : '50%'

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="back" hotkey="b" onPress={() => update($, view, x => ({ ...x, selected: null }))}>
              ← Volver a la lista
            </Button>
            <Button
              key="copy"
              variant="primary"
              onPress={press => $.ui.copy({ text: `/task-pilot:resume ${selected.id}`, surface: press.surface })}
            >
              Copiar comando para retomar
            </Button>
            <Button key="refresh" hotkey="r" dimColor onPress={() => update($, tick, n => n + 1)}>
              ↻ Refrescar
            </Button>
          </Box>

          {parents.length > 0 && (
            <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
              <Text dimColor>Subtarea de</Text>
              {parents.map((p, i) => (
                <Box flexDirection="row" gap={1}>
                  {i > 0 && <Text dimColor>›</Text>}
                  <Button key={`parent-${p.id}`} plain onPress={() => update($, view, x => ({ ...x, selected: p.id }))}>
                    <Text color={statusOf(p.status).color}>{p.id}</Text> <Text dimColor>{p.title}</Text>
                  </Button>
                </Box>
              ))}
            </Box>
          )}

          <Box flexDirection="column" borderStyle="round" borderColor={status.color} paddingX={1}>
            <Text>
              <Text color={status.color} bold>
                {status.icon} {status.label}
              </Text>
              <Text dimColor> · {selected.id}</Text>
            </Text>
            <Text size="title" bold>
              {selected.title}
            </Text>
            {meta.length > 0 && <Text dimColor>{meta.join('  ·  ')}</Text>}
            {selected.description && <Text>{selected.description}</Text>}
          </Box>

          <Box flexDirection={narrow ? 'column' : 'row'} gap={1}>
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={statWidth} flexGrow={1}>
              <Text dimColor>Progreso</Text>
              {total > 0 ? (
                <Box flexDirection="column">
                  <Text size="heading" bold>
                    {Math.round((done / total) * 100)} %
                  </Text>
                  <Text>
                    <Text color="success">{bar(done, total, 16)}</Text> {done}/{total} pasos
                  </Text>
                </Box>
              ) : (
                <Text dimColor>Sin plan de pasos</Text>
              )}
            </Box>
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={statWidth} flexGrow={1}>
              <Text dimColor>Tiempo dedicado</Text>
              <Text size="heading" bold color={tColor}>
                {formatMinutes(spent)}
              </Text>
              {estimate ? (
                <Text>
                  <Text color={tColor}>{bar(spent, estimate, 16)}</Text>
                  <Text dimColor>
                    {' '}
                    {pct} % de {formatMinutes(estimate)}
                    {spent > estimate ? ` · ${formatMinutes(spent - estimate)} de más` : ''}
                  </Text>
                </Text>
              ) : (
                <Text dimColor>Sin estimación</Text>
              )}
              {below.length > 0 && <Text dimColor>{formatMinutes(spentWithSubtasks)} con subtareas</Text>}
            </Box>
          </Box>

          {total > 0 && (
            <Box flexDirection="column">
              <Text bold>Pasos</Text>
              {selected.steps.map(step => {
                const mark = STEP[step.status] ?? STEP.todo!
                const current = step.status === 'doing'

                return (
                  <Text dimColor={isStepDone(step.status)}>
                    {' '}
                    <Text color={mark.color}>{mark.icon}</Text> <Text bold={current}>{step.text}</Text>
                    {step.estimateMin ? <Text dimColor> · {formatMinutes(step.estimateMin)}</Text> : ''}
                    {current ? <Text color="suggestion"> ← ahora</Text> : ''}
                  </Text>
                )
              })}
            </Box>
          )}

          {below.length > 0 && (
            <Box flexDirection="column">
              <Text bold>
                Subtareas{' '}
                <Text dimColor>
                  {below.length - belowOpen}/{below.length} cerradas
                </Text>
              </Text>
              {subtaskTree(selected.id, 0).map(({ task: child, depth }) => {
                const st = statusOf(child.status)
                const steps = child.steps.filter(s => isStepDone(s.status)).length

                return (
                  <Button key={`sub-${child.id}`} plain onPress={() => update($, view, x => ({ ...x, selected: child.id }))}>
                    {'  '.repeat(depth + 1)}
                    <Text color={st.color}>{st.icon}</Text> <Text color={st.color}>{child.id}</Text>{' '}
                    <Text dimColor={!isOpen(child)}>{child.title}</Text>
                    <Text dimColor>
                      {' · '}
                      {st.label}
                      {child.steps.length > 0 ? ` · ${steps}/${child.steps.length} pasos` : ''} · ⏱{' '}
                      {formatMinutes(minutes.get(child.id) ?? 0)} ›
                    </Text>
                  </Button>
                )
              })}
            </Box>
          )}

          {context && (
            <Box flexDirection="column">
              <Text bold>Dónde lo dejaste</Text>
              <Box borderStyle="round" borderColor="claude" paddingX={1}>
                <Markdown key="context" text={context} />
              </Box>
            </Box>
          )}

          {log.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Últimos movimientos</Text>
              {log
                .slice(-6)
                .reverse()
                .map(entry => {
                  const kind = LOG_KIND[entry.kind] ?? { icon: '•', label: entry.kind, color: 'text' as Color }

                  return (
                    <Text wrap="truncate-end">
                      {' '}
                      <Text color={kind.color}>{kind.icon}</Text> <Text dimColor>{entry.when}</Text>{' '}
                      <Text color={kind.color}>{kind.label}</Text> {entry.text.split('\n')[0]}
                    </Text>
                  )
                })}
            </Box>
          )}

          <Text dimColor>
            Creada {timeAgo(selected.createdAt)} · actualizada {timeAgo(selected.updatedAt)}
            {selected.closedAt ? ` · cerrada ${timeAgo(selected.closedAt)}` : ''}
          </Text>
          {hint('b volver · r refrescar')}
        </Box>
      )
    }

    const inView = tasks.filter(byFilter(v.filter)).filter(t => matches(t, v.query))
    const inViewIds = new Set(inView.map(t => t.id))
    // Subtasks show inside their parent's card, unless the parent is not in this view.
    const filtered = inView
      .filter(t => !t.parentId || !inViewIds.has(t.parentId))
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt))
    // Each card takes 4 rows; the header, search, filters and footer about 10.
    const perPage = Math.max(2, Math.floor((rows - 10) / 4))
    const pages = Math.max(1, Math.ceil(filtered.length / perPage))
    const page = Math.min(v.page, pages - 1)
    const shown = filtered.slice(page * perPage, (page + 1) * perPage)
    const openTasks = tasks.filter(isOpen)
    const countOf = (status: string) => openTasks.filter(t => t.status === status).length
    const totalOpenMinutes = openTasks.reduce((n, t) => n + (minutes.get(t.id) ?? 0), 0)

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

    const summary = [
      countOf('in_progress') > 0 && { text: `▶ ${countOf('in_progress')} en curso`, color: 'suggestion' as Color },
      countOf('blocked') > 0 && {
        text: `■ ${plural(countOf('blocked'), 'bloqueada', 'bloqueadas')}`,
        color: 'error' as Color,
      },
      countOf('review') > 0 && { text: `◐ ${countOf('review')} en revisión`, color: 'warning' as Color },
    ].filter(x => x !== false)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            <Text bold>{plural(openTasks.length, 'tarea abierta', 'tareas abiertas')}</Text>
            {summary.map(s => (
              <Text>
                <Text dimColor> · </Text>
                <Text color={s.color}>{s.text}</Text>
              </Text>
            ))}
          </Text>
          <Text dimColor>⏱ {formatMinutes(totalOpenMinutes)} dedicadas a las tareas abiertas</Text>
        </Box>

        <Box flexDirection="column">
          {Input && (
            <Input
              key="search"
              label="Buscar "
              placeholder="Buscar por ID, título, rama, proyecto o paso…"
              value={v.query}
              submitLabel="buscar"
              autoFocus
              onInput={(query: string) => update($, view, x => ({ ...x, query, page: 0 }))}
              onSubmit={(query: string) => update($, view, x => ({ ...x, query, page: 0 }))}
            />
          )}
          {!Input && v.query && <Text dimColor>Búsqueda: {v.query}</Text>}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {filterButton('open', `Abiertas ${openTasks.length}`, 'a')}
            {filterButton('closed', `Cerradas ${tasks.length - openTasks.length}`, 'c')}
            {filterButton('all', `Todas ${tasks.length}`, 't')}
            <Button key="refresh" hotkey="r" dimColor onPress={() => update($, tick, n => n + 1)}>
              ↻
            </Button>
          </Box>
        </Box>

        {shown.length === 0 && (
          <Box flexDirection="column" alignItems="center" paddingY={1}>
            <Text dimColor>
              {v.query ? `Nada coincide con «${v.query}».` : 'No hay tareas en esta vista.'}
            </Text>
            {v.filter !== 'all' && <Text dimColor>Prueba con «Todas».</Text>}
          </Box>
        )}

        <Box flexDirection="column">
          {shown.map((task, i) => {
            const status = statusOf(task.status)
            const done = task.steps.filter(s => isStepDone(s.status)).length
            const spent = minutes.get(task.id) ?? 0
            const estimate = estimateOf(task)
            const current = task.steps.find(s => s.status === 'doing') ?? task.steps.find(s => s.status === 'todo')
            const newGroup = i === 0 || shown[i - 1]!.status !== task.status
            const groupSize = filtered.filter(t => t.status === task.status).length
            const subtasks = descendantsOf(tasks, task.id)
            const subtaskSummary = STATUS_ORDER.map(s => ({ s, n: subtasks.filter(t => t.status === s).length }))
              .filter(x => x.n > 0)
              .map(x => `${x.n} ${statusOf(x.s).label.toLowerCase()}`)
              .join(' · ')

            return (
              <Box flexDirection="column">
                {newGroup && (
                  <Text color={status.color} bold>
                    {status.icon} {status.plural} <Text dimColor>({groupSize})</Text>
                  </Text>
                )}
                <Box
                  key={`card-${task.id}`}
                  flexDirection="column"
                  borderStyle="round"
                  borderDimColor
                  hover={{ borderColor: status.color, borderDimColor: false }}
                  paddingX={1}
                >
                  <Button
                    key={`task-${task.id}`}
                    plain
                    onPress={() => update($, view, x => ({ ...x, selected: task.id }))}
                  >
                    <Text color={status.color} bold>
                      {task.id}
                    </Text>{' '}
                    <Text bold>{task.title}</Text>
                    {task.parentId ? <Text dimColor> · subtarea de {task.parentId}</Text> : ''}
                    <Text dimColor> · {timeAgo(task.updatedAt)} ›</Text>
                  </Button>
                  <Text wrap="truncate-end">
                    {task.steps.length > 0 ? (
                      <Text>
                        <Text color="success">{bar(done, task.steps.length, 10)}</Text>{' '}
                        <Text dimColor>
                          {done}/{task.steps.length}
                        </Text>
                      </Text>
                    ) : (
                      <Text dimColor>sin pasos</Text>
                    )}
                    <Text dimColor>{'   '}⏱ </Text>
                    <Text color={timeColor(spent, estimate)}>{formatMinutes(spent)}</Text>
                    <Text dimColor> de {formatMinutes(estimate)}</Text>
                    {current && isOpen(task) ? <Text dimColor>{'   '}→ {current.text}</Text> : ''}
                  </Text>
                  {subtasks.length > 0 && (
                    <Text dimColor wrap="truncate-end">
                      ↳ {plural(subtasks.length, 'subtarea', 'subtareas')}: {subtaskSummary}
                    </Text>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>

        {pages > 1 && (
          <Box flexDirection="row" gap={1} alignItems="center">
            <Button key="prev" hotkey="p" onPress={() => update($, view, x => ({ ...x, page: Math.max(0, page - 1) }))}>
              ◀ Anterior
            </Button>
            <Text dimColor>
              {page + 1} de {pages}
            </Text>
            <Button key="next" hotkey="n" onPress={() => update($, view, x => ({ ...x, page: Math.min(pages - 1, page + 1) }))}>
              Siguiente ▶
            </Button>
          </Box>
        )}

        {hint('Pulsa una tarea para ver el detalle · a/c/t filtrar · r refrescar' + (pages > 1 ? ' · p/n página' : ''))}
      </Box>
    )
  })
}
