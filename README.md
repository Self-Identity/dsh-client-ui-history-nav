# dsh-client-ui-history-nav

[中文](README.md) | [English](README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-client-ui-history-nav.svg)](https://www.npmjs.com/package/dsh-client-ui-history-nav)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

给 DSH 客户端加浏览器式「后退 / 前进 / 刷新」按钮：会话与插件面板共用一条历史栈；选中的会话仍在回复时，刷新会先弹出确认。

## 功能

- **后退 / 前进**：在会话与全局面板之间回退、前进；没有历史时按钮置灰。
- **刷新**：重新加载当前页面的渲染，并在重载后重新打开刷新前的面板。选中的会话正在运行时先弹确认框（Esc、点遮罩或「取消」都能关掉）。面板内部状态和滚动位置会重置，这是刷新的预期代价。
- **统一历史栈**：会话切换与面板打开/关闭按访问顺序记录，最多 60 条，存在 `localStorage` 的 `dsh.history-nav.v1`。
- **自愈**：会话被归档、面板插件被卸载后，回放到失效条目会自动移除，不会卡住按钮。
- **本地化**：按钮 Tooltip、快捷键标签与确认框跟随 DSH 全局语言（中文 / English）。

## 位置

- **Windows 桌面**：标题栏、Application / Edit 菜单右侧；会话页与面板页位置一致。
- **其他平台**：会话标题左侧的座位；全局面板只保留快捷键。

## 快捷键

| 平台 | 后退 | 前进 |
|---|---|---|
| Windows / Linux | `Alt+←` | `Alt+→` |
| macOS | `⌘[` | `⌘]` |
| 纯浏览器 | `Ctrl+Alt+←` | `Ctrl+Alt+→` |

快捷键可在 **设置 → 快捷键** 中修改。

## 安装

1. 客户端侧边栏 → **插件** → **添加插件**。
2. 填 `dsh-client-ui-history-nav@1.5.0`（或选择本地源码目录）。
3. **安装** → **立即启用**；若提示「改动在下次启动生效」，重启客户端。
4. 卡片显示 **已启用 / 已挂载** 即生效；顶栏随后出现后退 / 前进 / 刷新胶囊。

## 兼容性

- 基于 DeepSeek Harness 桌面客户端 **0.2.1-rc.2**。依赖 `uiWorkspace.selection` 投影、`layout.panelInfo`、快捷键注册表与会话标题座位。
- Host 半区不 import 任何包；浏览器半区只解析平台模块种子（`react`、`@deepseek-ai/dsh-client-store`）。
- 客户端升级可能改动这些契约。座位或服务方法缺失时插件保持惰性，不会破坏外壳；控制台会有 `[dsh-client-ui-history-nav]` 警告。

## 卸载

在 **插件** 里关闭该组合包（或从 profile 的 `dsh.profile.bundles` 移除）后重启。历史只存在 `localStorage`；删除 `dsh.history-nav.v1` 即清空。

## 开发

```powershell
node --check lib/index.js
node --check lib/client.js
node tools/smoke.mjs
```

## 许可

MIT。与 DeepSeek 官方无隶属关系。
