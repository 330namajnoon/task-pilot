export type Filter = 'open' | 'all' | 'closed'

export type View = {
  query: string
  filter: Filter
  selected: string | null
  page: number
}

declare module 'claude-code' {
  interface PluginState {
    'task-pilot': { view: View; tick: number }
  }
}
