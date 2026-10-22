export type Filter = 'open' | 'all' | 'closed'

export type View = {
  query: string
  filter: Filter
  selected: string | null
  /** Attachment of the selected task whose preview is open. */
  attachment: number | null
  page: number
}

declare module 'claude-code' {
  interface PluginState {
    'task-pilot': { view: View; tick: number }
  }
}
