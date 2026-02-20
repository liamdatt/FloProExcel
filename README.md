# FloPro Financial Modelling

FloPro Financial Modelling is an open-source Excel add-in with a managed OpenRouter backend and built-in Jamaican market MCP tooling.

This repository still keeps internal `pi-*` identifiers for compatibility, but user-facing copy is FloPro.

## What changed

- Managed OpenRouter access (no per-user provider login or API key entry)
- Curated OpenRouter model list only
- Managed MCP endpoint for Jamaican market data
- Same-origin backend + frontend deployment model (VPS target)

## Managed architecture

The production app serves both UI and API from one origin:

- Frontend: `dist/` static assets + `/src/taskpane.html`
- OpenRouter proxy: `POST /api/openrouter/v1/*`
- Jamaica MCP JSON-RPC: `POST /api/mcp/jamaica-market`
- Health check: `GET /healthz`

Backend runtime requirement:

- `OPENROUTER_API_KEY` must be set

## Curated model list

Defined in `shared/openrouter-curated-models.mjs`:

1. `google/gemini-3.1-pro-preview`
2. `anthropic/claude-sonnet-4.6`
3. `openai/gpt-5.2-codex`
4. `moonshotai/kimi-k2.5`
5. `minimax/minimax-m2.5`

## Jamaican market MCP tools

Managed MCP server exposes:

- `jm_list_companies`
- `jm_get_company`
- `jm_get_statement`
- `jm_get_all_statements`
- `jm_get_price_data`

Upstream source:
- `https://chaseashley876.pythonanywhere.com/`

## Install for end users

1. Download `manifest.prod.xml` from your deployment host.
2. Sideload it into Excel.
3. Open **FloPro Financial Modelling** in the ribbon.
4. Start chatting immediately (no login flow).

Detailed instructions: [docs/install.md](docs/install.md)

## Developer quick start

### Prerequisites

- Node.js 20+

### Local development

```bash
npm install
npm run dev
```

### Local production-style run (frontend + backend)

```bash
export OPENROUTER_API_KEY="<your-openrouter-key>"
npm run start:prod
```

## Useful scripts

- `npm run dev` — Vite dev server
- `npm run build` — build frontend to `dist/`
- `npm run backend` — run backend only (`server/index.mjs`)
- `npm run start` — run backend only (`server/index.mjs`)
- `npm run start:prod` — build + run backend
- `npm run check` — lint/type/style checks
- `npm run test:models`
- `npm run test:context`
- `npm run test:security`

## Production deploy

Use a VPS (same-origin frontend + backend). See [docs/deploy-vercel.md](docs/deploy-vercel.md).

Generate production manifest for your host:

```bash
ADDIN_BASE_URL="https://<your-domain>" npm run manifest:prod
```

## Docs index

See [docs/README.md](docs/README.md).
