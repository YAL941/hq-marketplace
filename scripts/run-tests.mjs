import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const testFiles = readdirSync('tests')
    .filter((file) => file.endsWith('.test.ts'))
    .sort()
    .map((file) => `tests/${file}`);

if (testFiles.length === 0) {
    console.error('No test files found in tests/');
    process.exit(1);
}

const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=spec', ...testFiles],
    { stdio: 'inherit' },
);

if (result.error) {
    console.error('Could not start the test runner:', result.error);
    process.exit(1);
}

process.exitCode = result.status ?? 1;
