---
description: Save exactly where the active task stands
argument-hint: "[extra notes]"
---

Save a checkpoint of the task this session is working on (if you don't know which one, call `task_list` with `scope: "this_repo"` and ask). Extra notes from the user: $ARGUMENTS

1. Update the plan with `task_plan` so every step reflects reality (done / doing / todo, new steps discovered).
2. Call `task_checkpoint` written for someone who has none of this conversation: what is done, what is half done and in which state, the next concrete steps in order, decisions taken and why, the key files, blockers and open questions.
3. Confirm to the user in one or two lines.
