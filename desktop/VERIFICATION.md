# Desktop companion verification

Target: opt-in companion preview 0.1.2, based on published Pi Office v0.5.2 (`c31177705021aedcb538b0a59e37f63ed8da60e8`). Cloud Linux verification only, 2026-10-12.

## Isolation

All existing baseline-tracked files remain byte-for-byte unchanged, including root package/lockfile, React/R3F office, bridge, observer, visual assets, routes, and tests. Changes are additions inside `desktop/` only. The held v0.5.3 cubicle change is not included.

Root `npm run check` passes: production TypeScript/Vite build, observer typecheck, 119 Node tests and 390 component tests (36 files), 509 tests total.

## Desktop checks

The desktop production TypeScript/Vite build passes. It bundles React plus the 2D UI and the existing pure project projection logic; no Three.js, React Three Fiber, canvas or 3D models are loaded. The desktop package has its own dependencies/lockfile. `npm audit` reports zero known vulnerabilities for this lockfile at verification time.

Transport and shell tests cover fixed IPv4 loopback GET-only access, rejected redirects, bounded response length/deadline, malformed JSON and identities, stripped data fields, original session+agent identities, hidden cancellation and late-result races, recovery hotkey conflicts, tray failure, singleton behavior, crash recovery, secure BrowserWindow preferences, denied permissions/network/navigation/popups/downloads, exact IPC arguments and top-frame sender validation, and preload event stripping.

A real HTTP integration test starts the unchanged bridge with a synthetic fixture and confirms that companion reads preserve the observer roster and revision. This does not install or alter the user's observer.

Final `desktop/npm run check` passes: build plus **99 Node tests and 84 renderer/motion/geometry tests**, 183 desktop tests total, with no skips. Combined with the unchanged web suite, 692 tests pass. Renderer coverage includes startup subscription ordering, updates/removals, project and history selection, task inspection/back/escape, offline state, safe text, recovery controls, and every bridge status including completed.

`npm run package:win` successfully creates an unsigned Windows x64 portable package. Its ASAR contains only the shell, preload, core, bundled renderer, package metadata and documentation. Packaged runtime source bytes match the verified source. No web/observer/bridge files or node_modules are shipped inside the ASAR. The full unpacked Electron distribution is about 369 MiB; this is not a tiny native executable. Successful cross-packaging does not establish that the app has run on Windows.

## Measurements and limits

An isolated 30-second transport diagnostic measured three 10-second phases with eight synthetic agents. Scope: one Linux Node 24 process running both a synthetic bridge and the companion polling module. It excludes Electron, Chromium renderer, GPU, Windows, and the user's machine. Idle: 29.627 ms CPU, 42,471,424 bytes process RSS; busy: 19.858 ms CPU, 43,257,856 bytes RSS; hidden: 0.874 ms CPU, 43,257,856 bytes RSS. Zero snapshot requests occurred during the hidden phase. These short process-level figures are diagnostics, not desktop application resource claims or an idle-versus-busy comparison.

Full-app idle/busy/hidden CPU, RAM, GPU and frame-rate benchmarks are **not verified**. The executor's browser launch was blocked by a required Unix-socket permission, and the supported cloud browser could not reach the executor's loopback preview (`ERR_CONNECTION_REFUSED`). No restriction was bypassed. Browser pixels/screenshots and native keyboard/mouse behavior remain unverified.

Windows transparency, compositor behavior, tray availability, shortcut conflicts, DPI scaling, dragging, click-through, multi-monitor recovery and native Pi integration must be validated on Windows before describing this preview as production-ready. Windows may handle transparent-window sizing differently, which is why native drag-resize is disabled and explicit presets are used. No code signing, installer, auto-start or auto-updater is included.

## Windows acceptance checklist

1. Start the existing bridge and observer once. Confirm the dock matches the web roster, project grouping, current versus history, task text, and waiting/error attention.
2. Inspect idle, working, thinking and disconnected views; task text containing HTML must remain text. Inspect long names/tasks and >8 agents at both presets and at 100%/150%/200% display scaling.
3. Drag between monitors, toggle pin, minimize/restore, hide/restore, then enable click-through and immediately verify Ctrl+Shift+Space unlocks. If registration fails, lock must remain disabled.
4. Test with tray unavailable and conflicting shortcuts. Test close, second launch and renderer crash recovery. Do not accept a state with no reliable way to restore/unlock or quit.
5. Record the full Electron process-tree CPU/RAM/GPU for comparable idle, busy and hidden intervals, both with the separate 3D browser closed and explicitly open. Account for the existing bridge separately.
6. Confirm closing the companion does not terminate Pi sessions, and root web commands still work independently.

## Animation update verification

The 0.1.1 animation update adds 32 focused motion tests and 14 independent motion-audit tests. They cover every bridge status and historical override; stable SVG node identity on metadata snapshots, roster updates and status changes; keyboard contact and foreground-lid occlusion; conditional chin/raised-palm/temple poses without duplicate arms; low-frequency idle/completed motion; static offline/stale/unknown/history; transform-only keyframes; no animation timers or frame callbacks; hidden/disconnected pause and reduced-motion disabling. The illustrated style and existing web files remain unchanged.

A 14-second 1280×760 / 24 fps H.264 preview was generated offline by rendering the actual JSX SVGs and sampling their implemented CSS keyframes, easing, delays and SVG transform origins. Six state render comparisons confirmed pose changes in the intended limb/face regions, and decoded frames were inspected. This demonstrates the authored motion, not native Electron execution or measured animation performance. The video permanently identifies itself as a software-rendered preview.

## Laptop occlusion correction verification

The previous typing illustration painted hands after the opaque laptop lid, and an earlier test incorrectly required that ordering. The 0.1.2 correction adds a resident-side keyboard deck, aligns wrists and fingers with its visible sides, and draws the lid after all hand/forearm poses. The Apple mark and leaf are inside that lid.

Thirteen new independent geometry tests sample 1,001 typing phases, checking wrist continuity inside palm ellipses, visible finger/deck contact, limb bounds, exactly two visible forearms in each active pose, logo bounds, and corrected paint order. The existing motion test now asserts deck → limbs → opaque lid rather than the previous reversed requirement.

A separate offline raster diagnostic sampled 582 poses across working, idle, thinking, waiting, error and completed cycles. The opaque lid interior remained pixel-identical throughout each state's cycle; the prior illustration changed 183 interior pixels between two typing poses. Dense contact sheets and decoded corrected-video frames were visually inspected. This validates the authored SVG geometry/layering, not native Windows/browser rendering or performance. The corrected 14-second preview retains its software-rendered label.
