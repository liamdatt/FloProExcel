# Deploy Guide (VPS / Same-Origin Backend)

This project now targets a same-origin VPS deployment (frontend + Node backend in one service).

The old Vercel-only static deployment flow is deprecated for managed OpenRouter mode because the app now requires backend endpoints.

## Required backend environment

Set these environment variables on your VPS:

- `OPENROUTER_API_KEY` (required)
- `PORT` (optional, default `3000`)
- `HOST` (optional, default `0.0.0.0`)
- `OPENROUTER_API_TIMEOUT_MS` (optional)
- `JAMAICA_API_TIMEOUT_MS` (optional)
- `RATE_LIMIT_WINDOW_MS` (optional)
- `RATE_LIMIT_MAX_REQUESTS` (optional)

The backend will fail fast if `OPENROUTER_API_KEY` is missing.

## Build and run

```bash
npm install
npm run start:prod
```

`start:prod` builds `dist/` and starts `server/index.mjs`, which serves:

- Frontend assets + `/src/taskpane.html`
- `POST /api/openrouter/v1/*`
- `POST /api/mcp/jamaica-market`
- `GET /healthz`

## Manifest generation

Generate the production manifest with your VPS URL:

```bash
ADDIN_BASE_URL="https://<your-domain>" npm run manifest:prod
```

This writes:
- `manifest.prod.xml`
- `public/manifest.prod.xml`

Distribute `manifest.prod.xml` to users for sideloading.

## Smoke checks

After deploy:

1. Open `https://<your-domain>/healthz` and confirm `ok: true`.
2. Confirm model calls route through `/api/openrouter/v1`.
3. Confirm managed MCP endpoint responds at `/api/mcp/jamaica-market`.
4. Open Excel add-in and verify:
   - no login prompt
   - curated OpenRouter model list
   - Jamaica market tool calls succeed

