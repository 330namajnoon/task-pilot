#!/usr/bin/env node
import { handleHook, type HookInput } from "./hooks/handle.js";

/** Entry point of every hook. It must never break the user's session: any error is swallowed. */
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as HookInput;
  const output = handleHook(input);
  if (output) process.stdout.write(output);
}

main()
  .catch((error: unknown) => {
    console.error("task-pilot hook error:", error);
  })
  .finally(() => process.exit(0));
