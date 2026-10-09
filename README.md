# hermes-quote-selection

A desktop plugin for [Hermes Agent](https://hermes-agent.nousresearch.com/).
Select part of an agent reply, then press **Cmd+Option+L** or click **Add to chat**.
The quote appears as a chip above the chat input, like Cmd+L in Devin.
When you send, the chips become a Markdown quote ahead of your message.

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
- The selection appears as a chip above the input box, and the cursor moves to the input box.
- Add more quotes the same way. Each one gets its own chip. Hover a chip to see the full text, or click its **x** to remove it.
- Type your question and press Enter. The message is sent as each quote in `>` lines, then your question.
- Chips belong to the chat you made them in. Switch chats and they wait for you.
- A message that starts with `/` (a slash command) is sent untouched, and the chips stay for your next message.
- Type at least one character before you send. Hermes does not send an empty input box, even with chips.
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
| Plugin SDK: `KEYBINDS_AREA`, `COMPOSER_AREAS`, `host.state.focusedSessionId`, `host.composer.focus`, `ctx.*` | Low (public API) | The plugin does not load and shows an error toast that names the missing part. |
| App markup: `data-slot="aui_assistant-message-content"` | Medium (internal) | The popup shows for any selection outside an input, and one warning toast appears. |
| `mod+alt+l` stays free | Low | A new built-in shortcut on that key wins. Rebind with Cmd+/. |

## Privacy and security

- The plugin makes no network requests.
- It stores nothing. It uses no `localStorage` and no plugin storage.
- Selected text goes only into your own chat input. Nothing is sent until you press Enter.
- It builds its popup with `textContent`, never `innerHTML`.
- Quotes are inert text. Hermes turns `@file:`, `@url:`, and other `@kind:` text into live attachments. Agent output can contain such text, for example from a prompt-injected web page. The plugin puts a zero-width space after each `@kind:`, so a quote never attaches a file by accident.
- It imports only `@hermes/plugin-sdk`.

## Develop

```sh
npm install
npm run check
npm test
```

The tests run the plugin in jsdom with a fake SDK.
They cover the popup, the shortcut, the markup fallback, and the SDK self-check.

## See also

- [pwwang/hermes-quote-comment](https://github.com/pwwang/hermes-quote-comment): right-click a selection to quote it with a comment.
  Use it if you want a note attached to each quote.
  This plugin focuses on a one-key quote, like Cmd+L in Devin.

## License

MIT
