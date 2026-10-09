import { readJson, writeJsonAtomic } from "./fs.js";
import { paths } from "./paths.js";

/** Which task a Claude Code session is working on. Written by the hooks, which know the session id. */
export interface SessionBinding {
  sessionId: string;
  taskId: string | null;
  cwd?: string;
  boundAt: string;
  lastReminderAt?: string;
}

export function getSession(sessionId: string): SessionBinding | undefined {
  return readJson<SessionBinding>(paths.sessionFile(sessionId));
}

export function saveSession(binding: SessionBinding): void {
  writeJsonAtomic(paths.sessionFile(binding.sessionId), binding);
}
