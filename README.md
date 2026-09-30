<div align="center">

<img src="logo.gif" width="150" alt="DSH SubAgent Fish" />

# DSH SubAgent Fish

**给 DeepSeek Harness 桌面版的子代理一条会游动的小鱼。**

同一个子代理始终对应同一条鱼。运行时游动，结束后停下。

</div>

基于 [CharTyr/DSH-SubAgent-Fish](https://github.com/CharTyr/DSH-SubAgent-Fish) 的公开修复分支。

## 功能

- 子代理对话的右侧栏页签显示小鱼。
- 配合 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)，在「任务管理」的 Graph 和 Tree 两种视图显示小鱼。
- 鱼形、颜色和花纹由子代理 ID 决定，状态变化时同步开始或停止游动。

<img width="311" height="269" alt="小鱼示例" src="https://github.com/user-attachments/assets/6922861f-1f97-463a-a39a-6ac884c9289b" />

## 安装

使用 DeepSeek Harness 桌面版。终端命令由应用菜单 **Manage dsh Command… → Install** 安装（[官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#terminal-command)）。

启动过一次桌面应用后，退出应用并执行：

```bash
dsh plugin --profile desktop add github:MoonlyCake/DSH-SubAgent-Fish
```

重新打开应用即可。仓库包含构建好的 `lib/`，安装时无需编译。固定版本可使用 `github:MoonlyCake/DSH-SubAgent-Fish#<commit SHA>`。

本地安装：

```bash
git clone https://github.com/MoonlyCake/DSH-SubAgent-Fish.git
cd DSH-SubAgent-Fish
dsh plugin --profile desktop add "link:$PWD"
```

卸载：

```bash
dsh plugin --profile desktop remove dsh-subagent-fish
```

## 开发与验证

```bash
npm run build
npm test
npm run preview
node tools/render-rows-check.mjs
node tools/verify-live.mjs --offline
```

源码变更后重新构建，并一起提交 `lib/`。构建仅读取仓库源码。

Graph 使用宿主的节点 ID；Tree 使用宿主的 label → displayTitle → ID 规则。回归夹具采用 better-sidebar 0.24.1 的真实类名和属性，覆盖两种视图、状态切换、节点重用及卸载。

已在本地 DeepSeek Harness 桌面版、better-sidebar 0.24.1 验证 Graph、Tree 和子代理对话页签。

## 许可

[PolyForm Noncommercial License 1.0.0](LICENSE)，原作者 CharTyr。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

`preview/dsh-theme.css` 来自 DSH，按 MIT 许可分发。

## Friendly Links

[LINUX DO](https://linux.do/)
