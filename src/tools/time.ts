import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildReport, PERIODS, resolveRange } from "../report/report.js";
import { requireTask } from "../store/tasks.js";
import { appendEntry } from "../store/time.js";
import { UNASSIGNED } from "../time/aggregate.js";
import { formatMinutes, localDate, parseLocalDate } from "../time/dates.js";
import { summarizeRange } from "../time/queries.js";
import { absolutePath, currentProject, guard } from "./common.js";

const dateSchema = z
  .string()
  .refine((d) => {
    try {
      parseLocalDate(d);
      return true;
    } catch {
      return false;
    }
  }, "expected YYYY-MM-DD")
  .describe("Day as YYYY-MM-DD.");

export function registerTimeTools(server: McpServer): void {
  server.registerTool(
    "time_adjust",
    {
      title: "Correct tracked time",
      description:
        "Manually corrects the time of a task on a day: add or subtract minutes, or set the exact total. " +
        "Use it when the user says the tracked time is wrong or reports work done outside Claude Code (meetings, calls...). " +
        "Never invent amounts: only use what the user states.",
      inputSchema: {
        taskId: z
          .string()
          .optional()
          .describe("Task to correct. Omit to correct the time without a task."),
        minutes: z
          .number()
          .int()
          .min(-1440)
          .max(1440)
          .describe("Minutes to add (negative to subtract), or the total with mode set."),
        mode: z
          .enum(["add", "set"])
          .optional()
          .describe('"add" (default) or "set" the total of that day.'),
        date: dateSchema.optional().describe("Day to correct (default today)."),
        note: z.string().optional(),
      },
    },
    guard(({ taskId, minutes, mode = "add", date, note }) => {
      const id = taskId ? requireTask(taskId).id : null;
      if (mode === "set" && minutes < 0)
        throw new Error("With mode set, minutes must be 0 or more.");
      const day = date ?? localDate(new Date());
      appendEntry({
        kind: "adjust",
        ts: new Date().toISOString(),
        date: day,
        taskId: id,
        minutes,
        mode,
        note,
      });
      const total = summarizeRange(day, day).byTask.get(id ?? UNASSIGNED) ?? 0;
      return `${id ?? "Time without a task"} on ${day}: ${formatMinutes(total)} now.`;
    }),
  );

  server.registerTool(
    "report",
    {
      title: "Time report",
      description:
        "Report of the time worked in a period: per task (with all-time total, estimate and progress), per type, " +
        "per project and per day, plus how accurate the estimates were per type. " +
        "Use it for daily/weekly summaries and to ground new estimates on past tasks.",
      inputSchema: {
        period: z
          .enum(PERIODS)
          .optional()
          .describe('Default "today". Ignored when `from` is given.'),
        from: dateSchema.optional(),
        to: dateSchema.optional().describe("Last day included (default: today, or `from`'s day)."),
        project: z
          .union([z.literal("this_repo"), absolutePath])
          .optional()
          .describe('"this_repo" or a project folder to only count its tasks.'),
        format: z
          .enum(["md", "csv"])
          .optional()
          .describe('"md" (default) or "csv" with one row per day and task.'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(({ period, from, to, project, format }) => {
      const range = resolveRange(period, from, to ?? from);
      return buildReport({
        range,
        project: project === "this_repo" ? currentProject() : project,
        format,
      });
    }),
  );
}
