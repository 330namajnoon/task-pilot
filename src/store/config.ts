import { readJson, writeJsonAtomic } from "./fs.js";
import { paths } from "./paths.js";

export interface Config {
  /** Suggested task types. Any other type is accepted too. */
  taskTypes: string[];
  /** A gap longer than this between two activity events (outside a Claude turn) counts as idle. */
  idleTimeoutMin: number;
  /** A single Claude turn longer than this is capped (protects against a stuck session). */
  maxTurnMin: number;
  /** Remind Claude to save a checkpoint when the active task has none for this long. */
  checkpointReminderMin: number;
  /** Used by the daily report to show how full the day is. */
  workdayHours: number;
}

export const DEFAULT_CONFIG: Config = {
  taskTypes: [
    "feature",
    "bug",
    "refactor",
    "research",
    "review",
    "meeting",
    "support",
    "docs",
    "devops",
  ],
  idleTimeoutMin: 15,
  maxTurnMin: 240,
  checkpointReminderMin: 45,
  workdayHours: 8,
};

/** Loads config.json merged over the defaults, creating it on first use so users can edit it. */
export function loadConfig(): Config {
  const stored = readJson<Partial<Config>>(paths.config());
  if (!stored) {
    writeJsonAtomic(paths.config(), DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  return { ...DEFAULT_CONFIG, ...stored };
}
