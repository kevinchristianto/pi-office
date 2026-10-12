# Pi Office Companion (preview)

An optional 2D desktop dock for the existing Pi Office bridge. The web office, observer, and web commands are unchanged. This package does not start another bridge, register another observer, or load the 3D scene in the background.

## Run on Windows

1. Start your existing Pi Office normally (`START-OFFICE.cmd` or the root `npm start`, with its web build already available).
2. In a separate terminal, from this repository: `cd desktop`, then `npm ci`, then `npm start`.
3. Keep your current observer installation. No second `CONNECT-PI.cmd` step is needed.

Node 22.20+ is required for development. Electron is downloaded from its official release distribution during installation/first launch. The desktop package has its own lockfile: root `npm ci`, `npm run dev`, `npm run build`, `npm start`, and `npm run check` remain web-only.

If your existing bridge uses a different port, set `PI_OFFICE_PORT` to the same numeric port before starting the companion. Only `http://127.0.0.1:<port>` is supported; remote addresses and arbitrary URLs are intentionally unsupported.

## Controls

- Drag the header to move the dock.
- Select an agent for its task, status, and project. This is a read-only view.
- Pin toggles always-on-top. Size presets avoid transparent-window resizing issues on Windows.
- Lock enables click-through, but only when the recovery shortcut was successfully registered.
- **Ctrl+Shift+Space** restores, unlocks, and focuses the companion.
- **Ctrl+Shift+H** hides it. The tray also offers restore/unlock, show/hide, pin, size presets, and Quit.
- The office button opens the existing full 3D web office in your default browser only when requested. Close that browser tab when finished if you do not want it rendering.
- Close hides the companion when recovery is available. Use Quit to exit.

The OS may reserve a shortcut, so shortcut registration is checked rather than assumed. A second launch restores the existing instance. The dock does not install startup entries, request elevated permissions, change security settings, or write to your Pi sessions.

## Connection and resource behavior

The main process reads the existing `/api/snapshot` endpoint at a bounded interval while visible. It does not read the bridge's ingest token, call write endpoints, or expose a network API to the renderer. Hiding stops polling, aborts any pending read, and pauses animations. Restoring requests a fresh snapshot. Offline content is visibly marked as last-known data; it is not presented as current activity.

Only lightweight CSS/SVG resident animations are used, with a limited on-screen roster and reduced-motion support. There is no Three.js/WebGL dependency in the desktop renderer. Electron still carries Chromium's process/memory overhead: this is an architectural resource reduction, not a measured Windows CPU/RAM/GPU guarantee.

## Packaging

`npm run package:win` builds an unpacked Windows x64 app in `release/Pi-Office-Companion-win32-x64/`. Run its `.exe` alongside the already-running bridge. It is a portable preview, not an installer, is not code-signed, and has no auto-updater. Windows may display an unknown-publisher warning. Do not disable OS protection to run it; review/build the source or use a trusted signed distribution.

The package contains the bundled 2D UI and Electron shell, without the web app's assets, observer, bridge, or development dependencies. A successful cross-platform package build does not verify Windows transparency, tray behavior, hotkeys, or native runtime rendering. See `VERIFICATION.md` for actual checks and limits.

## Security boundaries

The renderer is sandboxed with context isolation, Node integration disabled, strict CSP, no network access, denied permission requests, blocked navigation/popups/webviews/downloads, and a small validated IPC command surface. Snapshot text is rendered as text. Main-frame sender validation and a fixed loopback URL prevent renderer-supplied file paths/URLs. The main process bounds snapshot size and fetch duration, rejects redirects, and strips unneeded fields before sending data to the UI.

Official API references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window).

## Development checks

Run `npm run check` here for the desktop build, transport/shell/security tests, and renderer tests. Run the root `npm run check` separately for the unchanged web/observer regression suite. Neither command changes the observer installation.

## Resident motion (preview 0.1.1)

The resident artwork now has small state-specific gestures. Working agents type with alternating visible hands and fingers. Thinking agents bring a hand toward their chin. Waiting agents raise a palm; errors use a restrained concerned/temple gesture. Idle and completed agents use slow breathing and occasional blinking, without suggesting that completed work is still running.

Offline, stale, unknown and historical portraits are static. Animation uses SVG groups and CSS transforms only; there is no JavaScript animation loop. Existing agent DOM identities survive ordinary snapshots so metadata updates do not restart their motion. The dock's existing hidden/disconnected pause and reduced-motion controls still apply. At most eight portraits animate in the dock, or one in the task detail view.

The motion preview is software-rendered from the implemented SVG and CSS keyframes. It illustrates those poses but is not a browser/Electron recording and does not verify native frame timing or performance.

## Laptop depth correction (preview 0.1.2)

Typing wrists and fingers now target a visible rear keyboard deck. The opaque laptop lid is painted in front of every hand and forearm, including thinking and attention gestures, so motion is hidden correctly instead of crossing the lid. The lid has the requested Apple silhouette and leaf. This corrects a real layer-order error in 0.1.1; it is not just a preview-video adjustment.
