# Updating Pi Office safely

## Existing installation

1. Stop **only the Pi Office bridge** with Ctrl+C. You do not need to stop your Pi sessions. The bridge gives its own HTTP connections a one-second grace period and then closes unfinished sockets; repeated signals are safe.
2. Back up any local edits and configuration. Update the app in the **same folder**. Preserve `.pi-office-token`, any custom token file and your Pi settings. Keep `extension/pi-office.ts` at its existing absolute path if Pi settings reference it.
3. In that app folder, run `npm ci`, then `npm run build`. This installs the lockfile's dependency versions and rebuilds the browser bundle, including local model assets. A release ZIP with prebuilt `dist/` can skip this build step.
4. Restart with `npm start` or `START-OFFICE.cmd`. Open the printed URL and hard-refresh the existing tab with Ctrl+F5.
5. If this update changes the observer extension, load the new observer using `/reload` in **each participating interactive Pi session, only after its response, compaction and child-agent work are idle**. A currently loaded extension does not automatically adopt changes on disk. Restarting Pi normally also loads the updated extension when configured. The bridge and browser can be restarted independently.
6. Confirm Live sessions shows one office per project, with each expected source session represented in its combined roster, and check the observed state. Test one normal task and a cancelled/failed task in your own Pi workflow. Do not use a visual office gesture as evidence of real Pi task state.

There is no token rotation or automatic Pi settings migration. Never use `git clean -fdx` to upgrade: it can remove ignored local credentials and dependencies. Do not replace your complete Pi settings file with a sample from documentation.

## Animation stability update (0.5.1)

Rebuild the browser bundle, restart the bridge and hard-refresh the office tab using steps 1–4. The pre-release audit also hardened the observer against overlapping starts, delayed RPCs and ambiguous child identities. Reload the observer in every participating Pi session when work is idle using step 5, even when upgrading from 0.5.0. Older/unversioned bridge snapshots remain viewable without repeated rig resets, but cannot safely animate lifecycle events.

## Project grouping update (0.5.0)

The 0.5.0 release changed the observer. Reload it in each idle Pi session after updating, as described above. Sessions in the same Git worktree now share one office; separate worktrees/clones remain distinct. Outside Git, the exact canonical working directory defines the project. Older observers have only working-directory fallback grouping, so reload is needed for nested directories and filesystem aliases. Unknown paths remain isolated. This display change does not combine or control underlying Pi sessions.

## Configuration and launcher behavior

- `START-OFFICE.cmd` checks for Node 22.20+ and the built `dist/index.html`. It gives build instructions instead of silently installing dependencies.
- `CONNECT-PI.cmd` keeps your current project directory and forwards Pi arguments. It uses an existing `PI_OFFICE_TOKEN` or reads `PI_OFFICE_TOKEN_FILE` through the observer, defaulting to the token beside the app. The token is never printed.
- `PI_OFFICE_URL` takes precedence. If it is unset, the connect helper uses `PI_OFFICE_PORT`, defaulting to `4317`. Set matching values in the separate bridge and Pi terminals. Use absolute paths for custom token files.
- These helpers do not modify global/project Pi settings, register services, create scheduled tasks, add firewall exceptions or terminate Pi processes.
- The local token is generated only when starting a bridge with no existing token. Preserve it across upgrades so already-running observers can reconnect.

## Runtime safety limits

The bridge binds only IPv4 loopback. Host/origin checks and authenticated POST ingestion remain in place. An observation upload has a 10-second body deadline and a bounded payload. SSE is limited to 32 browser streams; a client with over 1 MiB of queued response data is disconnected on its next event/heartbeat. Slow or interrupted requests cannot hold shutdown indefinitely: outstanding bridge sockets are destroyed after the one-second grace period. Shutdown does not send any command to Pi.

Loopback access is not isolation against other software running locally with access to the user account. Keep the app and token in a private user folder; do not expose the bridge through a reverse proxy or tunnel. Windows ACLs remain the user's responsibility.

## Rollback

Stop the bridge, restore your previous app files and lockfile while retaining the same token/configuration, run `npm ci` and `npm run build` if using source, and restart. If you loaded a newer observer, reload the restored extension only when Pi work is idle. Observations are in memory only, so restarting clears retained history; no persistent session database needs migration.

See README.md for current features and TESTING.md for the exact verification record. Windows launchers and real Pi remain subject to the documented local smoke test unless that record explicitly confirms them.
