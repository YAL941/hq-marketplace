// Removes named imports that tsc reported as TS6133/TS6192 unused.
// Only touches identifiers that literally appear inside a `import { ... } from '...'` list.
// Local variables and function params are left alone on purpose.
import { readFileSync, writeFileSync } from 'node:fs';

const out = readFileSync('typecheck-out.txt', 'utf8').split(/\r?\n/);

// file -> Set of unused identifiers
const unused = new Map();
for (const line of out) {
  const m = /^src\/(.+?)\((\d+),(\d+)\): error TS(?:6133|6192): '([^']+)'/.exec(line);
  if (!m) continue;
  const [, file, , , name] = m;
  if (!unused.has(file)) unused.set(file, new Set());
  unused.get(file).add(name);
}

const IMPORT_RE = /^(\s*)import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/;

for (const [file, names] of unused) {
  const path = `src/${file}`;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  let changed = false;

  const next = [];
  for (const line of lines) {
    const m = IMPORT_RE.exec(line);
    if (!m) {
      next.push(line);
      continue;
    }
    const [, indent, typeKw = '', body, source] = m;

    const kept = body
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((spec) => {
        const id = spec.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
        return !names.has(id);
      });

    if (kept.length === body.split(',').map((s) => s.trim()).filter(Boolean).length) {
      next.push(line);
      continue;
    }
    changed = true;
    if (kept.length === 0) {
      // Whole import became unused: drop the line entirely.
      continue;
    }
    next.push(`${indent}import ${typeKw}{ ${kept.join(', ')} } from '${source}';`);
  }

  if (changed) {
    writeFileSync(path, next.join('\n'), 'utf8');
    console.log(`cleaned ${file}`);
  }
}