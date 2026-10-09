import { describe, expect, it } from "vitest";
import { handleHook } from "../src/hooks/handle.js";
import { getSession } from "../src/store/sessions.js";
import { createTask } from "../src/store/tasks.js";
import { readDays } from "../src/store/time.js";
import { at, useTempHome } from "./helpers.js";

useTempHome();

const DAY = "2026-10-09";
const context = (output: string | undefined) =>
  (JSON.parse(output!) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext;

describe("handleHook", () => {
  it("binds the session when a task tool returns the bind marker", () => {
    handleHook(
      { session_id: "s1", hook_event_name: "UserPromptSubmit", cwd: "/repo" },
      at("09:00"),
    );
    handleHook(
      {
        session_id: "s1",
        hook_event_name: "PostToolUse",
        tool_name: "mcp__plugin_task-pilot_task-pilot__task_resume",
        tool_response: [{ type: "text", text: "...\n<!-- task-pilot:bind=t-0001 -->" }],
      },
      at("09:01"),
    );
    handleHook({ session_id: "s1", hook_event_name: "Stop" }, at("09:20"));

    expect(getSession("s1")?.taskId).toBe("T-0001");
    const beats = readDays([DAY]).map((e) => (e.kind === "hb" ? [e.event, e.taskId] : []));
    expect(beats).toEqual([
      ["UserPromptSubmit", null],
      ["bind", "T-0001"],
      ["Stop", "T-0001"],
    ]);
  });

  it("ignores tool results without a marker", () => {
    const out = handleHook({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      tool_response: "ok",
    });
    expect(out).toBeUndefined();
    expect(readDays([DAY])).toEqual([]);
  });

  it("lists the open tasks of the project at session start", () => {
    createTask({ title: "Fix login", type: "bug", project: "/repo" });
    createTask({ title: "Elsewhere", type: "feature", project: "/other" });
    const text = context(
      handleHook({ session_id: "s2", hook_event_name: "SessionStart", cwd: "/repo/src" }),
    );
    expect(text).toContain("Fix login");
    expect(text).not.toContain("Elsewhere");
  });

  it("re-injects the active task after a compaction", () => {
    const task = createTask({
      title: "Fix login",
      type: "bug",
      project: "/repo",
      steps: [{ text: "Reproduce" }],
    });
    handleHook({
      session_id: "s3",
      hook_event_name: "PostToolUse",
      tool_response: `<!-- task-pilot:bind=${task.id} -->`,
    });
    const text = context(
      handleHook({ session_id: "s3", hook_event_name: "SessionStart", source: "compact" }),
    );
    expect(text).toContain(`working on task ${task.id}`);
    expect(text).toContain("Reproduce");
  });

  it("reminds to checkpoint once the threshold has passed, then waits again", () => {
    const task = createTask({ title: "Long one", type: "feature" });
    handleHook(
      {
        session_id: "s4",
        hook_event_name: "PostToolUse",
        tool_response: `<!-- task-pilot:bind=${task.id} -->`,
      },
      at("09:00"),
    );
    expect(
      handleHook({ session_id: "s4", hook_event_name: "UserPromptSubmit" }, at("09:30")),
    ).toBeUndefined();
    expect(
      context(handleHook({ session_id: "s4", hook_event_name: "UserPromptSubmit" }, at("09:50"))),
    ).toContain("no checkpoint");
    expect(
      handleHook({ session_id: "s4", hook_event_name: "UserPromptSubmit" }, at("10:00")),
    ).toBeUndefined();
  });
});
