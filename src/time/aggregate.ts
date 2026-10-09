import type { Adjustment, Heartbeat, TimeEntry } from "../store/time.js";
import { localDate } from "./dates.js";

/** Key used for activity that happened while no task was bound to the session. */
export const UNASSIGNED = "";

/** Events that happen while Claude is working on a turn: the gap after them is not idle time. */
const IN_TURN_EVENTS = new Set(["UserPromptSubmit", "bind", "unbind"]);

export interface Interval {
  sessionId: string;
  taskKey: string;
  start: number;
  end: number;
}

export interface TimeRules {
  idleTimeoutMin: number;
  maxTurnMin: number;
}

/**
 * Turns heartbeats into active intervals, per session:
 * - a gap that starts inside a Claude turn (prompt → stop) is work, up to `maxTurnMin`;
 * - any other gap (user reading, thinking) counts only if it is shorter than `idleTimeoutMin`.
 * The interval belongs to the task bound at its start, or the one bound at its end when there was none.
 */
export function buildIntervals(entries: TimeEntry[], rules: TimeRules): Interval[] {
  const bySession = new Map<string, Heartbeat[]>();
  for (const entry of entries) {
    if (entry.kind !== "hb") continue;
    const list = bySession.get(entry.sessionId) ?? [];
    list.push(entry);
    bySession.set(entry.sessionId, list);
  }
  const intervals: Interval[] = [];
  for (const [sessionId, beats] of bySession) {
    beats.sort((a, b) => a.ts.localeCompare(b.ts));
    for (let i = 0; i + 1 < beats.length; i++) {
      const a = beats[i]!;
      const b = beats[i + 1]!;
      const start = Date.parse(a.ts);
      const end = Date.parse(b.ts);
      const gapMin = (end - start) / 60_000;
      const limit = IN_TURN_EVENTS.has(a.event) ? rules.maxTurnMin : rules.idleTimeoutMin;
      if (gapMin <= 0 || gapMin > limit) continue;
      intervals.push({ sessionId, taskKey: a.taskId ?? b.taskId ?? UNASSIGNED, start, end });
    }
  }
  return intervals;
}

/** Wall-clock minutes covered by the intervals, so parallel sessions are not counted twice. */
function unionMinutes(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const { start, end } of sorted) {
    if (start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    } else if (end > curEnd) {
      curEnd = end;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total / 60_000;
}

export interface DaySummary {
  /** Minutes per task key (UNASSIGNED for activity without a task). */
  byTask: Map<string, number>;
  /** Wall-clock minutes worked that day. */
  totalMin: number;
}

export interface Summary {
  byDay: Map<string, DaySummary>;
  byTask: Map<string, number>;
  totalMin: number;
}

function applyAdjustment(day: DaySummary, adj: Adjustment): void {
  const key = adj.taskId ?? UNASSIGNED;
  const before = day.byTask.get(key) ?? 0;
  const after = Math.max(0, adj.mode === "set" ? adj.minutes : before + adj.minutes);
  day.byTask.set(key, after);
  day.totalMin = Math.max(0, day.totalMin + after - before);
}

/**
 * Minutes per day and task. Intervals belong to the day they start on.
 * Pass `days` to restrict the summary (entries of the previous day are still needed
 * to close intervals that cross midnight, so read one extra day before the range).
 */
export function summarize(entries: TimeEntry[], rules: TimeRules, days?: Set<string>): Summary {
  const byDay = new Map<string, DaySummary>();
  const dayOf = (day: string) => {
    let summary = byDay.get(day);
    if (!summary) {
      summary = { byTask: new Map(), totalMin: 0 };
      byDay.set(day, summary);
    }
    return summary;
  };

  const intervalsByDay = new Map<string, Interval[]>();
  for (const interval of buildIntervals(entries, rules)) {
    const day = localDate(new Date(interval.start));
    if (days && !days.has(day)) continue;
    const list = intervalsByDay.get(day) ?? [];
    list.push(interval);
    intervalsByDay.set(day, list);
  }
  for (const [day, intervals] of intervalsByDay) {
    const summary = dayOf(day);
    for (const { taskKey, start, end } of intervals) {
      summary.byTask.set(taskKey, (summary.byTask.get(taskKey) ?? 0) + (end - start) / 60_000);
    }
    summary.totalMin = unionMinutes(intervals);
  }

  const adjustments = entries
    .filter((e): e is Adjustment => e.kind === "adjust")
    .filter((a) => !days || days.has(a.date))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  for (const adj of adjustments) applyAdjustment(dayOf(adj.date), adj);

  const byTask = new Map<string, number>();
  let totalMin = 0;
  for (const summary of byDay.values()) {
    totalMin += summary.totalMin;
    for (const [key, minutes] of summary.byTask) byTask.set(key, (byTask.get(key) ?? 0) + minutes);
  }
  return { byDay, byTask, totalMin };
}
