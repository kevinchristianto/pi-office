# Local observer bridge

The bridge binds only to `127.0.0.1:4317`. It serves the built app from `dist/`, stores a bounded snapshot in memory, and exposes no Pi control endpoints. It does not start, stop, steer, or approve agents.

## Windows / PowerShell

Use Node 24 LTS (or Node 22.20+), an existing Pi installation, and two PowerShell windows. Do not put this folder in a shared directory: snapshots include local project paths and task previews.

Window 1, in the extracted Pi Office folder:

```powershell
npm install
npm run build
npm start
```

The bridge creates a random `.pi-office-token` in the project root if `PI_OFFICE_TOKEN` is absent. It never prints its value. Leave this window running.

Window 2 (replace the sample path with your actual Pi Office folder):

```powershell
$office = 'C:\Users\you\code\pi-office'
$env:PI_OFFICE_TOKEN_FILE = Join-Path $office '.pi-office-token'
$env:PI_OFFICE_URL = 'http://127.0.0.1:4317'
pi --extension (Join-Path $office 'extension\pi-office.ts')
```

Launch that command from the project where you want Pi to work. Then open `http://127.0.0.1:4317` in your browser. The observer can be loaded by several Pi sessions; every session gets its own room/state.

To disable task previews before starting Pi:

```powershell
$env:PI_OFFICE_INCLUDE_TASKS = '0'
```

For a different port, set `$env:PI_OFFICE_PORT = '4318'` in the bridge window and `$env:PI_OFFICE_URL = 'http://127.0.0.1:4318'` in the Pi window. Both must match. Do not use LAN addresses, remote tunnels, reverse proxies, or public hosting for the live bridge.

`PI_OFFICE_TOKEN` may be supplied to both processes instead of a token file. It must contain 32–512 URL-safe characters. Never put the credential in a browser URL, screenshot, git commit, or issue. `PI_OFFICE_TOKEN_FILE` can point both processes to the same private file. Windows filesystem ACLs are inherited from its parent directory; keep that directory restricted to your own account. Unix token files are created with mode 0600.

## Endpoints

- `GET /api/health`: observer version and read-only status
- `GET /api/snapshot`: bounded state snapshot
- `GET /api/events`: server-sent `snapshot` events and heartbeat comments
- `POST /api/hello`: authenticated version/capability negotiation
- `POST /api/ingest`: authenticated observer-state upsert

Only same-origin browser reads are allowed. Host headers must match `127.0.0.1` or `localhost` at the listening port; cross-site browser requests and mismatched origins are rejected. There is no CORS wildcard. Ingestion requires `Authorization: Bearer <token>` and `Content-Type: application/json`.

Ingest shape:

```json
{
  "version": 1,
  "session": {
    "id": "session-id",
    "name": "Project session",
    "cwd": "C:\\work\\project",
    "model": "model-id",
    "connected": true,
    "agents": [
      {
        "id": "session-id:main",
        "name": "Pi",
        "role": "orchestrator",
        "task": "Review the project",
        "state": "working",
        "tool": "read",
        "model": "model-id",
        "inputTokens": null,
        "outputTokens": null,
        "cost": null,
        "updatedAt": "2026-10-09T09:00:00.000Z",
        "logs": [
          {
            "time": "2026-10-09T09:00:00.000Z",
            "level": "info",
            "message": "Tool started: read."
          }
        ]
      }
    ]
  },
  "capabilities": {
    "pi": true,
    "subagents": false,
    "usage": true,
    "logs": true
  }
}
```

Unknown fields are ignored. Missing fields preserve prior values; null metric values mean unavailable, not zero. IDs must be unique within a session; the supplied extension uses session-prefixed IDs globally. The bridge accepts up to 512 KiB per request, 24 sessions, 64 agents per session, and 60 log entries per agent. Old state is evicted when limits are reached. Logs are replaced by each supplied bounded log array.

After 35 seconds without a session heartbeat, active rows become `stale`. After 120 seconds they become `offline`. Completed/error outcomes are retained. A disconnected browser is a separate connection issue from a stale Pi process.

## Privacy and compatibility

The extension observes lifecycle metadata, a bounded task preview, model, usage, and tool names. It deliberately does not export assistant replies, hidden thinking, tool arguments, tool output, credentials, or full transcripts. Task-preview redaction is best effort; disable previews when working with sensitive prompts. All data stays in this local bridge; the bridge sends nothing to external services. Browser-local access is not a protection against other software already running under your user account.

Pi extensions run with Pi's own OS permissions. Review `extension/pi-office.ts` before loading it. All listeners return no behavioral changes. The only subagent RPC methods used are `ping`, `status`, and turn-boundary `cost`. Optional pi-subagents is not required for root-session observation. No scraping of terminal text or arbitrary filesystem watching is used.

Current pi-subagents fleet display keys are opaque and cannot be translated into run IDs. Its public fleet DTO can expose agent/model/token/goal information but omit exact tool and terminal state. An agent disappearing from that DTO is marked stale, never assumed successful. Older versions without fleet support use structured subagent tool progress and lifecycle hints when available. Missing fields remain blank or unknown.

Source contracts checked on 2026-10-09:

- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi exact extension types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- [pi-subagents observability](https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md)
- [pi-subagents extension API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md)

## Verification

Run `npm test`. Backend tests use only Node's test/assert/http/filesystem modules. The observer tests strip its TypeScript types with Node's built-in API and run the actual factory against a fake Pi lifecycle and event bus. No model calls or paid APIs are involved. This validates the integration contracts, but does not replace a smoke test in your particular installed Pi and pi-subagents versions.
