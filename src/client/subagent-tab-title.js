// ---------------------------------------------------------------------------
// D · 右侧栏的子代理标签
//
// DSH 把「每个标签的标题画什么」单独开了一个按类型分发的插槽
// （`sidebar.right.pane.tab.title`，keyed）。子代理对话的标签类型是
// `@deepseek-ai/dsh-client-ui-subagent`，而它自己**没有**占用这个插槽——
// 所以标签上写什么是我们说了算，而标签正文（真正的对话内容）一点都不用碰。
//
// 标签的地址形如 dsh-resource://subagentchat/session/<子会话 id>?parent=…&mode=…，
// 这个 id 就是那条鱼的身份来源：同一个子代理的标签，鱼永远是同一条。
//
// 本文件由 tools/build-client.mjs 拼进 lib/client.js，共用同一个作用域。
// ---------------------------------------------------------------------------

/** 子代理对话标签的类型 id（= dsh-client-ui-subagent 的注册 id）。 */
const SUBAGENT_CHAT_TAB_ID = '@deepseek-ai/dsh-client-ui-subagent'
/**
 * 标签上那颗鱼多大（px）。想调大小就改这里。
 * 标签本身约 28px 高、字 12px，所以别调太大。
 */
const TAB_FISH_SIZE = 20

/** 子代理对话地址的前缀；后面的 path 段是子会话 id，query 不是鱼的身份。 */
const SUBAGENT_CHAT_PREFIX = 'dsh-resource://subagentchat/session/'

/**
 * 从标签地址里取出子会话 id。
 * @param address - 标签的 contentId。
 * @returns 子会话 id；地址不是子代理对话时返回 undefined。
 */
function subagentSessionIdOf(address) {
  if (typeof address !== 'string' || !address.startsWith(SUBAGENT_CHAT_PREFIX)) return undefined
  const id = address.slice(SUBAGENT_CHAT_PREFIX.length).split(/[?#]/, 1)[0]
  // 官方地址把 childSessionId 编码为单独的 path 段；%2F 是 id 内容，裸 / 是错地址。
  if (id.length === 0 || id.includes('/')) return undefined
  try {
    return decodeURIComponent(id)
  } catch {
    // 损坏的地址也可能带 %，不能让 URIError 把整个标签栏渲染打断。
    return undefined
  }
}

/** 状态 hook 放在自己的组件里，避免可选 hook 出现 / 消失时改变 hook 顺序。 */
function SubagentFishStatusTabTitle({ tab, childId, useSessionStatus }) {
  const running = useSessionStatus((statuses) => childId !== undefined && statuses?.get?.(childId)?.running === true)
  return renderSubagentFishTabTitle(tab, childId, running)
}

/** 用纯渲染函数共用有状态和无状态的标题。 */
function renderSubagentFishTabTitle(tab, childId, running) {
  if (childId === undefined) return tab.title
  return React.createElement(
    'span',
    { className: 'dsf-chip' },
    React.createElement(FishAvatar, { id: childId, size: TAB_FISH_SIZE, state: running === true ? 'running' : undefined }),
    React.createElement('span', { className: 'dsf-label' }, tab.title),
  )
}

/**
 * 子代理标签的标题：小鱼 + 原来的名字。
 *
 * 地址不是子代理对话时原样返回标题 —— 这样即使 DSH 以后改了地址格式，
 * 最坏也只是没有鱼，不会把标签弄坏。
 */
function SubagentFishTabTitle(props) {
  const { useTabInfo, useSessionStatus } = props
  const info = useTabInfo()
  const tab = info.tab
  const childId = subagentSessionIdOf(tab.contentId)
  // childId 是否存在不能决定是否调用 hook；标签导航时它会改变。
  // 可选的 hook 自己有一个组件边界，props 的可用性改变时由 React 安全挂卸载。
  if (typeof useSessionStatus === 'function') {
    return React.createElement(SubagentFishStatusTabTitle, { tab, childId, useSessionStatus })
  }
  return renderSubagentFishTabTitle(tab, childId, undefined)
}
