import { readFileSync } from 'node:fs';

const langs = ['en', 'ar', 'so'];
const read = (l) => JSON.parse(readFileSync(new URL(`./src/i18n/${l}.json`, import.meta.url), 'utf8'));

const keysOf = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

const en = read('en');
const enKeys = keysOf(en);

let bad = 0;
for (const lang of langs) {
  if (lang === 'en') continue;
  const target = new Set(keysOf(read(lang)));
  const missing = enKeys.filter((k) => !target.has(k));
  if (missing.length) {
    bad++;
    console.log(`${lang}: MISSING ${missing.length}`);
    missing.forEach((k) => console.log(`  ${k}`));
  } else {
    console.log(`${lang}: OK (${enKeys.length} key paths match en)`);
  }
}
process.exit(bad ? 1 : 0);