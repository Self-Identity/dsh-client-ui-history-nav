# dsh-client-ui-history-nav

给 DSH Web GUI 加**浏览器式「后退 / 前进」**：在会话（Session）和全局面板（插件页等 `main` 面板）之间按访问顺序回退、前进。纯客户端插件，不修改 `app.asar`。

## 功能

- **两个按钮**：Windows 桌面统一放在窗口顶栏左上角、Desktop 菜单栏（Application / Edit）右侧的固定胶囊里，会话页与插件页等全局面板页位置完全一致；其他环境（纯 Web / macOS / Linux）回退到会话标题左侧的 `conversation.header.leading`。无历史时置灰。
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
- 打开/关闭全局面板，例如 **插件页**、**具体插件页**、其他插件注册的 `main` 面板（`layout.panelInfo.activePanelId` 变化）；
- 从面板回到会话（`activePanelId = null`）。

按钮出现的位置：

- Windows 桌面：**所有页面同一位置**——顶栏左上角、Desktop 菜单栏右侧的小胶囊。位置按菜单栏的实测宽度计算（中英文菜单宽度不同），侧栏展开/收起后自动跟随；
- 纯 Web / macOS / Linux 桌面：会话页在标题左侧；全局面板页不显示按钮，只保留快捷键。

插件内容页 / 插件派生页不做页面主体注入：统一胶囊属于框架级浮动层，不占用页面内容区、不会遮挡插件自己的页头，比在页面主体左上角叠按钮风险更低。

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
4. 重启客户端（浏览器端插件在启动时挂载）：Windows 顶栏左上角（Desktop 菜单栏右侧）出现「‹ ›」两个按钮，会话页与插件页等所有页面位置一致。

## 卸载

侧边栏 → 插件 → 关闭该组合包（或移除 `dsh.profile.bundles` 里的条目）后重启；`localStorage` 里的 `dsh.history-nav.v1` 可保留，重新启用后继续使用。

## 已验证 / 未验证

- 已验证（本机，2026-10-18/19，客户端 `0.2.1-rc.2` 契约核对 + 离线 mock 运行）：清单/补丁通过 `check-bundle.mjs`；`lib/client.js` 无 import、`node --check` 通过；mock 客户端上下文中会话切换、面板切换、去重、回退/前进、持久化恢复、失效条目丢弃、顶栏胶囊在会话页与面板页同位置显示、非桌面环境回退到标题座位均按预期工作（42 项断言）。
- 未验证（需要真实 GUI 挂载后确认）：胶囊与真实菜单栏/窗口按钮的像素级间距；侧栏展开/收起时胶囊的跟随；桌面快捷键桥接（Alt+←/→）与输入法/终端的共存；macOS/Web 的座位表现；旧版本客户端（无 `uiWorkspace.selection` 时退化为 `sessions.list` 读取）。

## 设计约定

- 只通过 `ctx` 取能力，零 `@deepseek-ai/*` import；React 与 `@deepseek-ai/dsh-client-store` 来自浏览器模块表。
- 客户端半区只注册两个座位（`conversation.header.leading` 与 `shell.overlay` 里的 `history-nav.titlebar`）与两条 shortcut 命令，不写 `document.body`，不替换应用根节点。
- 所有订阅、样式节点与快捷键都挂在 `ctx.effect` 上，插件卸载即释放。
