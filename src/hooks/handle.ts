import { renderListLine, renderResumePack } from "../report/views.js";
import { loadConfig } from "../store/config.js";
import { getSession, saveSession, type SessionBinding } from "../store/sessions.js";
import { belongsToProject, getTask, isOpen, listTasks } from "../store/tasks.js";
import { appendEntry } from "../store/time.js";
import { summarizeAll } from "../time/queries.js";

/** The fields task-pilot uses from the JSON Claude Code sends to hooks on stdin. */
export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  source?: string;
  tool_name?: string;
  tool_response?: unknown;
}

const MAX_CONTEXT_CHARS = 8000;
const BIND_PATTERN = /task-pilot:bind=([A-Za-z0-9._-]+)/;

function contextOutput(event: string, text: string): string {
  const additionalContext =
    text.length > MAX_CONTEXT_CHARS
      ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n…(truncated, call task_resume for the rest)`
      : text;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } });
}

function sessionStartContext(binding: SessionBinding | undefined, cwd: string | undefined): string {
  const active = binding?.taskId ? getTask(binding.taskId) : undefined;
  const totals = summarizeAll().byTask;
  if (active && isOpen(active)) {
    return [
      `task-pilot: this session is working on task ${active.id}. Its saved state follows.`,
      "Keep it updated: task_plan for steps, task_log for decisions/blockers, task_checkpoint after each step and before ending.",
      "",
      renderResumePack(active, totals.get(active.id) ?? 0, 4),
    ].join("\n");
  }
  const here = cwd ? listTasks().filter((t) => isOpen(t) && belongsToProject(t, cwd)) : [];
  if (!here.length) {
    return "task-pilot is active: for substantial work, create a task with task_create (type, steps, estimate) so it can be resumed in later sessions and its time is tracked.";
  }
  return [
    "task-pilot: open tasks in this project:",
    ...here.slice(0, 8).map((t) => renderListLine(t, totals.get(t.id) ?? 0)),
    "",
    "If the user's request continues one of them, call task_resume with its id before starting. " +
      "For new substantial work, create a task with task_create.",
  ].join("\n");
}

function checkpointReminder(binding: SessionBinding, now: Date): string | undefined {
  if (!binding.taskId) return undefined;
  const task = getTask(binding.taskId);
  if (!task || !isOpen(task)) return undefined;
  const last = Math.max(
    ...[task.lastCheckpointAt, binding.lastReminderAt, binding.boundAt].map((d) =>
      d ? Date.parse(d) : 0,
    ),
  );
  const minutes = Math.round((now.getTime() - last) / 60_000);
  if (minutes < loadConfig().checkpointReminderMin) return undefined;
  saveSession({ ...binding, lastReminderAt: now.toISOString() });
  return `task-pilot: task ${task.id} has no checkpoint for ${minutes} min. When this request is done, save where it stands with task_checkpoint.`;
}

/**
 * Handles one hook event and returns what to print on stdout (if anything).
 * Every event leaves a heartbeat, which is what the time tracking is computed from.
 */
export function handleHook(input: HookInput, now = new Date()): string | undefined {
  const sessionId = input.session_id;
  const event = input.hook_event_name;
  if (!sessionId || !event) return undefined;
  let binding = getSession(sessionId);
  let heartbeatEvent = event;

  if (event === "PostToolUse") {
    const response = JSON.stringify(input.tool_response ?? "");
    const bound = BIND_PATTERN.exec(response)?.[1];
    if (!bound && !response.includes("task-pilot:unbind")) return undefined;
    binding = {
      sessionId,
      taskId: bound?.toUpperCase() ?? null,
      cwd: input.cwd,
      boundAt: now.toISOString(),
    };
    saveSession(binding);
    heartbeatEvent = bound ? "bind" : "unbind";
  }

  appendEntry({
    kind: "hb",
    ts: now.toISOString(),
    sessionId,
    taskId: binding?.taskId ?? null,
    event: heartbeatEvent,
    cwd: input.cwd,
  });

  if (event === "SessionStart")
    return contextOutput(event, sessionStartContext(binding, input.cwd));
  if (event === "UserPromptSubmit" && binding) {
    const reminder = checkpointReminder(binding, now);
    if (reminder) return contextOutput(event, reminder);
  }
  return undefined;
}
