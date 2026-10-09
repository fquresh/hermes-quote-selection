// Cmd+Option+L: quote the text selected in a chat message into the composer,
// like Cmd+L in Devin. Plain Cmd+L stays with the app (terminal and file
// preview selections, focus composer), so this plugin uses a separate chord.
// A selection inside an agent reply also shows an "Add to chat" popup.
// The quote lands as a chip INSIDE the input, inline with the text, so the
// cursor can sit right next to it. The chip is a contenteditable=false span
// whose data-ref-text holds the Markdown blockquote; the composer's own draft
// serializer emits it as `>` lines on send, exactly like `@file:` chips.
import { host, KEYBINDS_AREA } from '@hermes/plugin-sdk'

const EDITABLE = '[contenteditable="true"], input, textarea'
// App markup, not SDK surface. If an update renames this slot, the popup falls
// back to any selection outside an input and warns once (see popupRange).
const AGENT_REPLY = '[data-slot="aui_assistant-message-content"]'
// Also app markup: every chat message carries it. Two or more messages on
// screen with no agent reply match means the reply selector went stale.
const CHAT_MESSAGE = '[data-message-id]'
// The composer's contenteditable. Same caveat: internal markup. If it cannot
// be found, quotes fall back to host.composer.insertText (plain `>` text) and
// a warning toast shows once per load.
const COMPOSER_INPUT = '[data-slot="composer-rich-input"]'
const POPUP_GAP = 6
const LABEL_MAX = 48

// Each app update reloads the plugin, so this runs once per new version and
// turns a silent SDK break into a visible one.
const missingSdk = ctx =>
  [
    ['KEYBINDS_AREA', typeof KEYBINDS_AREA === 'string'],
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
// arm an attachment. This matters twice: at send, and again if Hermes repaints
// the draft (its chip hydration re-scans the whole text). A zero-width space
// after `@` keeps the text readable but breaks the ref pattern.
const defuseRefs = text => text.replace(/@(?=[a-z]+:)/gi, '@\u200B')

const quoteBlock = text =>
  defuseRefs(text)
    .trim()
    .split(/\r?\n/)
    .map(line => (line.trim() ? `> ${line}` : '>'))
    .join('\n')

// What a chip serializes to inside the draft. The blank lines are load-bearing:
// without them, text typed next to the chip would merge into the quote (a line
// after `> a` is a lazy continuation in Markdown, not a new paragraph).
const chipText = text => `\n${quoteBlock(text)}\n\n`

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

// The composer that owns the chat the selection sits in. Hermes tiles put
// several composers on screen, so climb the selection's ancestors until exactly
// one composer is in scope; the climb returns null the moment it crosses a
// boundary shared by two panes, and a single-editor page needs no climb at all.
const composerFor = () => {
  const selection = window.getSelection()
  let el = elementOf(selection?.anchorNode)

  while (el && el !== document.documentElement) {
    const found = el.querySelectorAll?.(COMPOSER_INPUT)

    if (found?.length === 1) {
      return found[0]
    }

    if (found?.length > 1) {
      return null
    }

    el = el.parentElement
  }

  const all = document.querySelectorAll(COMPOSER_INPUT)

  return all.length === 1 ? all[0] : null
}

const fireEdit = (editor, type) => {
  // Build events from the editor's own window: cross-realm Event objects fail
  // dispatchEvent's instanceof check.
  const win = editor.ownerDocument?.defaultView ?? window

  try {
    editor.dispatchEvent(new win.InputEvent(type, { bubbles: true, inputType: 'insertText' }))
  } catch {
    editor.dispatchEvent(new win.Event(type, { bubbles: true }))
  }
}

const caretAfter = node => {
  const range = document.createRange()

  range.setStartAfter(node)
  range.collapse(true)

  const selection = window.getSelection()

  selection?.removeAllRanges()
  selection?.addRange(range)
}

const caretEnd = editor => {
  const range = document.createRange()

  range.selectNodeContents(editor)
  range.collapse(false)

  const selection = window.getSelection()

  selection?.removeAllRanges()
  selection?.addRange(range)
}

const quoteIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.flexShrink = '0'

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')

  path.setAttribute('d', 'M6 17h3l2-4V7H5v6h3l-2 4zm8 0h3l2-4V7h-6v6h3l-2 4z')
  svg.append(path)

  return svg
}

// A chip is a contenteditable=false span in the editor, the same shape the app
// uses for `@file:` refs, so the built-in machinery does the work: one backspace
// deletes it atomically, the draft serializer emits dataset.refText verbatim,
// and the empty-state placeholder clears itself.
const buildChip = (editor, text) => {
  const chip = document.createElement('span')

  chip.contentEditable = 'false'
  chip.dataset.quoteChip = ''
  chip.dataset.refText = chipText(text)
  chip.title = text.trim()

  Object.assign(chip.style, {
    alignItems: 'center',
    background: 'color-mix(in srgb, var(--ui-accent) 22%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ui-accent) 35%, transparent)',
    borderRadius: '6px',
    color: 'var(--ui-text-primary)',
    cursor: 'default',
    display: 'inline-flex',
    font: '500 0.85em/1.5 system-ui, sans-serif',
    gap: '0.3em',
    marginInline: '0.1em',
    maxWidth: '26em',
    padding: '0 0.2em 0 0.45em',
    verticalAlign: '-0.12em'
  })

  const label = document.createElement('span')
  const flat = text.trim().replace(/\s+/g, ' ')

  label.textContent = flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX).trimEnd()}…` : flat
  Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

  const remove = document.createElement('button')

  remove.type = 'button'
  remove.textContent = '×'
  remove.setAttribute('aria-label', 'Remove quote')
  Object.assign(remove.style, {
    background: 'none',
    border: 'none',
    color: 'var(--ui-text-tertiary)',
    cursor: 'pointer',
    font: 'inherit',
    padding: '0 0.15em'
  })
  // mousedown steals focus from the editor before click can run; suppress it.
  remove.addEventListener('mousedown', event => event.preventDefault())
  remove.addEventListener('click', () => {
    chip.remove()
    fireEdit(editor, 'input')
  })

  chip.append(quoteIcon(), label, remove)

  return chip
}

const insertQuoteChip = (editor, text) => {
  const chip = buildChip(editor, text)
  // A landing text node so the caret has somewhere to sit after the chip and
  // typed text does not glue onto it.
  const space = document.createTextNode(' ')
  const fragment = document.createDocumentFragment()

  fragment.append(chip, space)

  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  const inside = range && editor.contains(range.commonAncestorContainer) ? range : null

  if (inside) {
    inside.deleteContents()
    inside.insertNode(fragment)
  } else if (editor.childNodes.length === 1 && editor.firstChild?.nodeName === 'BR') {
    // An emptied editor keeps one scaffolding <br>; replacing it keeps the
    // draft clean of a stray leading newline.
    editor.replaceChildren(fragment)
  } else {
    editor.append(fragment)
  }

  caretAfter(space)
  delete editor.dataset.empty
  fireEdit(editor, 'beforeinput')
  fireEdit(editor, 'input')
  editor.focus()
}

let warnedComposerMarkup = false

const quoteSelection = () => {
  const text = selectedChatText()
  const editor = composerFor()

  if (text.trim()) {
    if (editor) {
      // insertQuoteChip replaces the selection with the caret after the chip.
      insertQuoteChip(editor, text)
    } else {
      window.getSelection()?.removeAllRanges()
      host.composer.insertText?.(null, chipText(text), { mode: 'inline' })
      host.composer.focus?.(null)

      if (!warnedComposerMarkup) {
        warnedComposerMarkup = true
        host.notify({
          kind: 'warning',
          message:
            'Quote selection: Hermes changed its composer markup, so quotes insert as plain text. Update COMPOSER_INPUT in plugin.js.'
        })
      }
    }

    return
  }

  // No selection: the chord only moves the cursor to the input.
  if (editor) {
    editor.focus()
    caretEnd(editor)
  } else {
    host.composer.focus?.(null)
  }
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

    if (typeof host?.composer?.insertText !== 'function' || typeof host?.composer?.focus !== 'function') {
      host.notify({
        kind: 'warning',
        message:
          'Quote selection: host.composer is missing. Inline chips still work, but the plain-text fallback for unknown composer markup is off.'
      })
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

    registerPopup(ctx)
  }
}
