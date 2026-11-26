import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS, isAllowed, toolsFor } from "../js/editor/tools.js";

const ids = (tools) => tools.map((tool) => tool.id);

test("every tool is offered on a large screen, in rail order", () => {
  assert.deepEqual(ids(toolsFor(false)), ["select", "exterior", "partition", "door", "window", "furniture"]);
  assert.deepEqual(toolsFor(false), TOOLS);
});

test("a phone offers select and furniture only", () => {
  assert.deepEqual(ids(toolsFor(true)), ["select", "furniture"]);
});

test("every tool has a unique shortcut key and a label", () => {
  const keys = TOOLS.map((tool) => tool.key.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  for (const tool of TOOLS) assert.ok(tool.label && tool.icon);
});

test("drawing tools are refused on a phone and allowed elsewhere", () => {
  for (const tool of ["exterior", "partition", "door", "window"]) {
    assert.equal(isAllowed(tool, true), false, tool);
    assert.equal(isAllowed(tool, false), true, tool);
  }
});

test("select, the catalog and placing a catalog item are allowed on a phone", () => {
  for (const tool of ["select", "furniture", "furniture:sofa", "furniture:bed-double"]) assert.equal(isAllowed(tool, true), true, tool);
});

test("unknown, empty and malformed tool names are refused", () => {
  for (const tool of ["", "wall", "SELECT", "furniture:", "furniturex", undefined, null, 3, {}]) {
    assert.equal(isAllowed(tool, false), false, String(tool));
    assert.equal(isAllowed(tool, true), false, String(tool));
  }
});

test("the returned list is a copy, so callers cannot change the tool set", () => {
  toolsFor(true).push({ id: "exterior" });
  assert.deepEqual(ids(toolsFor(true)), ["select", "furniture"]);
});
