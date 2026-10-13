# Pi Office Companion (preview)

An optional 2D desktop dock for Pi Office. The web office, observer, and web commands are unchanged. The portable Windows executable includes Electron, the local bridge, the full built web office, and the observer source. It reuses a compatible running bridge or starts its own loopback-only bridge. It never registers another observer or loads the 3D scene in the background.

## Portable Windows executable (0.2.0)

1. Run `Pi-Office-0.2.0-win-x64-portable.exe`. There is no separate npm install/start or first-launch Electron download. Portable means one self-extracting executable, not an installer; extraction takes disk space and may take a moment.
2. The dock starts the bundled bridge if nothing is listening on the configured port. A healthy existing Pi Office bridge is reused and left running on exit. An unrelated or incompatible service on the port is reported as an error; it is not stopped or replaced.
3. Open the options menu (or tray menu) and choose **Connect Pi…**. For an app-owned bridge, copy the provided PowerShell command and run it from your project folder. Pi must already be installed. This explicitly starts Pi with the bundled observer; it does not change persistent Pi settings or existing sessions. Do not load a second copy of the observer.
4. For an existing external bridge, keep using its existing observer connection or `CONNECT-PI.cmd`.
5. **Open full 3D office** opens the included web office on demand in your default browser. Close that browser tab to stop rendering it. Keep the executable running while using its owned bridge; Quit closes that bridge, but never stops Pi processes or sessions.

The bridge credential stays in the app's persistent user-data directory, outside the executable's temporary extraction folder. The Connect Pi dialog supplies the exact path without revealing its contents. Observer source is exported to a stable subdirectory only when you choose Connect Pi. It remains usable after the executable is moved or its extraction directory is removed.

For an existing observer whose token file must be retained, explicitly set `PI_OFFICE_TOKEN_FILE` to that same absolute file path before launching the executable. `PI_OFFICE_TOKEN` is also supported and takes precedence, but is never displayed or copied; when using it, launch Pi from the same terminal environment. Do not send credential values in chat or logs. The app never searches for or copies another installation's tokens.

`PI_OFFICE_PORT` selects the loopback port (default 4317). The Connect Pi command sets its matching `PI_OFFICE_URL`. No remote bridge addresses are supported. If an external bridge stops, restart it as usual; the app does not silently take ownership of it.

This is an unsigned preview. Windows may show an unknown-publisher warning. Do not disable Windows security protections. A successful cross-build and package inspection do not establish native Windows behavior; see VERIFICATION.md.

## Run from source on Windows

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

The main process reads the verified bridge `/api/snapshot` endpoint at a bounded interval while visible. The renderer never receives the ingest token or a network API. Its transport uses read endpoints only; the app-owned bridge retains its existing authenticated observer ingest endpoint. Hiding stops polling, aborts any pending read, and pauses animations. Restoring requests a fresh snapshot. Offline content is visibly marked as last-known data; it is not presented as current activity.

Only lightweight CSS/SVG resident animations are used, with a limited on-screen roster and reduced-motion support. There is no Three.js/WebGL dependency in the desktop renderer. Electron still carries Chromium's process/memory overhead: this is an architectural resource reduction, not a measured Windows CPU/RAM/GPU guarantee.

## Packaging

`npm run package:win` builds the root web office and desktop UI, then creates a self-contained Windows x64 portable EXE under `desktop/release/`. Install root and desktop dependencies with `npm ci` before building. The build uses pinned electron-builder and official Electron/NSIS distribution tooling, with publishing disabled. It has no auto-updater.

The package contains the 2D UI, Electron runtime, unchanged bridge modules, full web build, observer source, and notices. It excludes development dependencies and local credentials. A successful cross-platform package build does not verify Windows transparency, tray behavior, hotkeys, or native runtime rendering. See `VERIFICATION.md` for actual checks and limits.

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
