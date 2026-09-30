#!/usr/bin/env node
/** Dependency-free lifecycle regressions for the SHIPPED sidebar decorator.
 * Fixtures follow TasksTree / TasksGraph and tasks-card in better-sidebar
 * 0.24.1. The fake DOM models only the APIs this decorator uses; the browser
 * fixture in render-rows-check.mjs also runs the shipped bundle with real DOM.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')
const source = process.argv[2] !== undefined ? readFileSync(process.argv[2], 'utf8')
  : bundle.split('// ---- src/client/better-sidebar-rows.js ----\n')[1]?.split('// ---- src/client/index.js ----')[0]
assert.equal(typeof source, 'string', 'shipped bundle contains the row decorator')
let failures = 0

function matchesSelector(element, selector) {
  return selector.split(',').some(part => {
    const text = part.trim()
    const className = /^\.([\w-]+)/.exec(text)
    if (className && !element.className.split(/\s+/).includes(className[1])) return false
    const attrs = [...text.matchAll(/\[([\w-]+)(\*=|=)?(?:"([^"]*)")?\]/g)]
    return attrs.every(([, key, operator, value]) => {
      const actual = element.getAttribute(key)
      if (operator === '*=') return actual !== null && actual.includes(value)
      if (operator === '=') return actual === value
      return actual !== null
    }) && (className !== null || attrs.length > 0)
  })
}

class Element {
  nodeType = 1
  attrs = new Map()
  children = []
  parentNode = null
  text = ''
  html = ''
  constructor(tag = 'div') { this.tagName = tag }
  get parentElement() { return this.parentNode }
  get firstChild() { return this.children[0] ?? null }
  get className() { return this.getAttribute('class') ?? '' }
  set className(value) { this.setAttribute('class', value) }
  setAttribute(key, value) { this.attrs.set(key, String(value)) }
  getAttribute(key) { return this.attrs.get(key) ?? null }
  hasAttribute(key) { return this.attrs.has(key) }
  removeAttribute(key) { this.attrs.delete(key) }
  get textContent() { return this.text + this.children.map(child => child.textContent).join('') }
  set textContent(value) { this.text = String(value); this.children = [] }
  get innerHTML() { return this.html }
  set innerHTML(value) { this.html = value; this.children = [] }
  matches(selector) { return matchesSelector(this, selector) }
  closest(selector) {
    for (let node = this; node !== null; node = node.parentElement) if (node.matches(selector)) return node
    return null
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ])
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  insertBefore(child, before) {
    child.remove()
    const at = before === null ? this.children.length : this.children.indexOf(before)
    assert.ok(at >= 0, 'insertBefore reference belongs to the parent')
    this.children.splice(at, 0, child)
    child.parentNode = this
    return child
  }
  appendChild(child) { return this.insertBefore(child, null) }
  remove() {
    if (this.parentNode !== null) {
      const parent = this.parentNode
      parent.children.splice(parent.children.indexOf(this), 1)
      this.parentNode = null
    }
  }
}

function span(className, text = '') {
  const element = new Element('span')
  element.className = `hash${className}`
  element.textContent = text
  return element
}
function treeRow(label, { level = 2, kind = 'agent', legacy = false, running = false } = {}) {
  const row = new Element()
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-level', level)
  row.className = 'hash_treeRow'
  if (!legacy) row.setAttribute('data-tasks-row', '')
  if (kind === 'workflow') row.setAttribute('aria-expanded', 'true')
  row.appendChild(span('_treeDot'))
  row.appendChild(span('_treeGlyph'))
  const content = span('_treeContent')
  const title = span(legacy ? '_subagentLabel' : '_treeTitle', label)
  if (kind !== 'fold' && !legacy) title.setAttribute('title', label)
  content.appendChild(title)
  content.appendChild(span('_treeMeta', '一次性 · 已完成'))
  if (running) content.appendChild(span('_nodeMeta', '思考中'))
  row.appendChild(content)
  return row
}
function graphRow(id, label, { kind = 'subagent', state = 'done' } = {}) {
  const row = new Element()
  row.setAttribute('data-graph-node', id)
  row.setAttribute('role', 'button')
  row.setAttribute('data-depth', 1)
  const top = span('_cardTop')
  const badges = span('_cardBadges')
  const badge = span('_kindBadge', kind)
  badge.setAttribute('data-card-kind', kind)
  badges.appendChild(badge)
  top.appendChild(badges)
  top.appendChild(span('_cardName', label))
  row.appendChild(top)
  const bar = span('_cardBar')
  bar.setAttribute('data-card-bar', state)
  if (state === 'running') bar.setAttribute('data-running', 'true')
  bar.appendChild(span('_barDot'))
  bar.appendChild(span('_barState', state))
  row.appendChild(bar)
  return row
}
function snapshot(entries = [{ id: 'a', label: 'Agent A' }, { id: 'b', label: 'Agent B' }]) {
  return {
    byId: Object.fromEntries(entries.map(entry => [entry.id, { displayTitle: entry.label, running: false }])),
    projectionsBySession: { root: { values: { subagentCatalog: entries } } },
  }
}
function harness(initial = snapshot()) {
  const root = new Element('html')
  const body = new Element('body')
  root.appendChild(body)
  const pending = []
  const observers = []
  let list = initial
  let subscription = null
  let unsubscribed = 0
  let snapshots = 0
  let wakes = 0
  const store = {
    getSnapshot() { snapshots += 1; return list },
    subscribe(listener) { subscription = listener; return () => { subscription = null; unsubscribed += 1 } },
  }
  const context = createContext({
    document: {
      documentElement: root, body,
      querySelectorAll: selector => root.querySelectorAll(selector),
      querySelector: selector => root.querySelector(selector),
      createElement: tag => new Element(tag),
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(node, options) { this.root = node; this.options = options; this.connected = true }
      disconnect() { this.connected = false }
    },
    queueMicrotask: callback => pending.push(callback),
    fishIdentity: id => id,
    fishAvatarMarkup: (id, swim) => `${id}:${swim ? 'swim' : 'still'}`,
    shouldFishSwim: state => state === 'running',
    ensureFishSwimming: () => { wakes += 1 },
  })
  runInContext(`${source}\nglobalThis.install = installSidebarRowFish`, context)
  const flush = () => {
    let count = 0
    while (pending.length > 0) { assert.ok(++count < 20, 'microtasks settle'); pending.shift()() }
  }
  const emit = (record) => {
    for (const observer of observers) {
      if (!observer.connected) continue
      if (record.type === 'attributes' && !observer.options.attributes) continue
      if (record.type === 'attributes' && !observer.options.attributeFilter?.includes(record.attributeName)) continue
      if (record.type === 'characterData' && !observer.options.characterData) continue
      observer.callback([{ addedNodes: [], removedNodes: [], ...record }])
    }
  }
  return {
    body, root, store, context, observers, flush, emit,
    install: () => context.install({ sessions: { list: store } }),
    append(row) { body.appendChild(row); emit({ type: 'childList', target: body, addedNodes: [row] }); flush() },
    update(next) { list = next; subscription?.(); flush() },
    notify() { subscription?.(); flush() },
    get list() { return list }, get snapshots() { return snapshots },
    get unsubscribed() { return unsubscribed }, get wakes() { return wakes },
  }
}
const fish = row => row.querySelector('.dsf-row-fish')
function test(name, run) {
  try { run(); console.log(`  ok   ${name}`) }
  catch (error) { failures += 1; console.error(`  FAIL ${name}: ${error.message}`) }
}

console.log('sidebar bundle lifecycle')
test('current tree + default graph decorate; file, root, workflow and fold stay unchanged', () => {
  const h = harness()
  const rows = [treeRow('Agent A'), graphRow('b', 'Agent B', { state: 'running' }),
    treeRow('Agent A', { level: 1 }), treeRow('Agent A', { kind: 'workflow' }), treeRow('Agent A', { kind: 'fold' }),
    graphRow('a', 'Agent A', { kind: 'main' }), graphRow('a', 'Agent A', { kind: 'workflow' }), graphRow('a', 'Agent A', { kind: 'fold' })]
  const file = new Element(); file.setAttribute('role', 'treeitem'); file.setAttribute('aria-level', 1); file.textContent = 'Agent A'
  for (const row of [...rows, file]) h.body.appendChild(row)
  h.install(); h.flush()
  assert.equal(fish(rows[0])?.innerHTML, 'a:still')
  assert.equal(fish(rows[1])?.innerHTML, 'b:swim')
  assert.equal(fish(rows[1])?.parentElement.getAttribute('data-card-bar'), 'running')
  assert.equal(fish(rows[1])?.getAttribute('data-dsf-layout'), 'graph')
  assert.equal(h.wakes, 1)
  for (const row of [...rows.slice(2), file]) assert.equal(fish(row), null)
})
test('older dedicated subagent labels still work at level 1', () => {
  const h = harness(); const row = treeRow('Agent A', { level: 1, legacy: true })
  h.body.appendChild(row); h.install(); h.flush(); assert.equal(fish(row)?.innerHTML, 'a:still')
})
test('both displayTitle and id fallbacks match, including surrounding whitespace', () => {
  const h = harness(snapshot([{ id: 'a' }, { id: 'b' }, { id: 'c', label: '  Agent C  ' }]))
  h.list.byId.a.displayTitle = 'Display A'
  const rows = [treeRow('Display A'), treeRow('b'), treeRow('  Agent C  ')]
  rows.forEach(row => h.body.appendChild(row)); h.install(); h.flush()
  assert.deepEqual(rows.map(row => fish(row)?.innerHTML), ['a:still', 'b:still', 'c:still'])
})
test('duplicate titles are skipped in tree but graph uses its actual id', () => {
  const h = harness(snapshot([{ id: 'a', label: 'Same' }, { id: 'b', label: 'Same' }]))
  const tree = treeRow('Same', { legacy: true }), graph = graphRow('b', 'Same')
  h.body.appendChild(tree); h.body.appendChild(graph); h.install(); h.flush()
  assert.equal(fish(tree), null); assert.equal(fish(graph)?.innerHTML, 'b:still')
})
test('repeated references to the same id do not cause false ambiguity', () => {
  const h = harness(); h.list.projectionsBySession.a = h.list.projectionsBySession.root
  const row = treeRow('Agent A', { legacy: true }); h.body.appendChild(row); h.install(); h.flush()
  assert.equal(fish(row)?.innerHTML, 'a:still')
})
test('text-only updates refresh a reused row identity even when run state is unchanged', () => {
  const h = harness(); const row = treeRow('Agent A', { legacy: true }); h.body.appendChild(row); h.install(); h.flush()
  const title = row.querySelector('[class*="_subagentLabel"]'); title.textContent = 'Agent B'
  h.emit({ type: 'characterData', target: { nodeType: 3, parentElement: title } }); h.flush()
  assert.equal(fish(row)?.innerHTML, 'b:still'); assert.equal(row.getAttribute('dsfFishId'), 'b')
})
test('graph id and state attribute changes update the existing fish in place', () => {
  const h = harness(); const row = graphRow('a', 'Agent A'); h.body.appendChild(row); h.install(); h.flush()
  const host = fish(row); row.setAttribute('data-graph-node', 'b')
  h.emit({ type: 'attributes', target: row, attributeName: 'data-graph-node' }); h.flush()
  assert.equal(fish(row), host); assert.equal(host.innerHTML, 'b:still')
  const bar = row.querySelector('[data-card-bar]'); bar.setAttribute('data-card-bar', 'running')
  h.emit({ type: 'attributes', target: bar, attributeName: 'data-card-bar' }); h.flush()
  assert.equal(host.innerHTML, 'b:swim'); assert.equal(h.wakes, 1)
})
test('session running transitions start and stop tree fish without duplicates', () => {
  const h = harness(); const row = treeRow('Agent A', { legacy: true }); h.body.appendChild(row); h.install(); h.flush()
  h.list.byId.a.running = true; h.notify(); assert.equal(fish(row)?.innerHTML, 'a:swim')
  h.list.byId.a.running = false; h.notify(); assert.equal(fish(row)?.innerHTML, 'a:still')
  assert.equal(row.querySelectorAll('.dsf-row-fish').length, 1); assert.equal(h.wakes, 1)
})
test('modern tree trusts LiveLine markers when the independent summary is stale', () => {
  for (const marker of ['_nodeMeta', '_live', '_liveText']) {
    const h = harness(); const row = treeRow('Agent A')
    const content = row.querySelector('[class*="_treeContent"]'), live = span(marker, '运行中')
    content.appendChild(live); h.body.appendChild(row); h.install(); h.flush()
    assert.equal(h.list.byId.a.running, false); assert.equal(fish(row)?.innerHTML, 'a:swim')
    h.list.byId.a.running = true; live.remove()
    h.emit({ type: 'childList', target: content, removedNodes: [live] }); h.flush()
    assert.equal(fish(row)?.innerHTML, 'a:still')
  }
})
test('catalog removal or becoming ambiguous removes stale fish', () => {
  const h = harness(); const row = treeRow('Agent A', { legacy: true }); h.body.appendChild(row); h.install(); h.flush()
  h.update(snapshot([{ id: 'a', label: 'Agent A' }, { id: 'b', label: 'Agent A' }]))
  assert.equal(fish(row), null); assert.equal(row.getAttribute('dsfFishId'), null)
  h.update(snapshot()); assert.equal(fish(row)?.innerHTML, 'a:still')
  h.update(snapshot([])); assert.equal(fish(row), null)
})
test('late opening after many unrecognized tree scans still decorates', () => {
  const h = harness(); const file = treeRow('Unknown', { legacy: true })
  h.body.appendChild(file); h.install(); h.flush()
  for (let i = 0; i < 60; i += 1) { h.emit({ type: 'childList', target: file }); h.flush() }
  const row = treeRow('Agent A', { legacy: true }); h.append(row); assert.equal(fish(row)?.innerHTML, 'a:still')
})
test('React replacing graph bar reattaches cached swimming fish and wakes animation', () => {
  const h = harness(); const row = graphRow('a', 'Agent A', { state: 'running' })
  h.body.appendChild(row); h.install(); h.flush()
  const host = fish(row), oldBar = host.parentElement, bar = span('_cardBar')
  bar.setAttribute('data-card-bar', 'running'); oldBar.remove(); row.appendChild(bar)
  h.emit({ type: 'childList', target: row, addedNodes: [bar], removedNodes: [oldBar] }); h.flush()
  assert.equal(fish(row), host); assert.equal(host.parentElement, bar); assert.equal(h.wakes, 2)
})
test('removed rows release fish and a later reinsertion recovers', () => {
  const h = harness(); const row = treeRow('Agent A', { legacy: true }); h.body.appendChild(row); h.install(); h.flush()
  row.remove(); h.emit({ type: 'childList', target: h.body, removedNodes: [row] }); h.flush()
  assert.equal(fish(row), null); assert.equal(row.getAttribute('dsfFishId'), null)
  h.append(row); assert.equal(fish(row)?.innerHTML, 'a:still')
})
test('unrelated text and fish animation attributes do not read the session snapshot', () => {
  const h = harness(); const row = treeRow('Agent A'); h.body.appendChild(row); h.install(); h.flush()
  const count = h.snapshots, foreign = span('_transcript', 'hello'); h.body.appendChild(foreign)
  h.emit({ type: 'characterData', target: { nodeType: 3, parentElement: foreign } }); h.flush()
  h.emit({ type: 'attributes', target: fish(row), attributeName: 'transform' }); h.flush()
  assert.equal(h.snapshots, count)
})
test('disposal cleans detached rows, unsubscribes once and cancels pending work', () => {
  const h = harness(); const row = treeRow('Agent A', { legacy: true }); h.body.appendChild(row)
  const dispose = h.install(); h.flush(); row.remove()
  h.emit({ type: 'childList', target: h.body, removedNodes: [row] }); dispose(); dispose(); h.flush()
  assert.equal(fish(row), null); assert.equal(row.getAttribute('dsfFishId'), null)
  assert.equal(h.unsubscribed, 1); assert.equal(h.observers[0].connected, false)
  h.append(row); assert.equal(fish(row), null)
})
test('a reused DOM row gets the correct layout when switching tree to graph', () => {
  const h = harness(); const row = treeRow('Agent A'); h.body.appendChild(row); h.install(); h.flush()
  const host = fish(row), replacement = graphRow('a', 'Agent A')
  row.setAttribute('role', 'button'); row.setAttribute('data-graph-node', 'a')
  while (replacement.firstChild !== null) row.appendChild(replacement.firstChild)
  h.emit({ type: 'attributes', target: row, attributeName: 'data-graph-node' }); h.flush()
  assert.equal(fish(row), host); assert.equal(host.getAttribute('data-dsf-layout'), 'graph')
  assert.equal(host.parentElement.getAttribute('data-card-bar'), 'done')
})
test('a decorated row that loses its sidebar semantics is cleaned immediately', () => {
  const h = harness(); const row = graphRow('a', 'Agent A'); h.body.appendChild(row); h.install(); h.flush()
  row.removeAttribute('data-graph-node')
  h.emit({ type: 'attributes', target: row, attributeName: 'data-graph-node' }); h.flush()
  assert.equal(fish(row), null); assert.equal(row.getAttribute('dsfFishId'), null)
})
test('missing session store is a safe no-op', () => {
  const h = harness(); assert.equal(typeof h.context.install({ sessions: {} }), 'function')
  assert.equal(typeof h.context.install({}), 'function')
})
console.log(failures === 0 ? '\nall sidebar checks passed' : `\n${failures} sidebar check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
