---
description: Create a task with type, plan and estimate, and start tracking it
argument-hint: "<what you want to do> [ticket like STORE-123]"
---

The user wants to start this piece of work as a tracked task: $ARGUMENTS

1. If there is no description above, ask what the task is about.
2. Look at the code if needed to understand the scope. Then propose, in the user's language:
   - a short title and a type (feature, bug, refactor, research, review, meeting, support, docs, devops or another one that fits),
   - a plan of 3–8 concrete steps, each with an estimate in minutes,
   - the total estimate. Call `report` with `period: "month"` (or a wider `from`) and use the "Estimation accuracy" table, if there is one, to correct your estimate for this type.
   If a ticket key appears in the request (e.g. STORE-6042), use it as `externalRef`.
3. Wait for the user to confirm or adjust the plan, then call `task_create` with it.
4. Continue with the first step, marking it `doing` with `task_plan`.
