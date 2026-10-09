# quote-selection

A [Hermes Desktop](https://github.com/NousResearch/hermes-agent) plugin.
Select part of an agent reply, then press **Cmd+Option+L** or click **Add to chat**.
The text lands in the chat input as a Markdown quote, like Cmd+L in Devin.

## Install

In Hermes Desktop, open **Capabilities > Plugins** and install from Git with this URL:

```
https://github.com/fquresh/quote-selection
```

Or copy `plugin.js` by hand to `~/.hermes/desktop-plugins/quote-selection/plugin.js`.
The folder name must be `quote-selection`, because it must match the plugin id.
Hermes hot-reloads the file.
If it does not appear, press Cmd+K and run **Reload desktop plugins**.

## Use

- Select text inside an agent reply.
- Press **Cmd+Option+L** (Ctrl+Alt+L on Windows and Linux), or click the **Add to chat** popup.
- The selection goes into the input box as `> quote`, and the cursor moves after it.
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
| Plugin SDK: `KEYBINDS_AREA`, `host.composer.*`, `ctx.*` | Low (public API) | The plugin does not load and shows an error toast that names the missing part. |
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

## License

MIT
