# Saina for VS Code and Cursor

Saina is the decision layer for software systems. It builds specialist AI decision models and the developer platform around them. Developers use Saina to turn model predictions into versioned decision endpoints, observe how those decisions perform in production, turn failures into test cases, and improve their models or policies without breaking existing behavior. Saina works with open models and external inference providers, so teams can use their own infrastructure.

This extension brings Helm, Saina's family of specialist decision models, and Saina Studio into VS Code and Cursor.

- **Saina Studio MCP server for agent mode.** The extension registers `https://api.saina.run/v1/mcp`, so Copilot agent mode in VS Code and Cursor's agent can work with your decision endpoints, versions, decisions, traces, test cases, evaluations and datasets. It signs in with OAuth the first time a tool runs.
- **Run Decision on Selection.** Select text or JSON, pick a model or a decision endpoint, and ask a Yes / No, Choose one or Rate on a scale question. Helm scores the options; the answer shows in a notification and the **Saina** output channel.
- **Models.** The Helm models your account can use (Helm 3, Helm 2, Helm 2 Omni and specialist variants such as Helm 2 Routing), plus connected inference providers and your published decision endpoints. The list comes from your account, so new models show up without an extension update.
- **Recent Decisions.** Decisions recorded by your endpoints, filterable by endpoint, abstentions or errors. Click one to open the full record, then turn failures into test cases in Studio.
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
