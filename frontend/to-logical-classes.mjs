// Rewrites physical Tailwind direction utilities to their logical equivalents
// so the same stylesheet works in both LTR and RTL.
//
//   mr-2 -> me-2, ml-2 -> ms-2, pl-2 -> ps-2, pr-2 -> pe-2
//   left-2 -> start-2, right-2 -> end-2
//   text-left -> text-start, text-right -> text-end
//   border-l -> border-s, border-r -> border-e
//   rounded-l -> rounded-s, rounded-r -> rounded-e
//
// Anchors (`inset-x-0`, `bottom-0`) and fractional widths are left alone: they
// are not direction-dependent.
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const files = globSync('src/**/*.tsx');

const RULES = [
  [/(?<![\w-])ml-(\d)/g, 'ms-$1'],
  [/(?<![\w-])mr-(\d)/g, 'me-$1'],
  [/(?<![\w-])pl-(\d)/g, 'ps-$1'],
  [/(?<![\w-])pr-(\d)/g, 'pe-$1'],
  [/(?<![\w-])left-(\d)/g, 'start-$1'],
  [/(?<![\w-])right-(\d)/g, 'end-$1'],
  [/(?<![\w-])text-left\b/g, 'text-start'],
  [/(?<![\w-])text-right\b/g, 'text-end'],
  [/(?<![\w-])border-l(?!-)/g, 'border-s'],
  [/(?<![\w-])border-r(?!-)/g, 'border-e'],
  [/(?<![\w-])rounded-l(?!-)/g, 'rounded-s'],
  [/(?<![\w-])rounded-r(?!-)/g, 'rounded-e'],
  // `left-1/2` style halves are position helpers, not margins.
  [/(?<![\w-])left-1\/2/g, 'start-1/2'],
  [/(?<![\w-])right-1\/2/g, 'end-1/2'],
];

let totalChanges = 0;

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  let next = original;
  let changed = 0;

  for (const [pattern, replacement] of RULES) {
    next = next.replace(pattern, (match) => {
      changed += 1;
      return replacement.replace('$1', match.match(/\d/)?.[0] ?? '');
    });
  }

  if (changed > 0) {
    writeFileSync(file, next, 'utf8');
    totalChanges += changed;
    console.log(`${file}: ${changed}`);
  }
}

console.log(`total replacements: ${totalChanges}`);
