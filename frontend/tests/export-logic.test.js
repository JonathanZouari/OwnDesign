import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadName, exportBody, exportNote, FORMATS, needsPaper, versionLabel } from "../js/export-logic.js";

const versions = [
  { id: "v3", version_no: 3, label: "", author_role: "designer" },
  { id: "v2", version_no: 2, label: "Moved the kitchen", author_role: "client" },
];

test("three formats, and only PDF and PNG have a paper size", () => {
  assert.deepEqual(FORMATS.map((format) => format.id), ["pdf", "png", "dxf"]);
  assert.ok(needsPaper("pdf") && needsPaper("png"));
  assert.ok(!needsPaper("dxf"));
});

test("the request body carries the paper only where it applies", () => {
  assert.deepEqual(exportBody("pdf", "a3"), { format: "pdf", paper: "a3" });
  assert.deepEqual(exportBody("png", "a4"), { format: "png", paper: "a4" });
  assert.deepEqual(exportBody("dxf", "a3"), { format: "dxf" });
});

test("a version is named by number, author and note", () => {
  assert.equal(versionLabel(versions[0]), "v3 · designer · Untitled");
  assert.equal(versionLabel(versions[1]), "v2 · client · Moved the kitchen");
});

test("the note names the saved version and warns about unsaved changes", () => {
  assert.equal(exportNote(versions[1], false), "Exports saved version v2.");
  assert.equal(exportNote(versions[0], true), "Exports saved version v3. Unsaved changes on the canvas are not included.");
  assert.equal(exportNote(undefined, true), "");
});

test("the file name matches the server's: ASCII only, safe, with version and extension", () => {
  assert.equal(downloadName("Flat A", 2, "pdf"), "flat-a-v2.pdf");
  assert.equal(downloadName("  Dira ברחוב הרצל 5 ", 1, "dxf"), "dira-5-v1.dxf");
  assert.equal(downloadName("<script>alert(1)</script>", 3, "png"), "script-alert-1-script-v3.png");
  assert.equal(downloadName("דירה", 1, "pdf"), "plan-v1.pdf");
  assert.equal(downloadName("x".repeat(200), 1, "pdf"), `${"x".repeat(60)}-v1.pdf`);
});
