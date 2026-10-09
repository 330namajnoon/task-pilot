---
description: Close the active task and stop tracking its time
argument-hint: "[done|review|blocked|cancelled] [note]"
---

Finish working on the active task of this session. Arguments: $ARGUMENTS (default status: done).

1. Mark the finished steps with `task_plan`, and save a final `task_checkpoint` with the outcome (what was delivered, where, anything left for later).
2. Call `task_stop` with the task id, the status and a short note.
3. Show the user a short closing summary: time tracked vs estimate and steps done. If the real time was far from the estimate, say it in one line so future estimates improve.
