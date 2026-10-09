---
description: Time report for a period (week, month, dates) with estimate accuracy
argument-hint: "[today|yesterday|week|last_week|month|last_month|YYYY-MM-DD YYYY-MM-DD] [csv]"
---

Build a time report with the `report` tool. Arguments: $ARGUMENTS
- A period keyword goes in `period`; one or two dates go in `from` / `to`; default `week`.
- "csv" in the arguments means `format: "csv"`: save the result to a file the user names (or `task-pilot-<from>-<to>.csv` in the current folder) and tell them where it is.

Present the markdown report in the user's language, keeping the tables, and end with 2–3 short observations (where the time went, the type of work that takes longest, how accurate the estimates were).
