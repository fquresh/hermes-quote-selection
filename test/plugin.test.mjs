// Runs plugin.js in jsdom with a fake @hermes/plugin-sdk. `npm test`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'

const notes = []
const inserts = []
let focused = 0

globalThis.__sdk = {
  host: {
    composer: {
      focus: () => focused++,
      insertText: (id, text, opts) => {
        inserts.push({ id, mode: opts?.mode, text })
        return Promise.resolve(true)
      }
    },
    notify: n => notes.push(n)
  },
  KEYBINDS_AREA: 'keybinds'
}

const SDK_IMPORT = "import { host, KEYBINDS_AREA } from '@hermes/plugin-sdk'"
const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
assert.ok(source.includes(SDK_IMPORT), 'plugin.js imports match this test')
const stubbed = source.replace(SDK_IMPORT, 'const { host, KEYBINDS_AREA } = globalThis.__sdk')
const plugin = (await import(`data:text/javascript,${encodeURIComponent(stubbed)}`)).default

const rect = () => ({ top: 100, bottom: 120, left: 40, right: 200, width: 160, height: 20 })
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

// The same walk the app does in composerPlainText: chips emit their
// data-ref-text, <br> becomes a newline, everything else is text.
const serialize = node => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  if (node.dataset.refText) {
    return node.dataset.refText
  }

  if (node.tagName === 'BR') {
    return '\n'
  }

  return Array.from(node.childNodes).map(serialize).join('')
}

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

  return {
    chips: (editorId = 'composer') => [...byId(editorId).querySelectorAll('[data-quote-chip]')],
    contributions,
    dispose: () => disposers.forEach(fn => fn()),
    draft: (editorId = 'composer') => serialize(byId(editorId)),
    popup: () => doc.querySelector('[data-quote-selection-popup]'),
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

// An emptied Hermes composer keeps one scaffolding <br> to hold its height.
const CURRENT = `
  <div id="pane">
    <div data-message-id="u1"><p id="user">User question</p></div>
    <div data-slot="aui_assistant-message-content"><p id="a">First line of the reply.</p><p id="b">Second line.</p></div>
    <div id="sidebar">Sidebar text</div>
    <div contenteditable="true" data-slot="composer-rich-input" id="composer"><br></div>
  </div>`

// The same page after a hypothetical update renamed the reply slot.
const RENAMED = CURRENT.replace('aui_assistant-message-content', 'aui_reply-body').replace(
  '<div id="sidebar">',
  '<div data-message-id="u2"><p id="user2">Follow-up</p></div><div id="sidebar">'
)

// Popup click: an inline chip lands in the composer and the selection clears.
{
  const p = setup(CURRENT)
  assert.equal(p.contributions.find(c => c.area === 'keybinds').data.defaults[0], 'mod+alt+l')
  assert.equal(p.popup().style.display, 'none', 'popup hidden at start')
  assert.equal(p.chips().length, 0, 'no chips at start')

  p.select('a', 'b')
  await p.mouseup()
  assert.equal(p.popup().style.display, 'flex', 'popup shows for an agent reply selection')

  p.popup().click()
  // jsdom joins <p> text without a newline; Chromium adds one per block.
  assert.equal(p.chips().length, 1, 'one chip in the composer')
  assert.equal(p.chips()[0].contentEditable, 'false', 'chip is an atomic island')
  assert.equal(p.popup().style.display, 'none', 'popup hidden after click')
  const range = window.getSelection().getRangeAt(0)
  assert.equal(range.collapsed, true, 'a collapsed caret sits after the chip')
  assert.equal(range.startContainer.id, 'composer', 'caret lives in the composer')

  const draft = p.draft()
  // Empty editor scaffold replaced; chip payload plus the caret text node.
  assert.equal(draft, '\n> First line of the reply.Second line.\n\n ', 'draft holds the blockquote')
  assert.ok(draft.endsWith('\n\n '), 'trailing blank line keeps typed text out of the quote')
  p.dispose()
}

// Several quotes keep their order, inline where they were added.
{
  const p = setup(CURRENT)
  p.select('a')
  p.shortcut()
  p.select('b')
  p.shortcut()
  assert.equal(p.chips().length, 2)
  assert.equal(p.draft(), '\n> First line of the reply.\n\n \n> Second line.\n\n ')
  p.dispose()
}

// The x button removes the chip and its quote text.
{
  const p = setup(CURRENT)
  p.select('a')
  p.shortcut()
  assert.match(p.draft(), /> First line/)

  p.chips()[0].querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(p.chips().length, 0, 'chip removed')
  assert.equal(p.draft(), ' ', 'only the caret text node remains')
  p.dispose()
}

// A quote lands next to text already in the input, fenced off by newlines.
{
  const p = setup(CURRENT.replace('<br>', 'What does this mean?'))
  p.select('a')
  p.shortcut()
  assert.equal(p.draft(), 'What does this mean?\n> First line of the reply.\n\n ')
  p.dispose()
}

// With nothing selected, the chord just moves the cursor to the input.
{
  const p = setup(CURRENT)
  window.getSelection().removeAllRanges()
  p.shortcut()
  assert.equal(p.chips().length, 0, 'no chip')
  assert.equal(window.getSelection().getRangeAt(0).commonAncestorContainer.id, 'composer', 'caret at composer')
  p.dispose()
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
  assert.equal(p.chips().length, 0, 'shortcut ignores a composer selection')
  assert.equal(notes.length, 0, 'no warnings with current markup')

  p.dispose()
  assert.equal(p.popup(), null, 'popup removed on dispose')
}

// Attachment refs in agent output are quoted as inert text, even after the
// composer would re-scan the draft text for @kind: tokens.
{
  const p = setup(`
    <div id="pane">
      <div data-slot="aui_assistant-message-content"><p id="r">Run @file:~/.ssh/id_rsa and @URL:https://x.test, mail a@b.com</p></div>
      <div contenteditable="true" data-slot="composer-rich-input" id="composer"><br></div>
    </div>`)
  p.select('r')
  p.shortcut()
  const text = p.draft()
  // Same pattern the Hermes composer and transcript use to recognise refs.
  assert.equal(/@(file|folder|url|image|tool|terminal|session):/i.test(text), false, 'no live @kind: ref survives')
  assert.equal(
    text.replaceAll('\u200B', ''),
    '\n> Run @file:~/.ssh/id_rsa and @URL:https://x.test, mail a@b.com\n\n ',
    'text reads the same'
  )
  assert.ok(text.includes('a@b.com'), 'plain emails are untouched')
  p.dispose()
}

// Two panes: the chip goes to the composer that owns the selected message.
{
  const p = setup(`
    <div id="left">
      <div data-slot="aui_assistant-message-content"><p id="la">left reply</p></div>
      <div contenteditable="true" data-slot="composer-rich-input" id="left-composer"><br></div>
    </div>
    <div id="right">
      <div data-slot="aui_assistant-message-content"><p id="ra">right reply</p></div>
      <div contenteditable="true" data-slot="composer-rich-input" id="right-composer"><br></div>
    </div>`)
  p.select('ra')
  p.shortcut()
  assert.equal(p.chips('right-composer').length, 1, 'chip landed in the right pane')
  assert.equal(p.chips('left-composer').length, 0, 'left pane untouched')
  p.dispose()
}

// Unknown composer markup: quotes degrade to plain text through the SDK and
// warn once instead of breaking silently.
{
  notes.length = 0
  inserts.length = 0
  const p = setup(`
    <div data-slot="aui_assistant-message-content"><p id="r">A reply.</p></div>`)
  p.select('r')
  p.shortcut()
  assert.equal(inserts.length, 1, 'fell back to insertText')
  assert.equal(inserts[0].text, '\n> A reply.\n\n')
  assert.equal(inserts[0].mode, 'inline')
  assert.equal(notes.length, 1, 'warned once')
  assert.match(notes[0].message, /COMPOSER_INPUT/)

  p.select('r')
  p.shortcut()
  assert.equal(notes.length, 1, 'still only one warning')
  p.dispose()
}

// Renamed markup: fallback mode and one warning.
{
  notes.length = 0
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
  assert.equal(p.chips().length, 1, 'fallback still quotes')

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

// SDK break: the plugin refuses to load and says why. The check runs on the
// live host object, so a missing piece is deleted from the fake for the test.
// With host.notify gone, the error can only reach the console.
{
  notes.length = 0
  const errors = []
  const consoleError = console.error
  console.error = (...args) => errors.push(args.join(' '))
  const saved = globalThis.__sdk.host.notify
  delete globalThis.__sdk.host.notify
  const p = setup(CURRENT)
  assert.equal(p.contributions.length, 0, 'nothing registered')
  assert.equal(p.popup(), null, 'no popup injected')
  assert.equal(errors.length, 1, 'fell back to console.error')
  assert.match(errors[0], /host\.notify/)
  console.error = consoleError
  globalThis.__sdk.host.notify = saved
}

// Missing composer host: a warning, but inline chips still register.
{
  notes.length = 0
  const saved = globalThis.__sdk.host.composer
  globalThis.__sdk.host.composer = {}
  const p = setup(CURRENT)
  assert.ok(p.contributions.find(c => c.area === 'keybinds'), 'keybind still registered')
  assert.equal(notes.filter(n => n.kind === 'warning').length, 1, 'warned about host.composer')
  globalThis.__sdk.host.composer = saved
  p.dispose()
}

console.log('All tests passed.')
