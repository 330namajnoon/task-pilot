export type Step = { id: number; text: string; status: string; estimateMin?: number }

export type Task = {
  id: string
  title: string
  type: string
  status: string
  description?: string
  estimateMin?: number
  externalRef?: string
  project?: string
  branch?: string
  parentId?: string
  tags: string[]
  steps: Step[]
  createdAt: string
  updatedAt: string
  closedAt?: string
  lastCheckpointAt?: string
}

export type LogEntry = { when: string; kind: string; text: string }

export const CLOSED = ['done', 'cancelled']

const IN_TURN_EVENTS = new Set(['UserPromptSubmit', 'bind', 'unbind'])

type Heartbeat = { kind: 'hb'; ts: string; sessionId: string; taskId: string | null; event: string }
type Adjustment = { kind: 'adjust'; date: string; taskId: string | null; minutes: number; mode: 'add' | 'set' }

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function parseTasks(texts: string[]): Task[] {
  return texts
    .map(text => parseJson<Task>(text))
    .filter((task): task is Task => task !== undefined && typeof task.id === 'string')
    .map(task => ({ ...task, tags: task.tags ?? [], steps: task.steps ?? [] }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

const localDay = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Minutes per task, following task-pilot's own rules (idle gaps, turns, manual adjustments). */
export function minutesByTask(configText: string, texts: string[]): Map<string, number> {
  const config = parseJson<{ idleTimeoutMin?: number; maxTurnMin?: number }>(configText) ?? {}
  const idle = config.idleTimeoutMin ?? 15
  const maxTurn = config.maxTurnMin ?? 240

  const beats = new Map<string, Heartbeat[]>()
  const adjustments: Adjustment[] = []
  for (const text of texts) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let entry: Heartbeat | Adjustment
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (entry.kind === 'adjust') adjustments.push(entry)
      else if (entry.kind === 'hb') beats.set(entry.sessionId, [...(beats.get(entry.sessionId) ?? []), entry])
    }
  }

  // day -> task -> minutes
  const byDay = new Map<string, Map<string, number>>()
  const add = (day: string, task: string, minutes: number) => {
    const tasks = byDay.get(day) ?? new Map<string, number>()
    tasks.set(task, (tasks.get(task) ?? 0) + minutes)
    byDay.set(day, tasks)
  }
  for (const list of beats.values()) {
    list.sort((a, b) => a.ts.localeCompare(b.ts))
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!
      const b = list[i + 1]!
      const start = Date.parse(a.ts)
      const gap = (Date.parse(b.ts) - start) / 60_000
      const limit = IN_TURN_EVENTS.has(a.event) ? maxTurn : idle
      if (gap <= 0 || gap > limit) continue
      add(localDay(start), a.taskId ?? b.taskId ?? '', gap)
    }
  }
  for (const adj of adjustments) {
    const tasks = byDay.get(adj.date) ?? new Map<string, number>()
    const key = adj.taskId ?? ''
    const before = tasks.get(key) ?? 0
    tasks.set(key, Math.max(0, adj.mode === 'set' ? adj.minutes : before + adj.minutes))
    byDay.set(adj.date, tasks)
  }

  const total = new Map<string, number>()
  for (const tasks of byDay.values()) {
    for (const [task, minutes] of tasks) total.set(task, (total.get(task) ?? 0) + minutes)
  }

  return total
}

export function parseLog(text: string): LogEntry[] {
  return text
    .split(/^## /m)
    .filter(part => part.trim())
    .map(part => {
      const [head = '', ...body] = part.split('\n')
      const [when = '', kind = ''] = head.split(' · ')

      return { when: when.trim(), kind: kind.trim(), text: body.join('\n').trim() }
    })
}

/** Direct subtasks of `id`, oldest first. */
export function childrenOf(tasks: Task[], id: string): Task[] {
  return tasks.filter(t => t.parentId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Every subtask below `id`, at any depth. */
export function descendantsOf(tasks: Task[], id: string, seen = new Set<string>()): Task[] {
  seen.add(id)

  return childrenOf(tasks, id)
    .filter(c => !seen.has(c.id))
    .flatMap(c => [c, ...descendantsOf(tasks, c.id, seen)])
}

/** Parent, grandparent... up to the top task, top first. */
export function ancestorsOf(tasks: Task[], task: Task): Task[] {
  const chain: Task[] = []
  let parentId = task.parentId
  while (parentId && !chain.some(t => t.id === parentId)) {
    const parent = tasks.find(t => t.id === parentId)
    if (!parent) break
    chain.unshift(parent)
    parentId = parent.parentId
  }

  return chain
}

export function estimateOf(task: Task): number | undefined {
  if (task.estimateMin) return task.estimateMin
  const sum = task.steps.reduce((n, s) => n + (s.estimateMin ?? 0), 0)

  return sum > 0 ? sum : undefined
}

export function formatMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return '—'
  const m = Math.round(minutes)
  if (m < 60) return `${m}m`

  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function matches(task: Task, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    task.id,
    task.title,
    task.type,
    task.status,
    task.description,
    task.externalRef,
    task.project,
    task.branch,
    ...task.tags,
    ...task.steps.map(s => s.text),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return q.split(/\s+/).every(word => haystack.includes(word))
}

export function bar(done: number, total: number, width = 12): string {
  if (total === 0) return ''
  const full = Math.min(width, Math.round((done / total) * width))

  return `${'█'.repeat(full)}${'░'.repeat(width - full)}`
}

/** "hace 5 min", "hace 3 h", "ayer", "hace 4 días"... or the date when it is older than a month. */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const min = Math.max(0, Math.round((now - ms) / 60_000))
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} días`

  return iso.slice(0, 10)
}
