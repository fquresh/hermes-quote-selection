// Runs plugin.js in jsdom with a fake @hermes/plugin-sdk. `npm test`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'

const inserted = []
const notes = []
let focused = 0
const composer = {
  insertText: async (_id, text, opts) => (inserted.push({ text, opts }), true),
  focus: () => focused++
}
globalThis.__sdk = { KEYBINDS_AREA: 'keybinds', host: { composer, notify: n => notes.push(n) } }

const SDK_IMPORT = "import { host, KEYBINDS_AREA } from '@hermes/plugin-sdk'"
const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
assert.ok(source.includes(SDK_IMPORT), 'plugin.js imports the SDK the way this test expects')
const stubbed = source.replace(SDK_IMPORT, 'const { host, KEYBINDS_AREA } = globalThis.__sdk')
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

  return {
    contributions,
    dispose: () => disposers.forEach(fn => fn()),
    popup: () => doc.querySelector('[data-quote-selection-popup]'),
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

// Current markup: strict mode.
{
  const p = setup(CURRENT)
  assert.equal(p.contributions[0].data.defaults[0], 'mod+alt+l')
  assert.equal(p.popup().style.display, 'none', 'hidden at start')

  p.select('a', 'b')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'flex', 'shows for agent reply selection')

  p.popup().click()
  await tick()
  assert.equal(inserted.length, 1)
  // jsdom joins <p> text without a newline; Chromium adds one per block.
  assert.equal(inserted[0].text, '> First line of the reply.Second line.')
  assert.equal(inserted[0].opts.mode, 'block')
  assert.equal(p.popup().style.display, 'none', 'hidden after click')
  assert.equal(window.getSelection().isCollapsed, true, 'selection cleared')
  assert.equal(focused, 1)

  p.select('sidebar')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'none', 'no popup outside agent reply')

  p.select('user')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'none', 'no popup on a user message in strict mode')

  p.select('a', 'sidebar')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'none', 'no popup when the selection leaves the reply')

  p.select('a')
  await p.mouseup()
  p.escape()
  assert.equal(p.popup().style.display, 'none', 'escape hides')

  p.select('composer')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'none', 'no popup in the composer')
  await p.contributions[0].data.run()
  await tick()
  assert.equal(inserted.length, 1, 'shortcut ignores a composer selection')

  assert.equal(notes.length, 0, 'no warnings with current markup')
  p.dispose()
  assert.equal(p.popup(), null, 'popup removed on dispose')
}

// Attachment refs in agent output are quoted as inert text.
{
  const p = setup(`
    <div data-slot="aui_assistant-message-content"><p id="r">Run @file:~/.ssh/id_rsa and @URL:https://x.test, mail a@b.com</p></div>`)
  p.select('r')
  await p.mouseup()
  p.popup().click()
  await tick()
  const text = inserted.at(-1).text
  // Same pattern the Hermes composer and transcript use to recognise refs.
  assert.equal(/@(file|folder|url|image|tool|terminal|session):/i.test(text), false, 'no live @kind: ref survives')
  assert.equal(text.replaceAll('\u200B', ''), '> Run @file:~/.ssh/id_rsa and @URL:https://x.test, mail a@b.com', 'text reads the same')
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
  await tick()
  assert.equal(inserted.at(-1).text, '> First line of the reply.', 'fallback still quotes')

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
  const saved = composer.insertText
  delete composer.insertText
  const p = setup(CURRENT)
  assert.equal(p.contributions.length, 0, 'no keybind registered')
  assert.equal(p.popup(), null, 'no popup injected')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].kind, 'error')
  assert.match(notes[0].message, /host\.composer\.insertText/)
  composer.insertText = saved
}

console.log('All tests passed.')
