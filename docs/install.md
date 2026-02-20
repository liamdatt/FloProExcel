# Install FloPro Financial Modelling

No coding or dev tools are required for end users.

## 1. Download the manifest

Download `manifest.prod.xml` from your deployment host (example: `https://<your-domain>/manifest.prod.xml`).

If you are using this repository as-is, you can also use:
- Latest release: https://github.com/tmustier/pi-for-excel/releases/latest
- Repo copy: https://github.com/tmustier/pi-for-excel/blob/main/manifest.prod.xml

## 2. Add it to Excel

### macOS

1. Open Finder and press **Cmd + Shift + G**.
2. Open this folder:
   ```
   ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef
   ```
3. Copy `manifest.prod.xml` into that folder.
4. Quit Excel fully and reopen.
5. Go to **Insert → My Add-ins**.
6. Click **FloPro Financial Modelling** to open the sidebar.

If the `wef` folder does not exist:
```bash
mkdir -p ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef
```

### Windows

1. Open Excel.
2. Go to **Insert → My Add-ins**.
3. Click **Upload My Add-in…**.
4. Select `manifest.prod.xml`.
5. Click **Open FloPro** in the ribbon.

## 3. First-run check

1. Open the taskpane.
2. Send a test prompt such as:
   - `Summarize this workbook`
   - `List my sheets and key assumptions`

If you get a response, installation is complete.

## Managed runtime behavior

FloPro uses managed OpenRouter access by default:
- No per-user provider login
- No per-user API key entry
- Curated OpenRouter model list only

The `/login` command is retained as a compatibility shortcut and now opens settings with a managed-access message.

## Self-hosted operator checklist

If you deploy your own instance, configure these before users connect:

1. Set `OPENROUTER_API_KEY` in the server environment.
2. Run the frontend and backend on the same origin.
3. Ensure these backend routes are reachable:
   - `/api/openrouter/v1`
   - `/api/mcp/jamaica-market`
   - `/healthz`

