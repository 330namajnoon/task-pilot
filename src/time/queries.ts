import { loadConfig } from "../store/config.js";
import { readDays, trackedDays } from "../store/time.js";
import { summarize, type Summary } from "./aggregate.js";
import { addDays, dayRange } from "./dates.js";

/** Summary for the days from `from` to `to` (both included). */
export function summarizeRange(from: string, to: string): Summary {
  const days = dayRange(from, to);
  // The day before is read too, to close intervals that cross midnight into the range.
  const entries = readDays([addDays(from, -1), ...days]);
  return summarize(entries, loadConfig(), new Set(days));
}

/** All the time ever tracked, per task key. */
export function summarizeAll(): Summary {
  return summarize(readDays(trackedDays()), loadConfig());
}
