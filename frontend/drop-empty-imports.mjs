// Removes whole import declarations tsc reported as TS6192
// ("All imports in import declaration are unused").
// tsc gives no identifier for these, so the line number is all we have.
import { readFileSync, writeFileSync } from 'node:fs';

const out = readFileSync('typecheck-out.txt', 'utf8').split(/\r?\n/);

// file -> sorted descending list of line numbers to delete
const drop = new Map();
for (const line of out) {
  const m = /^src\/(.+?)\((\d+),\d+\): error TS6192:/.exec(line);
  if (!m) continue;
  const [, file, lineNo] = m;
  if (!drop.has(file)) drop.set(file, []);
  drop.get(file).push(Number(lineNo));
}

for (const [file, lineNos] of drop) {
  const path = `src/${file}`;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const doomed = new Set(lineNos);
  const kept = lines.filter((_, i) => !doomed.has(i + 1));
  writeFileSync(path, kept.join('\n'), 'utf8');
  console.log(`${file}: dropped lines ${lineNos.join(', ')}`);
}