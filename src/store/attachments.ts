import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, sep } from "node:path";
import { paths } from "./paths.js";
import type { Attachment, AttachmentMode, Task } from "./tasks.js";

/** Copies bigger than this are refused: link the file instead. */
export const MAX_COPY_BYTES = 50 * 1024 * 1024;

export interface NewAttachment {
  path: string;
  name?: string;
  note?: string;
  mode?: AttachmentMode;
}

export function attachmentsOf(task: Task): Attachment[] {
  return task.attachments ?? [];
}

/** File name kept safe for the task folder: no separators or odd characters. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "file";
}

/** Adds a file to the task: copied into its attachments folder (default) or linked where it is. */
export function addAttachment(task: Task, input: NewAttachment, now = new Date()): Attachment {
  let info;
  try {
    info = statSync(input.path);
  } catch {
    throw new Error(`File ${input.path} not found.`);
  }
  if (!info.isFile()) throw new Error(`${input.path} is not a file.`);
  const mode = input.mode ?? "copy";
  if (mode === "copy" && info.size > MAX_COPY_BYTES) {
    throw new Error(
      `${input.path} is ${Math.round(info.size / 1024 / 1024)} MB, over the ${MAX_COPY_BYTES / 1024 / 1024} MB copy limit; attach it with mode "link".`,
    );
  }
  const list = attachmentsOf(task);
  const id = list.reduce((max, a) => Math.max(max, a.id), 0) + 1;
  const name = input.name?.trim() || basename(input.path);
  let path = input.path;
  if (mode === "copy") {
    // The id prefix keeps two files with the same name apart; the extension stays for previews.
    const stored = safeName(name);
    path = join(
      paths.attachmentsDir(task.id),
      `${id}-${extname(stored) ? stored : stored + extname(input.path)}`,
    );
    mkdirSync(paths.attachmentsDir(task.id), { recursive: true });
    copyFileSync(input.path, path);
  }
  const attachment: Attachment = {
    id,
    name,
    path,
    source: input.path,
    mode,
    size: info.size,
    note: input.note?.trim() || undefined,
    addedAt: now.toISOString(),
  };
  task.attachments = [...list, attachment];
  return attachment;
}

/** Removes an attachment; a copy is deleted from the task folder, a linked file is left alone. */
export function removeAttachment(task: Task, id: number): Attachment {
  const attachment = attachmentsOf(task).find((a) => a.id === id);
  if (!attachment) throw new Error(`Attachment ${id} does not exist in ${task.id}.`);
  // Only ever delete inside the task's own folder, whatever task.json says.
  if (
    attachment.mode === "copy" &&
    attachment.path.startsWith(paths.attachmentsDir(task.id) + sep)
  ) {
    rmSync(attachment.path, { force: true });
  }
  task.attachments = attachmentsOf(task).filter((a) => a.id !== id);
  return attachment;
}
