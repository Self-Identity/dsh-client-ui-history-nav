# dsh-client-ui-history-nav

给 DSH Web GUI 加**浏览器式「后退 / 前进」**：在会话（Session）和全局面板（插件页等 `main` 面板）之间按访问顺序回退、前进。纯客户端插件，不修改 `app.asar`。

## 功能

- **两个按钮**：注册在 `conversation.header.leading`（会话标题左侧的常驻导航座位），无历史时置灰。
- **快捷键**（可在 设置 → 快捷键 里改）：
  - Windows / Linux 桌面：`Alt+←` 后退，`Alt+→` 前进
  - macOS 桌面：`⌘[` 后退，`⌘]` 前进
  - 纯 Web 打开：`Ctrl+Alt+←` / `Ctrl+Alt+→`（浏览器会把裸 `Alt+←` 抢走，因此 Web 默认加 `Ctrl`）
- **统一历史栈**：会话切换与全局面板切换共用一个栈，行为接近浏览器的「页面」历史。
- **持久化**：栈存在 `localStorage` 的 `dsh.history-nav.v1`（最多 60 条），刷新页面、重启客户端后仍在；前进分支保留到下一次新导航为止。
- **无效目标自愈**：会话被归档/删除、面板插件被卸载后，回放到失效条目会自动把它从栈里移除，不会卡住按钮。

## 覆盖范围

会记录：

- 侧栏里切换会话（`uiWorkspace.selection` 变化）；
- 打开/关闭全局面板，例如 **插件页**、其他插件注册的 `main` 面板（`layout.panelInfo.activePanelId` 变化）；
- 从面板回到会话（`activePanelId = null`）。

不会单独记录：

- **设置页**：当前版本里设置是模态面板（`sidebar.settings` 占位方内部的 modal），不是 `main` 页面，模态打开时快捷键也被架构层屏蔽；关闭设置后你本来就在原页面，无需历史。
- **目录选择器 / 文件树内部层级**：这些是模态交互或右侧栏内部状态，不是应用级页面。打开某个工作区最终会落到会话或面板，因此那次跳转本身会被记录。若后续有插件把「目录浏览」注册成 `main` 面板，它会自动纳入历史。

## 安装 / 启用

1. 源码目录：`F:\plugins-for-dsh\dsh-client-ui-history-nav`（不要放进 `F:\DSH-Official\plugins`）。
2. 接线（可重复执行，会备份 profile 的 `package.json`）：

   ```powershell
   node F:\plugins-for-dsh\_tools\wire-profile.cjs
   ```

3. 把 `dsh-client-ui-history-nav` 加入 desktop profile 的 `dsh.profile.bundles`，或打开客户端 侧边栏 → **插件** → 添加插件 → 填 `F:\plugins-for-dsh\dsh-client-ui-history-nav` → 安装 → **立即启用**。
4. 重启客户端（浏览器端插件在启动时挂载），会话标题左侧出现「‹ ›」两个按钮。

## 卸载

侧边栏 → 插件 → 关闭该组合包（或移除 `dsh.profile.bundles` 里的条目）后重启；`localStorage` 里的 `dsh.history-nav.v1` 可保留，重新启用后继续使用。

## 已验证 / 未验证

- 已验证（本机，2026-10-18，客户端 `0.2.1-rc.2` 契约核对 + 离线 mock 运行）：清单/补丁通过 `check-bundle.mjs`；`lib/client.js` 无 import、`node --check` 通过；mock 客户端上下文中会话切换、面板切换、去重、回退/前进、持久化恢复、失效条目丢弃均按预期工作。
- 未验证（需要真实 GUI 挂载后确认）：按钮在真实会话头部的视觉间距；桌面快捷键桥接（Alt+←/→）与输入法/终端的共存；旧版本客户端（无 `uiWorkspace.selection` 时退化为 `sessions.list` 读取）。

## 设计约定

- 只通过 `ctx` 取能力，零 `@deepseek-ai/*` import；React 与 `@deepseek-ai/dsh-client-store` 来自浏览器模块表。
- 客户端半区只注册一个 `conversation.header.leading` 座位与两条 shortcut 命令，不写 `document.body`，不替换应用根节点。
- 所有订阅、样式节点与快捷键都挂在 `ctx.effect` 上，插件卸载即释放。
