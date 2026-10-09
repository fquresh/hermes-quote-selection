// Cmd+Option+L: quote the text selected in a chat message into the composer,
// like Cmd+L in Devin. Plain Cmd+L stays with the app (terminal and file
// preview selections, focus composer), so this plugin uses a separate chord.
// A selection inside an agent reply also shows an "Add to chat" popup.
// A quote shows as a chip above the input; on send, a composer middleware
// turns the chips into a Markdown blockquote ahead of the typed message.
import { atom, Codicon, COMPOSER_AREAS, host, KEYBINDS_AREA, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const EDITABLE = '[contenteditable="true"], input, textarea'
// App markup, not SDK surface. If an update renames this slot, the popup falls
// back to any selection outside an input and warns once (see popupRange).
const AGENT_REPLY = '[data-slot="aui_assistant-message-content"]'
// Also app markup: every chat message carries it. Two or more messages on
// screen with no agent reply match means the reply selector went stale.
const CHAT_MESSAGE = '[data-message-id]'
const POPUP_GAP = 6

// Each app update reloads the plugin, so this runs once per new version and
// turns a silent SDK break into a visible one.
const missingSdk = ctx =>
  [
    ['KEYBINDS_AREA', typeof KEYBINDS_AREA === 'string'],
    ['COMPOSER_AREAS.top', typeof COMPOSER_AREAS?.top === 'string'],
    ['COMPOSER_AREAS.middleware', typeof COMPOSER_AREAS?.middleware === 'string'],
    ['atom', typeof atom === 'function'],
    ['useValue', typeof useValue === 'function'],
    ['Codicon', typeof Codicon === 'function'],
    ['host.state.focusedSessionId', typeof host?.state?.focusedSessionId?.get === 'function'],
    ['host.composer.focus', typeof host?.composer?.focus === 'function'],
    ['host.notify', typeof host?.notify === 'function'],
    ['ctx.addEventListener', typeof ctx.addEventListener === 'function'],
    ['ctx.setTimeout', typeof ctx.setTimeout === 'function'],
    ['ctx.onDispose', typeof ctx.onDispose === 'function']
  ]
    .filter(([, ok]) => !ok)
    .map(([name]) => name)

// The composer turns `@file:` / `@url:` / `@terminal:` (and other `@kind:`)
// text into live attachment refs. A quote must stay inert text: agent output
// can carry a prompt-injected `@file:~/.ssh/id_rsa`, and quoting it must not
// arm an attachment. A zero-width space after `@` keeps the text readable but
// breaks the ref pattern.
const defuseRefs = text => text.replace(/@(?=[a-z]+:)/gi, '@\u200B')

const quote = text =>
  defuseRefs(text)
    .trim()
    .split(/\r?\n/)
    .map(line => (line.trim() ? `> ${line}` : '>'))
    .join('\n')

const elementOf = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)

// Text selected inside the composer (or any input) is already editable, so
// quoting it into the composer would duplicate it.
const selectedChatText = () => {
  const selection = window.getSelection()

  if (!selection || selection.isCollapsed || elementOf(selection.anchorNode)?.closest(EDITABLE)) {
    return ''
  }

  return selection.toString()
}

// Pending quotes per chat: { [sessionKey]: [{ id, text }] }. A new chat has no
// session id until its first send, so it keys as 'new' until then.
const $quotes = atom({})
const NEW_CHAT = 'new'
let nextQuoteId = 0

const sessionKey = sessionId => sessionId ?? NEW_CHAT

const setQuotes = (key, list) => {
  const { [key]: _old, ...rest } = $quotes.get()

  $quotes.set(list.length ? { ...rest, [key]: list } : rest)
}

const addQuote = text => {
  const key = sessionKey(host.state.focusedSessionId.get())

  setQuotes(key, [...($quotes.get()[key] ?? []), { id: ++nextQuoteId, text: text.trim() }])
}

const removeQuote = (key, id) => setQuotes(key, ($quotes.get()[key] ?? []).filter(q => q.id !== id))

const quoteSelection = () => {
  const text = selectedChatText()

  if (text.trim()) {
    addQuote(text)
    window.getSelection()?.removeAllRanges()
  }

  host.composer.focus(null)
}

// Slash commands only route when they lead the message, so a quote must not
// be put in front of one; the chips stay pending for the next normal send.
const quoteMiddleware = {
  handler: draft => {
    const key = sessionKey(host.state.focusedSessionId.get())
    const pending = $quotes.get()[key]

    if (!pending?.length || draft.text.trimStart().startsWith('/')) {
      return draft
    }

    setQuotes(key, [])

    const quotes = pending.map(q => quote(q.text)).join('\n\n')

    return { ...draft, text: draft.text.trim() ? `${quotes}\n\n${draft.text}` : quotes }
  }
}

const chipStyle = {
  alignItems: 'center',
  background: 'color-mix(in srgb, var(--ui-accent) 22%, transparent)',
  border: '1px solid color-mix(in srgb, var(--ui-accent) 35%, transparent)',
  borderRadius: '6px',
  color: 'var(--ui-text-primary)',
  display: 'inline-flex',
  font: '500 12px/1.4 system-ui, sans-serif',
  gap: '6px',
  maxWidth: '320px',
  padding: '2px 4px 2px 7px'
}

const labelStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const removeStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--ui-text-tertiary)',
  cursor: 'pointer',
  display: 'inline-flex',
  padding: '0 2px'
}

const QuoteChip = ({ quote: q, sessionKey: key }) =>
  jsxs('span', {
    'data-quote-chip': '',
    style: chipStyle,
    title: q.text,
    children: [
      jsx(Codicon, { 'aria-hidden': true, name: 'quote', size: 12 }),
      jsx('span', { style: labelStyle, children: q.text.replace(/\s+/g, ' ') }),
      jsx('button', {
        'aria-label': 'Remove quote',
        onClick: () => removeQuote(key, q.id),
        style: removeStyle,
        type: 'button',
        children: jsx(Codicon, { 'aria-hidden': true, name: 'close', size: 12 })
      })
    ]
  })

// Every mounted composer renders this slot; it shows the focused chat's
// quotes, which is the composer the user is typing in.
const QuoteChips = () => {
  const quotes = useValue($quotes)
  const key = sessionKey(useValue(host.state.focusedSessionId))
  const list = quotes[key] ?? []

  if (!list.length) {
    return null
  }

  return jsx('div', {
    'data-quote-chips': '',
    style: { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px 8px 0' },
    children: list.map(q => jsx(QuoteChip, { quote: q, sessionKey: key }, q.id))
  })
}

// Strict mode: both ends of the selection must sit in the same agent reply, so
// a drag that starts in a reply and ends in the sidebar shows nothing.
// Fallback mode (no agent reply matches anywhere): any selection outside an
// input, so a renamed slot degrades the popup instead of silently killing it.
const popupRange = onStaleMarkup => {
  const selection = window.getSelection()

  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) {
    return null
  }

  const anchor = elementOf(selection.anchorNode)

  if (anchor?.closest(EDITABLE) || elementOf(selection.focusNode)?.closest(EDITABLE)) {
    return null
  }

  if (!document.querySelector(AGENT_REPLY)) {
    if (document.querySelectorAll(CHAT_MESSAGE).length >= 2) {
      onStaleMarkup()
    }

    return selection.getRangeAt(0)
  }

  const reply = anchor?.closest(AGENT_REPLY)

  return reply && reply.contains(selection.focusNode) ? selection.getRangeAt(0) : null
}

const createPopup = onClick => {
  const button = document.createElement('button')

  button.type = 'button'
  button.dataset.quoteSelectionPopup = ''
  Object.assign(button.style, {
    alignItems: 'center',
    background: 'var(--ui-bg-elevated)',
    border: '1px solid var(--ui-stroke-secondary)',
    borderRadius: '6px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
    color: 'var(--ui-text-secondary)',
    cursor: 'pointer',
    display: 'none',
    font: '500 12px/1 system-ui, sans-serif',
    gap: '8px',
    padding: '6px 9px',
    position: 'fixed',
    zIndex: '2147483000'
  })

  const label = document.createElement('span')
  label.textContent = 'Add to chat'

  const keys = document.createElement('span')
  keys.textContent = '⌥⌘L'
  keys.style.color = 'var(--ui-text-quaternary)'

  button.append(label, keys)
  // Keep the selection alive: a plain mousedown on a button would clear it
  // before the click handler reads it.
  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', onClick)
  button.addEventListener('mouseenter', () => (button.style.color = 'var(--ui-text-primary)'))
  button.addEventListener('mouseleave', () => (button.style.color = 'var(--ui-text-secondary)'))

  return button
}

const registerPopup = ctx => {
  let warnedStaleMarkup = false

  const warnStaleMarkup = () => {
    if (warnedStaleMarkup) {
      return
    }

    warnedStaleMarkup = true
    host.notify({
      kind: 'warning',
      message:
        'Quote selection: Hermes changed its chat markup. The popup now shows for any selection. Update AGENT_REPLY in plugin.js.'
    })
  }

  const hide = () => (popup.style.display = 'none')

  const popup = createPopup(() => {
    hide()
    quoteSelection()
  })

  const show = range => {
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()

    popup.style.display = 'flex'

    const { height, width } = popup.getBoundingClientRect()
    const above = rect.top - height - POPUP_GAP
    const top = above >= POPUP_GAP ? above : rect.bottom + POPUP_GAP
    const left = Math.min(Math.max(rect.left, POPUP_GAP), window.innerWidth - width - POPUP_GAP)

    popup.style.top = `${top}px`
    popup.style.left = `${left}px`
  }

  // Wait one tick: on mouseup the browser has not always committed the
  // final selection yet.
  const refresh = event => {
    if (popup.contains(event.target)) {
      return
    }

    ctx.setTimeout(() => {
      const range = popupRange(warnStaleMarkup)

      range ? show(range) : hide()
    }, 0)
  }

  document.body.append(popup)
  ctx.onDispose(() => popup.remove())

  ctx.addEventListener(document, 'mouseup', refresh)
  ctx.addEventListener(document, 'keyup', event => event.shiftKey && refresh(event))
  ctx.addEventListener(document, 'selectionchange', () => window.getSelection()?.isCollapsed && hide())
  ctx.addEventListener(document, 'keydown', event => event.key === 'Escape' && hide())
  ctx.addEventListener(window, 'scroll', hide, { capture: true, passive: true })
  ctx.addEventListener(window, 'resize', hide)
  ctx.addEventListener(window, 'blur', hide)
}

export default {
  id: 'quote-selection',
  name: 'Quote selection',
  register(ctx) {
    const missing = missingSdk(ctx)

    if (missing.length) {
      const message = `Quote selection is off: Hermes changed its plugin SDK (missing ${missing.join(', ')}).`

      typeof host?.notify === 'function' ? host.notify({ kind: 'error', message }) : console.error(message)

      return
    }

    ctx.register({
      id: 'quote',
      area: KEYBINDS_AREA,
      data: {
        id: 'quote-selection.toComposer',
        label: 'Quote selection into composer',
        category: 'composer',
        defaults: ['mod+alt+l'],
        run: quoteSelection
      }
    })

    ctx.register({ id: 'chips', area: COMPOSER_AREAS.top, render: () => jsx(QuoteChips, {}) })
    ctx.register({ id: 'send', area: COMPOSER_AREAS.middleware, data: quoteMiddleware })
    ctx.onDispose(() => $quotes.set({}))

    registerPopup(ctx)
  }
}
