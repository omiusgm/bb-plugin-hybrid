import test from "node:test";
import assert from "node:assert/strict";
import { answerPreview, isKnownTimelineTail, planAnswerFolding, planTimeline, turnId, type TimelineRow } from "../timeline.ts";

const row = (id: string, owner = false): TimelineRow => ({ id, owner });
const assistant = (turn: string, suffix = "answer") => row(`thread:message:${suffix}|turn:${turn}|kind:assistant`);
const reasoning = (turn: string) => row(`thread:message:thought|turn:${turn}|kind:reasoning`);
const user = (suffix: string, owner = true) => row(`thread:user-seed:${suffix}`, owner);
const indices = (value: Set<number>) => [...value];

test("Turn ids come from native metadata, including summaries without turn:", () => {
  assert.equal(turnId("thread:message:one|turn:turn-A|kind:assistant"), "turn-A");
  assert.equal(turnId("thread:turn:turn-B:op:reasoning:one"), "turn-B");
  assert.equal(turnId("thread:turn-C:work-summary:thread:command:one"), "turn-C");
  assert.equal(turnId("thread:command:one"), null);
});

test("Only the last assistant message of each completed turn is an answer", () => {
  const plan = planTimeline([
    user("one"), assistant("A", "progress"), reasoning("A"),
    assistant("A", "answer"), row("thread:command:after-answer"),
  ], true);
  assert.deepEqual(indices(plan.final), [3]);
  assert.deepEqual(indices(plan.quiet), [2, 4]);
  assert.equal(plan.final.has(1), false);
});

test("A busy current turn keeps prose and work fully visible", () => {
  const plan = planTimeline([
    user("one"), reasoning("A"), row("thread:command:running"), assistant("A", "progress"),
  ], false);
  assert.deepEqual(indices(plan.final), []);
  assert.deepEqual(indices(plan.quiet), []);
});

test("An older turn is completed while a newer turn remains busy", () => {
  const plan = planTimeline([
    user("one"), reasoning("A"), assistant("A"),
    user("two"), reasoning("B"), row("thread:command:running"), assistant("B", "progress"),
  ], false);
  assert.deepEqual(indices(plan.final), [2]);
  assert.deepEqual(indices(plan.quiet), [1]);
});

test("A summary's embedded child metadata cannot choose another turn or become the answer", () => {
  const plan = planTimeline([
    assistant("A"),
    row("thread:A:work-summary:thread:message:one|turn:A|kind:assistant"),
    row("thread:A:work-summary:thread:command:one"),
    user("two"), reasoning("B"),
  ], false);
  assert.deepEqual(indices(plan.final), [0]);
  assert.deepEqual(indices(plan.quiet), [1, 2]);
});

test("Commands without turn ids inherit a known single-turn context", () => {
  const plan = planTimeline([
    user("one"), row("thread:command:first"), reasoning("A"),
    row("thread:file-read:one"), row("thread:file-edit:two"),
    row("thread:file-change:three"), row("thread:tool:four"), assistant("A"),
  ], true);
  assert.deepEqual(indices(plan.final), [7]);
  assert.deepEqual(indices(plan.quiet), [1, 2, 3, 4, 5, 6]);
});

test("A user boundary prevents commands in a new busy turn from inheriting a completed turn", () => {
  const plan = planTimeline([
    reasoning("A"), assistant("A"), user("two"), row("thread:command:new"), reasoning("B"),
  ], false);
  assert.deepEqual(indices(plan.final), [1]);
  assert.deepEqual(indices(plan.quiet), [0]);
});

test("Work between different explicit turns without a user boundary remains ambiguous", () => {
  const plan = planTimeline([
    reasoning("A"), assistant("A"), row("thread:command:new"), reasoning("B"), assistant("B", "progress"),
  ], false);
  assert.deepEqual(indices(plan.final), [1]);
  assert.deepEqual(indices(plan.quiet), [0]);
});

test("Unknown or clipped tail does not turn the visible last assistant into a final answer", () => {
  // false represents both a busy native composer and an unproven virtualized tail.
  const plan = planTimeline([row("thread:command:clipped-start"), assistant("A", "progress")], false);
  assert.deepEqual(indices(plan.final), []);
  assert.deepEqual(indices(plan.quiet), []);
});

test("Clipping the start does not prevent a proven completed visible turn", () => {
  const plan = planTimeline([row("thread:command:clipped-start"), reasoning("A"), assistant("A")], true);
  assert.deepEqual(indices(plan.final), [2]);
  assert.deepEqual(indices(plan.quiet), [0, 1]);
});

test("A read marker follows the latest owner message, not an agent's user-like event", () => {
  const plan = planTimeline([
    user("owner-one"), assistant("A"), user("external", false),
    assistant("B"), user("owner-two"), reasoning("C"),
  ], false);
  assert.equal(plan.readFrom, 5);
  assert.equal(planTimeline([user("owner-one"), assistant("A"), user("external", false), assistant("B")], false).readFrom, 1);
});

test("A clipped owner message or an owner at the tail cannot invent a read marker", () => {
  assert.equal(planTimeline([reasoning("A"), assistant("A")], true).readFrom, null);
  assert.equal(planTimeline([assistant("A"), user("last")], true).readFrom, null);
  assert.deepEqual(indices(planTimeline([], false).final), []);
});


test("Only earlier proven answers can fold; the newest final stays expanded", () => {
  const plan = planTimeline([
    user("one"), assistant("A"), user("two"), assistant("B"),
    user("three"), assistant("C"),
  ], true);
  assert.deepEqual(indices(plan.final), [1, 3, 5]);
  assert.deepEqual(indices(plan.foldable), [1, 3]);
});

test("The latest completed answer stays expanded while the next turn is running", () => {
  const plan = planTimeline([
    assistant("A"), assistant("B"), user("three"), reasoning("C"), assistant("C", "progress"),
  ], false, true);
  assert.deepEqual(indices(plan.final), [0, 1]);
  assert.deepEqual(indices(plan.foldable), [0]);
  assert.deepEqual(indices(plan.current), [4]);
});

test("Current labels need a proven busy composer and full tail", () => {
  const input = [reasoning("A"), assistant("A", "first"), assistant("A", "latest")];
  assert.deepEqual(indices(planTimeline(input, false, true).current), [2]);
  assert.deepEqual(indices(planTimeline(input, false).current), []);
  assert.deepEqual(indices(planTimeline(input, true, true).current), []);
  assert.deepEqual(indices(planTimeline(input, false, true).foldable), []);
});

test("A new owner boundary without turn metadata cannot mark the previous answer current", () => {
  const plan = planTimeline([assistant("A"), user("two"), row("thread:command:starting")], false, true);
  assert.deepEqual(indices(plan.current), []);
});

test("Owner rows cannot become final, current, quiet or foldable even with assistant metadata", () => {
  const plan = planTimeline([
    { ...assistant("A"), owner: true }, assistant("B"),
    { ...assistant("C"), owner: true },
  ], false, true);
  for (const state of [plan.final, plan.current, plan.quiet, plan.foldable]) {
    assert.equal(state.has(0), false);
    assert.equal(state.has(2), false);
  }
});

test("Native collapsed turn rows inherit only their explicit turn identity", () => {
  assert.equal(turnId("thread:A:turn"), "A");
  assert.equal(turnId("thread:A:turn:0"), "A");
  assert.equal(turnId("thread:A:turn:12"), "A");
  assert.equal(turnId("thread:A:turn:anything"), "anything");
  const plan = planTimeline([
    row("thread:A:turn:0"), assistant("A"), user("two"), row("thread:B:turn:1"), assistant("B"),
  ], true);
  assert.deepEqual(indices(plan.quiet), [0, 3]);
  assert.deepEqual(indices(plan.final), [1, 4]);
});

test("Answer previews normalize whitespace and preserve Unicode characters", () => {
  assert.equal(answerPreview("  Первая\n\tстрока  "), "Первая строка");
  assert.equal(answerPreview("Я".repeat(71)), "Я".repeat(70) + "…");
  assert.equal(answerPreview("🙂".repeat(71)), "🙂".repeat(70) + "…");
  assert.equal(answerPreview(""), "");
});


test("Remembered newest final keeps older visible answers foldable after scrolling up", () => {
  const complete = [assistant("A"), assistant("B"), assistant("C")];
  const initial = planAnswerFolding(complete, new Set([0, 1, 2]), null, true);
  assert.equal(initial.latestFinal, complete[2].id);
  assert.deepEqual(indices(initial.foldable), [0, 1]);
  const clipped = complete.slice(0, 2);
  const scrolled = planAnswerFolding(clipped, new Set([0, 1]), initial.latestFinal, false);
  assert.equal(scrolled.latestFinal, complete[2].id);
  assert.deepEqual(indices(scrolled.foldable), [0, 1]);
});

test("A full tail updates the newest final and keeps it expanded after remount", () => {
  const input = [assistant("A"), assistant("B"), assistant("C")];
  const updated = planAnswerFolding(input, new Set([0, 1, 2]), input[1].id, true);
  assert.equal(updated.latestFinal, input[2].id);
  assert.deepEqual(indices(updated.foldable), [0, 1]);
  const remounted = planAnswerFolding(input, new Set([0, 1, 2]), updated.latestFinal, false);
  assert.deepEqual(indices(remounted.foldable), [0, 1]);
});

test("The first clipped viewport uses the safe visible fallback without remembering it", () => {
  const input = [assistant("A"), assistant("B")];
  const first = planAnswerFolding(input, new Set([0, 1]), null, false);
  assert.equal(first.latestFinal, null);
  assert.deepEqual(indices(first.foldable), [0]);
  assert.equal(planAnswerFolding([], new Set(), input[1].id, true).latestFinal, input[1].id);
});


test("A leading spacer permits a known tail; trailing or internal gaps do not", () => {
  const row = { row: true, spacerHeight: 0 };
  const gap = { row: false, spacerHeight: 842 };
  const empty = { row: false, spacerHeight: 0 };
  assert.equal(isKnownTimelineTail([gap, row, row]), true);
  assert.equal(isKnownTimelineTail([row, empty, row]), true);
  assert.equal(isKnownTimelineTail([row, row, gap]), false);
  // BB can pin the running work-summary below an internal virtualized gap.
  assert.equal(isKnownTimelineTail([row, gap, row]), false);
  assert.equal(isKnownTimelineTail([gap, row, gap, row]), false);
  assert.equal(isKnownTimelineTail([gap]), false);
  assert.equal(isKnownTimelineTail([]), false);
});
