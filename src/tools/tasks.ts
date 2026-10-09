import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  bindMarker,
  renderHeader,
  renderListLine,
  renderResumePack,
  renderSteps,
  UNBIND_MARKER,
} from "../report/views.js";
import { loadConfig } from "../store/config.js";
import {
  appendLog,
  belongsToProject,
  createTask,
  isOpen,
  listTasks,
  requireTask,
  saveTask,
  setStatus,
  STATUSES,
  type Task,
} from "../store/tasks.js";
import { summarizeAll } from "../time/queries.js";
import {
  absolutePath,
  currentBranch,
  currentProject,
  guard,
  idSchema,
  minutesSchema,
  stepInput,
} from "./common.js";

function trackedFor(id: string): number {
  return summarizeAll().byTask.get(id) ?? 0;
}

/** Starting work on a task moves it to in_progress (and reopens it if it was closed). */
function markStarted(task: Task): void {
  if (task.status === "in_progress") return;
  if (!isOpen(task)) appendLog(task.id, "status", "Reopened.");
  setStatus(task, "in_progress");
  saveTask(task);
}

export function registerTaskTools(server: McpServer): void {
  const types = loadConfig().taskTypes.join(", ");

  server.registerTool(
    "task_create",
    {
      title: "Create a task",
      description:
        "Creates a task that persists across sessions. Give it a type, a plan of steps and an estimate when you can " +
        "(the report tool shows how long past tasks of the same type really took). " +
        "By default it also becomes the active task of this session, so the time from now on is tracked on it.",
      inputSchema: {
        title: z.string().min(1),
        type: z.string().min(1).describe(`Kind of work. Usual types: ${types}.`),
        description: z.string().optional().describe("Goal and acceptance criteria."),
        estimateMin: minutesSchema
          .optional()
          .describe(
            "Total estimate in minutes. If omitted, the sum of the step estimates is used.",
          ),
        steps: z.array(stepInput).optional().describe("Initial plan, in order."),
        externalRef: z
          .string()
          .optional()
          .describe("Ticket key such as STORE-6042. When given it is also used as the task id."),
        id: z.string().optional().describe("Custom id. Default: externalRef, or T-0001, T-0002..."),
        project: absolutePath.optional().describe("Project folder. Default: the current one."),
        tags: z.array(z.string()).optional(),
        start: z
          .boolean()
          .optional()
          .describe("Make it the active task of this session (default true)."),
      },
    },
    guard((args) => {
      const project = args.project ?? currentProject();
      const task = createTask({ ...args, project, branch: currentBranch(project) });
      const start = args.start ?? true;
      if (start) markStarted(task);
      return [
        renderHeader(task, 0),
        "",
        "## Plan",
        renderSteps(task),
        "",
        start
          ? `Active task of this session.\n${bindMarker(task.id)}`
          : "Created without starting it.",
      ].join("\n");
    }),
  );

  server.registerTool(
    "task_list",
    {
      title: "List tasks",
      description:
        "Lists tasks with status, progress and tracked time vs estimate. By default only open ones.",
      inputSchema: {
        status: z
          .union([z.enum(["open", "all"]), z.enum(STATUSES)])
          .optional()
          .describe('"open" (default), "all" or a single status.'),
        scope: z
          .enum(["this_repo", "all"])
          .optional()
          .describe('"this_repo" for the tasks of the current project only (default "all").'),
        type: z.string().optional(),
        query: z
          .string()
          .optional()
          .describe("Text to look for in the id, title, description or tags."),
      },
      annotations: { readOnlyHint: true },
    },
    guard(({ status = "open", scope = "all", type, query }) => {
      const cwd = currentProject();
      const needle = query?.toLowerCase();
      const tasks = listTasks().filter(
        (t) =>
          (status === "all" || (status === "open" ? isOpen(t) : t.status === status)) &&
          (scope === "all" || belongsToProject(t, cwd)) &&
          (!type || t.type === type.toLowerCase()) &&
          (!needle ||
            [t.id, t.title, t.description ?? "", ...t.tags].some((s) =>
              s.toLowerCase().includes(needle),
            )),
      );
      if (!tasks.length) return "No tasks match. Create one with task_create.";
      const totals = summarizeAll().byTask;
      return tasks.map((t) => renderListLine(t, totals.get(t.id) ?? 0, cwd)).join("\n");
    }),
  );

  server.registerTool(
    "task_resume",
    {
      title: "Resume a task",
      description:
        "Loads everything needed to continue a task in this session: plan with progress, the last checkpoint " +
        "(where it was left off), recent log and time vs estimate. It also becomes the active task of this session. " +
        "Without an id it picks the most recently updated in-progress task of the current project, " +
        "or lists the open ones to choose from. Read the result and continue from the next steps.",
      inputSchema: { id: idSchema.optional() },
    },
    guard(({ id }) => {
      let task: Task | undefined;
      if (id) {
        task = requireTask(id);
      } else {
        const here = listTasks().filter((t) => isOpen(t) && belongsToProject(t, currentProject()));
        task = here.find((t) => t.status === "in_progress");
        if (!task) {
          if (!here.length)
            return "No open tasks in this project. Use task_list with scope all, or task_create.";
          return `Several open tasks here; ask the user which one and call task_resume with its id:\n${here
            .map((t) => renderListLine(t, trackedFor(t.id)))
            .join("\n")}`;
        }
      }
      markStarted(task);
      return `${renderResumePack(task, trackedFor(task.id))}\n\n${bindMarker(task.id)}`;
    }),
  );

  server.registerTool(
    "task_start",
    {
      title: "Start working on a task",
      description:
        "Makes a task the active one of this session (time is tracked on it) without loading its full context. " +
        "Use task_resume instead when you need to know where it was left off.",
      inputSchema: { id: idSchema },
    },
    guard(({ id }) => {
      const task = requireTask(id);
      markStarted(task);
      return `Now working on ${task.id} · ${task.title}.\n${bindMarker(task.id)}`;
    }),
  );

  server.registerTool(
    "task_stop",
    {
      title: "Stop working on the active task",
      description:
        "Detaches the session from its task so time stops being tracked on it, optionally changing its status " +
        "(review, blocked, done...). Save a checkpoint first so the next session knows where to continue.",
      inputSchema: {
        id: idSchema
          .optional()
          .describe("Task to update the status of. Not needed to just stop tracking."),
        status: z.enum(STATUSES).optional(),
        note: z.string().optional().describe("Why it stops here; added to the log."),
      },
    },
    guard(({ id, status, note }) => {
      const lines = ["Stopped tracking time on this session's task."];
      if (id) {
        const task = requireTask(id);
        if (note) appendLog(task.id, "note", note);
        if (status) {
          setStatus(task, status);
          lines.push(`${task.id} is now ${status}.`);
        }
        saveTask(task);
      }
      lines.push(UNBIND_MARKER);
      return lines.join("\n");
    }),
  );

  server.registerTool(
    "task_update",
    {
      title: "Update a task",
      description:
        "Changes the title, type, status, estimate, description, tags, ticket or project of a task.",
      inputSchema: {
        id: idSchema,
        title: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        status: z.enum(STATUSES).optional(),
        estimateMin: minutesSchema.optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        externalRef: z.string().optional(),
        project: absolutePath.optional(),
      },
    },
    guard(({ id, status, type, estimateMin, ...rest }) => {
      const task = requireTask(id);
      if (estimateMin !== undefined && estimateMin !== task.estimateMin) {
        appendLog(
          task.id,
          "note",
          `Estimate changed to ${estimateMin} min (was ${task.estimateMin ?? "none"}).`,
        );
        task.estimateMin = estimateMin;
      }
      if (type) task.type = type.trim().toLowerCase();
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) Object.assign(task, { [key]: value });
      }
      if (status) setStatus(task, status);
      saveTask(task);
      return renderHeader(task, trackedFor(task.id));
    }),
  );
}
