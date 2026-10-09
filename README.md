# hermes-quote-selection

A desktop plugin for [Hermes Agent](https://hermes-agent.nousresearch.com/).
Select part of an agent reply, then press **Cmd+Option+L** or click **Add to chat**.
The quote appears as a chip inside the chat input, inline with your text, like Cmd+L in Devin.
When you send, the chips become Markdown `>` quote lines where they sit in the message.

## Installation

### Option 1: Install from Git

In Hermes Desktop, open **Capabilities > Plugins > Install from Git** and paste:

```
https://github.com/fquresh/hermes-quote-selection
```

### Option 2: Copy by hand

1. Create the plugin folder. The folder name matches the plugin id:

   ```bash
   # macOS / Linux: ~/.hermes/desktop-plugins/quote-selection/
   # Windows: %USERPROFILE%\.hermes\desktop-plugins\quote-selection\
   mkdir -p ~/.hermes/desktop-plugins/quote-selection
   ```

2. Copy `plugin.js` into it:

   ```bash
   cp plugin.js ~/.hermes/desktop-plugins/quote-selection/
   ```

3. In Hermes Desktop, open the command palette (Cmd+K / Ctrl+K) and run **Reload desktop plugins**.

The file hot-reloads on every save.

## Use

- Select text inside an agent reply.
- Press **Cmd+Option+L** (Ctrl+Alt+L on Windows and Linux), or click the **Add to chat** popup.
- The selection appears as a chip inside the input box, at the cursor. The caret lands right after it, so you can keep typing.
- Add more quotes the same way. Each one gets its own chip, in the order you made them.
- Hover a chip to see the full quote. Remove one with its **x**, or put the caret after it and press Backspace.
- Press Enter to send. Each chip becomes `>` quote lines where it sits in the message. A chip alone also sends.
- Chips live inside the chat's draft, so they belong to that chat and survive a switch away and back.
- A message that starts with `/` (a slash command) still routes as a command.
- With no selection, the shortcut only moves the cursor to the input box.
- Text selected inside the input box is ignored.

To change the key, press Cmd+/ and look under **Composer** for "Quote selection into composer".

### Why not plain Cmd+L?

Hermes already uses Cmd+L for terminal and file preview selections.
Cmd+Shift+L toggles the browser.
Ctrl+L would break "clear screen" in the terminal.

## Update safety

| Depends on | Risk | If it breaks |
| --- | --- | --- |
| Plugin SDK: `KEYBINDS_AREA`, `host.notify`, `ctx.*` | Low (public API) | The plugin does not load and shows an error toast that names the missing part. |
| App markup: `data-slot="composer-rich-input"` and the `data-ref-text` chip contract | Medium (internal) | Quotes insert as plain `>` text through `host.composer.insertText`, and one warning toast appears. |
| App markup: `data-slot="aui_assistant-message-content"` | Medium (internal) | The popup shows for any selection outside an input, and one warning toast appears. |
| `mod+alt+l` stays free | Low | A new built-in shortcut on that key wins. Rebind with Cmd+/. |

## Privacy and security

- The plugin makes no network requests.
- It stores nothing. It uses no `localStorage` and no plugin storage. A quote lives in the chat's draft, not in the plugin.
- Selected text goes only into your own chat input. Nothing is sent until you press Enter.
- It builds its popup and chips with `textContent`, never `innerHTML`.
- Quotes are inert text. Hermes turns `@file:`, `@url:`, and other `@kind:` text into live attachments. Agent output can contain such text, for example from a prompt-injected web page. The plugin puts a zero-width space after each `@kind:`, so a quote never attaches a file by accident — even when a draft repaint re-scans the text.
- It imports only `@hermes/plugin-sdk`.

## Develop

```sh
npm install
npm run check
npm test
```

The tests run the plugin in jsdom with a fake SDK.
They cover the popup, the shortcut, inline chips, multi-pane targeting, the markup fallbacks, and the SDK self-check.

## See also

- [pwwang/hermes-quote-comment](https://github.com/pwwang/hermes-quote-comment): right-click a selection to quote it with a comment.
  Use it if you want a note attached to each quote.
  This plugin focuses on a one-key quote, like Cmd+L in Devin.

## License

MIT
