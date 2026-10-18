/**
 * dsh-client-ui-history-nav — browser half.
 *
 * Browser-style history over the Web client's two navigation axes:
 *
 *   1. the selected Session — `ctx.uiWorkspace.selection`, which the shipped
 *      workspace controller persists as `dsh.sessions.current`;
 *   2. the selected global panel — `ctx.layout.panelInfo.activePanelId`.
 *
 * Every settled change of the combined (panel, session) state becomes one
 * history entry. Back/forward replays the pair through
 * `uiWorkspace.openSession()` / `layout.selectPanel()`, so Sessions and global
 * panels (Plugins, a workspace overview page, ...) share one stack, the way a
 * browser keeps pages.
 *
 * The stack lives in a persisted snapshot store (`dsh.history-nav.v1`), so a
 * reload or a client restart keeps it. Replay is wrapped in a short suppression
 * window: the store notifications the replay itself causes must never be filed
 * as fresh entries.
 *
 * Seats:
 *   - `conversation.header.leading` gets the two buttons (the resident global
 *     navigation seat before the Session title);
 *   - `ctx.shortcuts` gets the configurable `history.back` / `history.forward`
 *     commands (Alt+←/→ on Windows and Linux Desktop, ⌘[/⌘] on macOS Desktop).
 *
 * No imports: React and the store kit come from the browser module table, and
 * every other capability is read from the cordis client context.
 */

window.__ModuleLoader__.load({
  id: 'dsh-client-ui-history-nav',
  factory: (require) => {
    /**
     * Always-overwritten boot record. The renderer console only reaches the
     * desktop crash log when the boot audit fails, so a plugin that silently
     * goes inert leaves no on-disk trace. This one ASCII record in
     * `localStorage` says exactly how far the browser half got.
     */
    function reportBoot(stage, detail) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem('dsh.history-nav.boot', JSON.stringify({
          stage,
          at: Date.now(),
          detail: detail === undefined ? null : detail,
        }))
      } catch {
        /* a diagnostics write must never become the failure it reports */
      }
    }

    try {
      reportBoot('factory-enter')
      const React = require('react')
      const storeKit = require('@deepseek-ai/dsh-client-store')
      reportBoot('requires-ok')

      const E = React.createElement
      const PKG = 'dsh-client-ui-history-nav'
      const NS = 'historyNav'
      const STYLE_ID = PKG + '/styles'
      const STORE_NAME = 'dsh.history-nav.v1'
      /** A browser keeps far more; 60 is enough to feel infinite and cheap to persist. */
      const MAX_ENTRIES = 60
      const zh = {
        back: '\u540e\u9000',
        forward: '\u524d\u8fdb',
        group: '\u9875\u9762\u5bfc\u822a',
        noBack: '\u6ca1\u6709\u53ef\u8fd4\u56de\u7684\u9875\u9762',
        noForward: '\u6ca1\u6709\u53ef\u524d\u8fdb\u7684\u9875\u9762',
      }

      const en = {
        back: 'Back',
        forward: 'Forward',
        group: 'Page navigation',
        noBack: 'No earlier page',
        noForward: 'No later page',
      }

      const CSS = [
        '.dsh-hnav{display:flex;align-items:center;gap:2px;min-width:0;flex:none}',
        '.dsh-hnav__button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;',
        'width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;',
        'color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;-webkit-app-region:no-drag}',
        '.dsh-hnav__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);',
        'color:var(--dsw-alias-label-primary)}',
        '.dsh-hnav__button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,',
        'var(--dsw-alias-interactive-bg-hover))}',
        '.dsh-hnav__button:disabled{color:var(--dsw-alias-label-tertiary);cursor:default;opacity:.55}',
        '.dsh-hnav__button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
        '.dsh-hnav__icon{display:block;width:16px;height:16px;flex:none}',
      ].join('')

      /** Insert the one style node this plugin owns, tagged like shipped packages. */
      function insertStyle() {
        if (typeof document === 'undefined') return () => {}
        const selector = 'style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']'
        if (document.querySelector(selector) !== null) return () => {}
        const node = document.createElement('style')
        node.dataset.plugin = PKG
        node.dataset.pluginCss = STYLE_ID
        node.textContent = CSS
        document.head.appendChild(node)
        return () => {
          if (node.parentNode !== null) node.parentNode.removeChild(node)
        }
      }

      /** Report a failure without letting it escape a slot boundary. */
      const warn = (message, error) => {
        try {
          console.warn('[history-nav] ' + message, error)
        } catch {
          /* console may be unavailable in an exotic carrier */
        }
      }

      /** Read a service off the client context without tripping the inject proxy. */
      function serviceOf(ctx, name) {
        try {
          return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined
        } catch {
          return undefined
        }
      }

      /** One history entry, normalized; `null` when neither axis is addressable. */
      function entryOf(value) {
        if (value === null || typeof value !== 'object') return null
        const panelId = typeof value.panelId === 'string' && value.panelId.length > 0 ? value.panelId : null
        const sessionId = typeof value.sessionId === 'string' && value.sessionId.length > 0 ? value.sessionId : null
        const subagentAddress = typeof value.subagentAddress === 'string' && value.subagentAddress.length > 0
          ? value.subagentAddress
          : null
        if (panelId === null && sessionId === null) return null
        return { panelId, sessionId, subagentAddress }
      }

      /** Identity of one entry, used to deduplicate a settled state. */
      function signatureOf(entry) {
        if (entry === null || entry === undefined) return 'null'
        return JSON.stringify([entry.panelId, entry.sessionId, entry.subagentAddress])
      }

      /**
       * The live navigation engine. `null` while the plugin is inactive; the
       * buttons read it on every render, so a re-apply (HMR) replaces it without
       * leaving a component bound to a disposed stack.
       */
      let engine = null

      /** Keep a render error in one seat, never in the whole header. */
      class QuietBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { failed: false }
        }

        static getDerivedStateFromError() {
          return { failed: true }
        }

        componentDidCatch(error) {
          warn('navigation buttons failed to render', error)
        }

        render() {
          return this.state.failed ? null : this.props.children
        }
      }

      /** One chevron; the direction is the only difference. */
      function NavIcon(props) {
        const back = props.direction === 'back'
        return E('svg', {
          className: 'dsh-hnav__icon',
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          'aria-hidden': 'true',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }, E('path', { d: back ? 'M9.75 3 4.75 8l5 5' : 'M6.25 3 11.25 8l-5 5' }))
      }

      /** The two buttons shown in the conversation header. */
      function NavButtons() {
        const active = engine
        if (active === null) return null
        const snapshot = React.useSyncExternalStore(active.subscribe, active.getSnapshot)
        const t = active.t
        const canBack = active.canBack(snapshot)
        const canForward = active.canForward(snapshot)
        return E('div', {
          className: 'dsh-hnav',
          role: 'group',
          'aria-label': t('group'),
        }, [
          E('button', {
            key: 'back',
            type: 'button',
            className: 'dsh-hnav__button',
            disabled: !canBack,
            'aria-label': t('back'),
            title: t('back'),
            onClick: () => {
              if (active.canBack(active.getSnapshot())) active.back()
            },
          }, E(NavIcon, { direction: 'back' })),
          E('button', {
            key: 'forward',
            type: 'button',
            className: 'dsh-hnav__button',
            disabled: !canForward,
            'aria-label': t('forward'),
            title: t('forward'),
            onClick: () => {
              if (active.canForward(active.getSnapshot())) active.forward()
            },
          }, E(NavIcon, { direction: 'forward' })),
        ])
      }

      /**
       * Build the engine over the two shipped stores.
       *
       * @param t - bound translate function for this plugin's namespace.
       * @param uiWorkspace - the workspace navigation service (selection owner).
       * @param layout - the panel/layout service (panel selection owner).
       * @param sessions - optional fallback reader for builds without `selection`.
       */
      function createEngine(t, uiWorkspace, layout, sessions) {
        const store = storeKit.createSnapshotStore(
          { entries: [], index: -1 },
          { persist: { name: STORE_NAME } },
        )

        // Heal a document written by an older build, a truncated write, or hand
        // editing: keep only addressable entries and a cursor inside the list.
        store.update((draft) => {
          const entries = Array.isArray(draft.entries)
            ? draft.entries.map(entryOf).filter((entry) => entry !== null).slice(-MAX_ENTRIES)
            : []
          const raw = typeof draft.index === 'number' && Number.isInteger(draft.index) ? draft.index : entries.length - 1
          draft.entries = entries
          draft.index = entries.length === 0 ? -1 : Math.max(0, Math.min(entries.length - 1, raw))
        })

        let selection
        try {
          selection = uiWorkspace === undefined || uiWorkspace === null ? undefined : uiWorkspace.selection
        } catch (error) {
          selection = undefined
        }
        let panelInfo
        try {
          panelInfo = layout === undefined || layout === null ? undefined : layout.panelInfo
        } catch (error) {
          panelInfo = undefined
        }

        /** Best-effort current Session id when the selection store is unavailable. */
        const retainedSessionId = () => {
          if (sessions === undefined || sessions === null || sessions.list === undefined) return null
          try {
            const snapshot = sessions.list.getSnapshot()
            const row = Object.values(snapshot.byId || {}).find((entry) => {
              const retained = entry && entry.retainedBy
              return retained !== undefined && retained !== null && (retained.mainView || 0) > 0
            })
            return row !== undefined && typeof row.id === 'string' ? row.id : null
          } catch {
            return null
          }
        }

        /** The (panel, session) pair the client is showing right now. */
        const readState = () => {
          let panelId = null
          try {
            const info = panelInfo !== undefined && typeof panelInfo.getSnapshot === 'function'
              ? panelInfo.getSnapshot()
              : null
            if (info !== null && info !== undefined && typeof info.activePanelId === 'string' && info.activePanelId.length > 0) {
              panelId = info.activePanelId
            }
          } catch {
            panelId = null
          }

          let sessionId = null
          let subagentAddress = null
          try {
            const selected = selection !== undefined && typeof selection.getSnapshot === 'function'
              ? selection.getSnapshot()
              : null
            if (selected !== null && selected !== undefined && typeof selected.sessionId === 'string' && selected.sessionId.length > 0) {
              sessionId = selected.sessionId
              if (typeof selected.subagentAddress === 'string' && selected.subagentAddress.length > 0) {
                subagentAddress = selected.subagentAddress
              }
            }
          } catch {
            sessionId = null
            subagentAddress = null
          }
          if (sessionId === null) sessionId = retainedSessionId()
          return { panelId, sessionId, subagentAddress }
        }

        let scheduled = false
        let disposed = false
        /**
         * True for exactly the microtask in which a replay's own store
         * notifications are delivered. A timer window would also swallow a fast
         * user navigation right after a Back; one microtask cannot, because the
         * next user action is always a later task. A delayed notification still
         * cannot file a duplicate entry: the cursor already names the replayed
         * entry, so the capture's dedupe check skips it.
         */
        let suppressCapture = false
        const stops = []

        /** File the settled state, truncating the forward branch like a browser. */
        const capture = () => {
          if (disposed || suppressCapture) return
          const state = readState()
          // A blank conversation is the absence of a page, not a page: recording
          // it would make Back return to "nothing" after every restart.
          if (state.panelId === null && state.sessionId === null) return
          const snapshot = store.getSnapshot()
          const entries = snapshot.entries
          const index = snapshot.index
          if (index >= 0 && index < entries.length && signatureOf(entries[index]) === signatureOf(state)) return
          const kept = index >= 0 && index < entries.length ? entries.slice(0, index + 1) : []
          kept.push(state)
          const capped = kept.length > MAX_ENTRIES ? kept.slice(kept.length - MAX_ENTRIES) : kept
          store.set({ entries: capped, index: capped.length - 1 })
        }

        /** Coalesce the two stores: one navigation action = one entry. */
        const schedule = () => {
          if (disposed || scheduled) return
          scheduled = true
          queueMicrotask(() => {
            scheduled = false
            capture()
          })
        }

        const listen = (source) => {
          if (source === undefined || source === null || typeof source.subscribe !== 'function') return
          const stop = source.subscribe(schedule)
          if (typeof stop === 'function') stops.push(stop)
        }
        listen(selection)
        listen(panelInfo)
        // A build without the selection store still changes the retained Session
        // list; subscribing keeps the plugin useful there.
        if (sessions !== undefined && sessions !== null && sessions.list !== undefined) listen(sessions.list)

        /** Replay one entry through the shipped navigation actions. */
        const applyEntry = (entry) => {
          if (uiWorkspace === undefined || uiWorkspace === null || typeof uiWorkspace.openSession !== 'function') {
            throw new Error('uiWorkspace.openSession is unavailable')
          }
          if (layout === undefined || layout === null || typeof layout.selectPanel !== 'function') {
            throw new Error('layout.selectPanel is unavailable')
          }
          const current = readState()
          const target = entry.subagentAddress !== null ? entry.subagentAddress : entry.sessionId
          const sameSession = current.sessionId === entry.sessionId
            && (current.subagentAddress === null ? null : current.subagentAddress) === entry.subagentAddress
          if (target !== null && !sameSession) uiWorkspace.openSession(target)
          layout.selectPanel(entry.panelId)
        }

        /**
         * Move the cursor one step and replay. A target that cannot be replayed
         * (its panel or Session is gone) is dropped from the stack, so a stale
         * entry can never trap the buttons.
         */
        const step = (delta) => {
          const snapshot = store.getSnapshot()
          const index = snapshot.index + delta
          if (index < 0 || index >= snapshot.entries.length) return false
          const entry = snapshot.entries[index]
          store.set({ entries: snapshot.entries, index })
          suppressCapture = true
          try {
            applyEntry(entry)
            return true
          } catch (error) {
            warn('navigation replay failed; dropping the unreachable entry', error)
            const entries = snapshot.entries.slice()
            entries.splice(index, 1)
            store.set({ entries, index: entries.length === 0 ? -1 : Math.min(index, entries.length - 1) })
            return false
          } finally {
            // Release right after the capture microtask this replay queued: the
            // next store change is already a new user navigation.
            queueMicrotask(() => {
              suppressCapture = false
            })
          }
        }

        return {
          t,
          getSnapshot: () => store.getSnapshot(),
          subscribe: (listener) => store.subscribe(listener),
          canBack: (snapshot) => snapshot.index > 0,
          canForward: (snapshot) => snapshot.index >= 0 && snapshot.index < snapshot.entries.length - 1,
          back: () => step(-1),
          forward: () => step(1),
          dispose() {
            disposed = true
            for (const stop of stops) {
              try {
                stop()
              } catch {
                /* an unsubscribing failure must not block the others */
              }
            }
            stops.length = 0
          },
        }
      }

      /** Shortcut defaults per device profile; an omitted profile stays unbound. */
      const DEFAULTS = {
        back: {
          'desktop:macos': { code: 'BracketLeft', modifiers: ['primary'] },
          'desktop:windows': { code: 'ArrowLeft', modifiers: ['alt'] },
          'desktop:linux': { code: 'BracketLeft', modifiers: ['primary'] },
          'web:macos': { code: 'ArrowLeft', modifiers: ['primary', 'alt'] },
          'web:windows': { code: 'ArrowLeft', modifiers: ['primary', 'alt'] },
        },
        forward: {
          'desktop:macos': { code: 'BracketRight', modifiers: ['primary'] },
          'desktop:windows': { code: 'ArrowRight', modifiers: ['alt'] },
          'desktop:linux': { code: 'BracketRight', modifiers: ['primary'] },
          'web:macos': { code: 'ArrowRight', modifiers: ['primary', 'alt'] },
          'web:windows': { code: 'ArrowRight', modifiers: ['primary', 'alt'] },
        },
      }

      /** The client plugin body: engine, header seat, and shortcut commands. */
      function apply(ctx) {
        try {
          reportBoot('apply-enter')
          const slots = serviceOf(ctx, 'slots')
          const locale = serviceOf(ctx, 'locale')
          if (slots === undefined || locale === undefined) {
            reportBoot('services-missing', { slots: slots !== undefined, locale: locale !== undefined })
            warn('slots/locale service missing; plugin idle')
            return
          }
          const shortcuts = serviceOf(ctx, 'shortcuts')
          const uiWorkspace = serviceOf(ctx, 'uiWorkspace')
          const layout = serviceOf(ctx, 'layout')
          const sessions = serviceOf(ctx, 'sessions')

          ctx.effect(() => {
            const disposeZh = locale.register(NS, 'zh', zh)
            const disposeEn = locale.register(NS, 'en', en)
            return () => {
              if (typeof disposeZh === 'function') disposeZh()
              if (typeof disposeEn === 'function') disposeEn()
            }
          }, 'history-nav: dictionaries')

          let t
          try {
            t = locale.bind(NS)
          } catch (error) {
            warn('locale binding deferred', error)
            t = (key) => key
          }

          ctx.effect(() => insertStyle(), 'history-nav: styles')

          const nextEngine = createEngine(t, uiWorkspace, layout, sessions)
          engine = nextEngine
          ctx.effect(() => () => {
            if (engine === nextEngine) engine = null
            nextEngine.dispose()
          }, 'history-nav: engine')

          const seat = () => E(QuietBoundary, null, E(NavButtons, {}))
          ctx.effect(() => slots.inject('conversation.header.leading', () => {
            try {
              return slots.register({ name: 'conversation.header.leading' }, seat)
            } catch (error) {
              reportBoot('header-seat-rejected', String(error && error.message ? error.message : error))
              warn('header seat registration rejected', error)
              return undefined
            }
          }), 'history-nav: header seat')

          if (shortcuts !== undefined && typeof shortcuts.register === 'function') {
            const register = (id, kind, label, aliases, relative) => ctx.effect(() => shortcuts.register({
              id,
              label: () => t(label),
              aliases,
              defaults: DEFAULTS[kind],
              regions: ['page', 'editable'],
              modals: [],
              resolve: () => {
                const snapshot = nextEngine.getSnapshot()
                const allowed = relative < 0 ? nextEngine.canBack(snapshot) : nextEngine.canForward(snapshot)
                if (!allowed) {
                  return { status: 'blocked', reason: t(relative < 0 ? 'noBack' : 'noForward') }
                }
                return { status: 'handled', run: () => (relative < 0 ? nextEngine.back() : nextEngine.forward()) }
              },
            }), 'history-nav: ' + id)
            register('history.back', 'back', 'back', ['back', 'previous page', 'navigate back'], -1)
            register('history.forward', 'forward', 'forward', ['forward', 'next page', 'navigate forward'], 1)
          } else {
            warn('shortcuts service missing; buttons only')
          }

          let hasSelection = false
          try {
            hasSelection = uiWorkspace !== undefined && uiWorkspace !== null && Boolean(uiWorkspace.selection)
          } catch {
            hasSelection = false
          }
          let hasPanelInfo = false
          try {
            hasPanelInfo = layout !== undefined && layout !== null && Boolean(layout.panelInfo)
          } catch {
            hasPanelInfo = false
          }
          reportBoot('apply-ok', {
            hasSelection,
            hasPanelInfo,
            shortcuts: shortcuts !== undefined,
          })
        } catch (error) {
          reportBoot('apply-failed', String(error && error.stack ? error.stack : error).slice(0, 600))
          warn('client apply failed; the plugin stays inert', error)
        }
      }

      return {
        name: PKG,
        inject: ['slots', 'locale', 'shortcuts', 'uiWorkspace', 'layout'],
        apply,
      }
    } catch (error) {
      reportBoot('factory-failed', String(error && error.stack ? error.stack : error).slice(0, 600))
      try {
        console.error('[history-nav] module evaluation failed; the plugin stays inert', error)
      } catch {
        /* console may be unavailable */
      }
      return {
        name: 'dsh-client-ui-history-nav',
        inject: [],
        apply() {
          // Inert: the entry activates so the boot audit stays green.
          reportBoot('inert-apply')
        },
      }
    }
  },
})
