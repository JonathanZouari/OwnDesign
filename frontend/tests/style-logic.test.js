import assert from "node:assert/strict";
import { test } from "node:test";
import * as S from "../js/style-logic.js";

const PALETTE = [
  { hex: "#d8c8b0", name: "beige", share: 0.45 },
  { hex: "#2F3A2E", name: "dark green", share: 0.35 },
  { hex: "#ffffff", name: "white", share: 0.2 },
];
const eight = Array.from({ length: 8 }, (_, i) => `#00000${i}`);

// ---- paletteToBriefColors ------------------------------------------------------------------------

test("paletteToBriefColors adds new colours in lower case and keeps the brief's order", () => {
  const { colors, added, skipped } = S.paletteToBriefColors(["#111111"], PALETTE);
  assert.deepEqual(colors, ["#111111", "#d8c8b0", "#2f3a2e", "#ffffff"]);
  assert.deepEqual(added, ["#d8c8b0", "#2f3a2e", "#ffffff"]);
  assert.deepEqual(skipped, []);
});

test("paletteToBriefColors skips a colour already in the brief in another case", () => {
  const { colors, added, skipped } = S.paletteToBriefColors(["#2f3a2e"], PALETTE);
  assert.deepEqual(colors, ["#2f3a2e", "#d8c8b0", "#ffffff"]);
  assert.deepEqual(added, ["#d8c8b0", "#ffffff"]);
  assert.deepEqual(skipped, ["#2F3A2E"]);
});

test("paletteToBriefColors skips invalid hex values", () => {
  const palette = [{ hex: "red; background:url(x)", name: "x", share: 0.5 }, { hex: "#abc", share: 0.2 }, { hex: null }, {}, null, { hex: "#123456", share: 0.3 }];
  const { colors, added, skipped } = S.paletteToBriefColors([], palette);
  assert.deepEqual(colors, ["#123456"]);
  assert.deepEqual(added, ["#123456"]);
  assert.equal(skipped.length, 5);
});

test("paletteToBriefColors stops at eight colours", () => {
  const full = S.paletteToBriefColors(eight, PALETTE);
  assert.deepEqual(full.colors, eight);
  assert.deepEqual(full.added, []);
  assert.equal(full.skipped.length, 3);

  const seven = eight.slice(0, 7);
  const one = S.paletteToBriefColors(seven, PALETTE);
  assert.equal(one.colors.length, 8);
  assert.deepEqual(one.added, ["#d8c8b0"]);
  assert.deepEqual(one.skipped, ["#2F3A2E", "#ffffff"]);
});

test("paletteToBriefColors honours a smaller maximum", () => {
  assert.deepEqual(S.paletteToBriefColors([], PALETTE, 2).added, ["#d8c8b0", "#2f3a2e"]);
});

test("paletteToBriefColors handles an empty or missing palette and brief", () => {
  assert.deepEqual(S.paletteToBriefColors([], []), { colors: [], added: [], skipped: [] });
  assert.deepEqual(S.paletteToBriefColors(null, null), { colors: [], added: [], skipped: [] });
  const brief = ["#111111"];
  assert.deepEqual(S.paletteToBriefColors(brief, undefined).colors, brief);
});

test("paletteToBriefColors adds a colour repeated in the palette once", () => {
  const { added, skipped } = S.paletteToBriefColors([], [{ hex: "#AAAAAA" }, { hex: "#aaaaaa" }]);
  assert.deepEqual(added, ["#aaaaaa"]);
  assert.deepEqual(skipped, ["#aaaaaa"]);
});

test("paletteToBriefColors does not change its inputs", () => {
  const brief = ["#111111"];
  S.paletteToBriefColors(brief, PALETTE);
  assert.deepEqual(brief, ["#111111"]);
});

// ---- styleButton -----------------------------------------------------------------------------------

test("styleButton counts the colours that would really be added", () => {
  assert.deepEqual(S.styleButton([], PALETTE), { count: 3, disabled: false, text: "Add 3 colours to the brief" });
  assert.deepEqual(S.styleButton(["#d8c8b0", "#2f3a2e"], PALETTE), { count: 1, disabled: false, text: "Add 1 colour to the brief" });
});

test("styleButton is disabled when the palette is already in the brief", () => {
  assert.deepEqual(S.styleButton(["#D8C8B0", "#2f3a2e", "#ffffff"], PALETTE), { count: 0, disabled: true, text: "Palette already in the brief" });
});

test("styleButton is disabled when the brief is full", () => {
  assert.deepEqual(S.styleButton(eight, PALETTE), { count: 0, disabled: true, text: "The brief has 8 colours" });
});

test("styleButton is disabled with no palette", () => {
  assert.deepEqual(S.styleButton([], []), { count: 0, disabled: true, text: "No colours to add" });
  assert.deepEqual(S.styleButton([], null), { count: 0, disabled: true, text: "No colours to add" });
});

test("addedMessage names the number of colours", () => {
  assert.equal(S.addedMessage(3), "Added 3 colours to the brief.");
  assert.equal(S.addedMessage(1), "Added 1 colour to the brief.");
});

// ---- profileSentences ------------------------------------------------------------------------------

test("profileSentences describes each category against the analysed images", () => {
  const profile = {
    analysed: 4,
    total: 5,
    palette: [],
    categories: [
      { category: "seating", images: 3, objects: 5 },
      { category: "plants", images: 1, objects: 1 },
    ],
  };
  assert.deepEqual(S.profileSentences(profile), ["Seating in 3 of 4 images", "Plants in 1 of 4 images"]);
});

test("profileSentences uses the singular for one analysed image", () => {
  const profile = { analysed: 1, total: 1, palette: [], categories: [{ category: "tables", images: 1, objects: 2 }] };
  assert.deepEqual(S.profileSentences(profile), ["Tables in 1 of 1 image"]);
});

test("profileSentences returns nothing for an empty or missing profile", () => {
  assert.deepEqual(S.profileSentences(null), []);
  assert.deepEqual(S.profileSentences(undefined), []);
  assert.deepEqual(S.profileSentences({ analysed: 0, total: 0, palette: [], categories: [] }), []);
  assert.deepEqual(S.profileSentences({ analysed: 2, total: 2 }), []);
});

test("profileSentences skips malformed categories", () => {
  const profile = { analysed: 2, total: 2, categories: [{ category: "", images: 1 }, { images: 1 }, null, { category: "decor", images: 2 }] };
  assert.deepEqual(S.profileSentences(profile), ["Decor in 2 of 2 images"]);
});

// ---- analysisSummary -------------------------------------------------------------------------------

test("analysisSummary counts objects by category, most first", () => {
  const analysis = {
    objects: [
      { label: "chair", category: "seating", confidence: 0.9 },
      { label: "potted plant", category: "plants", confidence: 0.8 },
      { label: "couch", category: "seating", confidence: 0.7 },
    ],
    palette: PALETTE,
  };
  assert.equal(S.analysisSummary(analysis), "2 seating · 1 plants");
});

test("analysisSummary keeps first-seen order for equal counts", () => {
  const analysis = { objects: [{ category: "tables" }, { category: "decor" }] };
  assert.equal(S.analysisSummary(analysis), "1 tables · 1 decor");
});

test("analysisSummary says when nothing was found", () => {
  assert.equal(S.analysisSummary({ objects: [], palette: PALETTE }), "No furniture found");
  assert.equal(S.analysisSummary({ palette: PALETTE }), "No furniture found");
});

test("analysisSummary is empty without an analysis", () => {
  assert.equal(S.analysisSummary(null), "");
  assert.equal(S.analysisSummary(undefined), "");
});

test("analysisSummary files objects without a category under other", () => {
  assert.equal(S.analysisSummary({ objects: [{ label: "x" }, null] }), "1 other");
});

// ---- percent ---------------------------------------------------------------------------------------

test("percent rounds a share to a whole percentage", () => {
  assert.equal(S.percent(0.45), "45%");
  assert.equal(S.percent(0.333), "33%");
  assert.equal(S.percent(1), "100%");
  assert.equal(S.percent(0), "0%");
});

test("percent clamps and tolerates bad input", () => {
  assert.equal(S.percent(1.5), "100%");
  assert.equal(S.percent(-0.2), "0%");
  assert.equal(S.percent(null), "0%");
  assert.equal(S.percent("abc"), "0%");
  assert.equal(S.percent(Number.NaN), "0%");
});

// ---- swatchLabel -----------------------------------------------------------------------------------

test("swatchLabel gives a colour an accessible name", () => {
  assert.equal(S.swatchLabel({ hex: "#d8c8b0", name: "beige", share: 0.45 }), "beige, 45%");
  assert.equal(S.swatchLabel({ hex: "#d8c8b0", share: 0.45 }), "#d8c8b0, 45%");
  assert.equal(S.swatchLabel({ hex: "#d8c8b0", name: "beige", share: 0.45, images: 3 }), "beige, 45%, in 3 images");
  assert.equal(S.swatchLabel({ hex: "#d8c8b0", name: "beige", share: 0.45, images: 1 }), "beige, 45%, in 1 image");
});

test("imagesText uses the singular for one image", () => {
  assert.equal(S.imagesText(1), "in 1 image");
  assert.equal(S.imagesText(4), "in 4 images");
});

// ---- basisText -------------------------------------------------------------------------------------

test("basisText names the analysed and total inspiration images", () => {
  assert.equal(S.basisText({ analysed: 3, total: 4 }), "Based on 3 of 4 inspiration images");
  assert.equal(S.basisText({ analysed: 1, total: 1 }), "Based on 1 of 1 inspiration image");
  assert.equal(S.basisText(null), "Based on 0 of 0 inspiration images");
});
