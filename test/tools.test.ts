import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { readContext, getTask } from "../src/store/tasks.js";
import { appendEntry } from "../src/store/time.js";
import { localDate } from "../src/time/dates.js";
import { useTempHome } from "./helpers.js";

useTempHome();

let client: Client;

beforeEach(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = result.content.map((c) => c.text).join("\n");
  if (result.isError) throw new Error(text);
  return text;
}

describe("task tools", () => {
  it("creates, plans, checkpoints and resumes a task", async () => {
    const created = await call("task_create", {
      title: "Add login",
      type: "Feature",
      externalRef: "store-42",
      project: "/repo",
      steps: [
        { text: "API", estimateMin: 60 },
        { text: "UI", estimateMin: 90 },
      ],
    });
    expect(created).toContain("STORE-42 · Add login");
    expect(created).toContain("<!-- task-pilot:bind=STORE-42 -->");
    expect(getTask("STORE-42")?.status).toBe("in_progress");

    await call("task_plan", {
      id: "STORE-42",
      update: [{ step: 1, status: "done" }],
      add: [{ text: "Tests" }],
    });
    await call("task_checkpoint", {
      id: "STORE-42",
      summary: "API ready, UI not started.",
      nextSteps: ["Build the form"],
      keyFiles: ["src/api/login.ts"],
    });
    expect(readContext("STORE-42")).toContain("- Build the form");

    const pack = await call("task_resume", { id: "store-42" });
    expect(pack).toContain("1/3 steps");
    expect(pack).toContain("est 2h 30m");
    expect(pack).toContain("- [x] 1. API");
    expect(pack).toContain("API ready, UI not started.");
    expect(pack).toContain("Step 1 done: API");
  });

  it("numbers tasks without a ticket and refuses duplicates", async () => {
    await call("task_create", { title: "One", type: "bug", start: false });
    await call("task_create", { title: "Two", type: "bug", start: false });
    expect(getTask("T-0002")?.title).toBe("Two");
    await expect(
      call("task_create", { title: "Again", type: "bug", id: "t-0001" }),
    ).rejects.toThrow("already exists");
  });

  it("lists open tasks and filters them", async () => {
    await call("task_create", { title: "Open bug", type: "bug", start: false });
    await call("task_create", { title: "Done feature", type: "feature", start: false });
    await call("task_update", { id: "T-0002", status: "done" });
    const open = await call("task_list", {});
    expect(open).toContain("Open bug");
    expect(open).not.toContain("Done feature");
    expect(await call("task_list", { status: "all", type: "feature" })).toContain("Done feature");
  });

  it("stops a task with a final status and the unbind marker", async () => {
    await call("task_create", { title: "Review PR", type: "review" });
    const out = await call("task_stop", { id: "T-0001", status: "review", note: "Waiting for CI" });
    expect(out).toContain("<!-- task-pilot:unbind -->");
    expect(getTask("T-0001")?.status).toBe("review");
  });

  it("reports tracked and adjusted time", async () => {
    await call("task_create", { title: "Fix crash", type: "bug", estimateMin: 60, start: false });
    const now = Date.now();
    const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
    appendEntry({
      kind: "hb",
      ts: iso(30),
      sessionId: "s",
      taskId: "T-0001",
      event: "UserPromptSubmit",
    });
    appendEntry({ kind: "hb", ts: iso(0), sessionId: "s", taskId: "T-0001", event: "Stop" });
    // Keep the test stable when it runs right after midnight.
    const day = localDate(new Date(now - 30 * 60_000));
    await call("time_adjust", { taskId: "T-0001", minutes: 15, date: day, note: "call with QA" });

    const report = await call("report", { from: day });
    expect(report).toContain("T-0001 · Fix crash");
    expect(report).toContain("45m");
    expect(report).toContain("| bug | 45m | 100% |");

    const csv = await call("report", { from: day, format: "csv" });
    expect(csv.split("\n")[1]).toBe(`${day},T-0001,Fix crash,bug,backlog,${process.cwd()},45`);
  });

  it("returns a readable error for unknown tasks", async () => {
    await expect(call("task_resume", { id: "NOPE-1" })).rejects.toThrow("not found");
  });
});
