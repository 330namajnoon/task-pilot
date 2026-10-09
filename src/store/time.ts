import { readdirSync } from "node:fs";
import { localDate } from "../time/dates.js";
import { appendText, readText } from "./fs.js";
import { paths } from "./paths.js";

/** An activity event from a hook: the user sent a prompt, Claude finished a turn, a task was bound... */
export interface Heartbeat {
  kind: "hb";
  ts: string;
  sessionId: string;
  taskId: string | null;
  event: string;
  cwd?: string;
}

/** A manual correction of the tracked time of one task on one day. */
export interface Adjustment {
  kind: "adjust";
  ts: string;
  date: string;
  taskId: string | null;
  minutes: number;
  mode: "add" | "set";
  note?: string;
}

export type TimeEntry = Heartbeat | Adjustment;

export function appendEntry(entry: TimeEntry): void {
  const day = entry.kind === "adjust" ? entry.date : localDate(new Date(entry.ts));
  appendText(paths.timeFile(day), `${JSON.stringify(entry)}\n`);
}

export function readDays(days: Iterable<string>): TimeEntry[] {
  const entries: TimeEntry[] = [];
  for (const day of days) {
    const text = readText(paths.timeFile(day));
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as TimeEntry);
      } catch {
        // A torn line from a crash: skip it rather than lose the whole day.
      }
    }
  }
  return entries;
}

/** Every day that has a time file, sorted. */
export function trackedDays(): string[] {
  try {
    return readdirSync(paths.timeDir())
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}
