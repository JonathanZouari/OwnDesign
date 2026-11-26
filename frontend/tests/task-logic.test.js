import assert from "node:assert/strict";
import { test } from "node:test";

import { actionsFor, introFor, openCounts, splitTasks, taskFormState, tasksLabel } from "../js/task-logic.js";

test("splitTasks separates open and done, newest first", () => {
  const tasks = [
    { id: "a", status: "open", created_at: "2026-11-01T00:00:00Z" },
    { id: "b", status: "done", created_at: "2026-11-02T00:00:00Z" },
    { id: "c", status: "open", created_at: "2026-11-03T00:00:00Z" },
    { id: "d", status: "weird", created_at: "2026-11-04T00:00:00Z" },
    null,
  ];
  const { open, done } = splitTasks(tasks);
  assert.deepEqual(open.map((t) => t.id), ["c", "a"]);
  assert.deepEqual(done.map((t) => t.id), ["b"]);
});

test("splitTasks handles empty and malformed input", () => {
  assert.deepEqual(splitTasks([]), { open: [], done: [] });
  assert.deepEqual(splitTasks(undefined), { open: [], done: [] });
  assert.deepEqual(splitTasks({ not: "a list" }), { open: [], done: [] });
});

test("actionsFor mirrors the API's role rules", () => {
  assert.deepEqual(actionsFor("client", "open"), ["complete"]);
  assert.deepEqual(actionsFor("client", "done"), ["undo"]);
  assert.deepEqual(actionsFor("designer", "open"), ["delete"]);
  assert.deepEqual(actionsFor("designer", "done"), ["reopen", "delete"]);
  assert.deepEqual(actionsFor("stranger", "open"), []);
  assert.deepEqual(actionsFor("client", "unknown"), []);
  assert.deepEqual(actionsFor(undefined, undefined), []);
});

test("taskFormState trims and enforces 1 to 120 characters", () => {
  assert.equal(taskFormState("").ok, false);
  assert.equal(taskFormState("   ").ok, false);
  assert.equal(taskFormState(null).ok, false);
  assert.deepEqual(taskFormState(" x ").body, { title: "x", details: "" });
  assert.equal(taskFormState("x".repeat(120)).ok, true);
  assert.equal(taskFormState("x".repeat(121)).ok, false);
  assert.equal(taskFormState("ok", "d".repeat(1000)).ok, true);
  assert.equal(taskFormState("ok", "d".repeat(1001)).ok, false);
  assert.equal(taskFormState("<b>x</b>").body.title, "<b>x</b>"); // text, rendered with textContent
});

test("openCounts counts the inbox per project", () => {
  const counts = openCounts([{ project_id: "p1" }, { project_id: "p2" }, { project_id: "p1" }, {}, null]);
  assert.equal(counts.get("p1"), 2);
  assert.equal(counts.get("p2"), 1);
  assert.equal(counts.get("p3"), undefined);
  assert.equal(openCounts(undefined).size, 0);
});

test("tasksLabel and introFor", () => {
  assert.equal(tasksLabel(0), "Tasks");
  assert.equal(tasksLabel(undefined), "Tasks");
  assert.equal(tasksLabel(3), "Tasks (3 open)");
  assert.match(introFor("designer"), /Ask your client/);
  assert.match(introFor("client"), /Mark each one done/);
});
