// Pure translation logic (no DOM), so it can be unit-tested with node --test.
// The English text itself is the key: pages and scripts keep writing plain English, and anything
// without a Hebrew entry simply stays English.

const clean = (text) => text.replace(/\s+/g, " ").trim();

// Translates one piece of text. Leading and trailing whitespace is preserved.
// Returns the input unchanged when there is no entry.
export function translate(text, { words, patterns }) {
  const key = clean(text);
  if (!key) return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const done = (value) => lead + value + trail;
  if (Object.hasOwn(words, key)) return done(words[key]);
  for (const [pattern, template] of patterns) {
    const match = key.match(pattern);
    if (!match) continue;
    // Captured parts (names, numbers, roles) are translated too when they have an entry of their own.
    const parts = match.slice(1).map((part) => (Object.hasOwn(words, part) ? words[part] : part));
    return done(template.replace(/\$(\d)/g, (_, i) => parts[Number(i) - 1] ?? ""));
  }
  return text;
}

// English keys that no Hebrew entry covers; used by tests and by the missing-entry report.
export const missing = (keys, dictionary) => keys.filter((key) => translate(key, dictionary) === key);
