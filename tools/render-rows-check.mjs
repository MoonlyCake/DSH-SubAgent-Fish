#!/usr/bin/env node
/** Real-DOM browser fixture for the shipped bundle.
 *
 * Structure follows better-sidebar 0.24.1 TasksTree.tsx, TasksGraph.tsx and
 * tasks-card.tsx: current treeTitle[title] rows and default graph cards with
 * data-graph-node / data-card-kind / data-card-bar. Source links appear in the
 * page. Includes view switch, run-state update and unload controls. Browser
 * assertions are exposed as window.__dsfRowsCheckResult and #probe JSON.
 * Usage: node tools/render-rows-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const ROWS = [
  { id: 'c-docs', label: '调研 DSH 插件开发文档', level: 2, running: true },
  { id: 'c-docs-1', label: '抓取 slots 章节', level: 3, running: false },
  { id: 'c-install', label: '把插件装进 web profile', level: 2, running: false },
]
function treeRow(row, kind = 'agent') {
  const label = escapeHtml(row.label)
  return `<div class="hash_treeRow" data-tasks-row role="treeitem" tabindex="0" aria-level="${row.level}" aria-label="${label} 一次性 · 已完成"${kind === 'workflow' ? ' aria-expanded="true"' : ''} data-fixture-id="${row.id}">
    <span class="hash_treeDot"></span><span class="hash_treeGlyph" aria-hidden="true">◇</span>
    <span class="hash_treeContent"><span class="hash_treeTitle"${kind === 'fold' ? '' : ` title="${label}"`}>${label}</span>
    <span class="hash_treeMeta">一次性 · 已完成</span>${row.running ? '<span class="hash_nodeMeta">思考中</span>' : ''}</span></div>`
}
function graphRow(row, kind = 'subagent') {
  const label = escapeHtml(row.label)
  return `<div class="hash_node" data-graph-node="${row.id}" data-depth="1" role="button" tabindex="-1" aria-label="${label} 一次性 · 已完成">
    <span class="hash_cardTop hash_depth1"><span class="hash_cardBadges"><span class="hash_kindBadge" data-card-kind="${kind}">${kind}</span></span>
      <span class="hash_cardName" title="${label}">${label}</span><span class="hash_cardMeta" title="一次性">一次性</span></span>
    <span class="hash_cardBar" data-card-bar="${row.running ? 'running' : 'done'}"${row.running ? ' data-running="true"' : ''}>
      <span class="hash_barDot"></span><span class="hash_barState">${row.running ? '运行中' : '已完成'}</span></span></div>`
}
const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>better-sidebar graph + tree regression check</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#16161a;color:#e8e8ec;font-family:-apple-system,"PingFang SC",sans-serif;font-size:13px}
main{max-width:1180px;margin:24px auto;padding:0 24px}h1{font-size:20px}h2{font-size:14px;font-weight:500}p,a{color:#aaaab4}a{color:#8ab4f8}
.controls{display:flex;gap:10px;align-items:center;margin:18px 0}button{padding:6px 10px;background:#25252d;color:inherit;border:1px solid #4a4a55;border-radius:4px;cursor:pointer}
.views{display:grid;grid-template-columns:1fr 1fr;gap:28px}.panel{padding:12px;border:1px solid #35353f}.graph{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
.hash_node{width:210px;display:flex;flex-direction:column;border:1px solid #4a4a55;border-radius:4px;overflow:hidden;cursor:pointer}
.hash_cardTop{display:flex;flex-direction:column;gap:2px;padding:6px 8px 5px;min-height:60px;background:#24242c}
.hash_cardBadges{display:flex;align-items:center;gap:4px}.hash_kindBadge{font-size:10px;color:#8b96ae}.hash_cardName{font-size:12px;font-weight:600}.hash_cardMeta{font-size:11px;color:#aaaab4}
.hash_cardBar{display:flex;align-items:center;gap:5px;height:22px;padding:0 6px 0 8px;border-top:1px solid #35353f;overflow:hidden;font-size:11px}
.hash_barDot,.hash_treeDot{width:6px;height:6px;border-radius:50%;background:#3ecf8e;flex:none}.hash_cardBar[data-running]{background:#222b29}
.hash_treeRow{display:flex;align-items:flex-start;gap:7px;padding:0 8px;cursor:pointer}.hash_treeDot,.hash_treeGlyph{margin-top:9px}.hash_treeContent{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;min-height:32px}
.hash_treeTitle{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hash_treeMeta{font-size:11px;color:#aaaab4}.hash_treeRow[aria-level="3"]{margin-left:25px}
.decoys{margin-top:20px}.decoys [role]{margin:4px 0}.decoys .hash_node{display:none}pre{white-space:pre-wrap;font-size:11px;color:#a4cbb3}#status{color:#a4cbb3}
</style></head>
<body data-ds-dark-theme><main>
<h1>better-sidebar 0.24.1：图模式与树模式</h1>
<p>DOM anchors follow <a href="https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/TasksGraph.tsx">TasksGraph</a>,
<a href="https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/TasksTree.tsx">TasksTree</a> and
<a href="https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/tasks-card.tsx">tasks-card</a>. CSS below preserves their relevant flex and state-bar geometry.</p>
<div class="controls"><button id="view-toggle">切换为树模式</button><button id="state-toggle">切换第三个子代理的运行状态</button><button id="dispose">卸载插件</button><span id="status">正在检查…</span></div>
<div class="views"><section class="panel" id="graph-panel"><h2>Graph（桌面默认模式）</h2><div class="graph" id="graph">${ROWS.map(row => graphRow(row)).join('')}</div></section>
<section class="panel" id="tree-panel"><h2>TasksTree</h2><div role="tree" id="tree">${ROWS.map(row => treeRow(row)).join('')}</div></section></div>
<div class="decoys" id="decoys"><h2>必须保持原样的节点</h2>
<div role="treeitem" aria-level="1">README.md（文件树）</div>
${treeRow({ id: 'root', label: ROWS[0].label, level: 1 })}
${treeRow({ id: 'workflow', label: ROWS[0].label, level: 2 }, 'workflow')}
${treeRow({ id: 'fold', label: ROWS[0].label, level: 2 }, 'fold')}
${graphRow(ROWS[0], 'main')}${graphRow(ROWS[0], 'workflow')}${graphRow(ROWS[0], 'fold')}
</div><pre id="probe"></pre>
</main>
<script>
var React = { Fragment: Symbol('f'), createElement: function(t,p){return {type:t,props:p||{}}}, useMemo:function(f){return f()},useRef:function(i){return {current:i}},useState:function(i){return [i,function(){}]},useEffect:function(){},useSyncExternalStore:function(_s,g){return g()} };
var captured;
window.__ModuleLoader__ = {load:function(entry){captured=entry.factory(function(id){if(id==='react')return React;throw new Error(id)})}};
</script><script>${bundle}</script>
<script>
const rows = ${JSON.stringify(ROWS)};
const list = { byId: Object.fromEntries(rows.map(row => [row.id,{ displayTitle:row.label,running:row.running }])),
 projectionsBySession: { root:{values:{subagentCatalog:rows.map(row=>({id:row.id,label:row.label,mode:'one-shot'}))}} } };
const listeners = new Set();
let effects=[];
const sessions={list:{getSnapshot:function(){return list},subscribe:function(fn){listeners.add(fn);return function(){listeners.delete(fn)}}}};
function effect(fn){const dispose=fn();if(typeof dispose==='function')effects.push(dispose)}
function mount(){captured.apply({effect:effect,slots:{inject:function(){return function(){}},register:function(s,c){return {spec:s,component:c}}},
 inject:function(services,callback){if(services.includes('betterSidebar'))callback({effect:effect,betterSidebar:{},sessions:sessions})}})}
function disposeRows(){const old=effects;effects=[];old.reverse().forEach(function(dispose){dispose()})}
mount();
function refresh(){listeners.forEach(function(fn){fn()})}
function delay(){return new Promise(function(resolve){setTimeout(resolve,30)})}
function inventory(container){return Array.from(container.querySelectorAll('[data-tasks-row], [data-graph-node]')).map(function(row){
 const fish=row.querySelector('.dsf-row-fish');return {id:row.getAttribute('data-graph-node')||row.getAttribute('data-fixture-id'),fishId:fish&&fish.getAttribute('data-dsf-id'),state:fish&&fish.getAttribute('data-dsf-state'),swims:!!(fish&&fish.querySelector('svg.fish-swim[data-fish-id]')),count:row.querySelectorAll('.dsf-row-fish').length};})}
function phase(){return {graph:inventory(document.getElementById('graph')),tree:inventory(document.getElementById('tree')),decoyTouched:document.querySelectorAll('#decoys .dsf-row-fish').length}}
function setThirdRunning(running){list.byId['c-install'].running=running;const bar=document.querySelector('#graph [data-graph-node="c-install"] [data-card-bar]');bar.setAttribute('data-card-bar',running?'running':'done');if(running)bar.setAttribute('data-running','true');else bar.removeAttribute('data-running');const content=document.querySelector('#tree [data-fixture-id="c-install"] [class*="treeContent"]');const live=content.querySelector('[class*="nodeMeta"]');if(running&&!live){const node=document.createElement('span');node.className='hash_nodeMeta';node.textContent='思考中';content.appendChild(node)}else if(!running&&live)live.remove();refresh()}
let onlyTree=false;
document.getElementById('view-toggle').onclick=function(){onlyTree=!onlyTree;document.getElementById('graph-panel').hidden=onlyTree;document.getElementById('tree-panel').hidden=!onlyTree;document.querySelector('.views').style.gridTemplateColumns='1fr';this.textContent=onlyTree?'切换为图模式':'切换为树模式'};
document.getElementById('state-toggle').onclick=function(){setThirdRunning(!list.byId['c-install'].running)};
document.getElementById('dispose').onclick=function(){disposeRows();document.getElementById('status').textContent='已卸载：鱼全部清理，订阅 '+listeners.size};
(async function(){
 const result={viewport:{width:innerWidth,height:innerHeight},phases:{},checks:[]};
 const check=function(name,passed){result.checks.push({name,passed})};
 await delay();result.phases.initial=phase();
 check('three tree rows and three default graph cards decorated',result.phases.initial.tree.every(row=>row.fishId===row.id&&row.count===1)&&result.phases.initial.graph.every(row=>row.fishId===row.id&&row.count===1));
 check('file, root, workflow and fold nodes untouched',result.phases.initial.decoyTouched===0);
 check('running fish swims and settled fish remain still',result.phases.initial.tree[0].swims&&result.phases.initial.graph[0].swims&&!result.phases.initial.tree[2].swims&&!result.phases.initial.graph[2].swims);
 setThirdRunning(true);await delay();result.phases.running=phase();
 check('tree and graph respond to running state changes',result.phases.running.tree[2].swims&&result.phases.running.graph[2].swims);
 setThirdRunning(false);await delay();result.phases.finished=phase();
 check('tree and graph stop completed fish',!result.phases.finished.tree[2].swims&&!result.phases.finished.graph[2].swims);
 const firstTree=document.querySelector('#tree [data-tasks-row]');const title=firstTree.querySelector('[class*="treeTitle"]');title.firstChild.data=rows[1].label;await delay();
 check('text-node-only row reuse changes identity',firstTree.querySelector('.dsf-row-fish').getAttribute('data-dsf-id')===rows[1].id);
 title.firstChild.data=rows[0].label;await delay();
 const graphCard=document.querySelector('#graph [data-graph-node="c-docs"]');const oldBar=graphCard.querySelector('[data-card-bar]');const newBar=oldBar.cloneNode(true);newBar.querySelector('.dsf-row-fish').remove();oldBar.replaceWith(newBar);await delay();
 check('React replacing card state bar restores fish',newBar.querySelectorAll('.dsf-row-fish').length===1);
 disposeRows();await delay();
 check('unload cleans both surfaces and unsubscribes',document.querySelectorAll('.dsf-row-fish').length===0&&listeners.size===0);
 // Remount for interactive visual inspection and manual state/view controls.
 // The decorator is internal; remount through the real public apply contract.
 mount();
 await delay();result.phases.restored=phase();result.passed=result.checks.every(check=>check.passed);
 window.__dsfRowsCheckResult=result;document.getElementById('probe').textContent=JSON.stringify(result,null,2);document.getElementById('status').textContent=result.passed?'全部 '+result.checks.length+' 项真实 DOM 检查通过':'检查失败';
})().catch(function(error){window.__dsfRowsCheckResult={passed:false,error:String(error),stack:error.stack};document.getElementById('probe').textContent=JSON.stringify(window.__dsfRowsCheckResult);document.getElementById('status').textContent='检查失败';});
</script></body></html>`

writeFileSync(join(ROOT, 'preview/rows-check.html'), page)
console.log(`wrote preview/rows-check.html (${page.length} bytes)`)
