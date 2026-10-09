import { homedir } from "node:os";
import { join } from "node:path";

/** Root of all task-pilot data. Read on every call so tests can point it elsewhere. */
export function homeDir(): string {
  return process.env.TASK_PILOT_HOME || join(homedir(), ".claude-tasks");
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Task ids become directory names, so only allow a safe subset of characters. */
export function normalizeId(id: string): string {
  const trimmed = id.trim();
  if (!ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid task id "${id}": use letters, digits, ".", "_" or "-".`);
  }
  return trimmed.toUpperCase();
}

export const paths = {
  config: () => join(homeDir(), "config.json"),
  tasksDir: () => join(homeDir(), "tasks"),
  taskDir: (id: string) => join(homeDir(), "tasks", normalizeId(id)),
  taskFile: (id: string) => join(paths.taskDir(id), "task.json"),
  contextFile: (id: string) => join(paths.taskDir(id), "context.md"),
  logFile: (id: string) => join(paths.taskDir(id), "log.md"),
  sessionsDir: () => join(homeDir(), "sessions"),
  sessionFile: (sessionId: string) =>
    join(homeDir(), "sessions", `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`),
  timeDir: () => join(homeDir(), "time"),
  timeFile: (date: string) => join(homeDir(), "time", `${date}.jsonl`),
};
