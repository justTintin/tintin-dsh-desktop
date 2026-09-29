import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { checkAnchors, checkLineGate, countSourceLines } from './verify-tintin-gate.mjs'

const repoRoot = () => resolve('/repo')

test('countSourceLines counts CRLF and LF content identically', () => {
  assert.equal(countSourceLines('a\nb\nc'), 3)
  assert.equal(countSourceLines('a\r\nb\r\nc\r\n'), 3)
  assert.equal(countSourceLines(''), 0)
  assert.equal(countSourceLines('x\n'.repeat(1200)), 1200)
})

test('checkAnchors passes anchors whose path matches the minimum count', () => {
  const files = new Map([
    [join(repoRoot(), 'docs', 'plan.md'), 'gate gate gate'],
  ])
  const violations = checkAnchors({
    root: repoRoot(),
    anchors: [
      { comment: 'gate anchor', path: 'docs/plan.md', pattern: 'gate', minCount: 3 },
    ],
    readText: path => {
      const content = files.get(path)
      if (content === undefined) throw new Error('missing')
      return content
    },
  })
  assert.deepEqual(violations, [])
})

test('checkAnchors reports missing targets, short counts, and invalid entries', () => {
  const files = new Map([
    [join(repoRoot(), 'docs', 'plan.md'), 'gate'],
  ])
  const violations = checkAnchors({
    root: repoRoot(),
    anchors: [
      { comment: 'missing file', path: 'docs/gone.md', pattern: 'gate', minCount: 1 },
      { comment: 'count too low', path: 'docs/plan.md', pattern: 'gate', minCount: 2 },
      { comment: 'invalid entry', path: 'docs/plan.md' },
    ],
    readText: path => {
      const content = files.get(path)
      if (content === undefined) throw new Error('missing')
      return content
    },
  })
  assert.equal(violations.length, 3)
  assert.match(violations[0], /anchor target is missing/)
  assert.match(violations[1], /found 1/)
  assert.match(violations[2], /invalid entry/)
})

test('checkLineGate blocks growth beyond the ceiling and stale baseline entries', () => {
  const files = new Map([
    [join(repoRoot(), 'dsh-tintin-bundle', 'okay.js'), 'x\n'.repeat(10)],
    [join(repoRoot(), 'dsh-tintin-bundle', 'locked.js'), 'x\n'.repeat(1200)],
    [join(repoRoot(), 'dsh-tintin-bundle', 'grew.js'), 'x\n'.repeat(1300)],
  ])
  const violations = checkLineGate({
    root: repoRoot(),
    baseline: {
      'dsh-tintin-bundle/locked.js': 1200,
      'dsh-tintin-bundle/grew.js': 1200,
      'dsh-tintin-bundle/gone.js': 1100,
    },
    listFiles: (_root, directory) => [...files.keys()]
      .filter(path => path.replaceAll('\\', '/').includes(`/${directory}/`)),
    readText: path => {
      const content = files.get(path)
      if (content === undefined) throw new Error('missing')
      return content
    },
    fileExists: path => files.has(path),
  })
  assert.equal(violations.length, 2)
  assert.match(violations[0], /grew beyond its locked baseline/)
  assert.match(violations[1], /references a missing file/)
})

test('checkLineGate rejects an oversized file that has no baseline entry', () => {
  const files = new Map([
    [join(repoRoot(), 'dsh-tintin-media-bundle', 'big.vue'), 'x\n'.repeat(1001)],
  ])
  const violations = checkLineGate({
    root: repoRoot(),
    baseline: {},
    listFiles: (_root, directory) => [...files.keys()]
      .filter(path => path.replaceAll('\\', '/').includes(`/${directory}/`)),
    readText: path => {
      const content = files.get(path)
      if (content === undefined) throw new Error('missing')
      return content
    },
    fileExists: path => files.has(path),
  })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /without a baseline entry/)
})
