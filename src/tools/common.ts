import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { z } from "zod";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool body and turns thrown errors into a tool error Claude can read and fix. */
export function guard<A>(fn: (args: A) => string): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return { content: [{ type: "text", text: fn(args) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  };
}

/** The folder Claude Code was started in: the MCP server inherits it as its working directory. */
export function currentProject(): string {
  return process.cwd();
}

export function currentBranch(dir: string): string | undefined {
  try {
    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

export const idSchema = z.string().min(1).describe("Task id, e.g. T-0003 or STORE-6042.");
export const minutesSchema = z.number().int().positive().max(100_000);
export const absolutePath = z.string().refine(isAbsolute, "must be an absolute path");
export const stepInput = z.object({
  text: z.string().min(1),
  estimateMin: minutesSchema.optional().describe("Estimated minutes for this step."),
});
