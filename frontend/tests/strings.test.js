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
  for (const group of [strings.AUTH, strings.API_ERRORS, strings.EDITOR, strings.PANEL, strings.WIZARD, strings.IMPORT, strings.EDITOR_UNDERLAY, strings.WIZARD_IMPORT, strings.DESIGN, strings.CONSULTANT, strings.STUDIO.memberRoles]) {
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

test("design strings cover every surface and image kind", () => {
  assert.deepEqual(Object.keys(strings.DESIGN.surfaces).sort(), ["cabinets", "ceiling", "floor", "walls"]);
  assert.deepEqual(Object.keys(strings.DESIGN.imageKinds).sort(), ["existing_item", "inspiration"]);
});

test("consultant plan summary handles zero, one and many", () => {
  const { planSummary } = strings.CONSULTANT;
  assert.equal(planSummary(1, 1, 1), "גרסה 1 · חדר אחד · פריט ריהוט אחד");
  assert.equal(planSummary(3, 0, 0), "גרסה 3 · 0 חדרים · 0 פריטי ריהוט");
  assert.equal(planSummary(2, 4, 7), "גרסה 2 · 4 חדרים · 7 פריטי ריהוט");
});

test("statuses with their own meaning have Hebrew messages", () => {
  for (const status of [429, 502, 503]) assert.match(strings.CONSULTANT.errors[status], /[֐-׿]/);
  for (const status of [415, 429]) assert.ok(strings.API_ERRORS[status]);
});

test("both studio membership roles have a Hebrew label", () => {
  assert.deepEqual(Object.keys(strings.STUDIO.memberRoles).sort(), ["designer", "owner"]);
});
