#!/usr/bin/env node
/**
 * Offline smoke test for the browser half.
 *
 * The client bundle is an IIFE that calls `window.__ModuleLoader__.load` and
 * expects a cordis client context plus two baseline modules (React and the store
 * kit). This harness supplies minimal fakes for exactly those boundaries, then
 * drives the history engine the same way the real UI does:
 *
 *   - a Session selection store        (uiWorkspace.selection)
 *   - a global-panel selection store   (layout.panelInfo)
 *   - shortcuts                        (ctx.shortcuts)
 *   - slot seats                       (ctx.slots)
 *
 * Run: node tools/smoke.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '..', 'lib', 'client.js')
const source = readFileSync(bundlePath, 'utf8')
const PKG = 'dsh-client-ui-history-nav'
const STORE_KEY = 'dsh.history-nav.v1'

let passed = 0
const failures = []
const check = (label, condition, detail) => {
  if (condition) {
    passed += 1
    console.log('  ok  ' + label)
  } else {
    failures.push(label + (detail === undefined ? '' : ': ' + detail))
    console.log('  FAIL ' + label + (detail === undefined ? '' : ': ' + detail))
  }
}
const eq = (label, actual, expected) => {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    'actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected))
}
const tick = () => new Promise((done) => setTimeout(done, 5))
const readState = (storage) => {
  const raw = storage.getItem(STORE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

/** Minimal localStorage shared by every fake context in this process. */
function createStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    raw: map,
  }
}

/** Minimal snapshot store with the same face the engine relies on. */
function createSnapshotStore(storage, initial, options) {
  const key = options && options.persist ? options.persist.name : undefined
  let snapshot = initial
  if (key !== undefined) {
    const raw = storage.getItem(key)
    if (raw !== null) {
      try {
        snapshot = JSON.parse(raw)
      } catch {
        snapshot = initial
      }
    }
  }
  const listeners = new Set()
  const publish = () => {
    if (key !== undefined) storage.setItem(key, JSON.stringify(snapshot))
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next) => {
      snapshot = next
      publish()
    },
    update: (mutate) => {
      const draft = JSON.parse(JSON.stringify(snapshot))
      mutate(draft)
      snapshot = draft
      publish()
    },
  }
}

/** Minimal React; the buttons are registered but this test never renders them. */
function createReact() {
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
  }
  return {
    Component,
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    useCallback: (fn) => fn,
  }
}

/** Load the bundle into a fresh vm context and return its registered factory. */
function loadBundle(storage, react, storeKit) {
  let registration
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', parentNode: null }),
    head: { appendChild: () => {} },
  }
  const window = {
    __ModuleLoader__: {
      load: (definition) => {
        registration = definition
      },
    },
  }
  const context = {
    window,
    document,
    localStorage: storage,
    console,
    queueMicrotask,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Error,
    Promise,
    setTimeout,
  }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: bundlePath })
  if (registration === undefined) throw new Error('bundle did not call window.__ModuleLoader__.load')
  const module = registration.factory((request) => {
    if (request === 'react') return react
    if (request === '@deepseek-ai/dsh-client-store') return storeKit
    throw new Error('unexpected require: ' + request)
  })
  return { registration, module }
}

/** Build one fake client context sharing a storage, plus its disposal list. */
function createContext(storage) {
  const react = createReact()
  const storeKit = { createSnapshotStore: (initial, options) => createSnapshotStore(storage, initial, options) }
  const boot = loadBundle(storage, react, storeKit)

  const dictionaries = new Map()
  const disposers = []
  const shortcuts = new Map()
  const seats = []
  const panels = new Set(['plugins'])

  const locale = {
    register: (ns, localeId, dict) => {
      dictionaries.set(ns + ':' + localeId, dict)
      return () => dictionaries.delete(ns + ':' + localeId)
    },
    bind: (ns) => (key) => {
      const table = dictionaries.get(ns + ':zh')
      return table !== undefined && table[key] !== undefined ? table[key] : key
    },
  }
  const slots = {
    inject: (key, callback) => {
      const value = callback()
      return typeof value === 'function' ? value : () => {}
    },
    register: (options, Component) => {
      seats.push({ options, Component })
      return { dispose: () => {} }
    },
  }

  const selection = createSnapshotStore(storage, {}, {})
  const panelInfo = createSnapshotStore(storage, { activePanelId: null }, {})
  const sessionList = createSnapshotStore(storage, { ids: [], byId: {} }, {})
  const openCalls = []
  const panelCalls = []

  const uiWorkspace = {
    selection,
    openSession: (target) => {
      openCalls.push(target)
      selection.set({ sessionId: String(target) })
    },
  }
  const layout = {
    panelInfo,
    selectPanel: (panelId) => {
      if (panelId !== null && !panels.has(panelId)) throw new Error('main panel "' + panelId + '" is not registered')
      panelCalls.push(panelId)
      panelInfo.set({ activePanelId: panelId })
    },
  }
  const sessions = { list: sessionList }

  const services = {
    slots,
    locale,
    shortcuts: {
      register: (definition) => {
        shortcuts.set(definition.id, definition)
        return () => shortcuts.delete(definition.id)
      },
    },
    uiWorkspace,
    layout,
    sessions,
  }

  const ctx = {
    get: (name) => services[name],
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }

  boot.module.apply(ctx)
  return {
    module: boot.module,
    selection,
    panelInfo,
    layout,
    shortcuts,
    seats,
    openCalls,
    panelCalls,
    dispose: () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          /* already gone */
        }
      }
    },
  }
}

async function main() {
  console.log('bundle: ' + bundlePath)
  const storage = createStorage()
  let world = createContext(storage)
  const resolve = (id) => world.shortcuts.get(id).resolve({ modal: null })

  // --- registration -------------------------------------------------------
  eq('module name', world.module.name, PKG)
  check('injects slots/locale/shortcuts/uiWorkspace/layout',
    ['slots', 'locale', 'shortcuts', 'uiWorkspace', 'layout'].every((name) => world.module.inject.includes(name)))
  const boot = JSON.parse(storage.getItem('dsh.history-nav.boot'))
  eq('apply reached ok', boot.stage, 'apply-ok')
  check('header seat registered', world.seats.some((seat) => seat.options.name === 'conversation.header.leading'))
  eq('two shortcut commands', [...world.shortcuts.keys()].sort(), ['history.back', 'history.forward'])
  eq('desktop back default', world.shortcuts.get('history.back').defaults['desktop:windows'],
    { code: 'ArrowLeft', modifiers: ['alt'] })
  eq('desktop forward default', world.shortcuts.get('history.forward').defaults['desktop:windows'],
    { code: 'ArrowRight', modifiers: ['alt'] })
  check('back blocked without history', resolve('history.back').status === 'blocked')

  // --- session navigation -------------------------------------------------
  world.selection.set({ sessionId: 's1' })
  await tick()
  world.selection.set({ sessionId: 's2' })
  await tick()
  let state = readState(storage)
  eq('two session entries', state.entries.map((entry) => entry.sessionId), ['s1', 's2'])
  eq('cursor on newest', state.index, 1)

  // --- panel navigation ---------------------------------------------------
  world.layout.selectPanel('plugins')
  await tick()
  state = readState(storage)
  eq('panel entry appended', state.entries.map((entry) => entry.panelId), [null, null, 'plugins'])
  eq('panel entry keeps the session', state.entries[2].sessionId, 's2')

  // Repeating the current state must not append anything.
  world.layout.selectPanel('plugins')
  await tick()
  eq('repeated panel selection is not a new entry', readState(storage).entries.length, 3)

  // --- back / forward -----------------------------------------------------
  const back = resolve('history.back')
  eq('back handled', back.status, 'handled')
  back.run()
  await tick()
  state = readState(storage)
  eq('back moved the cursor', state.index, 1)
  eq('back cleared the panel', world.panelInfo.getSnapshot().activePanelId, null)
  eq('back kept the Session', world.selection.getSnapshot().sessionId, 's2')

  const backAgain = resolve('history.back')
  backAgain.run()
  await tick()
  state = readState(storage)
  eq('second back moved to the older Session', state.index, 0)
  eq('older Session reopened', world.selection.getSnapshot().sessionId, 's1')
  eq('back called openSession', world.openCalls.at(-1), 's1')

  const forward = resolve('history.forward')
  eq('forward handled', forward.status, 'handled')
  forward.run()
  await tick()
  eq('forward returned to s2', world.selection.getSnapshot().sessionId, 's2')
  forward.run()
  await tick()
  state = readState(storage)
  eq('forward restored the panel', state.index, 2)
  eq('forward selected the panel', world.panelInfo.getSnapshot().activePanelId, 'plugins')

  // --- truncation on a new navigation ------------------------------------
  back.run()
  await tick()
  back.run()
  await tick()
  eq('cursor back at the oldest entry', readState(storage).index, 0)
  world.selection.set({ sessionId: 's9' })
  await tick()
  state = readState(storage)
  eq('new navigation truncated the forward branch', state.entries.map((entry) => entry.sessionId), ['s1', 's9'])
  eq('cursor at the new entry', state.index, 1)

  // --- persistence across a reload ---------------------------------------
  const entryTotal = state.entries.length
  const indexBefore = state.index
  world.dispose()
  world = createContext(storage)
  state = readState(storage)
  eq('history survived a reload', state.entries.length, entryTotal)
  eq('cursor survived a reload', state.index, indexBefore)
  eq('shortcuts re-registered', [...world.shortcuts.keys()].sort(), ['history.back', 'history.forward'])

  // --- stale panel self-heals --------------------------------------------
  world.panelInfo.set({ activePanelId: 'gone' })
  await tick()
  state = readState(storage)
  const staleCount = state.entries.length
  eq('stale panel recorded', state.entries.at(-1).panelId, 'gone')
  world.shortcuts.get('history.back').resolve({ modal: null }).run()
  await tick()
  const forwardToGone = world.shortcuts.get('history.forward').resolve({ modal: null })
  if (forwardToGone.status === 'handled') forwardToGone.run()
  await tick()
  state = readState(storage)
  check('unreachable forward target dropped', !state.entries.some((entry) => entry.panelId === 'gone'),
    'entries=' + JSON.stringify(state.entries))
  check('stale replay did not grow the stack', state.entries.length < staleCount)

  // --- cleanup ------------------------------------------------------------
  world.dispose()
  const finalBoot = JSON.parse(storage.getItem('dsh.history-nav.boot'))
  eq('boot record stayed green after reload', finalBoot.stage, 'apply-ok')

  console.log('\npassed: ' + passed + ', failed: ' + failures.length)
  if (failures.length > 0) {
    console.error('FAILED:\n- ' + failures.join('\n- '))
    process.exit(1)
  }
  console.log('[OK] history-nav smoke test')
}

main().catch((error) => {
  console.error('[ERROR] smoke test crashed', error)
  process.exit(1)
})
