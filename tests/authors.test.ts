import test from "node:test";
import assert from "node:assert/strict";
import { classifyRow, parseThreadMention, tellTarget, threadIdFromHref } from "../classify.ts";
import { planMarks } from "../authors.ts";
import { normalizeOptions } from "../options.ts";

const mention = JSON.stringify({ kind: "thread", threadId: "thr_fixture1", projectId: "proj_x", label: "Тестовый тред" });

test("A user-seed row is the owner's, an inbound message or a child line by structure", () => {
  const id = "thr_a:user-seed:7";
  assert.equal(classifyRow(id, "", "owner"), "user");
  assert.equal(classifyRow(id, "Message from Тестовый тред", "inbound"), "inbound");
  assert.equal(classifyRow(id, "UI assigned to you", "child"), "child");
  // An unknown non-owner seed must not pose as the owner's message.
  assert.equal(classifyRow(id, "?", "other"), null);
  // Without structural evidence the legacy id-only answer is kept.
  assert.equal(classifyRow(id, ""), "user");
});
test("A command row bb draws as 'Sent to <thread>' is an outgoing message", () => {
  const id = "thr_a:command:da71-i496";
  assert.equal(classifyRow(id, "Sent to Тестовый тред", "outgoing"), "tell");
  // Without the structural hint the text heuristic still applies.
  assert.equal(classifyRow(id, "Sent to Тестовый тред"), "run");
  assert.equal(classifyRow(id, "Ran bb thread tell thr_abc123 'x'"), "tell");
  // The hint never turns a non-command row into an outgoing message.
  assert.equal(classifyRow("thr_a:assistant:kind:assistant|turn:t1", "x", "outgoing"), "assistant");
});
test("Thread mention and link parsing accept only valid thread id syntax", () => {
  assert.equal(parseThreadMention(mention), "thr_fixture1");
  assert.equal(parseThreadMention(JSON.stringify({ kind: "project", threadId: "thr_a" })), null);
  assert.equal(parseThreadMention(JSON.stringify({ kind: "thread", threadId: "../etc" })), null);
  assert.equal(parseThreadMention("{broken"), null);
  assert.equal(parseThreadMention(null), null);
  assert.equal(threadIdFromHref("/projects/proj_a/threads/thr_fixture2"), "thr_fixture2");
  assert.equal(threadIdFromHref("/projects/proj_a/threads/thr_fixture2?x=1"), "thr_fixture2");
  assert.equal(threadIdFromHref("/settings"), null);
});
test("tellTarget reads only a literal id after bb thread tell", () => {
  assert.equal(tellTarget("Ran bb thread tell thr_fixture3 'ждёт'; sleep 1"), "thr_fixture3");
  assert.equal(tellTarget("bb thread tell --queue thr_abc123 'x'"), "thr_abc123");
  assert.equal(tellTarget("M='a'; bb thread tell $PARENT \"$M\""), null);
  assert.equal(tellTarget("echo thr_abc123 | bb thread tell \"$T\" hi"), null);
  assert.equal(tellTarget("bb thread show thr_abc123"), null);
});
test("Marks: agent speech shows the own thread, others show the related thread", () => {
  assert.deepEqual(planMarks("assistant", "thr_me", null), { agent: "thr_me", arrow: null });
  assert.deepEqual(planMarks("inbound", "thr_me", "thr_other"), { agent: "thr_other", arrow: "in" });
  assert.deepEqual(planMarks("tell", "thr_me", "thr_other"), { agent: "thr_other", arrow: "out" });
  assert.deepEqual(planMarks("tell", "thr_me", null), { agent: null, arrow: "out" });
  assert.deepEqual(planMarks("child", "thr_me", "thr_kid"), { agent: "thr_kid", arrow: null });
  assert.deepEqual(planMarks("user", "thr_me", null), { agent: null, arrow: null });
  assert.deepEqual(planMarks("run", "thr_me", null), { agent: null, arrow: null });
});
test("The author-marks option defaults to on and survives invalid input", () => {
  assert.equal(normalizeOptions(undefined).marks, true);
  assert.equal(normalizeOptions({ marks: false }).marks, false);
  assert.equal(normalizeOptions({ marks: "no" }).marks, true);
});
