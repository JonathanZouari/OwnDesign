import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";

// Loads the vendored pdf.js under Node. If it needs browser globals it is skipped (the browser E2E covers it).
test("vendored pdf.js imports and exposes the API the reader uses", async (t) => {
  const dir = readdirSync(new URL("../vendor/", import.meta.url)).find((d) => d.startsWith("pdfjs-"));
  assert.ok(dir, "vendor/pdfjs-* exists");
  let lib;
  try {
    lib = await import(new URL(`../vendor/${dir}/pdf.min.mjs`, import.meta.url));
  } catch (error) {
    t.skip(`needs a browser environment: ${error.message}`);
    return;
  }
  assert.equal(typeof lib.getDocument, "function");
  assert.equal(typeof lib.OPS.constructPath, "number");
  assert.ok(lib.version);
});
