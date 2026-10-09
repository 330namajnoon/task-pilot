import { describe, expect, it } from "vitest";
import { summarize, UNASSIGNED } from "../src/time/aggregate.js";
import { at, hb } from "./helpers.js";

const rules = { idleTimeoutMin: 15, maxTurnMin: 240 };
const DAY = "2026-10-09";

describe("summarize", () => {
  it("counts a long Claude turn but not a long idle gap", () => {
    const summary = summarize(
      [
        hb("09:00", "UserPromptSubmit", "T-1"),
        hb("09:40", "Stop", "T-1"), // Claude worked 40 min: counted
        hb("10:30", "UserPromptSubmit", "T-1"), // user away 50 min: idle
        hb("10:35", "Stop", "T-1"),
        hb("10:45", "UserPromptSubmit", "T-1"), // user read for 10 min: counted
        hb("10:50", "Stop", "T-1"),
      ],
      rules,
    );
    expect(summary.byTask.get("T-1")).toBe(40 + 5 + 10 + 5);
    expect(summary.byDay.get(DAY)?.totalMin).toBe(60);
  });

  it("assigns the time around a bind to the newly bound task", () => {
    const summary = summarize(
      [
        hb("09:00", "UserPromptSubmit", null),
        hb("09:02", "bind", "T-1"),
        hb("09:30", "Stop", "T-1"),
        hb("09:35", "UserPromptSubmit", "T-1"),
        hb("09:36", "unbind", null),
        hb("09:40", "Stop", null),
      ],
      rules,
    );
    expect(summary.byTask.get("T-1")).toBe(2 + 28 + 5 + 1);
    expect(summary.byTask.get(UNASSIGNED)).toBe(4);
  });

  it("does not count parallel sessions twice in the day total", () => {
    const summary = summarize(
      [
        hb("09:00", "UserPromptSubmit", "T-1", "a"),
        hb("10:00", "Stop", "T-1", "a"),
        hb("09:30", "UserPromptSubmit", "T-2", "b"),
        hb("10:30", "Stop", "T-2", "b"),
      ],
      rules,
    );
    expect(summary.byTask.get("T-1")).toBe(60);
    expect(summary.byTask.get("T-2")).toBe(60);
    expect(summary.totalMin).toBe(90);
  });

  it("applies manual adjustments in order", () => {
    const summary = summarize(
      [
        hb("09:00", "UserPromptSubmit", "T-1"),
        hb("09:30", "Stop", "T-1"),
        {
          kind: "adjust",
          ts: at("12:00").toISOString(),
          date: DAY,
          taskId: "T-1",
          minutes: 15,
          mode: "add",
        },
        {
          kind: "adjust",
          ts: at("12:01").toISOString(),
          date: DAY,
          taskId: "T-2",
          minutes: 60,
          mode: "set",
        },
        {
          kind: "adjust",
          ts: at("12:02").toISOString(),
          date: DAY,
          taskId: "T-1",
          minutes: -100,
          mode: "add",
        },
      ],
      rules,
    );
    expect(summary.byTask.get("T-1")).toBe(0);
    expect(summary.byTask.get("T-2")).toBe(60);
    expect(summary.totalMin).toBe(60);
  });

  it("restricts to the requested days and keeps intervals on the day they start", () => {
    const entries = [
      hb("23:50", "UserPromptSubmit", "T-1", "s1", "2026-10-08"),
      hb("00:10", "Stop", "T-1", "s1", DAY),
      hb("09:00", "UserPromptSubmit", "T-1", "s1", DAY),
      hb("09:10", "Stop", "T-1", "s1", DAY),
    ];
    expect(summarize(entries, rules, new Set([DAY])).byTask.get("T-1")).toBe(10);
    expect(summarize(entries, rules, new Set(["2026-10-08"])).byTask.get("T-1")).toBe(20);
  });
});
