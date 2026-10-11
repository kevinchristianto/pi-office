# Pre-publication code audit · 0.5.1

Date: 2026-10-11. Audited the uncommitted animation-stability source, not the older published application. Publication remained on hold throughout the audit. This is a source review with executable regressions, not a guarantee that the application is bug-free or a security certification.

## Scope and method

- Read all application frontend, bridge and observer sources, with separate reviews of UI/identity, lifecycle/3D/navigation, observer reliability and bridge security/concurrency. Independently cross-reviewed the resulting fixes.
- Reviewed launchers, build/test configuration, setup/update documentation and the 19 asset-generation/export/validation scripts. Parsed all 18 Python scripts, checked the JavaScript exporter syntax and parsed configuration/generated JSON. Did not rebuild or rewrite authored assets.
- Exercised real React Three Fiber reconciliation, Three.js animation mixers, shipped GLBs, HTML label portals, raycasting, routes, collision envelopes, resource disposal and actual HTTP handlers. Renderer output is stubbed in these tests.
- Ran npm's dependency audit, a clean lockfile installation, strict TypeScript/build checks and the complete automated test suite. Six Playwright browser tests were discovered, not executed.
- Generated code, lockfile metadata and binary historical artwork were not treated as hand-written application code. All 16 shipped GLBs are unchanged and covered by loading, geometry, animation and hand-anatomy tests. Historical Blender scenes/videos were not rerendered.

## Confirmed defects corrected

### Animation and lifecycle

- Surviving residents retain their rigs and animation phases through data, project and connection changes. Interrupted status blends preserve evaluated weights and clip phase.
- Stop/restart reversals no longer reapply initial positions. Changes before the next rendered frame, including multiple snapshots batched into one React commit, no longer hide a seated resident or produce a departing ghost.
- Offsite/hidden residents no longer leave visible HTML bubbles or clickable mesh targets. Hover cursors are restored when their owner hides or unmounts without overriding another resident's active cursor.
- Selected residents moving beyond the six-desk window keep confirmed departures. Unchanged physical rooms retain active travel; real geometry/transport boundaries safely rebase movement without recreating rigs.

### Frontend interaction

- Roster and Inspect panels no longer obscure each other; Escape dismisses the active panel correctly.
- Visual commands use a monotonic serial instead of wall-clock timestamps, avoiding lost repeated actions.
- Focused projects migrate through canonical metadata updates without dropping selected/followed residents or an open inspection.
- Guide focus remains contained and the guide can scroll within short viewports. Workplace summary text has adequate measured contrast. Activity bubbles retain the reported source-session model.

### Observer reliability and privacy

- Hardened overlapping startup/shutdown/discovery and delayed RPC/send handling so older work cannot revive or overwrite a newer observation generation.
- Preserved queued cost queries, sparse child metadata and omission tracking; rejected stale, malformed or future lifecycle hints before they mutate display state.
- Prevented lossy or ambiguous source identities from combining unrelated children/sessions. Stopped history can be evicted without blocking all new observable children.
- Restricted child-task extraction to supported subagent tool results; unrelated custom/tool result payloads are not exported as child tasks. Task-preview opt-out remains effective.
- Added bounded replay tracking across display-row eviction. At 512 distinct marked children, uncertain lifecycle effects for new identities fail closed while ordinary roster/state updates continue. Root lifecycle and already tracked children are not disabled. Session start/reload resets the observer baseline. See the bridge documentation for the exact limit.

### Bridge and dependencies

- Reject invalid transport IDs instead of sanitizing/truncating them into another identity.
- Reject hidden static-file targets reached through public-looking symlinks.
- Correctly normalize implicit/explicit default HTTP port 80 without allowing other hosts or ports.
- Upgraded the development test runner to Vitest 4.1.11, removed its deprecated configuration and refreshed dependency license notices. Production dependency versions are unchanged. The final npm audit reports zero known vulnerabilities; this is an advisory-database result, not proof of security.

The prior development-tool findings were [Vitest mock redirection file disclosure](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) and Tinypool prototype-pollution gadgets affecting [worker options](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) and [run options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr). The production-only audit was already clean. The vulnerable Tinypool dependency is absent from the updated lockfile.

## Remaining limits

- Native Windows/CMD/ACL behavior, installed Pi/pi-subagents integration, browser WebGL pixels/input and GPU frame rate remain unverified. Cloud-browser access to the executor's loopback was unavailable; denied browser routes were not bypassed.
- The bridge intentionally trusts local OS processes for read-only snapshot/SSE access. It does not isolate observation data from other software already able to connect locally. Installation and credential directories must remain private; path checks are not race-proof against a writer replacing files between checks.
- History is count-bounded, but authenticated worst-case log content can reach approximately 92 million JavaScript characters before serialization overhead. A large snapshot can exceed the per-client pre-write backpressure threshold. Reducing retention or redesigning streaming would require a separate resource-policy change.
- Opaque fleet and child-run identities cannot always be correlated across public DTO families, so the observer does not guess at cross-family deduplication. Usage/cost is reported telemetry, not billing authority; cloned events or omitted history cannot establish exact accounting.
- Lifecycle delivery on final Pi exit is best-effort. Missing/ambiguous contracts, reconnects, old snapshots and exhausted replay tracking suppress uncertain animations rather than invent events.
- The existing Blender footage is a 0.5.0 visual review. Its exporter deliberately refuses the changed blend contract until its review mapping is refreshed. It is not evidence of the new live-event fixes.
- Clean registry installation used the lockfile with lifecycle scripts disabled. Application build and tests passed against that installed tree; no new global software, credentials, Pi settings, services or network permissions were configured.

For exact final test totals and commands, see [TESTING.md](TESTING.md). Updating this audited release includes observer fixes: reload each participating observer only when Pi and its child work are idle, following [UPDATING.md](UPDATING.md).
