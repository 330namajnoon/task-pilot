import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import { registerProgressTools } from "./tools/progress.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerTimeTools } from "./tools/time.js";

const { version } = pkg;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "task-pilot", version },
    {
      instructions:
        "Persistent tasks across Claude Code sessions, with automatic time tracking. " +
        "When the user starts a piece of work, create a task (type, plan of steps, estimate) with task_create; " +
        "when they come back to one, load it with task_resume and continue from its checkpoint. " +
        "While working, mark steps with task_plan, log decisions and blockers with task_log, and save the exact state " +
        "with task_checkpoint after each step and before the session ends. " +
        "Time is tracked automatically on the session's active task; use report for daily/weekly summaries " +
        "and time_adjust only with amounts the user gives.",
    },
  );
  registerTaskTools(server);
  registerProgressTools(server);
  registerTimeTools(server);
  return server;
}
