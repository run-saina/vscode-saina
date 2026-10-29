# Saina for VS Code

Build, test, and inspect AI decisions without leaving your editor.

Saina brings specialist decision models and Saina Studio into VS Code and Cursor. Run decisions against selected text or JSON, inspect production results, and connect your coding agent to your Studio workspace.

## What you can do

- **Work with your coding agent.** Ask Copilot agent mode or Cursor's agent about your Saina Studio workspace: "Which decisions on `ticket-router` abstained today?", "Why did this decision fail?", "Turn these failures into test cases." The agent can read endpoints, versions, decisions, traces, test cases, evaluations and datasets.
- **Run decisions.** Select text or JSON, choose a model or decision endpoint, ask a Yes / No, Choose one or Rate on a scale question, and get a structured answer with option scores.
- **Inspect production decisions.** Browse recent decisions from your endpoints, filter to errors or abstentions, and open the full record.
- **Choose your model.** Helm 3, Helm 2, Helm 2 Omni and specialist variants such as Helm 2 Routing, or an inference provider connected in Studio. New models appear without an extension update.
- **Start faster.** `saina-ask` snippets for Python, JavaScript and TypeScript, and `saina-trace` for Python.

## Two ways to connect

| | Studio in your coding agent | Decisions and sidebar |
|---|---|---|
| What it does | Work with endpoints, decisions, tests and datasets through your agent | Run a model or endpoint, browse recent decisions |
| How you sign in | Sign in to Saina Studio the first time the agent uses a Saina tool | **Saina: Set API Key** (create the key in Studio) |
| Needs an API key | No | Yes, for the hosted API. Not for a self-hosted server |

## Get started

1. Install the extension and open the **Saina** panel in the activity bar.
2. For decisions and the sidebar: run **Saina: Set API Key**. No account yet? [Sign up at saina.run](https://saina.run/signup).
3. For your coding agent: ask it about your Saina endpoints. It prompts you to sign in to Saina Studio once.
4. Select some text, right-click, and choose **Saina: Run Decision on Selection**.

Direct calls to Saina's hosted API use credits; the free plan includes daily credits. The extension asks before sending an input, and you can turn that off. A self-hosted server runs on your own infrastructure.

Saina works with open models and external inference providers, so you can use hosted inference or your own infrastructure.

## About Saina

Saina is the decision layer for software systems. It builds specialist AI decision models (Helm) and Saina Studio, the developer platform for turning model predictions into versioned decision endpoints, observing how they perform in production, turning failures into test cases, and improving models or policies without breaking existing behavior. Helm weights are open under Apache 2.0.

## Privacy

- **Decisions and sidebar:** the extension calls `saina.baseUrl` directly with your API key. A decision sends the text you selected or typed; the sidebar reads your models, endpoints and recent decisions.
- **Coding agent:** your editor connects to the Saina Studio MCP server at `<saina.baseUrl>/v1/mcp` after you approve access in Studio (read only, or read and write). The agent's tool calls read or change data in your Studio workspace according to that approval. You can revoke the connection in Studio settings.
- The extension sends no telemetry.

## Settings

| Setting | Default | |
|---|---|---|
| `saina.baseUrl` | `https://api.saina.run` | Your service origin for a self-hosted server, for example `http://localhost:8000`. |
| `saina.registerMcpServer` | `true` | Make Saina Studio available to your coding agent. |
| `saina.confirmBeforeRun` | `true` | Ask before sending an input to a model. |

If your editor has no MCP registration API, run **Saina: Copy MCP Server Config** and paste the result into its MCP config.

## Support

dev@saina.run · [saina.run](https://saina.run)
