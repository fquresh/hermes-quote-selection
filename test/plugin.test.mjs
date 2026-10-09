// Runs plugin.js in jsdom with a fake @hermes/plugin-sdk and a tiny JSX stub. `npm test`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'

const atom = initial => {
  let value = initial
  return { get: () => value, set: next => (value = next) }
}

const notes = []
let focused = 0
const focusedSessionId = atom('s1')
const composer = { focus: () => focused++ }

globalThis.__sdk = {
  atom,
  Codicon: function Codicon() {},
  COMPOSER_AREAS: { top: 'composer.top', middleware: 'composer.middleware' },
  host: { composer, notify: n => notes.push(n), state: { focusedSessionId } },
  KEYBINDS_AREA: 'keybinds',
  useValue: store => store.get()
}
// Element objects instead of React: enough to call components and read props.
const element = (type, props, key) => ({ key, props, type })
globalThis.__jsx = { jsx: element, jsxs: element }

const SDK_IMPORT = "import { atom, Codicon, COMPOSER_AREAS, host, KEYBINDS_AREA, useValue } from '@hermes/plugin-sdk'"
const JSX_IMPORT = "import { jsx, jsxs } from 'react/jsx-runtime'"
const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
assert.ok(source.includes(SDK_IMPORT) && source.includes(JSX_IMPORT), 'plugin.js imports match this test')
const stubbed = source
  .replace(SDK_IMPORT, 'const { atom, Codicon, COMPOSER_AREAS, host, KEYBINDS_AREA, useValue } = globalThis.__sdk')
  .replace(JSX_IMPORT, 'const { jsx, jsxs } = globalThis.__jsx')
const plugin = (await import(`data:text/javascript,${encodeURIComponent(stubbed)}`)).default

const rect = () => ({ top: 100, bottom: 120, left: 40, right: 200, width: 160, height: 20 })
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

// One fresh page and plugin load per scenario, like an app reload.
const setup = html => {
  const dom = new JSDOM(`<body>${html}</body>`)
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node })
  // jsdom has no layout; Electron implements these.
  dom.window.Range.prototype.getClientRects = () => [rect()]
  dom.window.Range.prototype.getBoundingClientRect = rect

  const contributions = []
  const disposers = []
  const ctx = {
    register: c => contributions.push(c),
    onDispose: fn => disposers.push(fn),
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    addEventListener: (target, type, listener, options) => {
      target.addEventListener(type, listener, options)
      disposers.push(() => target.removeEventListener(type, listener, options))
    }
  }
  plugin.register(ctx)

  const doc = dom.window.document
  const byId = id => doc.getElementById(id)
  const area = name => contributions.find(c => c.area === name)

  // Render the composer.top slot and return the chip elements it shows.
  const chipElements = () => {
    const root = area('composer.top').render()
    const out = root.type(root.props)
    return out ? out.props.children : []
  }

  return {
    contributions,
    dispose: () => disposers.forEach(fn => fn()),
    popup: () => doc.querySelector('[data-quote-selection-popup]'),
    chips: () => chipElements().map(chip => chip.props.quote.text),
    removeChip: index => {
      const chip = chipElements()[index]
      chip.type(chip.props).props.children[2].props.onClick()
    },
    send: text => area('composer.middleware').data.handler({ text }).text,
    shortcut: () => area('keybinds').data.run(),
    select: (startId, endId = startId) => {
      const range = doc.createRange()
      range.setStart(byId(startId).firstChild, 0)
      range.setEnd(byId(endId).firstChild, byId(endId).firstChild.length)
      const selection = dom.window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    },
    mouseup: async () => {
      doc.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }))
      await tick()
    },
    escape: () => doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
  }
}

const CURRENT = `
  <div data-message-id="u1"><p id="user">User question</p></div>
  <div data-slot="aui_assistant-message-content"><p id="a">First line of the reply.</p><p id="b">Second line.</p></div>
  <div id="sidebar">Sidebar text</div>
  <div contenteditable="true" id="composer">draft</div>`

// The same page after a hypothetical update renamed the reply slot.
const RENAMED = CURRENT.replace('aui_assistant-message-content', 'aui_reply-body').replace(
  '<div id="sidebar">',
  '<div data-message-id="u2"><p id="user2">Follow-up</p></div><div id="sidebar">'
)

// Popup click: a chip appears, and the send turns it into a blockquote.
{
  const p = setup(CURRENT)
  assert.equal(p.contributions.find(c => c.area === 'keybinds').data.defaults[0], 'mod+alt+l')
  assert.equal(p.popup().style.display, 'none', 'popup hidden at start')
  assert.deepEqual(p.chips(), [], 'no chips at start')

  p.select('a', 'b')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'flex', 'popup shows for an agent reply selection')

  p.popup().click()
  // jsdom joins <p> text without a newline; Chromium adds one per block.
  assert.deepEqual(p.chips(), ['First line of the reply.Second line.'], 'one chip')
  assert.equal(p.popup().style.display, 'none', 'popup hidden after click')
  assert.equal(window.getSelection().isCollapsed, true, 'selection cleared')
  assert.equal(focused, 1, 'cursor moved to the input')

  assert.equal(p.send('What does this mean?'), '> First line of the reply.Second line.\n\nWhat does this mean?')
  assert.deepEqual(p.chips(), [], 'chips cleared after send')
  assert.equal(p.send('plain'), 'plain', 'no chips, no change')
  p.dispose()
}

// Several quotes, in order, then the question.
{
  const p = setup(CURRENT)
  p.select('a')
  p.shortcut()
  p.select('b')
  p.shortcut()
  assert.deepEqual(p.chips(), ['First line of the reply.', 'Second line.'])
  assert.equal(p.send('Compare these'), '> First line of the reply.\n\n> Second line.\n\nCompare these')
  p.dispose()
}

// The x button removes a chip.
{
  const p = setup(CURRENT)
  p.select('a')
  p.shortcut()
  p.removeChip(0)
  assert.deepEqual(p.chips(), [], 'chip removed')
  assert.equal(p.send('hi'), 'hi', 'removed chip is not sent')
  p.dispose()
}

// A slash command is sent untouched and the chip waits for the next message.
{
  const p = setup(CURRENT)
  p.select('a')
  p.shortcut()
  assert.equal(p.send('/help'), '/help')
  assert.deepEqual(p.chips(), ['First line of the reply.'], 'chip kept after a slash command')
  assert.equal(p.send('ok'), '> First line of the reply.\n\nok')
  p.dispose()
}

// Quotes belong to the chat they were made in. A new chat keys as "new".
{
  const p = setup(CURRENT)
  p.select('a')
  p.shortcut()
  focusedSessionId.set('s2')
  assert.deepEqual(p.chips(), [], 'other chat shows no chips')
  assert.equal(p.send('hi'), 'hi', 'other chat sends no quote')
  focusedSessionId.set(null)
  p.select('b')
  p.shortcut()
  assert.equal(p.send('new chat'), '> Second line.\n\nnew chat')
  focusedSessionId.set('s1')
  assert.deepEqual(p.chips(), ['First line of the reply.'], 'first chat still has its chip')
  p.dispose()
  assert.deepEqual(p.chips(), [], 'dispose clears pending quotes')
}

// Selections that must not quote.
{
  const p = setup(CURRENT)
  for (const [ids, reason] of [
    [['sidebar'], 'outside an agent reply'],
    [['user'], 'a user message in strict mode'],
    [['a', 'sidebar'], 'a selection that leaves the reply']
  ]) {
    p.select(...ids)
    await p.mouseup()
    assert.equal(p.popup().style.display, 'none', `no popup for ${reason}`)
  }

  p.select('a')
  await p.mouseup()
  p.escape()
  assert.equal(p.popup().style.display, 'none', 'escape hides')

  p.select('composer')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'none', 'no popup in the composer')
  p.shortcut()
  assert.deepEqual(p.chips(), [], 'shortcut ignores a composer selection')
  assert.equal(notes.length, 0, 'no warnings with current markup')

  p.dispose()
  assert.equal(p.popup(), null, 'popup removed on dispose')
}

// Attachment refs in agent output are quoted as inert text.
{
  const p = setup(`
    <div data-slot="aui_assistant-message-content"><p id="r">Run @file:~/.ssh/id_rsa and @URL:https://x.test, mail a@b.com</p></div>`)
  p.select('r')
  p.shortcut()
  const text = p.send('?')
  // Same pattern the Hermes composer and transcript use to recognise refs.
  assert.equal(/@(file|folder|url|image|tool|terminal|session):/i.test(text), false, 'no live @kind: ref survives')
  assert.equal(
    text.replaceAll('\u200B', ''),
    '> Run @file:~/.ssh/id_rsa and @URL:https://x.test, mail a@b.com\n\n?',
    'text reads the same'
  )
  assert.ok(text.includes('a@b.com'), 'plain emails are untouched')
  p.dispose()
}

// Renamed markup: fallback mode and one warning.
{
  const p = setup(RENAMED)

  p.select('sidebar')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'flex', 'fallback shows for any non-input selection')
  assert.equal(notes.length, 1, 'warns when the reply selector is stale')
  assert.equal(notes[0].kind, 'warning')
  assert.match(notes[0].message, /AGENT_REPLY/)

  p.select('a')
  await p.mouseup()
  assert.equal(notes.length, 1, 'warns only once per load')

  p.popup().click()
  assert.deepEqual(p.chips(), ['First line of the reply.'], 'fallback still quotes')

  p.select('composer')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'none', 'fallback still skips the composer')
  p.dispose()
}

// Fresh chat with one message and no reply yet: fallback, but no false warning.
{
  notes.length = 0
  const p = setup('<div data-message-id="u1"><p id="user">Only a question</p></div>')
  p.select('user')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'flex')
  assert.equal(notes.length, 0, 'no warning before any reply exists')
  p.dispose()
}

// SDK break: the plugin refuses to load and says why.
{
  notes.length = 0
  const saved = globalThis.__sdk.COMPOSER_AREAS.middleware
  delete globalThis.__sdk.COMPOSER_AREAS.middleware
  const p = setup(CURRENT)
  assert.equal(p.contributions.length, 0, 'nothing registered')
  assert.equal(p.popup(), null, 'no popup injected')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].kind, 'error')
  assert.match(notes[0].message, /COMPOSER_AREAS\.middleware/)
  globalThis.__sdk.COMPOSER_AREAS.middleware = saved
}

console.log('All tests passed.')
