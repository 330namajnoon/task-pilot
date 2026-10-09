import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderCheckpoint, renderSteps } from "../report/views.js";
import {
  appendLog,
  formatStamp,
  requireTask,
  saveTask,
  setStatus,
  STEP_STATUSES,
  writeContext,
} from "../store/tasks.js";
import { guard, idSchema, minutesSchema, stepInput } from "./common.js";

export function registerProgressTools(server: McpServer): void {
  server.registerTool(
    "task_plan",
    {
      title: "Edit a task's plan",
      description:
        "Edits the steps of a task: replace the whole plan, add steps, update them (text, estimate, status) or remove them. " +
        "Mark a step `doing` when you start it and `done` when it is finished, so the progress is always real. " +
        "Step numbers are stable ids; they are not renumbered when a step is removed.",
      inputSchema: {
        id: idSchema,
        replace: z.array(stepInput).optional().describe("New full plan (drops the current steps)."),
        add: z.array(stepInput).optional().describe("Steps to append at the end."),
        update: z
          .array(
            z.object({
              step: z.number().int().positive(),
              text: z.string().min(1).optional(),
              status: z.enum(STEP_STATUSES).optional(),
              estimateMin: minutesSchema.optional(),
            }),
          )
          .optional(),
        remove: z.array(z.number().int().positive()).optional(),
      },
    },
    guard(({ id, replace, add, update, remove }) => {
      const task = requireTask(id);
      let nextId = task.steps.reduce((max, s) => Math.max(max, s.id), 0) + 1;
      if (replace) {
        task.steps = [];
        nextId = 1;
        appendLog(task.id, "note", "Plan replaced.");
      }
      for (const step of [...(replace ?? []), ...(add ?? [])]) {
        task.steps.push({
          id: nextId++,
          text: step.text,
          status: "todo",
          estimateMin: step.estimateMin,
        });
      }
      for (const change of update ?? []) {
        const step = task.steps.find((s) => s.id === change.step);
        if (!step) throw new Error(`Step ${change.step} does not exist in ${task.id}.`);
        if (change.text) step.text = change.text;
        if (change.estimateMin !== undefined) step.estimateMin = change.estimateMin;
        if (change.status && change.status !== step.status) {
          step.status = change.status;
          if (change.status === "done")
            appendLog(task.id, "progress", `Step ${step.id} done: ${step.text}`);
        }
      }
      if (remove?.length) task.steps = task.steps.filter((s) => !remove.includes(s.id));
      if (task.status === "backlog" && task.steps.length) setStatus(task, "planned");
      if (
        ["backlog", "planned"].includes(task.status) &&
        task.steps.some((s) => s.status !== "todo")
      ) {
        setStatus(task, "in_progress");
      }
      saveTask(task);
      return `Plan of ${task.id}:\n${renderSteps(task)}`;
    }),
  );

  server.registerTool(
    "task_log",
    {
      title: "Add to a task's log",
      description:
        "Appends a dated entry to the task's log: progress made, a decision and its reason, a blocker, or a note. " +
        "The log is the history; for the current state use task_checkpoint.",
      inputSchema: {
        id: idSchema,
        kind: z.enum(["progress", "decision", "blocker", "note"]),
        text: z.string().min(1),
      },
    },
    guard(({ id, kind, text }) => {
      const task = requireTask(id);
      appendLog(task.id, kind, text);
      saveTask(task);
      return `Logged ${kind} on ${task.id}.`;
    }),
  );

  server.registerTool(
    "task_checkpoint",
    {
      title: "Save where the task is",
      description:
        "Overwrites the task's checkpoint: the exact point where work stands, so a future session can continue " +
        "without the current conversation. Write it for someone with no context: what is done, what is half done, " +
        "the next concrete steps, decisions taken, key files and open questions. " +
        "Save one after finishing a step, after important decisions and before the session ends.",
      inputSchema: {
        id: idSchema,
        summary: z.string().min(1).describe("Current state in a few sentences."),
        nextSteps: z.array(z.string()).optional().describe("Concrete next actions, in order."),
        decisions: z.array(z.string()).optional().describe("Decisions taken and why."),
        keyFiles: z
          .array(z.string())
          .optional()
          .describe("Files that matter, with a short note each."),
        blockers: z.array(z.string()).optional(),
        openQuestions: z.array(z.string()).optional(),
      },
    },
    guard(({ id, ...input }) => {
      const task = requireTask(id);
      const now = new Date();
      writeContext(task.id, renderCheckpoint(input, formatStamp(now)));
      appendLog(task.id, "checkpoint", input.summary, now);
      task.lastCheckpointAt = now.toISOString();
      saveTask(task, now);
      return `Checkpoint saved for ${task.id}.`;
    }),
  );
}
