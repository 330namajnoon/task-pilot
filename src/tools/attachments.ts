import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderAttachments } from "../report/views.js";
import { addAttachment, removeAttachment } from "../store/attachments.js";
import { appendLog, ATTACHMENT_MODES, requireTask, saveTask } from "../store/tasks.js";
import { absolutePath, guard, idSchema } from "./common.js";

export function registerAttachmentTools(server: McpServer): void {
  server.registerTool(
    "task_attach",
    {
      title: "Attach files to a task",
      description:
        "Attaches files to a task or subtask (specs, screenshots, logs, exports...) and lists or removes them. " +
        'By default a file is copied into the task\'s folder, so it stays even if the original moves; mode "link" ' +
        "keeps only a reference to the file where it is (use it for big files or ones that keep changing). " +
        "Each subtask has its own attachments. They are listed in task_resume and shown in the task panel. " +
        "Call it with just the id to list the attachments.",
      inputSchema: {
        id: idSchema,
        add: z
          .array(
            z.object({
              path: absolutePath.describe("Absolute path of the file to attach."),
              name: z.string().min(1).optional().describe("Name to show. Default: the file name."),
              note: z.string().optional().describe("What the file is and why it matters."),
              mode: z.enum(ATTACHMENT_MODES).optional().describe('"copy" (default) or "link".'),
            }),
          )
          .optional(),
        remove: z
          .array(z.number().int().positive())
          .optional()
          .describe(
            "Attachment numbers to remove. A copy is deleted; a linked file is left alone.",
          ),
      },
    },
    guard(({ id, add, remove }) => {
      const task = requireTask(id);
      const now = new Date();
      for (const number of remove ?? []) {
        const removed = removeAttachment(task, number);
        appendLog(task.id, "note", `Attachment ${removed.id} removed: ${removed.name}`, now);
        saveTask(task, now);
      }
      for (const input of add ?? []) {
        const added = addAttachment(task, input, now);
        appendLog(
          task.id,
          "note",
          `Attached ${added.name} (${added.mode === "copy" ? "copy" : `link to ${added.source}`})${added.note ? `: ${added.note}` : ""}`,
          now,
        );
        // Saved one by one, so a file that fails later does not leave this copy unrecorded.
        saveTask(task, now);
      }
      return `Attachments of ${task.id}:\n${renderAttachments(task)}`;
    }),
  );
}
