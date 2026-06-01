import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const minimumLineCoverage = Number(process.env.VERITAS_MIN_LINE_COVERAGE ?? '80');
const testFiles = readdirSync('tests')
  .filter((entry) => entry.endsWith('.test.mjs'))
  .sort()
  .map((entry) => `tests/${entry}`);

const result = spawnSync(
  process.execPath,
  ['--experimental-test-coverage', '--test', ...testFiles],
  {
    encoding: 'utf8',
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const coverageLine = combinedOutput
  .split('\n')
  .find((line) => line.includes('all files') && line.includes('|'));

if (!coverageLine) {
  throw new Error('Unable to locate aggregate coverage output for all files.');
}

const match = coverageLine.match(/all files\s+\|\s+([\d.]+)/);
if (!match) {
  throw new Error(`Unable to parse line coverage from: ${coverageLine}`);
}

const lineCoverage = Number(match[1]);
if (Number.isNaN(lineCoverage)) {
  throw new Error(`Parsed line coverage is not a number: ${match[1]}`);
}

if (lineCoverage < minimumLineCoverage) {
  throw new Error(
    `Line coverage ${lineCoverage.toFixed(2)}% is below the required ${minimumLineCoverage.toFixed(2)}% threshold.`,
  );
}

process.stdout.write(
  `Coverage gate passed: line coverage ${lineCoverage.toFixed(2)}% >= ${minimumLineCoverage.toFixed(2)}%.\n`,
);
