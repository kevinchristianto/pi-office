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

Launch that command from the project where you want Pi to work. Then open `http://127.0.0.1:4317` in your browser. The observer can be loaded by several Pi sessions; each session retains its own state, while sessions in the same project share one office section.

To disable task previews before starting Pi:

```powershell
$env:PI_OFFICE_INCLUDE_TASKS = '0'
```

For a different port, set `$env:PI_OFFICE_PORT = '4318'` in the bridge window and `$env:PI_OFFICE_URL = 'http://127.0.0.1:4318'` in the Pi window. Both must match. Do not use LAN addresses, remote tunnels, reverse proxies, or public hosting for the live bridge.

`PI_OFFICE_TOKEN` may be supplied to both processes instead of a token file. It must contain 32–512 URL-safe characters. Never put the credential in a browser URL, screenshot, git commit, or issue. `PI_OFFICE_TOKEN_FILE` can point both processes to the same private file. Windows filesystem ACLs are inherited from its parent directory; keep that directory restricted to your own account. Unix token files are created with mode 0600.

## Project identity and display grouping

The observer emits optional `session.project` metadata containing `id`, `root`, `name`, `kind` (`git` or `directory`), `platform`, and an optional Windows `filesystemId`. The root is the canonical Git **worktree** top-level, or the exact canonical working directory outside Git. Discovery is a read-only Git call once per session start, limited to one second and 64 KiB; no shell, hooks, Git settings changes or trust overrides are used. Distinct clones and linked worktrees retain different roots. Raw `session.cwd` is preserved separately.

Roots must be absolute, control-free and at most 4096 characters. IDs use a SHA-256 digest of platform and normalized root; Windows case folding additionally requires a positive filesystem identity so case-distinct directories do not collapse. The bridge validates the fields, recomputes the digest and display name, and treats invalid or explicit-null metadata as unresolved. Omitted metadata retains backward-compatible partial updates. An observer that cannot resolve its path sends `project: null`.

Storage remains keyed by the original session ID; agent IDs, lifecycle markers and source state are not merged or rewritten. The browser builds a separate project view with combined residents, stable source-scoped display identities and live-first ordering. Unresolved paths stay separate. Legacy observers without metadata can group exact absolute cwd paths only; reload the updated observer while Pi is idle for Git-root/alias detection.

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

Unknown fields are ignored. Missing fields preserve prior values; null metric values mean unavailable, not zero. Transport session and agent IDs must be exact, nonblank, control-free strings of at most 240 UTF-16 code units. Invalid session IDs are rejected with HTTP 400 and malformed agent rows are ignored; IDs are never shortened into another identity. IDs must be unique within a session; the supplied extension uses session-prefixed IDs globally. The bridge accepts up to 512 KiB per request, 24 sessions, 64 agents per session, and 60 log entries per agent. Old state is evicted when limits are reached. Logs are replaced by each supplied bounded log array.

After 35 seconds without a session heartbeat, active rows become `stale`. After 120 seconds they become `offline`. Completed/error outcomes are retained. A disconnected browser is a separate connection issue from a stale Pi process.

## Cosmetic lifecycle observations

Protocol v1 also accepts optional `agent.lifecycle` metadata: `{ version: 1, eventId, kind: "start" | "stop", source, at }`. The bridge validates the source/kind pairing and timestamp, bounds IDs, and keeps only the latest marker per bounded agent row. Explicit `null` clears a marker on a fresh observer baseline; partial updates preserve it. `streamId` identifies the current in-memory bridge instance. These fields never change reported state, remove roster history, or send Pi controls.

The observer emits root start markers only for Pi's explicit `session_start` reasons `startup`, `new`, and `fork`, and root stop markers only for `session_shutdown` reason `quit`. Missing/unknown reasons, reload, resume, internal cleanup, ordinary `agent_start`/`agent_end`, tool results, and stale/offline projection do not imply lifecycle transitions. The existing best-effort shutdown delivery is unchanged: an undelivered quit cannot produce an exit effect.

For children, only an advertised non-fleet `subagent:child-status` v1 event with an exact `runId`, `childId`, `type`, `started`/`stopped` status, and current timestamp can emit a marker. Old, duplicate, reordered, future, and malformed hints are ignored for transitions. Generic async start/completion hints and fleet membership never mint markers; opaque fleet IDs cannot be safely joined to these events. These observations indicate a reported child lifecycle transition, not execution success or detached-process terminal proof. A separate bounded replay watermark survives eviction of display rows. It remembers at most 512 distinct marked children per observer lifetime; after that limit, new child identities continue receiving ordinary state/roster updates but receive no uncertain cosmetic lifecycle markers. Already tracked children and the root keep their lifecycle handling. A fresh session start or observer reload clears this cache and establishes a new baseline. A stopped child can still have an `idle` display state; the explicit marker carries the lifecycle observation.

The browser establishes a static baseline on initial load, every SSE reconnect, and a bridge-instance change. It consumes only fresh explicit markers during a continuous stream; a separate epoch changes even when React batches reconnect state updates. Filtering/reordering/mounting rooms, membership changes, task completion, and network loss never invent arrivals or departures. The bridge retains reported roster rows after stop so a visual departure can complete independently of the data history.

## Privacy and compatibility

The extension observes lifecycle metadata, a bounded task preview, model, usage, and tool names. It deliberately does not export assistant replies, hidden thinking, tool arguments, tool output, credentials, or full transcripts. Task-preview redaction is best effort; disable previews when working with sensitive prompts. All data stays in this local bridge; the bridge sends nothing to external services. Browser-local access is not a protection against other software already running under your user account.

Pi extensions run with Pi's own OS permissions. Review `extension/pi-office.ts` before loading it. All listeners return no behavioral changes. The only subagent RPC methods used are `ping`, `status`, and turn-boundary `cost`. Optional pi-subagents is not required for root-session observation. No scraping of terminal text or arbitrary filesystem watching is used.

Current pi-subagents fleet display keys are opaque and cannot be translated into run IDs. Its public fleet DTO can expose agent/model/token/goal information but omit exact tool and terminal state. An agent disappearing from that DTO is marked stale, never assumed successful. Older versions without fleet support use structured subagent tool progress and lifecycle hints when available. Missing fields remain blank or unknown.

Source contracts originally checked on 2026-10-09; lifecycle reason/hint semantics rechecked on 2026-10-11:

- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi exact extension types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- [pi-subagents observability](https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md)
- [pi-subagents extension API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md)

## Verification

Run `npm test`. Backend tests use only Node's test/assert/http/filesystem modules. The observer tests strip its TypeScript types with Node's built-in API and run the actual factory against a fake Pi lifecycle and event bus. No model calls or paid APIs are involved. This validates the integration contracts, but does not replace a smoke test in your particular installed Pi and pi-subagents versions.
