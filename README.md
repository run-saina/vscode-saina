# Saina for VS Code

Build, test, and inspect AI decisions without leaving your editor.

Saina brings specialist decision models and Saina Studio into VS Code and Cursor. Run decisions against selected text or JSON, inspect production results, and connect your coding agent to your Studio workspace.

## What you can do

- **Work with your coding agent.** Ask Copilot agent mode or Cursor's agent about your Saina Studio workspace: "Which decisions on `ticket-router` abstained today?", "Why did this decision fail?", "Turn these failures into test cases." The agent can read endpoints, versions, decisions, traces, test cases, evaluations and datasets.
- **Run decisions.** Select text or JSON, choose a model or decision endpoint, ask a Yes / No, Choose one or Rate on a scale question, and get a structured answer with option scores.
- **Inspect production decisions.** Browse recent decisions from your endpoints, filter to errors or abstentions, and open the full record.
- **Choose your model.** Helm 3, Helm 2, Helm 2 Omni and specialist variants such as Helm 2 Routing, or an inference provider connected in Studio. New models appear without an extension update.
- **Start faster.** `saina-ask` snippets for Python, JavaScript and TypeScript, and `saina-trace` for Python.

## Get started

1. Install the extension and open the **Saina** panel in the activity bar.
2. Click **Sign In** and approve access in Saina Studio. Choose **Read and write** if you want to run decisions from the editor; **Read only** is enough to browse. No account yet? [Sign up at saina.run](https://saina.run/signup).
3. Select some text, right-click, and choose **Saina: Run Decision on Selection**.
4. Ask your coding agent about your Saina endpoints. VS Code and Cursor sign the agent in to Saina Studio separately, the first time it uses a Saina tool.

No API key needed. A self-hosted Saina server on `localhost` needs no sign-in at all.

Running a decision on Saina's hosted API uses credits; the free plan includes daily credits. The extension asks before sending an input, and you can turn that off. A self-hosted server runs on your own infrastructure.

Saina works with open models and external inference providers, so you can use hosted inference or your own infrastructure.

## About Saina

Saina is the decision layer for software systems. It builds specialist AI decision models (Helm) and Saina Studio, the developer platform for turning model predictions into versioned decision endpoints, observing how they perform in production, turning failures into test cases, and improving models or policies without breaking existing behavior. Helm weights are open under Apache 2.0.

## Privacy

- **The extension** signs in to Saina Studio with OAuth and calls the Saina Studio MCP server at `<saina.baseUrl>/v1/mcp` with that access. It sends the text you select or type when you run a decision, and reads your models, endpoints and recent decisions for the sidebar. Its sign-in is kept in the editor's secret store; **Saina: Sign Out** revokes it.
- **Your coding agent** has its own connection to the same MCP server, approved separately in Studio (read only, or read and write). Its tool calls read or change data in your Studio workspace according to that approval.
- Revoke either connection in Saina Studio settings at any time. The extension sends no telemetry.

## Settings

| Setting | Default | |
|---|---|---|
| `saina.baseUrl` | `https://api.saina.run` | Your service origin for a self-hosted server, for example `http://localhost:8000`. |
| `saina.registerMcpServer` | `true` | Make Saina Studio available to your coding agent. |
| `saina.confirmBeforeRun` | `true` | Ask before sending an input to a model. |

If your editor has no MCP registration API, run **Saina: Copy MCP Server Config** and paste the result into its MCP config.

## Support

dev@saina.run · [saina.run](https://saina.run)
