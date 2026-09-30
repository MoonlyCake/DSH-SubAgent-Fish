// ---------------------------------------------------------------------------
// E · 在 dsh-better-sidebar 的任务树 / 工作流图里给子代理挂上小鱼。
//
// TasksTree 没有行级 id，按其 treeTitle（旧版 subagentLabel）与 catalog 的
// 同一命名规则反查；重名时不猜。TasksGraph 已有 data-graph-node，直接用 id，
// 并要求子代理 / 队友种类标记和 catalog 身份，避免触碰主代理、工作流、折叠组。
// 本文件由 tools/build-client.mjs 拼进 lib/client.js，共用同一个作用域。
// ---------------------------------------------------------------------------

const SUBAGENT_ROW_SELECTOR = '[role="treeitem"][aria-level]'
const SUBAGENT_GRAPH_SELECTOR = '[data-graph-node][role="button"]'
const SIDEBAR_FISH_SELECTOR = `${SUBAGENT_ROW_SELECTOR}, ${SUBAGENT_GRAPH_SELECTOR}`
const SUBAGENT_LABEL_SELECTOR = '[class*="treeTitle"][title], [class*="_subagentLabel"]'
// 保留旧标记名，方便已有预览和诊断读取；卸载时只清理自己拥有的节点。
const ROW_MARK = 'dsfFishId'

/** 使用与 better-sidebar childLabel 相同的 entry.label → displayTitle → id 规则。 */
function subagentRowsIndex(list) {
  const byLabel = new Map()
  const ids = new Set()
  const projections = list?.projectionsBySession
  if (projections === null || typeof projections !== 'object') return { byLabel, ids }
  for (const projection of Object.values(projections)) {
    const entries = projection?.values?.subagentCatalog
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) continue
      ids.add(entry.id)
      const label = entry.label ?? list.byId?.[entry.id]?.displayTitle ?? entry.id
      if (typeof label !== 'string' || label.trim().length === 0) continue
      const key = label.trim()
      // 同一个 id 在多个投影里出现不算重名；不同 id 重名则不能安全地反查。
      if (!byLabel.has(key)) byLabel.set(key, entry.id)
      else if (byLabel.get(key) !== entry.id) byLabel.set(key, null)
    }
  }
  return { byLabel, ids }
}

function rowFishState(list, sessionId) {
  return list?.byId?.[sessionId]?.running === true ? 'running' : 'done'
}

/** 获取已确认的身份和挂载点；结构不认识时什么都不做。 */
function sidebarFishTarget(row, index, list) {
  if (row.matches(SUBAGENT_GRAPH_SELECTOR)) {
    const sessionId = row.getAttribute('data-graph-node')
    const kind = row.querySelector('[data-card-kind]')?.getAttribute('data-card-kind')
    const bar = row.querySelector('[data-card-bar]')
    if ((kind !== 'subagent' && kind !== 'teammate') || !index.ids.has(sessionId) || bar === null) return null
    // 图模式已有真正驱动状态条的状态，优先使用它，避免等会话摘要追上。
    const state = bar.getAttribute('data-running') === 'true' || bar.getAttribute('data-card-bar') === 'running'
      ? 'running' : 'done'
    return { sessionId, state, parent: bar, layout: 'graph' }
  }
  const labelElement = row.querySelector(SUBAGENT_LABEL_SELECTOR)
  if (labelElement === null) return null
  const modernTree = labelElement.matches('[class*="treeTitle"]')
  if (modernTree) {
    // TasksTree 的根代理在 level 1，工作流行声明 aria-expanded，折叠组没有
    // 带 title 的 treeTitle。旧版专用 subagentLabel 不需要这些新版条件。
    if (!row.hasAttribute('data-tasks-row') || row.getAttribute('aria-level') === '1' || row.hasAttribute('aria-expanded')) return null
  }
  const label = labelElement.textContent?.trim()
  const sessionId = index.byLabel.get(label)
  if (typeof sessionId !== 'string') return null
  // TasksTree 的状态来自 subagents.live，与 list.byId.running 是独立数据源。
  // 它仅在 running 时添加 LiveLine；该组件总会画 nodeMeta（思考中）、live
  // 或 liveText 中的至少一种。只检查标题同层节点，避开嵌套子代理和任务按钮。
  const treeRunning = modernTree && Array.from(labelElement.parentElement.children).some(element =>
    /(?:^|\s)(?:\S+_)?(?:nodeMeta|live|liveText)(?:\s|$)/.test(element.getAttribute('class') ?? ''))
  const state = modernTree ? treeRunning ? 'running' : 'done' : rowFishState(list, sessionId)
  return { sessionId, state, parent: row, layout: 'tree' }
}

/** 观察结构 / 文本 / 状态变化，卸载时释放订阅和自己添加的节点。 */
function installSidebarRowFish(ctx) {
  const store = ctx.sessions?.list
  if (typeof store?.getSnapshot !== 'function') return () => {}
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {}
  const root = document.documentElement ?? document.body
  if (root === null || root === undefined) return () => {}

  let pending = false
  let disposed = false
  const owned = new Map()

  const removeFish = (row, host) => {
    host.remove()
    row.removeAttribute(ROW_MARK)
    owned.delete(row)
  }

  const decorate = () => {
    pending = false
    if (disposed) return
    const list = store.getSnapshot()
    const index = subagentRowsIndex(list)
    const seen = new Set()
    let addedSwimmingFish = false
    for (const row of document.querySelectorAll(SIDEBAR_FISH_SELECTOR)) {
      const target = sidebarFishTarget(row, index, list)
      let host = owned.get(row)
      if (target === null) {
        if (host !== undefined) removeFish(row, host)
        continue
      }
      seen.add(row)
      if (host === undefined) {
        host = document.createElement('span')
        host.className = 'dsf-row-fish'
        host.setAttribute('aria-hidden', 'true')
        owned.set(row, host)
      }
      const { sessionId, state, parent, layout } = target
      const changed = host.getAttribute('data-dsf-id') !== sessionId || host.getAttribute('data-dsf-state') !== state
      if (changed) {
        host.innerHTML = fishAvatarMarkup(fishIdentity(sessionId), shouldFishSwim(state))
        host.setAttribute('data-dsf-id', sessionId)
        host.setAttribute('data-dsf-state', state)
      }
      host.setAttribute('data-dsf-layout', layout)
      const reattached = host.parentNode !== parent
      if (reattached) parent.insertBefore(host, parent.firstChild)
      row.setAttribute(ROW_MARK, sessionId)
      if ((changed || reattached) && shouldFishSwim(state)) addedSwimmingFish = true
    }
    // React 可能重用、移除或更换一整行。不能让旧身份留在新行或脱离文档的节点上。
    for (const [row, host] of owned) {
      if (!seen.has(row)) removeFish(row, host)
    }
    if (addedSwimmingFish) ensureFishSwimming()
  }

  const schedule = () => {
    if (pending || disposed) return
    pending = true
    queueMicrotask(decorate)
  }

  // 不为整页每次动画 / 文字更新扫描；只响应任务节点和包含它们的结构变化。
  // 观察器始终待命，页面晚些打开或 better-sidebar 重挂载也能恢复。
  const relevantNode = (node) => {
    const element = node?.nodeType === 1 ? node : node?.parentElement
    if (element === null || element === undefined || typeof element.closest !== 'function') return false
    if (element.closest('.dsf-row-fish') !== null) return false
    return owned.has(element) || element.closest(SIDEBAR_FISH_SELECTOR) !== null
      || element.matches(SIDEBAR_FISH_SELECTOR)
      || element.querySelector(SIDEBAR_FISH_SELECTOR) !== null
  }
  const observer = new MutationObserver((records) => {
    if (records.some(record => relevantNode(record.target)
      || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(relevantNode)))) schedule()
  })
  observer.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'title', 'role', 'aria-level', 'aria-expanded', 'data-tasks-row', 'data-graph-node', 'data-card-kind', 'data-card-bar', 'data-running'],
  })
  const unsubscribe = typeof store.subscribe === 'function' ? store.subscribe(schedule) : undefined
  schedule()

  return () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    if (typeof unsubscribe === 'function') unsubscribe()
    for (const [row, host] of owned) removeFish(row, host)
  }
}
