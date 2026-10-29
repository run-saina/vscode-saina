# Saina for VS Code and Cursor

Saina Helm models in your editor.

- **Saina MCP server for agent mode.** The extension registers `https://api.saina.run/v1/mcp`, so Copilot agent mode in VS Code and Cursor's agent can read your endpoints, decisions, traces, evals and datasets. It signs in with OAuth the first time a tool runs.
- **Run Decision on Selection.** Select text or JSON, pick a model or endpoint, and ask a Yes / No, Choose one or Rate on a scale question. The answer shows in a notification and the **Saina** output channel.
- **Models.** Every Saina Helm model your account can use (`saina-helm-3-0.8b`, `saina-helm-2-0.8b`, `saina-helm-0.8b`), plus connected providers and published Studio endpoints. The list comes from your account, so new Helm releases show up without an extension update.
- **Recent Decisions.** The latest decisions from your endpoints, filterable by endpoint, abstentions or errors. Click one to open the full record.
- **Snippets.** `saina-ask` and `saina-trace` in Python, `saina-ask` in JavaScript and TypeScript.

## Get started

1. [Create an account](https://saina.run/signup) and an API key in Studio.
2. Run **Saina: Set API Key** from the Command Palette. The key is kept in the editor's secret store.
3. Open the Saina view in the activity bar.

Every run is billed for the text sent. The extension asks before each run; turn that off with `saina.confirmBeforeRun`.

## Settings

| Setting | Default | |
|---|---|---|
| `saina.baseUrl` | `https://api.saina.run` | Your service origin for a self-hosted Helm, for example `http://localhost:8000`. |
| `saina.registerMcpServer` | `true` | Register the Saina MCP server for agent mode. |
| `saina.confirmBeforeRun` | `true` | Ask before sending text to a model. |

On hosts without an MCP registration API, run **Saina: Copy MCP Server Config** and paste it into your client's MCP config.

## Privacy

The extension talks only to `saina.baseUrl`. It sends the text you select when you run a decision, and nothing else. No telemetry.

## Support

dev@saina.run · [saina.run](https://saina.run)
