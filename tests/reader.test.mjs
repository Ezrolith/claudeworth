import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProjectName, prettyCwd } from '../src/reader.js';

test('decodeProjectName strips the drive prefix and keeps the last 3 segments', () => {
  assert.equal(
    decodeProjectName('C--Users-Peter-Projects-claudeworth'),
    'Peter/Projects/claudeworth'
  );
  // KNOWN limitation: a real folder name containing '-' is split into fake segments.
  // This is exactly why we prefer the per-event cwd (see prettyCwd) for display.
  assert.equal(decodeProjectName('C--Users-Peter-my-cool-app'), 'my/cool/app');
});

test('prettyCwd derives the last two path segments from a real cwd (Windows or POSIX)', () => {
  assert.equal(prettyCwd('C:\\Users\\Peter\\code\\my-app'), 'code/my-app');
  assert.equal(prettyCwd('/home/me/projects/foo'), 'projects/foo');
  // Hyphens in the real folder name are preserved, unlike decodeProjectName.
  assert.equal(prettyCwd('C:\\Users\\Peter\\Projects\\P-Universe 2'), 'Projects/P-Universe 2');
  assert.equal(prettyCwd(''), '');
  assert.equal(prettyCwd(null), '');
});
