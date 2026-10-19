# dsh-client-ui-history-nav

Browser-style Back / Forward / Refresh controls in the DSH client window title bar. Sessions and plugin panels share one history stack, and a refresh asks for confirmation while a session is still running.

给 DSH 客户端加浏览器式「后退 / 前进 / 刷新」：会话与插件面板共用一条历史栈；选中会话仍在回复时，刷新会先确认。

## Features

- **Back / forward** across sessions and global panels; the buttons are disabled when there is no history.
- **Refresh** reloads the current page rendering and reopens the panel that was open before the reload. A running session triggers a confirmation first (Esc, overlay click or Cancel dismisses it). Panel state and scroll position reset — that is the expected cost of a refresh.
- **One shared stack**: session switches and panel open/close are recorded in visit order, up to 60 entries, persisted in `localStorage` under `dsh.history-nav.v1`.
- **Self-healing**: entries whose session was archived or whose panel plugin is gone are dropped on replay instead of sticking the buttons.
- **Localized**: button tooltips, shortcut labels and the confirmation dialog follow the DSH locale (Chinese / English).

## Placement

- **Windows desktop**: caption area, right of the Application / Edit menu; the same position on session pages and panel pages.
- **Other platforms**: the leading seat of the conversation header; global panels keep the keyboard shortcuts only.

## Shortcuts

| Platform | Back | Forward |
|---|---|---|
| Windows / Linux | `Alt+←` | `Alt+→` |
| macOS | `⌘[` | `⌘]` |
| Plain browser | `Ctrl+Alt+←` | `Ctrl+Alt+→` |

Shortcuts are rebindable in **Settings → Shortcuts**.

## Install

1. Open the client sidebar → **Plugins** → **Add plugin**.
2. Point it at this package: the local source directory, or the npm package name once published.
3. Choose **Install**, then **Enable now**; restart the client if it says the change takes effect on the next start.
4. The card must read **Enabled / Mounted**. The back / forward / refresh pill then appears in the title bar.

## Compatibility

- Built against the DeepSeek Harness desktop client **0.2.1-rc.2**. It relies on the `uiWorkspace.selection` projection, `layout.panelInfo`, the shortcut registry and the conversation header seat.
- The host half imports nothing. The browser half resolves only platform module seeds (`react`, `@deepseek-ai/dsh-client-store`).
- Client upgrades may change these contracts. When a seat or a service method is missing the plugin stays inert instead of breaking the shell; see the console for `[dsh-client-ui-history-nav]` warnings.

## Uninstall

Disable the bundle in **Plugins** (or remove it from the profile's `dsh.profile.bundles`) and restart. History lives only in `localStorage`; delete `dsh.history-nav.v1` to clear it.

## Development

```powershell
node --check lib/index.js
node --check lib/client.js
node tools/smoke.mjs
```

## License

MIT.
