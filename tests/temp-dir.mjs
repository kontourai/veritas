import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The only place under tests/ that may create a directory directly (tests/temp-dir-guard.test.mjs enforces it).
//
// Creates a directory under the OS temp dir and removes it, recursively, when the owner finishes.
// `owner` is anything with an `after(fn)` hook:
//   - a test context `t`: removal runs after that test and its subtests, so a directory that a test
//     inspects late, or hands to a child process the test awaits, still exists until the test ends;
//   - `{ after }` imported from 'node:test': for a directory created at module scope or in a suite
//     hook, removal runs once the file's tests finish.
// Removal is `force`, so a test that already deleted its directory (or deleted the working
// directory of a child on purpose) does not fail the cleanup.
export function tempDir(owner, prefix) {
  if (typeof owner?.after !== 'function') {
    throw new TypeError('tempDir(owner, prefix): owner needs an after() hook; pass the test context `t` or { after } from node:test');
  }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  // maxRetries/retryDelay only absorb a transient ENOTEMPTY/EBUSY (a git or antivirus scan finishing
  // as the tree is removed). A process that keeps writing into the directory outlasts them, so the
  // test must not start one (see disableGitAutoMaintenance in helpers.mjs).
  owner.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}
