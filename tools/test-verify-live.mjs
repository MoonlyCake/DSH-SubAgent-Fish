#!/usr/bin/env node
/** Regression checks using temporary profiles and a real local HTTP server. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBootGraph, verify } from './verify-live.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = 'dsh-subagent-fish'
const temporary = mkdtempSync(join(tmpdir(), 'dsf-verify-'))
const profileDir = join(temporary, 'profiles', 'web')
const installed = join(profileDir, 'node_modules', plugin)
mkdirSync(installed, { recursive: true })
symlinkSync(profileDir, join(temporary, 'profiles', 'desktop'), 'dir')
const manifest = { main: 'index.js', exports: { './client': { default: './client.js' } }, dsh: { client: { platform: 'web' }, bundle: { patch: 'cordis.patch.yml' } } }
const profile = { dependencies: { [plugin]: 'link:.' }, dsh: { profile: { bundles: [plugin] } } }
const saveProfile = (value = profile) => writeFileSync(join(profileDir, 'package.json'), JSON.stringify(value))
const saveManifest = (value = manifest) => writeFileSync(join(installed, 'package.json'), JSON.stringify(value))
saveProfile()
saveManifest()
writeFileSync(join(installed, 'index.js'), 'export function apply() {}')
writeFileSync(join(installed, 'cordis.patch.yml'), 'name: dsh-subagent-fish')
const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
writeFileSync(join(installed, 'client.js'), bundle)
const env = { DSH_HOME: temporary, DSH_PROFILE: 'web' }
const run = async (args, options = {}) => {
  const messages = []
  const code = await verify({ args, env, root, log: (message) => messages.push(message), ...options })
  return { code, text: messages.join('\n') }
}

const expected = { rows: [{ id: plugin, url: 'client.js', label: 'a } brace { and "quote" and \\slash' }] }
assert.deepEqual(parseBootGraph(`<p>__DSH_BOOT__ mention</p><script>window.__DSH_BOOT__ = ${JSON.stringify(expected)};</script>`), expected)
assert.equal(parseBootGraph('window.__DSH_BOOT__ = {"broken":'), null)
assert.equal(parseBootGraph('there is no boot graph'), null)
assert.deepEqual(parseBootGraph('window.__DSH_BOOT__ = nope; window.__DSH_BOOT__ = {"rows": []}'), { rows: [] })

let mode = 'ok'
let authenticatedRequests = 0
let unexpectedRequests = 0
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost')
  if (path.pathname === '/dsh/' && path.searchParams.has('token')) {
    if (mode === 'denied') { response.writeHead(403); response.end('denied'); return }
    const headers = { location: mode === 'redirect-origin' ? 'http://example.invalid/' : '/dsh/' }
    if (mode !== 'no-cookie') headers['set-cookie'] = ['session=secret; HttpOnly; Path=/', 'csrf=second; Expires=Wed, 01 Jan 2030 00:00:00 GMT; Path=/']
    response.writeHead(303, headers)
    response.end()
    return
  }
  if (request.headers.cookie !== 'session=secret; csrf=second') {
    response.writeHead(401); response.end('wrong cookie'); return
  }
  authenticatedRequests += 1
  if (path.pathname === '/dsh/') {
    let graph = expected
    if (mode === 'graphRows') graph = { graphRows: expected.rows }
    if (mode === 'bad-rows') graph = { rows: { id: plugin } }
    if (mode === 'null-row') graph = { rows: [null] }
    if (mode === 'missing-url') graph = { rows: [{ id: plugin }] }
    if (mode === 'origin') graph = { rows: [{ id: plugin, url: 'http://example.invalid/client.js' }] }
    response.writeHead(mode === 'index-error' ? 500 : 200, { 'content-type': 'text/html' })
    response.end(`<script>window.__DSH_BOOT__ = ${JSON.stringify(graph)};</script>`)
  } else if (path.pathname === '/dsh/client.js') {
    if (mode === 'bundle-redirect') {
      response.writeHead(302, { location: 'http://example.invalid/client.js' }); response.end()
    } else {
      response.writeHead(mode === 'bundle-error' ? 404 : 200)
      response.end(mode === 'wrong-bundle' ? 'not our module' : bundle)
    }
  } else {
    unexpectedRequests += 1
    response.writeHead(404); response.end()
  }
})
await new Promise((resolveListen, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolveListen)
})
const launch = `http://127.0.0.1:${server.address().port}/dsh/?token=launch-secret`
try {
  assert.equal((await run(['--offline'])).code, 0)
  assert.equal((await run(['--offline'], { env: { DSH_HOME: temporary } })).code, 0, 'desktop is the default profile')
  saveProfile({ ...profile, dsh: { profile: { bundles: [plugin, 'dsh-better-sidebar'] } } })
  assert.equal((await run(['--offline'])).code, 0, 'optional sidebar may load after the fish plugin')
  saveProfile()
  for (const successMode of ['ok', 'graphRows']) {
    mode = successMode
    const result = await run([launch])
    assert.equal(result.code, 0, result.text)
    assert.equal(result.text.includes('secret'), false, 'auth secrets must not appear in output')
  }
  assert.equal(authenticatedRequests, 4, 'subpath index and relative bundle URL are both authenticated')
  for (const failureMode of ['denied', 'no-cookie', 'redirect-origin', 'bad-rows', 'null-row', 'missing-url', 'origin', 'index-error', 'bundle-error', 'wrong-bundle', 'bundle-redirect']) {
    mode = failureMode
    const result = await run([launch])
    assert.equal(result.code, 1, `${failureMode} must fail cleanly`)
    assert.equal(result.text.includes('secret'), false)
  }
  assert.equal(unexpectedRequests, 0)
  for (const args of [['bad url'], ['ftp://example.com/'], ['https://name:pass@example.com/'], [launch, '--offline'], [launch, launch]]) {
    assert.equal((await run(args)).code, 1, `bad arguments ${args}`)
  }
  const networkFailure = await run([launch], { fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.equal(networkFailure.code, 1)
  assert.match(networkFailure.text, /live requests completed.*TypeError/)
  const timeoutFailure = await run([launch], { fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError') } })
  assert.match(timeoutFailure.text, /request timed out/)
  saveProfile({ dsh: { profile: { bundles: {} } } })
  assert.equal((await run(['--offline'])).code, 1, 'malformed bundle stack cannot throw')
  saveProfile()
  for (const badManifest of [null, {}, { ...manifest, main: undefined, dsh: { client: null } }, { ...manifest, exports: { './client': './missing.js' } }, { ...manifest, main: '.' }]) {
    saveManifest(badManifest)
    assert.equal((await run(['--offline'])).code, 1, 'bad manifest must fail without crashing')
  }
  writeFileSync(join(installed, 'package.json'), '{invalid')
  assert.equal((await run(['--offline'])).code, 1)
  rmSync(join(profileDir, 'package.json'))
  assert.equal((await run(['--offline'])).code, 1)
  console.log('live verifier parsing, auth, optional-sidebar, and error checks passed')
} finally {
  server.closeAllConnections()
  await new Promise((resolveClose) => server.close(resolveClose))
  rmSync(temporary, { recursive: true, force: true })
}
