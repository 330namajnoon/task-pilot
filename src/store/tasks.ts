import { readdirSync } from "node:fs";
import { sep } from "node:path";
import { appendText, readJson, readText, writeJsonAtomic, writeTextAtomic } from "./fs.js";
import { normalizeId, paths } from "./paths.js";

export const STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];
export const CLOSED_STATUSES: readonly Status[] = ["done", "cancelled"];

export const STEP_STATUSES = ["todo", "doing", "done", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const LOG_KINDS = [
  "progress",
  "decision",
  "blocker",
  "note",
  "checkpoint",
  "status",
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface Step {
  id: number;
  text: string;
  status: StepStatus;
  estimateMin?: number;
}

export const ATTACHMENT_MODES = ["copy", "link"] as const;
export type AttachmentMode = (typeof ATTACHMENT_MODES)[number];

export interface Attachment {
  id: number;
  name: string;
  /** Where the file is read from: the copy inside the task folder, or the original for a link. */
  path: string;
  /** Path the file was attached from. */
  source: string;
  mode: AttachmentMode;
  size: number;
  note?: string;
  addedAt: string;
}

export interface Task {
  id: string;
  title: string;
  type: string;
  status: Status;
  description?: string;
  estimateMin?: number;
  externalRef?: string;
  project?: string;
  branch?: string;
  /** Task this one is a subtask of. Subtasks keep their own status, plan, log and time. */
  parentId?: string;
  tags: string[];
  steps: Step[];
  /** Files attached to this task; a subtask keeps its own. Absent in tasks saved before 0.4. */
  attachments?: Attachment[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  closedAt?: string;
  lastCheckpointAt?: string;
}

export interface NewTask {
  title: string;
  type: string;
  id?: string;
  description?: string;
  estimateMin?: number;
  externalRef?: string;
  project?: string;
  branch?: string;
  tags?: string[];
  steps?: { text: string; estimateMin?: number }[];
  parentId?: string;
}

export function isOpen(task: Task): boolean {
  return !CLOSED_STATUSES.includes(task.status);
}

/** Explicit estimate, or the sum of the step estimates when there is none. */
export function effectiveEstimate(task: Task): number | undefined {
  if (task.estimateMin !== undefined) return task.estimateMin;
  const estimates = task.steps.map((s) => s.estimateMin).filter((m) => m !== undefined);
  return estimates.length ? estimates.reduce((a, b) => a + b, 0) : undefined;
}

export function stepProgress(task: Task): { done: number; total: number } {
  const counted = task.steps.filter((s) => s.status !== "skipped");
  return { done: counted.filter((s) => s.status === "done").length, total: counted.length };
}

/** True when `dir` is the task's project or a folder inside it. */
export function belongsToProject(task: Task, dir: string): boolean {
  if (!task.project) return false;
  return dir === task.project || dir.startsWith(task.project + sep);
}

export function getTask(id: string): Task | undefined {
  return readJson<Task>(paths.taskFile(id));
}

export function requireTask(id: string): Task {
  const task = getTask(id);
  if (!task) throw new Error(`Task ${normalizeId(id)} not found. Use task_list to see the ids.`);
  return task;
}

export function saveTask(task: Task, now = new Date()): Task {
  task.updatedAt = now.toISOString();
  writeJsonAtomic(paths.taskFile(task.id), task);
  return task;
}

export function listTasks(): Task[] {
  let ids: string[];
  try {
    ids = readdirSync(paths.tasksDir());
  } catch {
    return [];
  }
  return ids
    .map((id) => getTask(id))
    .filter((t): t is Task => t !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Direct subtasks of `id`, oldest first. */
export function childrenOf(id: string, tasks = listTasks()): Task[] {
  return tasks
    .filter((t) => t.parentId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Every subtask below `id`, at any depth. */
export function descendantsOf(id: string, tasks = listTasks()): Task[] {
  return childrenOf(id, tasks).flatMap((c) => [c, ...descendantsOf(c.id, tasks)]);
}

/** Parent, grandparent... up to the top task (closest first). */
export function ancestorsOf(task: Task, tasks = listTasks()): Task[] {
  const chain: Task[] = [];
  let parentId = task.parentId;
  while (parentId && !chain.some((t) => t.id === parentId)) {
    const parent = tasks.find((t) => t.id === parentId);
    if (!parent) break;
    chain.push(parent);
    parentId = parent.parentId;
  }
  return chain;
}

/** Checks that `task` can hang from `parentId` (it exists and no cycle is made) and returns its normalized id. */
export function validParent(task: Pick<Task, "id"> | undefined, parentId: string): string {
  const parent = requireTask(parentId);
  if (task && (parent.id === task.id || ancestorsOf(parent).some((t) => t.id === task.id))) {
    throw new Error(
      `${parent.id} is ${task.id} itself or one of its subtasks; it cannot be its parent.`,
    );
  }
  return parent.id;
}

/** Next free id below a parent: STORE-42.1, STORE-42.2... */
function nextChildId(parentId: string): string {
  let n = 1;
  while (getTask(`${parentId}.${n}`)) n++;
  return `${parentId}.${n}`;
}

function nextAutoId(): string {
  const max = listTasks()
    .map((t) => /^T-(\d+)$/.exec(t.id)?.[1])
    .filter((n) => n !== undefined)
    .reduce((acc, n) => Math.max(acc, Number(n)), 0);
  return `T-${String(max + 1).padStart(4, "0")}`;
}

export function createTask(input: NewTask, now = new Date()): Task {
  const parentId = input.parentId ? validParent(undefined, input.parentId) : undefined;
  const id = normalizeId(
    input.id ?? input.externalRef ?? (parentId ? nextChildId(parentId) : nextAutoId()),
  );
  if (getTask(id)) throw new Error(`Task ${id} already exists. Use task_resume to continue it.`);
  const iso = now.toISOString();
  const task: Task = {
    id,
    title: input.title,
    type: input.type.trim().toLowerCase(),
    status: input.steps?.length ? "planned" : "backlog",
    description: input.description,
    estimateMin: input.estimateMin,
    externalRef: input.externalRef,
    project: input.project,
    branch: input.branch,
    parentId,
    tags: input.tags ?? [],
    steps: (input.steps ?? []).map((s, i) => ({
      id: i + 1,
      text: s.text,
      status: "todo",
      estimateMin: s.estimateMin,
    })),
    createdAt: iso,
    updatedAt: iso,
  };
  saveTask(task, now);
  appendLog(
    id,
    "status",
    `Created as ${task.status} (${task.type})${parentId ? `, subtask of ${parentId}` : ""}.`,
    now,
  );
  if (parentId) appendLog(parentId, "note", `Subtask ${id} added: ${task.title}`, now);
  return task;
}

/** Moves the task to `status`, stamping start/close dates and logging the change. */
export function setStatus(task: Task, status: Status, now = new Date()): void {
  if (task.status === status) return;
  appendLog(task.id, "status", `${task.status} → ${status}`, now);
  task.status = status;
  if (status === "in_progress" && !task.startedAt) task.startedAt = now.toISOString();
  task.closedAt = CLOSED_STATUSES.includes(status) ? now.toISOString() : undefined;
}

export function formatStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function appendLog(id: string, kind: LogKind, text: string, now = new Date()): void {
  appendText(paths.logFile(id), `## ${formatStamp(now)} · ${kind}\n${text.trim()}\n\n`);
}

/** Last `count` entries of log.md, oldest first. */
export function recentLog(id: string, count: number): string[] {
  const text = readText(paths.logFile(id));
  if (!text) return [];
  const entries = text
    .split(/^(?=## )/m)
    .map((e) => e.trim())
    .filter(Boolean);
  return entries.slice(-count);
}

export function readContext(id: string): string | undefined {
  return readText(paths.contextFile(id));
}

export function writeContext(id: string, markdown: string): void {
  writeTextAtomic(paths.contextFile(id), markdown);
}
