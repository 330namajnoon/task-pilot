---
name: task-pilot
description: Work on tasks that persist across Claude Code sessions with the task-pilot tools — create a task with type, plan and estimate, resume it where it was left off, keep its plan, log and checkpoint up to date, and report the time spent. Use it whenever the user starts a substantial piece of work, mentions a ticket or a task they were doing before ("sigamos con...", "continue the login task", "where was I?"), asks what they did today or this week, how long something took, or wants to estimate a task — even if they don't name task-pilot.
---

# task-pilot

task-pilot keeps each task outside the conversation, in `~/.claude-tasks/`, so any future session can continue it with the same thread. Time is tracked automatically on the task that is active in the session; you never have to start or stop timers by hand.

## The loop

1. **Start** — new work → `task_create` (title, type, steps with estimates, total estimate, `externalRef` if there is a ticket). Previous work → `task_resume` and read the result before touching anything: the checkpoint says where it was left off and what comes next.
2. **Work** — when you start a step, mark it `doing` with `task_plan`; when it is finished, `done`. Add steps you discover; mark the ones that no longer apply `skipped` instead of deleting them. Record decisions (with the reason), blockers and notable findings with `task_log`.
3. **Checkpoint** — call `task_checkpoint` after finishing each step, after an important decision, when the user is about to leave, and whenever a hook reminds you. Write it for a reader with zero context: done, half done (and in which state), next concrete steps, decisions, key files, open questions. A good checkpoint is the whole point of the plugin.
4. **Finish** — final `task_checkpoint` with the outcome, then `task_stop` with the final status (`done`, `review`, `blocked`...).

Only one task is active per session. To switch, `task_checkpoint` the current one and then `task_resume`/`task_start` the other one.

## Estimating

- Break the work into steps of at most a few hours and estimate each step in minutes; the task estimate defaults to their sum.
- Before giving an estimate, call `report` with a wide period and look at "Estimation accuracy": if this type of task usually takes 1.4× the estimate, say so and correct it.
- If a task goes well over its estimate, tell the user and re-estimate with `task_update` (the change is logged).

## Time

- It is computed from activity: the time Claude works on a turn always counts; the time between turns counts only if it is shorter than the idle timeout (15 min by default).
- Activity in a session without an active task shows as "(no task)" in the reports.
- Use `time_adjust` only with amounts the user gives you (meetings, calls, corrections). Never invent or "round up" time.

## Answering questions

- "What did I do today / this week?" → `report` with `period` `today` / `week`.
- "What was I working on?", "what's pending?" → `task_list` (add `scope: "this_repo"` for the current project).
- "How long did X take?" → `task_list` with `query`, or `report` for the period.

## Data

Everything is plain files the user can read or edit: `tasks/<ID>/task.json` (metadata and steps), `context.md` (last checkpoint), `log.md` (history), `time/YYYY-MM-DD.jsonl` (activity and adjustments), `config.json` (task types, idle timeout, reminder interval, workday hours). Set `TASK_PILOT_HOME` to keep them somewhere else.
