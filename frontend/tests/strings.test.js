import assert from "node:assert/strict";
import { test } from "node:test";
import * as strings from "../js/strings.js";

// Walks every exported value: strings must be non-empty, functions must return a non-empty string.
function check(value, path) {
  if (typeof value === "string") return assert.ok(value.trim().length > 0, `${path} is empty`);
  if (typeof value === "function") return assert.ok(String(value("x", "y", "z")).trim().length > 0, `${path}() returned nothing`);
  if (Array.isArray(value)) return value.forEach((item, i) => check(item, `${path}[${i}]`));
  assert.equal(typeof value, "object", `${path} has an unexpected type`);
  for (const [key, inner] of Object.entries(value)) check(inner, `${path}.${key}`);
}

test("every exported string is non-empty", () => {
  for (const [name, value] of Object.entries(strings)) check(value, name);
});

test("user-facing strings are Hebrew, not leftover English", () => {
  for (const group of [strings.AUTH, strings.API_ERRORS, strings.EDITOR, strings.PANEL, strings.WIZARD, strings.IMPORT, strings.EDITOR_UNDERLAY, strings.WIZARD_IMPORT]) {
    const leaves = [];
    (function walk(v) {
      if (typeof v === "string") leaves.push(v);
      else if (typeof v === "function") leaves.push(String(v("x", "y", "z")));
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    })(group);
    for (const text of leaves) assert.match(text, /[֐-׿]/, `"${text}" has no Hebrew`);
  }
});

test("API errors cover the statuses the plan names", () => {
  for (const status of [401, 403, 404, 409, 413, 422]) assert.ok(strings.API_ERRORS[status]);
});

test("room kinds: unique names, known types", () => {
  const types = new Set(Object.keys(strings.ROOM_TYPE_LABELS));
  const names = strings.ROOM_KINDS.map((k) => k.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 16);
  for (const k of strings.ROOM_KINDS) assert.ok(types.has(k.type), `${k.name} has unknown type ${k.type}`);
  for (const t of types) assert.ok(strings.ROOM_KINDS.some((k) => k.type === t), `no kind for type ${t}`);
});
