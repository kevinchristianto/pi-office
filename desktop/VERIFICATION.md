# Desktop companion verification

Target: self-contained portable companion preview 0.2.1, based on published Pi Office v0.5.2 (`c31177705021aedcb538b0a59e37f63ed8da60e8`) and published desktop 0.2.0 commit `768c7799cd13d14b872d7fbb943f1d16beaad1fc`. Cloud Linux verification, 2026-10-13; a separate Windows CI job builds the release asset.

## Isolation

All existing baseline-tracked files remain byte-for-byte unchanged, including root package/lockfile, React/R3F office, bridge, observer, visual assets, routes, and tests. Changes are isolated to `desktop/` and one new feature-branch-only release workflow. The held v0.5.3 cubicle change is not included.

Root `npm run check` passes: production TypeScript/Vite build, observer typecheck, 119 Node tests and 390 component tests (36 files), 509 tests total.

## Desktop checks

The desktop production TypeScript/Vite build passes. It bundles React plus the 2D UI and the existing pure project projection logic; no Three.js, React Three Fiber, canvas or 3D models are loaded. The desktop package has its own dependencies/lockfile. The shipped production dependency audit reports zero known vulnerabilities. The build-only electron-builder toolchain currently reports eight moderate transitive findings associated with an unpatched sprintf-js denial-of-service advisory. Those development dependencies are not shipped; build scripts use fixed metadata. This is disclosed rather than described as a clean development audit.

Transport and shell tests cover fixed IPv4 loopback GET-only access, rejected redirects, bounded response length/deadline, malformed JSON and identities, stripped data fields, original session+agent identities, hidden cancellation and late-result races, recovery hotkey conflicts, tray failure, singleton behavior, crash recovery, secure BrowserWindow preferences, denied permissions/network/navigation/popups/downloads, exact IPC arguments and top-frame sender validation, and preload event stripping.

A real HTTP integration test starts the unchanged bridge with a synthetic fixture and confirms that companion reads preserve the observer roster and revision. This does not install or alter the user's observer.

Current `desktop/npm run check` passes: build plus **227 Node tests and 201 renderer/motion/geometry tests**, 428 desktop tests total, with no skips. Combined with the unchanged web suite, 937 tests pass. Renderer coverage includes startup subscription ordering, updates/removals, project and history selection, task inspection/back/escape, offline state, safe text, recovery controls, and every bridge status including completed.

`npm run package:win` creates an unsigned single portable EXE with an x86 NSIS bootstrap and x64 Electron payload. Its ASAR contains the desktop runtime helpers, preload, core, renderer and stripped package metadata. The unchanged bridge, observer and full web office are bundled separately under resources/office. No development node_modules are shipped. Exact source and embedded-payload verification must pass before a release asset is accepted. This includes Chromium/Electron overhead and is not a tiny native executable. Successful cross-packaging does not establish that the app has run on Windows.

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

## Self-contained executable update (0.2.0)

Fresh aggregate checks pass: root 119 Node + 390 component tests (509); desktop 168 Node + 86 component tests (254). Total: 763 passing tests, no skips. Both production builds and the observer typecheck pass. These counts include 39 focused runtime/worker tests, 16 independent executable integration checks, and 14 packaging/CLI tests.

The packaged app bundles the unchanged bridge modules, full root web build, observer source and Electron runtime. A bounded 4 KiB, 1.5-second loopback health read accepts only the existing Pi Office service/protocol. Only connection refusal permits an app-owned bridge launch. Conflicting or unresponsive listeners produce fixed, non-secret error messages; no ingest/write request or process kill is sent to them. The renderer does not poll until the bridge is verified as external or owned.

An owned bridge runs under Electron utilityProcess with an allowlisted environment, no inherited Node loader/debug arguments and private parent IPC. Startup, graceful shutdown and kill fallback are bounded; only the recorded owned process handle can be stopped. Parent heartbeat expiry shuts down an orphaned worker. This small IPC watchdog remains active while the dock is hidden; snapshot HTTP polling and portrait animation still pause. No whole-app resource measurements have been made for this new packaged arrangement.

The stable credential file is outside temporary extraction. Its contents never enter renderer state, clipboard instructions, logs or package artifacts. Connect Pi exports only the unchanged observer source after an explicit action. Directory/symlink confinement, atomic export, PowerShell quote escaping, explicit clipboard consent, repeated dialog suppression, and the complete immutable 175-file baseline are regression-tested. No Pi settings, prompts or running sessions are changed.

The portable packager verifies both the assembled application and the actual executable's embedded payload, including Electron x64 PE architecture, ASAR source byte identity, all web files, unchanged bridge modules and observer. An EXE SHA256 and JSON verification report are emitted. This is package inspection, not a native Windows launch, visual recording or end-to-end Pi test.

Additional Windows acceptance checks: first launch without Node/npm, offline launch once the EXE is downloaded, moving/relaunching the EXE, simultaneous second launch, user-data paths containing spaces/quotes, no existing bridge, a healthy existing bridge, unrelated port conflict, quit during startup, bridge crash, parent crash, explicit observer connection from a project folder, and full web office opened on demand. Confirm external bridges and all Pi sessions survive app quit. Code signing and interactive Windows acceptance remain outstanding.

### Windows CI verifier correction

The initial Windows build produced the EXE, but verification rejected its nested renderer paths because the ASAR inventory uses forward slashes while app-builder-lib splits lookup directories using the host separator. Verification now converts inventory paths at the reader boundary. A regression loads the actual installed ASAR reader with both Windows and POSIX path semantics, reproducing the original failure and confirming the corrected lookup. No payload integrity check is weakened.

Both packaging commands now fail closed on synchronous or asynchronous errors, including earlier exit hooks that would otherwise reset the status. Five child-process tests cover these cases and prove a malformed executable cannot create a checksum or verification report. The workflow independently requires every release file and checks its size/hash/report before upload. No failed package was released.

## Menu, sizing and visible-state update (0.2.1)

Before free-sizing integration, aggregate checks passed: 509 unchanged web tests plus 332 desktop tests, 841 total. Both production builds and observer typecheck pass. Earlier sections retain historical measurements and counts for their named versions.

Electron 44.7.0 source establishes two relevant mechanisms. Its legacy loadFile URL construction differs from pathToFileURL for percent signs and brackets; Chromium also normalizes Windows drive letters. The renderer now loads the exact canonical URL used by the strict sender check. Validation retains exact webContents and main-frame identity, compares both current and invoking-frame URLs, and rejects hosts, query/fragment, malformed escapes and encoded separators. Only Windows drive-letter case is normalized. The user's exact extraction path was not obtained, so that path mismatch is a supported diagnosis rather than a native reproduction.

Electron SetSize clamps to current minimum bounds. On Windows, SetBounds on a non-resizable window also updates its minimum/maximum to those bounds; enlargement therefore prevented a later SetSize shrink. Presets now use SetBounds, verify the actual result, and commit their selection only after success. Tests reproduce repeated Roomy→Compact from both tray and renderer, partial/ignored changes and rollback, rapid commands, crash reload and offscreen positioning. This source-backed regression model does not replace native Windows testing.

The styled project listbox and options popover cover keyboard arrows, Home/End, Enter/Space, Escape, typeahead, Tab/focus recovery, outside dismissal, stable identities and bounded scrolling. Action-specific errors never echo native exception text. Late failures cannot overwrite a later action result or dismissed message. Opening either popup clears and invalidates old notices, preventing a prior error from covering compact-menu recovery actions; five regressions cover failure, reopen, next action and late rejection.

Seventeen new portrait contracts check truthful captions, connection/history overrides, reduced motion, hidden pauses and source geometry. A 1,001-phase audit checks keyboard contact, two arms, foreground opaque Apple laptop, and caption/head clearance. Stronger work/thinking/attention motion uses CSS transforms only; no new continuous JavaScript loop is introduced. Native compositor, compact text readability at DPI scales, keyboard interaction and menu placement remain acceptance checks.

Primary implementation references:
- https://github.com/electron/electron/blob/v44.7.0/lib/browser/api/web-contents.ts#L279-L295
- https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_base_window.cc#L465-L470
- https://github.com/electron/electron/blob/v44.7.0/shell/browser/native_window_views.cc#L831-L846

## Free sizing and responsive roster (0.2.1)

Final Linux aggregate checks pass: 227 Node + 201 renderer tests (428 desktop) plus 509 unchanged web tests, **937 total**, with no Linux skips. On Windows CI, the symlink-creation audit is explicitly skipped because it may require administrator privileges; no permissions are changed to run it. Both builds and the observer typecheck pass.

The custom lower-right grip uses the existing transparent, non-resizable native window and checked setBounds. Electron explicitly documents that setting resizable:true can break transparent windows. The renderer requests only integer width/height; no position, path, URL, process or raw Electron API is exposed. Main revalidates exact sender/top-frame identity when queued work executes, clamps DIP bounds to minimum/maximum and current monitor work area, and preserves native tray preset behavior while hidden or locked. Free-resize requests require a visible, unlocked live window.

Renderer and main queues coalesce resize input on a 50 ms cadence. The renderer retains at most one in-flight request and one latest target; cancellation and shared error epochs prevent stale gestures/errors from overriding later actions. Keyboard sizing uses 16 DIP steps or 64 with Shift. The renderer reconciles the accepted dimensions after monitor clamping so a subsequent shrink is not stuck behind an oversized request. These are bounded scheduling contracts, not measured native frame-rate claims.

Window geometry alone is persisted in companion-window.json under app userData. Reads are limited to 2 KiB and validated; writes are debounced, use a unique temporary file and atomic replacement, and flush on close. No bridge credentials, agent identities or task text are persisted by this feature. Restoring geometry and display topology/scale/work-area changes clamp size and position, including monitors with negative origins. A small physical work area takes precedence over the usual minimum.

The roster uses auto-fit grid cells (88 DIP compact, 104 DIP roomy), capped portraits, internal scrolling and an explicit 64-illustration limit. Every current agent remains accessible from the full list. IntersectionObserver pauses offscreen artwork; reduced-motion and whole-window visibility pauses remain. Long content is bounded, popups stay above the resize grip, and footer actions reserve grip space. CSS/DOM contracts include narrow, wide, tall, exceptionally small work areas, long labels and many agents. A compact first-row arithmetic budget leaves space inside 260 DIP; this is not a browser pixel measurement.

An updated still uses actual SVG portraits in an illustrative responsive composition and permanently labels itself as a software-rendered concept. It does not establish native window handling or browser layout. Interactive Windows acceptance must include continuous pointer drag, rapid direction changes at work-area limits, keyboard resizing, Escape/capture loss, Compact/Roomy after arbitrary sizes, menu use while sizing, restore after monitor removal, and 100%/150%/200% DPI transitions.

References: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations ; https://www.electronjs.org/docs/latest/api/screen
