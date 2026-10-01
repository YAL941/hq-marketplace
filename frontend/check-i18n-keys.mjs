// Verifies every locale file has exactly the same key set as en.json.
// A missing key does not throw at build time; it silently renders the raw key
// path in the UI, which is why this is checked explicitly.
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flatten(value, path)) out.add(nested);
    } else {
      out.add(path);
    }
  }
  return out;
}

const expected = flatten(base);
let failed = false;

// Arabic has four CLDR plural categories; i18next looks for `_zero`, `_one`,
// `_two`, `_few`, `_many`, `_other` and falls back through them. A locale with
// extra plural suffixes is correct, not a drift, so collapse them to the bare
// key path before diffing.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const bare = (key) => key.replace(PLURAL_SUFFIX, '');

// If en only defines plural forms (`x_one`, `x_other`), the group still counts
// as one key path `x`; otherwise en and every locale would look inconsistent.
const expectedBase = new Set([...expected].map(bare));

for (const lang of ['ar', 'so']) {
  const actualBase = new Set([...flatten(JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf8')))].map(bare));

  const missing = [...expectedBase].filter((k) => !actualBase.has(k));
  const extra = [...actualBase].filter((k) => !expectedBase.has(k));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`${lang}: OK (${expectedBase.size} key paths match en)`);
  } else {
    failed = true;
    if (missing.length) console.log(`${lang}: MISSING -> ${missing.join(', ')}`);
    if (extra.length) console.log(`${lang}: EXTRA   -> ${extra.join(', ')}`);
  }
}

console.log(`en: ${expected.size} keys`);
process.exit(failed ? 1 : 0);
