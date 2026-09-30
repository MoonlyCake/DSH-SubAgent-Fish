#!/usr/bin/env node
/** Address decoding, status hook boundaries, and scoped plugin registration. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let activeComponent
let hooks
const markHook = (name) => {
  const list = hooks.get(activeComponent) ?? []
  list.push(name)
  hooks.set(activeComponent, list)
}
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
}
const sandbox = {
  React,
  FishAvatar: (props) => ({ type: 'fish', props }),
  installFishCss: () => () => {},
  stopFishSwimming: () => {},
  installSidebarRowFish: () => () => {},
}
const context = createContext(sandbox)
runInContext(`${readFileSync(join(root, 'src/client/subagent-tab-title.js'), 'utf8')}\n${readFileSync(join(root, 'src/client/index.js'), 'utf8')}\nglobalThis.api = { subagentSessionIdOf, SubagentFishTabTitle, apply }`, context)
const { subagentSessionIdOf, SubagentFishTabTitle, apply } = sandbox.api
const prefix = 'dsh-resource://subagentchat/session/'
assert.equal(subagentSessionIdOf(`${prefix}child-42`), 'child-42')
assert.equal(subagentSessionIdOf(`${prefix}%E5%AD%90%20%E4%BB%A3%E7%90%86`), '子 代理')
assert.equal(subagentSessionIdOf(`${prefix}child%3F%23?parent=parent-a&mode=one-shot#unused`), 'child?#')
assert.equal(subagentSessionIdOf(`${prefix}child%2Fa?parent=parent-a&mode=one-shot`), 'child/a')
for (const address of [undefined, null, 42, '', prefix, `${prefix}?parent=p`, `${prefix}child/extra`, `${prefix}bad-%zz`, `${prefix}%E0%A4%A`, 'dsh-resource://file/a.md']) {
  assert.equal(subagentSessionIdOf(address), undefined, `graceful fallback for ${String(address)}`)
}

function render(node) {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(render)
  if (!('type' in node)) return node
  if (typeof node.type === 'function') {
    const previous = activeComponent
    activeComponent = node.type.name
    const rendered = render(node.type(node.props))
    activeComponent = previous
    return rendered
  }
  return { type: node.type, props: { ...node.props, children: render(node.props.children) } }
}
function title(contentId, { statuses, statusHook = true, label = 'title' } = {}) {
  hooks = new Map()
  const props = {
    useTabInfo: () => { markHook('tab'); return { tab: { contentId, title: label } } },
  }
  if (statusHook) props.useSessionStatus = (selector) => { markHook('status'); return selector(statuses) }
  const result = render(React.createElement(SubagentFishTabTitle, props))
  return { result, hookMap: hooks }
}
const running = title(`${prefix}child%20a`, { statuses: new Map([['child a', { running: true }]]) })
assert.equal(running.result.props.children[0].type, 'fish')
assert.equal(running.result.props.children[0].props.id, 'child a')
assert.equal(running.result.props.children[0].props.state, 'running')
assert.equal(running.result.props.children[0].props.size, 20)
assert.equal(running.result.props.children[1].props.children[0], 'title')
const addressed = title(`${prefix}child%20a?parent=parent-b&mode=continuable`, { statuses: new Map([['child a', { running: true }]]) })
assert.equal(addressed.result.props.children[0].props.id, 'child a', 'parent/mode never change fish identity')
assert.equal(addressed.result.props.children[0].props.state, 'running', 'DSH addressed child finds the correct status')
for (const statuses of [undefined, new Map(), new Map([['child a', { running: false }]]), new Map([['child a', { running: 1 }]])]) {
  assert.equal(title(`${prefix}child%20a`, { statuses }).result.props.children[0].props.state, undefined)
}
const noStatus = title(`${prefix}child%20a`, { statusHook: false })
assert.equal(noStatus.result.props.children[0].props.state, undefined)
assert.deepEqual(running.hookMap.get('SubagentFishTabTitle'), noStatus.hookMap.get('SubagentFishTabTitle'), 'optional status hook cannot alter parent hook sequence')
assert.deepEqual(running.hookMap.get('SubagentFishStatusTabTitle'), ['status'])
for (const contentId of [`${prefix}bad-%zz`, prefix, 'dsh-resource://file/a.md']) {
  const plain = title(contentId)
  assert.equal(plain.result, 'title')
  assert.deepEqual(plain.hookMap.get('SubagentFishStatusTabTitle'), ['status'], 'navigation keeps status hook unconditional within its component')
}
const originalTitle = { rich: true }
assert.equal(title('unknown', { label: originalTitle, statusHook: false }).result, originalTitle)

const registrations = []
const effects = []
const disposals = []
sandbox.installFishCss = () => { registrations.push('css'); return () => disposals.push('css') }
sandbox.stopFishSwimming = () => disposals.push('swim')
sandbox.installSidebarRowFish = () => { registrations.push('rows'); return () => disposals.push('rows') }
let serviceCallback
const ctx = {
  effect(factory) { effects.push(factory()) },
  slots: {
    inject(name, callback) { registrations.push(name); return callback() },
    register(spec, component) {
      assert.equal(spec.key, '@deepseek-ai/dsh-client-ui-subagent')
      assert.equal(component, SubagentFishTabTitle)
      return () => disposals.push('slot')
    },
  },
  inject(services, callback) {
    assert.deepEqual(Array.from(services), ['betterSidebar'])
    serviceCallback = callback
  },
}
apply(ctx)
assert.equal(registrations.includes('rows'), false, 'optional sidebar need not be installed')
serviceCallback({ effect: ctx.effect })
assert.equal(registrations.includes('rows'), true, 'sidebar can appear after plugin installation')
for (const dispose of effects.reverse()) dispose?.()
assert.deepEqual(disposals, ['rows', 'slot', 'swim', 'css'])
console.log('tab title and plugin lifecycle checks passed')
