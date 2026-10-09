---
description: Pick up a saved task where it was left off
argument-hint: "[task id]"
---

Resume the task `$ARGUMENTS` with `task_resume` (without an id if none was given: it picks the in-progress task of this repo or lists the candidates — if it lists several, ask the user which one).

Then, in the user's language and briefly:
- say where the task stands (progress, time vs estimate, the last checkpoint),
- point out anything that changed since then if it matters (e.g. check `git status` / the current branch against the task's branch),
- propose the next step from the checkpoint and continue with it once the user agrees.
