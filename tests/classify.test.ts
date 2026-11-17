import test from "node:test";
import assert from "node:assert/strict";
import { classifyRow, classifyCommand, classifyState, isHybridPalette } from "../classify.ts";
import { normalizeOptions, defaults } from "../options.ts";

test("Only the six declared palette markers activate the layout", () => {
  for (const id of ["grafit", "terrakota", "sosna", "indigo", "pergament", "nuar"]) assert.equal(isHybridPalette(id), true);
  for (const id of ["", "dracula", "hybrid", "grafit extra", "\"grafit\""]) assert.equal(isHybridPalette(id), false);
});
test("Summary identifiers cannot inherit the type of their first child", () => {
  assert.equal(classifyRow("t:work-summary:t:command:1", "bb thread spawn"), "summary");
  assert.equal(classifyRow("t:work-summary:t:op:reasoning:1", "Thought"), "summary");
  assert.equal(classifyRow("t:unknown", "bb thread spawn"), null);
});
test("Command text has an explicit priority and a harmless fallback", () => {
  assert.equal(classifyCommand("bb thread spawn p --prompt 'git status'"), "delegate");
  assert.equal(classifyCommand("bb thread tell t hello"), "tell");
  assert.equal(classifyCommand("bb todo-dock goal set title"), "task");
  assert.equal(classifyCommand("bb task list"), "task");
  assert.equal(classifyCommand("git status"), "git");
  assert.equal(classifyCommand("python script.py"), "run");
});
test("Semantic row ids preserve reasoning, read, edits, warning, error", () => {
  for (const [id, expected] of [
    [":user-seed:1", "user"], ["kind:assistant", "assistant"],
    ["kind:reasoning", "think"], ["op:reasoning", "think"],
    [":file-read:", "read"], [":file-edit:", "edit"], [":file-change:", "edit"],
    [":tool:", "net"], ["op:warning", "attention"], [":error:", "error"],
  ]) assert.equal(classifyRow(id, ""), expected);
});
test("A command mentioning an error is not itself a failed command", () => {
  assert.equal(classifyState("Ran echo error", "run"), "done");
  assert.equal(classifyState("Running command", "run"), "running");
  assert.equal(classifyState("Failed command", "run"), "error");
  assert.equal(classifyState("Waiting", "run"), "waiting");
  assert.equal(classifyState("Thought", "think"), "unknown");
  assert.equal(classifyState("Thought", "think", true), "running");
  assert.equal(classifyState("Выполняется команда", "run"), "running");
  assert.equal(classifyState("Ошибка: команда", "run"), "error");
  assert.equal(classifyState("Прочитано file.ts", "read"), "done");
});
test("Corrupt options cannot enable unsupported sticky UI", () => {
  assert.deepEqual(normalizeOptions(null), defaults);
  assert.deepEqual(normalizeOptions({ colorcode: "false", density: "evil", sticky: true }), defaults);
  assert.equal(normalizeOptions({ colorcode: false, density: "compact" }).colorcode, false);
});


test("Past-answer folding is opt-in for both old and corrupt stored settings", () => {
  assert.equal(defaults.collapseAnswers, false);
  assert.equal(normalizeOptions({}).collapseAnswers, false);
  assert.equal(normalizeOptions({ collapseAnswers: "true" }).collapseAnswers, false);
  assert.equal(normalizeOptions({ collapseAnswers: true }).collapseAnswers, true);
  assert.equal(normalizeOptions({ collapseAnswers: false }).collapseAnswers, false);
});

test("Native collapsed turns use the summary style without classifying arbitrary rows", () => {
  assert.equal(classifyRow("thread:A:turn", "Worked for 34s"), "summary");
  assert.equal(classifyRow("thread:A:turn:0", "Worked for 34s"), "summary");
  assert.equal(classifyRow("thread:A:turn:12", "Worked for 34s"), "summary");
  assert.equal(classifyRow("thread:A:turn:unknown", "Worked for 34s"), null);
  assert.equal(classifyState("Worked for 34s", "summary"), "done");
});
