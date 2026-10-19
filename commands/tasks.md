---
description: Open the task panel to browse tasks and subtasks (optional: text to search or a task id)
argument-hint: "[search | id]"
---

The task panel normally answers this command itself and opens without reaching you. If you are reading this, the panel is not available here, so show the tasks instead. Arguments: $ARGUMENTS

- If the argument is a task id, call `task_list` with `query` set to it and `status: "all"` to show the task, and again with `parent` set to it to show its subtask tree.
- Otherwise call `task_list` (with `query` set to the argument when there is one) and show the result in the user's language as a compact list, keeping subtasks indented under their parent: id, title, status, progress, time vs estimate.
