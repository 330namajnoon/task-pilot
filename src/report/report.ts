import { basename } from "node:path";
import { loadConfig } from "../store/config.js";
import { belongsToProject, effectiveEstimate, listTasks, type Task } from "../store/tasks.js";
import { UNASSIGNED } from "../time/aggregate.js";
import { addDays, formatMinutes, localDate, startOfWeek } from "../time/dates.js";
import { summarizeAll, summarizeRange } from "../time/queries.js";
import { renderProgress } from "./views.js";

export const PERIODS = ["today", "yesterday", "week", "last_week", "month", "last_month"] as const;
export type Period = (typeof PERIODS)[number];

export interface Range {
  from: string;
  to: string;
  label: string;
}

export function resolveRange(
  period: Period | undefined,
  from: string | undefined,
  to: string | undefined,
  today = localDate(new Date()),
): Range {
  if (from) return { from, to: to ?? today, label: to && to !== from ? `${from} → ${to}` : from };
  switch (period ?? "today") {
    case "today":
      return { from: today, to: today, label: `today (${today})` };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day, label: `yesterday (${day})` };
    }
    case "week": {
      const start = startOfWeek(today);
      return { from: start, to: today, label: `this week (${start} → ${today})` };
    }
    case "last_week": {
      const start = addDays(startOfWeek(today), -7);
      const end = addDays(start, 6);
      return { from: start, to: end, label: `last week (${start} → ${end})` };
    }
    case "month": {
      const start = `${today.slice(0, 7)}-01`;
      return { from: start, to: today, label: `this month (${start} → ${today})` };
    }
    case "last_month": {
      const end = addDays(`${today.slice(0, 7)}-01`, -1);
      const start = `${end.slice(0, 7)}-01`;
      return { from: start, to: end, label: `last month (${start} → ${end})` };
    }
  }
}

const NO_TASK_LABEL = "(no task)";

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function addTo(map: Map<string, number>, key: string, minutes: number): void {
  map.set(key, (map.get(key) ?? 0) + minutes);
}

/** Real/estimated ratio per type, over the closed tasks that had an estimate. */
function estimationAccuracy(tasks: Task[], totals: Map<string, number>): string[][] {
  const perType = new Map<string, { count: number; ratioSum: number }>();
  for (const task of tasks) {
    const estimate = effectiveEstimate(task);
    const real = totals.get(task.id);
    if (task.status !== "done" || !estimate || !real) continue;
    const entry = perType.get(task.type) ?? { count: 0, ratioSum: 0 };
    entry.count++;
    entry.ratioSum += real / estimate;
    perType.set(task.type, entry);
  }
  return [...perType]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([type, { count, ratioSum }]) => {
      const ratio = ratioSum / count;
      const verdict =
        ratio > 1.1
          ? `takes ${Math.round((ratio - 1) * 100)}% longer than estimated`
          : ratio < 0.9
            ? `takes ${Math.round((1 - ratio) * 100)}% less than estimated`
            : "on target";
      return [type, String(count), `${ratio.toFixed(2)}×`, verdict];
    });
}

export interface ReportOptions {
  range: Range;
  project?: string;
  format?: "md" | "csv";
}

export function buildReport({ range, project, format = "md" }: ReportOptions): string {
  const tasks = listTasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const inProject = (key: string) => {
    if (!project) return true;
    const task = byId.get(key);
    return task !== undefined && belongsToProject(task, project);
  };
  const summary = summarizeRange(range.from, range.to);

  if (format === "csv") {
    const rows = [["date", "task_id", "title", "type", "status", "project", "minutes"]];
    for (const [day, daySummary] of [...summary.byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const [key, minutes] of daySummary.byTask) {
        if (!inProject(key)) continue;
        const task = byId.get(key);
        rows.push([
          day,
          key,
          task?.title ?? (key ? "" : NO_TASK_LABEL),
          task?.type ?? "",
          task?.status ?? "",
          task?.project ?? "",
          String(Math.round(minutes)),
        ]);
      }
    }
    return rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
  }

  const allTime = summarizeAll().byTask;
  const taskRows = [...summary.byTask]
    .filter(([key, minutes]) => minutes >= 0.5 && inProject(key))
    .sort((a, b) => b[1] - a[1]);
  if (!taskRows.length) {
    return `# Time report · ${range.label}\n\nNo activity tracked in this period${project ? ` for ${project}` : ""}.`;
  }

  const byType = new Map<string, number>();
  const byProject = new Map<string, number>();
  for (const [key, minutes] of taskRows) {
    const task = byId.get(key);
    addTo(byType, task?.type ?? NO_TASK_LABEL, minutes);
    addTo(byProject, task?.project ? basename(task.project) : NO_TASK_LABEL, minutes);
  }
  const tracked = taskRows.reduce((sum, [, m]) => sum + m, 0);
  // Without a project filter, the wall-clock total avoids counting parallel sessions twice.
  const worked = project ? tracked : summary.totalMin;
  const days = summary.byDay.size;
  const workday = loadConfig().workdayHours * 60;

  const out: string[] = [`# Time report · ${range.label}`, ""];
  const pctOfWorkday =
    days === 1
      ? ` · ${Math.round((worked / workday) * 100)}% of a ${formatMinutes(workday)} workday`
      : "";
  out.push(
    `**Worked:** ${formatMinutes(worked)}${days > 1 ? ` over ${days} days` : ""}${pctOfWorkday}`,
  );
  const unassigned = summary.byTask.get(UNASSIGNED) ?? 0;
  if (!project && unassigned >= 1) {
    out.push(
      `**Without a task:** ${formatMinutes(unassigned)} (sessions where no task was active)`,
    );
  }
  out.push("", "## By task");
  out.push(
    table(
      ["Task", "Type", "Status", "Project", "In period", "All time", "Estimate", "Progress"],
      taskRows.map(([key, minutes]) => {
        const task = byId.get(key);
        if (!task) return [key || NO_TASK_LABEL, "", "", "", formatMinutes(minutes), "", "", ""];
        const estimate = effectiveEstimate(task);
        return [
          `${task.id} · ${task.title}`,
          task.type,
          task.status,
          task.project ? basename(task.project) : "",
          formatMinutes(minutes),
          formatMinutes(allTime.get(task.id) ?? 0),
          estimate ? formatMinutes(estimate) : "",
          renderProgress(task),
        ];
      }),
    ),
  );

  const share = (minutes: number) => `${Math.round((minutes / tracked) * 100)}%`;
  out.push("", "## By type");
  out.push(
    table(
      ["Type", "Time", "Share"],
      [...byType].sort((a, b) => b[1] - a[1]).map(([k, m]) => [k, formatMinutes(m), share(m)]),
    ),
  );
  if (byProject.size > 1) {
    out.push("", "## By project");
    out.push(
      table(
        ["Project", "Time", "Share"],
        [...byProject].sort((a, b) => b[1] - a[1]).map(([k, m]) => [k, formatMinutes(m), share(m)]),
      ),
    );
  }

  if (days > 1) {
    out.push("", "## By day");
    const dayRows = [...summary.byDay]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, daySummary]) => {
        const top = [...daySummary.byTask]
          .filter(([key, m]) => m >= 1 && inProject(key))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([key, m]) => `${key || NO_TASK_LABEL} ${formatMinutes(m)}`)
          .join(", ");
        const dayWorked = project
          ? [...daySummary.byTask].filter(([key]) => inProject(key)).reduce((s, [, m]) => s + m, 0)
          : daySummary.totalMin;
        return [day, formatMinutes(dayWorked), top];
      });
    out.push(table(["Day", "Worked", "Top tasks"], dayRows));
  }

  const accuracy = estimationAccuracy(
    tasks.filter((t) => !project || belongsToProject(t, project)),
    allTime,
  );
  if (accuracy.length) {
    out.push("", "## Estimation accuracy (closed tasks, all time)");
    out.push(table(["Type", "Tasks", "Real / estimate", "Verdict"], accuracy));
  }
  return out.join("\n");
}
