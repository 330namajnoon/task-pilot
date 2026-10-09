import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { Heartbeat } from "../src/store/time.js";

/** Points TASK_PILOT_HOME to a fresh temp folder for every test. */
export function useTempHome(): { dir: () => string } {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "task-pilot-"));
    process.env.TASK_PILOT_HOME = dir;
  });
  afterEach(() => {
    delete process.env.TASK_PILOT_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir: () => dir };
}

/** Local-time Date for today's date at HH:MM, so day bucketing is stable in any time zone. */
export function at(time: string, day = "2026-10-09"): Date {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y!, mo! - 1, d!, h!, mi!);
}

export function hb(
  time: string,
  event: string,
  taskId: string | null,
  sessionId = "s1",
  day?: string,
): Heartbeat {
  return { kind: "hb", ts: at(time, day).toISOString(), sessionId, taskId, event };
}
