# task-pilot

A [Claude Code](https://claude.com/claude-code) plugin that keeps your tasks **across sessions** and tracks **the time you spend on each one**.

- **Continue where you left off.** Each task stores its estimate, plan of steps, a log of decisions and blockers, and a checkpoint of exactly where the work stands. A new session (or a compacted one) picks it up with the same thread.
- **Automatic time tracking.** Hooks record activity per session; the time is assigned to the task that session is working on. No timers to start or stop. Corrections and work done outside Claude Code (meetings, calls) can be added by hand.
- **Subtasks, at any depth.** Any task can be split into subtasks (and those into more subtasks). Each one has its own status, plan, checkpoint, log and time, and is shown under its parent in lists, in `task_resume` and in the panel.
- **Attachments.** Files that belong to a task or subtask (specs, screenshots, logs, exports) can be attached to it, copied into the task's folder or linked where they are. They are listed in `task_resume` and previewed in the panel.
- **Daily and weekly control.** Reports per task, type, project and day, how much time went to work without a task, and how accurate your estimates are per type of task.

Everything is stored as plain JSON / Markdown in `~/.claude-tasks/`. Nothing leaves your machine.

## Install

Requires Node.js 20 or later.

```text
/plugin marketplace add 330namajnoon/task-pilot
/plugin install task-pilot@task-pilot
```

Restart Claude Code after installing so the hooks and the MCP server load.

## Use

| Command | What it does |
|---|---|
| `/task-pilot:new <description>` | Proposes type, plan and estimate, creates the task and starts tracking it |
| `/task-pilot:resume [id]` | Loads a task (plan, last checkpoint, recent log, time vs estimate) and continues it |
| `/task-pilot:checkpoint` | Saves exactly where the active task stands |
| `/task-pilot:done [status]` | Closes the active task (`done`, `review`, `blocked`...) and stops tracking it |
| `/task-pilot:status` | Open tasks with progress and time vs estimate |
| `/task-pilot:today` | What you worked on today and for how long |
| `/task-pilot:report [period]` | Report for `week`, `last_week`, `month`, a date range…, optionally as CSV |
| `/task-pilot:tasks [search \| id]` | Opens a panel to browse and search tasks and subtasks, with each task's steps, time vs estimate, attachments (with a preview), last checkpoint and log |

You don't need the commands for everything: the plugin includes a skill, so asking things like *"let's continue the login task"*, *"what did I do this week?"* or *"how long would this take?"* works too. When a session starts in a repo that has open tasks, Claude is told about them.

### A typical day

```text
> /task-pilot:new migrate the payments webhook to the new API STORE-6042
  … Claude proposes 5 steps, 6h estimate; you confirm and it starts …

  (next morning, new session)
> /task-pilot:resume STORE-6042
  … "3/5 steps, 4h 10m of 6h. Last checkpoint: retries done, signature check pending…" …

> /task-pilot:today
  … Worked 6h 20m · STORE-6042 4h 05m · STORE-6050 1h 30m · (no task) 45m …
```

## How time is measured

Every prompt you send, every turn Claude finishes and every task switch writes a heartbeat to `~/.claude-tasks/time/<day>.jsonl`. Between two heartbeats of the same session:

- while Claude is working on a turn, the time always counts (up to `maxTurnMin`);
- otherwise (you reading or thinking), it counts only if the gap is shorter than `idleTimeoutMin`.

Parallel sessions are not double-counted in the daily total. Use `time_adjust` (or just tell Claude, e.g. *"add 1h of meeting to STORE-6042 today"*) to correct anything.

## Data

```text
~/.claude-tasks/
  config.json                 task types, idleTimeoutMin, maxTurnMin, checkpointReminderMin, workdayHours
  tasks/<ID>/task.json        title, type, status, estimate, project, branch, ticket, tags, steps, parentId, attachments
  tasks/<ID>/attachments/     copies of the files attached to the task
  tasks/<ID>/context.md       last checkpoint: where the work stands and what's next
  tasks/<ID>/log.md           dated history: progress, decisions, blockers, status changes
  sessions/<session>.json     which task each Claude Code session is working on
  time/YYYY-MM-DD.jsonl       activity heartbeats and manual adjustments
```

Set `TASK_PILOT_HOME` to store the data somewhere else (for example a synced folder).

## MCP tools

`task_create`, `task_list`, `task_resume`, `task_start`, `task_stop`, `task_update`, `task_plan`, `task_log`, `task_checkpoint`, `task_attach`, `time_adjust`, `report`.

## Development

```bash
npm install
npm test            # vitest
npm run typecheck
npm run lint
npm run bundle      # builds bundle/server.js and bundle/hook.js (commit them: users run the bundles)
claude --plugin-dir .   # try the plugin locally
```

## License

MIT
