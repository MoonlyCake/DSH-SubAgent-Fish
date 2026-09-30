#!/usr/bin/env node
/** Check profile wiring and the client bundle served by a running DSH server.
 * Usage: node tools/verify-live.mjs 'http://127.0.0.1:3080/?token=...'
 *        node tools/verify-live.mjs --offline
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'dsh-subagent-fish'
const SIDEBAR_ID = 'dsh-better-sidebar'

/** Extract the JSON assigned to __DSH_BOOT__, respecting braces in strings. */
export function parseBootGraph(html) {
  const assignments = /\b(?:window\.)?__DSH_BOOT__\s*=\s*/g
  for (const match of html.matchAll(assignments)) {
    const start = match.index + match[0].length
    if (html[start] !== '{') continue
    let depth = 0
    let quoted = false
    let escaped = false
    for (let i = start; i < html.length; i++) {
      const ch = html[i]
      if (quoted) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') quoted = false
      } else if (ch === '"') quoted = true
      else if (ch === '{') depth += 1
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)) } catch { break }
      }
    }
  }
  return null
}

const isFile = (path) => {
  try { return statSync(path).isFile() } catch { return false }
}

/** Run without exiting the process, so failures can also be checked in tests. */
export async function verify({
  args = process.argv.slice(2), env = process.env, root = ROOT,
  fetchImpl = globalThis.fetch, log = console.log, timeoutMs = 10000,
} = {}) {
  let failures = 0
  const check = (name, ok, detail) => {
    log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` — ${detail}`}`)
    if (!ok) failures += 1
    return Boolean(ok)
  }
  const read = (path, name) => {
    try { return readFileSync(path, 'utf8') } catch (error) {
      check(name, false, error.code ?? error.message)
      return undefined
    }
  }
  const readJson = (path, name) => {
    const text = read(path, name)
    if (text === undefined) return undefined
    try { return JSON.parse(text) } catch {
      check(name, false, 'invalid JSON')
      return undefined
    }
  }

  log('profile wiring')
  const profileDir = join(env.DSH_HOME ?? join(env.HOME ?? '', '.dsh'), 'profiles', env.DSH_PROFILE ?? 'desktop')
  const profile = readJson(join(profileDir, 'package.json'), 'can read the profile manifest')
  if (profile !== undefined) {
    const bundles = profile?.dsh?.profile?.bundles
    const hasBundles = check('profile bundle stack is an array', Array.isArray(bundles))
    check('package is a profile dependency', typeof profile?.dependencies?.[PLUGIN_ID] === 'string')
    check('package is in the bundle stack', hasBundles && bundles.includes(PLUGIN_ID))
    // ctx.inject waits for the optional service, so either bundle order works.
    if (hasBundles && bundles.includes(SIDEBAR_ID)) {
      log(`  (bundle order: sidebar@${bundles.indexOf(SIDEBAR_ID)}, fish@${bundles.indexOf(PLUGIN_ID)})`)
    }
  }

  const source = read(join(root, 'lib/client.js'), 'can read the built browser bundle')
  if (source !== undefined) {
    check('lib/client.js declares the module-loader contract', source.includes('window.__ModuleLoader__.load(') && source.includes(`id: "${PLUGIN_ID}"`))
    check('lib/client.js exports apply', /exports\.apply\s*=/.test(source))
    check('lib/client.js registers the subagent tab-title slot', source.includes('sidebar.right.pane.tab.title'))
    check('lib/client.js decorates the optional better-sidebar rows', source.includes('betterSidebar') && source.includes('installSidebarRowFish'))
  }

  log('\nclient half, as the profile would load it')
  const installed = join(profileDir, 'node_modules', PLUGIN_ID)
  const manifest = readJson(join(installed, 'package.json'), 'package resolves from the profile directory')
  if (manifest !== undefined) {
    const declaration = manifest?.dsh?.client
    check('declares dsh.client', declaration !== null && typeof declaration === 'object')
    check("dsh.client.platform is 'web'", declaration?.platform === 'web')
    const clientEntry = manifest?.exports?.['./client']
    const clientRel = typeof clientEntry === 'string' ? clientEntry : clientEntry?.default
    check('exports["./client"] resolves to a string path', typeof clientRel === 'string')
    const clientPath = typeof clientRel === 'string' ? join(installed, clientRel) : undefined
    const clientExists = check('client entry is a file', clientPath !== undefined && isFile(clientPath), String(clientRel))
    check('main entry is a file', typeof manifest?.main === 'string' && isFile(join(installed, manifest.main)), String(manifest?.main))
    const patch = manifest?.dsh?.bundle?.patch
    check('bundle patch is a file', typeof patch === 'string' && isFile(join(installed, patch)), String(patch))
    if (clientExists) {
      const installedSource = read(clientPath, 'can read the installed browser bundle')
      check('installed bundle registers under the package name', installedSource?.includes(`id: ${JSON.stringify(PLUGIN_ID)}`) === true)
    }
    try {
      const actual = realpathSync(installed)
      log(`  (installed via ${actual === root ? 'a link to this repo' : actual})`)
    } catch (error) { check('installed package path resolves', false, error.code ?? error.message) }
  }

  const targets = args.filter((argument) => argument !== '--offline')
  if (args.includes('--offline') && targets.length > 0) {
    check('choose either --offline or a launch URL', false)
  } else if (targets.length > 1) {
    check('provide one launch URL', false)
  } else if (targets.length === 0) {
    log('\nno URL given — skipping the live half.')
  } else {
    let base
    try { base = new URL(targets[0]) } catch { check('launch URL is valid', false) }
    if (base !== undefined && !check('launch URL uses HTTP(S) without embedded credentials',
      ['http:', 'https:'].includes(base.protocol) && base.username === '' && base.password === '')) base = undefined
    if (base !== undefined) {
      const request = (url, options = {}) => fetchImpl(url, {
        ...options, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      })
      log(`\nlive server ${base.origin}`)
      try {
        const redeem = await request(base)
        const accepted = check('token accepted (expected a 303 to the clean URL)', redeem.status === 303, `HTTP ${redeem.status}`)
        const rawCookies = typeof redeem.headers.getSetCookie === 'function'
          ? redeem.headers.getSetCookie()
          : (redeem.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,\s]+=)/).filter(Boolean)
        const cookie = rawCookies.map((entry) => entry.split(';')[0].trim()).filter(Boolean).join('; ')
        const hasCookie = check('server issued a session cookie', cookie.length > 0, '(none)')
        if (accepted && hasCookie) {
          const location = redeem.headers.get('location')
          const indexUrl = new URL(location ?? base.pathname, base)
          indexUrl.searchParams.delete('token')
          if (check('clean index URL stays on the server origin', indexUrl.origin === base.origin)) {
            const index = await request(indexUrl, { headers: { cookie } })
            const html = await index.text()
            const indexOk = check('index document served', index.ok, `HTTP ${index.status}`)
            const graph = indexOk ? parseBootGraph(html) : null
            check('index carries a parsed client boot graph', graph !== null)
            const rows = graph?.rows ?? graph?.graphRows
            const validRows = Array.isArray(rows) && rows.every((row) => row !== null && typeof row === 'object' && typeof row.id === 'string')
            check('boot graph has a client roster array', validRows)
            if (validRows) {
              const mineRow = rows.find((row) => row.id === PLUGIN_ID)
              check(`${PLUGIN_ID} is in the served client roster`, mineRow !== undefined,
                `roster: ${rows.map((row) => row.id).join(', ') || '(empty)'}`)
              if (mineRow !== undefined) {
                let bundleUrl
                if (check('plugin row declares a bundle URL', typeof mineRow.url === 'string' && mineRow.url.length > 0)) {
                  try { bundleUrl = new URL(mineRow.url, indexUrl) } catch { check('plugin bundle URL is valid', false) }
                }
                // A server-provided URL must never receive the session cookie on another origin.
                if (bundleUrl !== undefined && check('plugin bundle URL stays on the server origin', bundleUrl.origin === base.origin)) {
                  const served = await request(bundleUrl, { headers: { cookie } })
                  const body = await served.text()
                  check('its bundle URL serves', served.ok, `HTTP ${served.status} ${bundleUrl.pathname}`)
                  check('served bundle is ours', body.includes(PLUGIN_ID) && body.includes('__ModuleLoader__.load'))
                  check('served bundle carries both registrations', body.includes('sidebar.right.pane.tab.title') && body.includes('betterSidebar'))
                }
              }
              log(rows.some((row) => row.id === SIDEBAR_ID)
                ? '  (optional dsh-better-sidebar is also in the roster)'
                : '  (optional dsh-better-sidebar is absent; tab fish still work)')
            }
          }
        }
      } catch (error) {
        // Fetch/timeout errors are a failed check, not an uncaught stack trace.
        check('live requests completed', false, error.name === 'TimeoutError' ? 'request timed out' : error.code ?? error.name ?? 'request failed')
      }
    }
  }
  log(failures === 0 ? '\nall requested checks passed.' : `\n${failures} check(s) failed`)
  return failures === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await verify()
}
