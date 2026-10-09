// Cmd+Option+L: quote the text selected in a chat message into the composer,
// like Cmd+L in Devin. Plain Cmd+L stays with the app (terminal and file
// preview selections, focus composer), so this plugin uses a separate chord.
// A selection inside an agent reply also shows an "Add to chat" popup.
import { host, KEYBINDS_AREA } from '@hermes/plugin-sdk'

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
    ['host.composer.insertText', typeof host?.composer?.insertText === 'function'],
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

const quoteSelection = async () => {
  const text = selectedChatText()

  if (text.trim()) {
    const inserted = await host.composer.insertText(null, quote(text), { mode: 'block' })

    if (!inserted) {
      host.notify({ kind: 'warning', message: 'No open chat input to quote into.' })

      return
    }

    window.getSelection()?.removeAllRanges()
  }

  host.composer.focus(null)
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
    void quoteSelection()
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
        run: () => void quoteSelection()
      }
    })

    registerPopup(ctx)
  }
}
