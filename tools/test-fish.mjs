#!/usr/bin/env node
/** Regressions for deterministic artwork, unique SVG IDs and animation teardown. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { FISH_SPECIES, FISH_EYES, FISH_COLORS, fishSvg, fishTraits, parseCustom, swimGeom, swimPose } from '../src/fish/engine.js'
import { fishIdentity, PATTERNS } from '../src/fish/identity.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
function check(name, fn) {
  fn()
  checks += 1
  console.log(`  ok   ${name}`)
}
const normalized = (markup) => markup
  .replace(/pattern-clip-(?:avatar-)?\d+/g, 'pattern-clip-N')
  .replace(/ fish-swim/g, '')
  .replace(/ data-fish-id="\d+"/g, '')

check('identities are repeatable and overrides do not reshuffle other axes', () => {
  const base = fishIdentity('stable-agent')
  assert.deepEqual(base, fishIdentity('stable-agent'))
  for (const [field, value] of [['species', 'eel'], ['eyes', 'wink'], ['pattern', 'spots'], ['color', '3'], ['strength', 1]]) {
    const overridden = fishIdentity('stable-agent', { [field]: value })
    assert.equal(overridden[field], field === 'color' ? 3 : value)
    for (const axis of ['species', 'color', 'eyes', 'pattern', 'base', 'patternSeed', 'strength']) {
      if (axis !== field) assert.equal(overridden[axis], base[axis])
    }
  }
})

check('invalid identity overrides keep valid deterministic defaults', () => {
  const ordinary = fishIdentity('stable-agent')
  assert.deepEqual(fishIdentity('stable-agent', null), ordinary)
  assert.deepEqual(fishIdentity('stable-agent', { species: 'constructor', eyes: '__proto__', pattern: 'unknown', strength: 'bad' }), ordinary)
  assert.equal(fishIdentity('stable-agent', { strength: -2 }).strength, 0)
  assert.equal(fishIdentity('stable-agent', { strength: 5 }).strength, 1)
})

check('invalid inherited species and eye names cannot crash the renderer', () => {
  assert.equal(parseCustom('c-constructor-0-dots-body'), null)
  assert.equal(parseCustom('c-eel-0-constructor-body'), null)
  for (const opts of [null, { species: 'constructor', eyes: 'constructor' }, { species: '__proto__', eyes: '__proto__' }]) {
    assert.match(fishSvg('prototype-probe', opts), /fish-body/)
  }
  const custom = fishIdentity('custom-eyes', { eyes: 'wink' })
  assert.equal(fishTraits(custom.seed, { eyes: 'constructor' }).eyes, 'wink')
})

check('species overrides retain the independent seeded colour draw', () => {
  for (let i = 0; i < 30; i++) {
    const seed = `colour-probe-${i}`
    assert.equal(fishTraits(seed, { species: 'eel' }).color, fishTraits(seed).color)
  }
})

check('SVG attributes reject nonnumeric dimensions and nonfinite pattern opacity', () => {
  for (const size of ['64" onload="alert(1)', Infinity, -1, 0, NaN]) {
    const markup = fishSvg('attribute-probe', { size, pattern: 'stripes', strength: 'bad', still: true })
    assert.match(markup, /width="64" height="64"/)
    assert.doesNotMatch(markup, /onload|NaN|Infinity/)
    assert.match(markup, /opacity="0.55"/)
  }
  assert.match(fishSvg('attribute-probe', { size: '32', still: true }), /width="32" height="32"/)
})

check('every species and pattern produces finite, repeatable animated geometry', () => {
  for (const species of Object.keys(FISH_SPECIES)) {
    for (const pattern of PATTERNS) {
      const identity = fishIdentity(`${species}:${pattern}`, { species, pattern })
      const markup = fishSvg(identity.seed, identity)
      assert.doesNotMatch(markup, /NaN|Infinity|undefined/)
      assert.equal(normalized(markup), normalized(fishSvg(identity.seed, identity)))
      const geom = swimGeom(/data-fish-id="(\d+)"/.exec(markup)[1])
      for (const time of [0, 0.5, 300]) {
        const pose = swimPose(geom, time)
        assert.doesNotMatch(JSON.stringify(pose), /NaN|Infinity|undefined/)
        assert.deepEqual(pose, swimPose(geom, time))
      }
    }
  }
  for (const eyes of Object.keys(FISH_EYES)) {
    const identity = fishIdentity(eyes, { eyes })
    assert.equal(fishTraits(identity.seed).eyes, eyes)
    assert.equal(fishTraits(identity.seed).color, FISH_COLORS[identity.color])
  }
})

const classic = (path) => readFileSync(join(ROOT, path), 'utf8')
  .replace(/^import\s[^\n]*\n/gm, '')
  .replace(/^export\s*\{[^}]*\};?[ \t]*\n?/gm, '')
  .replace(/^export\s+/gm, '')

function createDocument() {
  const doc = { fish: [], tags: [] }
  doc.querySelectorAll = () => doc.fish
  doc.querySelector = (selector) => selector.startsWith('style') ? doc.tags[0] ?? null : doc.fish[0] ?? null
  doc.createElement = () => ({
    dataset: {}, isConnected: true, textContent: '',
    remove() { this.isConnected = false; doc.tags = doc.tags.filter((tag) => tag !== this) },
  })
  doc.head = { appendChild: (tag) => doc.tags.push(tag) }
  return doc
}

function runtime(reduced = false) {
  const frames = new Map(), intervals = new Map(), mediaListeners = new Set()
  let serial = 0, mediaLookups = 0
  const media = {
    matches: reduced,
    addEventListener: (_event, listener) => mediaListeners.add(listener),
    removeEventListener: (_event, listener) => mediaListeners.delete(listener),
  }
  const sandbox = {
    document: createDocument(), console: { info() {} },
    requestAnimationFrame: (callback) => { const id = ++serial; frames.set(id, callback); return id },
    cancelAnimationFrame: (id) => frames.delete(id),
    setInterval: (callback) => { const id = ++serial; intervals.set(id, callback); return id },
    clearInterval: (id) => intervals.delete(id),
    matchMedia: () => { mediaLookups += 1; return media },
  }
  const context = createContext(sandbox)
  runInContext(['src/fish/engine.js', 'src/fish/identity.js', 'src/client/fish-avatar.js'].map(classic).join('\n')
    + '\nglobalThis.api = { fishIdentity, fishAvatarMarkup, ensureFishSwimming, stopFishSwimming, installFishCss, startSwimLoop, stopSwimLoop };', context)
  return {
    sandbox, frames, intervals, mediaListeners, api: sandbox.api,
    get mediaLookups() { return mediaLookups },
    frame(now) { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(now) },
    heartbeat() { for (const callback of [...intervals.values()]) callback() },
    reduced(value) { media.matches = value; for (const listener of [...mediaListeners]) listener({ matches: value }) },
  }
}

function mount(markup) {
  const part = (d = '') => ({ isConnected: true, attrs: { d }, setAttribute(name, value) { this.attrs[name] = value } })
  const body = part(/class="fish-body" d="([^"]+)"/.exec(markup)[1])
  const bob = part(), clip = markup.includes('fish-clip') ? part() : null
  const heads = [part(), part()]
  const marks = Array.from(markup.matchAll(/class="fish-mark"/g), () => part())
  return {
    dataset: { fishId: /data-fish-id="(\d+)"/.exec(markup)[1] }, body, bob, clip, heads, marks,
    querySelector: (selector) => ({ '.fish-body': body, '.fish-bob': bob, '.fish-clip': clip })[selector] ?? null,
    querySelectorAll: (selector) => selector === '.fish-head' ? heads : marks,
  }
}

check('cached fish get distinct document-wide clipping IDs without changing their artwork', () => {
  const r = runtime()
  const identity = r.api.fishIdentity('mounted-twice', { pattern: 'stripes' })
  const first = r.api.fishAvatarMarkup(identity), second = r.api.fishAvatarMarkup(identity)
  const clip = (markup) => /<clipPath id="([^"]+)"/.exec(markup)[1]
  assert.notEqual(clip(first), clip(second))
  for (const markup of [first, second]) assert.ok(markup.includes(`clip-path="url(#${clip(markup)})"`))
  assert.equal(normalized(first), normalized(second))
  r.api.stopFishSwimming()
})

check('one loop animates the body, clipping outline and markings together', () => {
  const r = runtime()
  const markup = r.api.fishAvatarMarkup(r.api.fishIdentity('motion-probe', { pattern: 'stripes' }))
  const fish = mount(markup), original = fish.body.attrs.d
  r.sandbox.document.fish = [fish]
  r.api.ensureFishSwimming()
  r.api.ensureFishSwimming()
  assert.equal(r.frames.size, 1)
  r.frame(1000)
  assert.notEqual(fish.body.attrs.d, original)
  assert.equal(fish.body.attrs.d, fish.clip.attrs.d)
  assert.ok(fish.marks.every((mark) => mark.attrs.d.length > 0))
  assert.equal(r.frames.size, 1)
  r.api.stopFishSwimming()
  assert.equal(r.frames.size, 0)
  assert.equal(r.intervals.size, 0)
  assert.equal(r.mediaListeners.size, 0)
})

check('reduced motion cancels frames and disabling it restarts cached fish', () => {
  const r = runtime(true)
  const markup = r.api.fishAvatarMarkup(r.api.fishIdentity('reduced-probe', { pattern: 'belly' }))
  const fish = mount(markup), original = fish.body.attrs.d
  r.sandbox.document.fish = [fish]
  r.api.ensureFishSwimming()
  assert.equal(r.frames.size, 0)
  assert.equal(r.mediaListeners.size, 1)
  r.reduced(false)
  assert.equal(r.frames.size, 1)
  r.frame(1200)
  assert.notEqual(fish.body.attrs.d, original)
  const moving = fish.body.attrs.d
  r.reduced(true)
  assert.equal(r.frames.size, 0)
  r.frame(1500)
  assert.equal(fish.body.attrs.d, moving)
  r.api.stopFishSwimming()
  r.reduced(false)
  assert.equal(r.frames.size, 0)
})

check('manual pause freezes geometry and resume continues the loop', () => {
  const r = runtime()
  const fish = mount(r.api.fishAvatarMarkup(r.api.fishIdentity('pause-probe')))
  r.sandbox.document.fish = [fish]
  r.frame(1000)
  const moving = fish.body.attrs.d
  r.sandbox.fishPaused = true
  r.frame(1500)
  assert.equal(fish.body.attrs.d, moving)
  r.sandbox.fishPaused = false
  r.frame(1800)
  assert.notEqual(fish.body.attrs.d, moving)
  r.api.stopFishSwimming()
})

check('empty DOM releases both the animation loop and heartbeat', () => {
  const r = runtime()
  r.api.ensureFishSwimming()
  for (let i = 0; i < 6; i++) r.frame(i * 500)
  assert.equal(r.frames.size, 0)
  assert.equal(r.mediaListeners.size, 0)
  r.heartbeat()
  r.heartbeat()
  assert.equal(r.intervals.size, 0)
})

check('cached fish restart after leaving and returning to the DOM', () => {
  const r = runtime()
  const identity = r.api.fishIdentity('returning-probe')
  r.api.fishAvatarMarkup(identity)
  for (let i = 0; i < 6; i++) r.frame(i * 500)
  assert.equal(r.frames.size, 0)
  const fish = mount(r.api.fishAvatarMarkup(identity))
  r.sandbox.document.fish = [fish]
  r.api.ensureFishSwimming()
  const original = fish.body.attrs.d
  r.frame(3500)
  assert.notEqual(fish.body.attrs.d, original)
  r.api.stopFishSwimming()
})

check('stylesheet ownership survives repeated installs and separate documents', () => {
  const r = runtime(), firstDoc = r.sandbox.document
  const releaseA = r.api.installFishCss(), releaseB = r.api.installFishCss()
  assert.equal(firstDoc.tags.length, 1)
  releaseA()
  releaseA()
  assert.equal(firstDoc.tags.length, 1)
  const secondDoc = createDocument()
  r.sandbox.document = secondDoc
  const releaseC = r.api.installFishCss()
  assert.equal(secondDoc.tags.length, 1)
  releaseB()
  assert.equal(firstDoc.tags.length, 0)
  assert.equal(secondDoc.tags.length, 1)
  releaseC()
  assert.equal(secondDoc.tags.length, 0)
})

console.log(`\n${checks} fish checks passed`)
