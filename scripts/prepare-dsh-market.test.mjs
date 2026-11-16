import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MARKET_WORKSPACES, latestMarket, marketResolution, prepareMarket } from './prepare-dsh-market.mjs'

const reply = version => async () => new Response(JSON.stringify({ name: 'dshmarket', version }))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-market-prepare-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, data) => writeFileSync(join(root, path), `${JSON.stringify(data, null, 2)}\n`)
  mkdirSync(join(root, '.yarn', 'patches'), { recursive: true })
  writeFileSync(join(root, '.yarn', 'patches', 'dshmarket-desktop.patch'), '# fixture patch' + String.fromCharCode(10))
  write('package.json', { resolutions: { 'dshmarket@npm:1.0.0': 'patch:old', other: '2.0.0' } })
  writeFileSync(join(root, 'yarn.lock'), 'original lock\n')
  for (const name of MARKET_WORKSPACES) {
    mkdirSync(join(root, name, 'node_modules/dshmarket'), { recursive: true })
    write(`${name}/package.json`, { name, dependencies: { dshmarket: '1.0.0', other: '2.0.0' } })
    write(`${name}/node_modules/dshmarket/package.json`, { name: 'dshmarket', version: '1.0.0' })
  }
  const install = () => {
    for (const name of MARKET_WORKSPACES) {
      const version = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).dependencies.dshmarket
      write(`${name}/node_modules/dshmarket/package.json`, { name: 'dshmarket', version })
    }
    writeFileSync(join(root, 'yarn.lock'), 'updated lock\n')
  }
  return { root, write, install }
}

test('refreshes all editions and rechecks the tag on every invocation (explicit --latest)', async t => {
  const { root, install } = fixture(t)
  let version = '1.59.0', queries = 0, installs = 0
  // 2026-11-16 用户裁决:追新必须显式(pinned:false=--latest);默认 pinned 不触 fetcher
  const options = { pinned: false, fetcher: async (...args) => { queries++; return reply(version)(...args) }, runInstall: () => { installs++; install() } }
  await prepareMarket(root, options)
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).resolutions, { other: '2.0.0', 'dshmarket@npm:1.59.0': marketResolution('1.59.0') })
  for (const name of MARKET_WORKSPACES) assert.deepEqual(JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).dependencies, { dshmarket: version, other: '2.0.0' })
  assert.equal(installs, 1)
  // 同版本再次追新:latest 相同→幂等,不重复 install(原语义保留)
  await prepareMarket(root, options)
  assert.equal(installs, 1)
  version = '1.60.0'
  await prepareMarket(root, options)
  assert.equal(queries, 3)
  assert.equal(installs, 2)
  assert.equal(await prepareMarket(root, { ...options, check: true }), '1.60.0')
})

test('default is pinned: no npm access, installed version kept (2026-11-16 用户裁决)', async t => {
  const { root } = fixture(t)
  let queries = 0
  const version = await prepareMarket(root, { fetcher: async () => { queries++; throw new Error('must not fetch') }, runInstall: () => { throw new Error('must not install') } })
  assert.equal(version, '1.0.0')
  assert.equal(queries, 0)
})

test('check is read-only and rejects stale installed copies (latest mode)', async t => {
  const { root, install, write } = fixture(t)
  await assert.rejects(prepareMarket(root, { check: true, pinned: false, fetcher: reply('1.59.0'), runInstall: () => assert.fail('must not install') }), /market:prepare/)
  assert.equal(readFileSync(join(root, 'yarn.lock'), 'utf8'), 'original lock\n')
  await prepareMarket(root, { pinned: false, fetcher: reply('1.59.0'), runInstall: install })
  write('dsh-desktop-next/node_modules/dshmarket/package.json', { name: 'dshmarket', version: '1.0.0' })
  await assert.rejects(prepareMarket(root, { check: true, pinned: false, fetcher: reply('1.59.0') }), /dsh-desktop-next/)
})

test('pinned check is read-only and rejects diverged workspaces without npm', async t => {
  const { root, write } = fixture(t)
  // 一致状态:pinned 通过,不触 npm
  assert.equal(await prepareMarket(root, { check: true, fetcher: () => { throw new Error('must not fetch') } }), '1.0.0')
  assert.equal(readFileSync(join(root, 'yarn.lock'), 'utf8'), 'original lock\n')
  write('dsh-desktop-next/node_modules/dshmarket/package.json', { name: 'dshmarket', version: '9.9.9' })
  await assert.rejects(prepareMarket(root, { check: true, fetcher: () => { throw new Error('must not fetch') } }), /diverge/)
})

test('restores manifests and the lockfile after an interrupted installation', async t => {
  const { root } = fixture(t)
  const paths = ['package.json', 'yarn.lock', ...MARKET_WORKSPACES.map(name => `${name}/package.json`)]
  const before = paths.map(path => readFileSync(join(root, path), 'utf8'))
  await assert.rejects(prepareMarket(root, { pinned: false, fetcher: reply('1.59.0'), runInstall: () => {
    writeFileSync(join(root, 'yarn.lock'), 'incomplete')
    throw new Error('interrupted')
  } }), /restored/)
  assert.deepEqual(paths.map(path => readFileSync(join(root, path), 'utf8')), before)
})

test('does not accept an offline or malformed latest response', async () => {
  await assert.rejects(latestMarket(async () => { throw new Error('offline') }), /offline/)
  await assert.rejects(latestMarket(async () => new Response('', { status: 503 })), /503/)
  await assert.rejects(latestMarket(reply('latest')), /invalid/)
  await assert.rejects(latestMarket(async () => new Response(JSON.stringify({ name: 'other', version: '1.0.0' }))), /invalid/)
})

test('all root launch, build and packaging entry points prepare the market first', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const entrypoints = Object.entries(scripts).filter(([name]) => /^(build$|dev(?::|$)|start(?::|$)|package:dir|dist:)/.test(name))
  assert.ok(entrypoints.length >= 18)
  for (const [name, command] of entrypoints) assert.ok(command.startsWith('yarn market:prepare && '), name)
})
