import { basename } from "node:path";
import { formatMinutes } from "../time/dates.js";
import {
  effectiveEstimate,
  readContext,
  recentLog,
  stepProgress,
  type Step,
  type Task,
} from "../store/tasks.js";

/** Marker the PostToolUse hook looks for to bind the session to a task. */
export const bindMarker = (id: string) => `<!-- task-pilot:bind=${id} -->`;
export const UNBIND_MARKER = "<!-- task-pilot:unbind -->";

const STEP_BOX: Record<Step["status"], string> = {
  todo: "[ ]",
  doing: "[~]",
  done: "[x]",
  skipped: "[-]",
};

export function renderSteps(task: Task): string {
  if (!task.steps.length) return "_No plan yet. Add steps with task_plan._";
  return task.steps
    .map((s) => {
      const estimate = s.estimateMin !== undefined ? ` (est ${formatMinutes(s.estimateMin)})` : "";
      return `- ${STEP_BOX[s.status]} ${s.id}. ${s.text}${estimate}`;
    })
    .join("\n");
}

/** "2h 10m / est 4h 00m (54%)", or just the tracked time when there is no estimate. */
export function renderTime(task: Task, trackedMin: number): string {
  const estimate = effectiveEstimate(task);
  if (!estimate) return `${formatMinutes(trackedMin)} tracked, no estimate`;
  const pct = Math.round((trackedMin / estimate) * 100);
  return `${formatMinutes(trackedMin)} tracked / est ${formatMinutes(estimate)} (${pct}%)`;
}

export function renderProgress(task: Task): string {
  const { done, total } = stepProgress(task);
  return total ? `${done}/${total} steps` : "no steps";
}

export function renderHeader(task: Task, trackedMin: number): string {
  const where = task.project
    ? `${task.project}${task.branch ? ` (branch ${task.branch})` : ""}`
    : "no project";
  const lines = [
    `# ${task.id} · ${task.title}`,
    `Type: ${task.type} · Status: ${task.status} · ${renderProgress(task)} · ${renderTime(task, trackedMin)}`,
    `Project: ${where}${task.externalRef && task.externalRef.toUpperCase() !== task.id ? ` · Ref: ${task.externalRef}` : ""}${task.tags.length ? ` · Tags: ${task.tags.join(", ")}` : ""}`,
  ];
  if (task.description) lines.push("", task.description);
  return lines.join("\n");
}

/** Everything needed to pick a task back up in a new session. */
export function renderResumePack(task: Task, trackedMin: number, logEntries = 6): string {
  const context = readContext(task.id);
  const log = recentLog(task.id, logEntries);
  return [
    renderHeader(task, trackedMin),
    "",
    "## Plan",
    renderSteps(task),
    "",
    "## Where we left off",
    context?.trim() ||
      "_No checkpoint yet. Save one with task_checkpoint when you reach a milestone._",
    "",
    `## Recent log (last ${logEntries})`,
    log.length ? log.join("\n\n") : "_Empty._",
  ].join("\n");
}

/** One line per task for lists. */
export function renderListLine(task: Task, trackedMin: number, cwd?: string): string {
  const project = task.project ? basename(task.project) : "-";
  const here = cwd && task.project === cwd ? " (this repo)" : "";
  return `- **${task.id}** · ${task.status} · ${task.type} · ${task.title} — ${project}${here} · ${renderProgress(task)} · ${renderTime(task, trackedMin)} · updated ${task.updatedAt.slice(0, 10)}`;
}

export interface CheckpointInput {
  summary: string;
  nextSteps?: string[];
  decisions?: string[];
  keyFiles?: string[];
  blockers?: string[];
  openQuestions?: string[];
}

export function renderCheckpoint(input: CheckpointInput, stampText: string): string {
  const section = (title: string, items?: string[]) =>
    items?.length ? [`### ${title}`, ...items.map((i) => `- ${i}`), ""] : [];
  return [
    `_Updated ${stampText}_`,
    "",
    input.summary.trim(),
    "",
    ...section("Next steps", input.nextSteps),
    ...section("Decisions", input.decisions),
    ...section("Key files", input.keyFiles),
    ...section("Blockers", input.blockers),
    ...section("Open questions", input.openQuestions),
  ]
    .join("\n")
    .trimEnd()
    .concat("\n");
}
