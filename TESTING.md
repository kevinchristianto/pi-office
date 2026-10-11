# Verification record · live office/history 0.5.2

Date: 2026-10-11. Fresh clone of published `1786f6c38bfa24580c646dd2762cef5c2ccd2dab`. Cloud Linux only; no access to the user's computer. This is a frontend presentation fix, with bridge/observer history and source identities preserved.

## Current verification

Fresh `npm run check` passed against the final held source: frontend TypeScript/Vite build, strict observer TypeScript, **119 Node tests plus 390 Vitest tests across 36 files, 509 total**, with no skips. This includes 24 additional regressions since 0.5.1. Independent frontend/lifecycle cross-reviews passed. Four focused negative controls fail against the published baseline as expected.

Prettier, configuration TypeScript and `git diff --check` pass. Source hashes were checked before and after the final aggregate run; no application source changed during that run.

Coverage includes initial stopped/offline snapshots, refresh/reconnect, unfinished departures, stale grace versus offline contact, newer authoritative restarts, grouped source identities, historical selection, current/history counts, empty live offices and disabled physical controls for absent residents. Historical records remain accessible through the roster and Inspect. Genuine observed stops retain their actor until the exit completes in a continuous view; reconnect settles the stopped actor absent without replaying travel. Lost contact never synthesizes an exit.

The desk furniture/layout remains stable while occupants change, avoiding route or collision-geometry churn. All 16 authored GLBs are byte-identical to the published baseline. Backend and observer source are unchanged. Dependency versions are unchanged; clean `npm ci --ignore-scripts` succeeded, and the fresh full npm advisory scan reports zero known vulnerabilities.

Actual R3F/GLB tests use renderer stubs and do not verify browser pixels or GPU performance. Native Windows, real installed Pi/pi-subagents and browser WebGL/input remain unverified. The previously blocked browser route was not bypassed or retried. Historical Blender footage was not rerendered for this presentation change. This patch does not require an observer reload when upgrading from 0.5.1.

The records below describe earlier source stages and are not the current test count.

---

# Historical verification · audited animation stability 0.5.1

Date: 2026-10-11. Audited the uncommitted fix stage based on published commit `a549e0c935cee5e6b4eafa5f33569006b9f1dde4`. Cloud Linux only; no access to the user's computer. See [AUDIT.md](AUDIT.md) for the complete scope, confirmed corrections and residual risks.

## Final automated verification

- Fresh `npm run check`: strict frontend TypeScript/Vite production build, strict observer TypeScript, **119 Node tests plus 366 Vitest tests across 33 files, 485 total**, all passing with no skipped tests. After the final observer sparse-metadata clarification, strict observer TypeScript and the entire 119-test Node suite were rerun successfully; frontend source was unchanged.
- Clean `npm ci --ignore-scripts` from the updated lockfile passed. Vitest is pinned to 4.1.11; production dependency versions are unchanged. `npm ls --depth=0` passes. Final full dependency advisory scan reports **zero known vulnerabilities**. Advisory results are time-dependent and are not a security guarantee.
- Configuration TypeScript, Prettier, `git diff --check`, all 18 asset Python scripts' AST parsing, JavaScript exporter syntax and configuration/generated JSON parsing pass.
- All 16 shipped GLBs remain byte-identical to the published baseline. Actual GLTFLoader, AnimationMixer, animation/anatomy, resource disposal, architecture/routing and furniture geometry regressions pass.
- Independent reviews cross-checked frontend/runtime and bridge/observer fixes. Negative controls reproduced defects against the prior frozen source, including 26 observer audit failures and four preservation passes.

The 71 additional tests since the initial 414-test stability stage cover event ordering/replay, observer races and privacy, bridge boundaries, interactions and actual 3D lifecycle/hidden-actor behavior. Runtime tests exercise real R3F reconciliation, GLBs, clip mixers, DOM portals and raycasting with renderer output stubbed; they do not verify browser pixels or GPU frame rate.

## Explicitly unverified or historical

Six Playwright definitions were discovered, not executed. The separate supported cloud browser cannot reach the executor loopback; denied browser routes were not bypassed. Native Windows/CMD/ACL behavior, installed Pi/pi-subagents integration and real browser WebGL/input/performance remain unverified.

Existing 0.5.0 Blender footage is historical and was not rerendered for these fixes. The review exporter safely refuses the changed animation-blending contract until its mapping is refreshed. Assets and clips remain unchanged. This audited release includes observer changes, so follow UPDATING.md and reload participating observers only when Pi and child work are idle.

The older records below describe earlier source stages, including their dependency-install and verification limitations. They do not replace this fresh audit run.

---

# Historical pre-audit verification · animation stability 0.5.1

Date: 2026-10-11. Fresh clone of published commit `a549e0c935cee5e6b4eafa5f33569006b9f1dde4`. Cloud Linux only; no access to the user's computer.

## Current bugfix verification

All steps of `npm run check` passed on the final source (build/observer/Node and Vitest were run separately): strict frontend TypeScript and Vite build, strict observer TypeScript, **81 Node tests plus 333 Vitest tests across 28 files, 414 total**. `git diff --check` passed. The 25 new regressions include actual scene identity, interrupted animation blending, pre-frame transforms and real App focus/lifecycle continuity.

The regression tests reproduce the published-source failures using the actual App/data/lifecycle path and actual React Three Fiber reconciliation, shipped GLBs and AnimationMixer. Renderer output is stubbed: these are runtime-logic and transform checks, not browser screenshots, GPU/frame-rate measurements or a reproduction on the user's Windows computer.

Confirmed causes include repeated visual baseline resets on unversioned bridge snapshots; global scene keys and project-ID changes replacing surviving rigs; selected historical roster movement swallowing a stop; interrupted animation fades restarting outgoing weights; and a stop/restart direction change reapplying the initial position before the next rendered frame. Ordinary current-versioned metadata snapshots alone preserve rig identity.

The 0.5.0 Blender footage remains a prior visual review. It is unchanged and does not demonstrate these live data-update fixes. All authored assets and animation clips remain unchanged.

Dependency installation from the registry failed on this run. Verification uses the intact existing dependency tree with the same dependency lockfile; `npm ls --depth=0` passes. Only the package version metadata changes to 0.5.1. Browser WebGL and native Windows/Pi integration remain unverified.

The older release records below are historical context, not a substitute for the current bugfix run.

---

# Verification record · project-grouped corporate office 0.5.0

Date: 2026-10-11. Reconstructed from the published 0.4.0 baseline after a cloud workspace rollback. Earlier 0.5.0 test totals are not evidence for this tree. All current results below come from fresh runs. Cloud Linux only; no access to the user’s computer.

## Current verification

Fresh `npm run check` passed after production-source freeze: strict frontend TypeScript and Vite build, strict observer TypeScript, 81 Node tests and 308 Vitest tests across 25 files (389 total). `git diff --check` passed. Six Playwright tests were discovered but not executed. All 16 shipped GLBs, including all eight corrected resident variants, are byte-identical to the published baseline. A fresh `npm ci --cache /tmp/pi-office-recovery-npm-cache` succeeded against the unchanged dependency lockfile (package version alone changed).

Coverage includes compact centered multi-project grids, opposing desk orientations, camera fit/focus, workplace panels and keyboard behavior; confirmed lifecycle protocol and reconnect/filter suppression; complete swept-body entrance/exit routes through actual GLB furniture and architectural solids; frame-driven FIFO traffic, restart/interruption, retained departures after roster removal, reduced motion, direct line-of-sight pathfinding, collision-checked rounded turns, floor-union clearance and continuous heading. Independent integration tests run the actual lifecycle hook, React Three Fiber frame loop and authored GLB AnimationMixer together. Render output is stubbed in those tests, so they do not validate browser pixels or frame rate.

Natural navigation uses a bounded eight-scene geometry cache. An independent four-project/24-route CPU check measured repeated equivalent layouts at 0.17–0.31 ms per batch after caching, versus 321–727 ms before the fix. Cold planning was about 511 ms under concurrent cloud rendering. These are development-machine route-generation timings, not browser frame-rate guarantees.

Runtime hardening is verified with real HTTP streams, malformed/stalled/oversized uploads, bounded SSE clients, private token/static-file boundaries and real process mixed-signal shutdown. Windows command helpers and real Pi sessions remain untested here.

## Project grouping regressions

Actual temporary Git repositories, nested directories, symlink aliases, separate clones and linked worktrees verify canonical worktree-root identity. Bounded Git refusal, missing executable, output overflow, timeout and async start/shutdown races are covered. Windows normalization/filesystem-identity fixtures cover case/slash aliases and case-distinct directories; these are not native Windows runtime tests.

Actual App/SSE/lifecycle-hook tests verify one project office for multiple source sessions, independent raw-ID collisions, source-specific inspection/focus/follow, live-first project/desk windows, retained historical observations and exact-root legacy upgrades. Real React Three Fiber/GLB tests cover preserved appearance, shared physical-room traffic and retained exit actors whose fields continue updating outside the six-desk window. Stable scene ordering prevents a last-root stop from cancelling its departure just because the project becomes offline. Unknown paths, truncated/ambiguous legacy paths and colliding display-ID namespaces remain isolated.

## Animation review

The updated natural-walking preview has 190 frames / 15.8333 seconds. Its sample route is 11.800 units instead of the previous 16.010; one-way walking time is about 6.56 seconds instead of 13.34. This comparison is specific to the preview desk.

The current Blender review uses exported runtime geometry, entrance/desk route helpers and the same movement controller sampled at 12 fps. It shows a complete full-size arrival, seated work, stand and full departure at 1.8 scene units per second. Stand/sit has a 0.32-second transition phase, with a 0.2-second authored-clip blend. Walk clip playback runs at 1.5× the original rate to match the 50% faster translation. Heading is bounded, including a brief in-place turn on reversal. The project-grouping fix changes no review geometry or motion: all 190 samples and original GLBs were compared unchanged, source provenance was refreshed, and the saved scene plus existing MP4 passed validation/full decode again. It is a Blender visualization, not an application recording or proof of live Pi event delivery. Lighting, antialiasing and imported-clip blending can differ from Three.js.

Only fresh explicit supported starts/stops trigger lifecycle movement. Initial snapshots, reconnects, filters, stale/offline transitions and task-turn activity never synthesize it. Stops are best-effort observer events; a process that terminates before sending one can simply become offline. Queued arrivals wait outside the visible scene, with one shared corridor owner. Completed-stop history is capped at 512 identities, prioritizing the current/inflight roster; a fresh transport epoch establishes a new snapshot baseline. Reduced motion settles directly without travel. Whole-project removal, focus/filter changes and transport resets cancel active travel because the viewed geometry changes; individual roster removal retains a confirmed departing actor. Actual Pi stays view-only.

## Remaining validation

On 2026-10-11 the supported separate cloud browser again returned `net::ERR_CONNECTION_REFUSED` for the executor’s loopback server. Inspecting its resulting error tab was blocked by the browser URL policy, so that route stopped. Same-process HTTP checks returned 200 for the built app and `/api/health`. Local Chromium’s earlier singleton-socket failure was not bypassed. Browser WebGL, pointer hit testing, touch, fullscreen and GPU performance remain unverified. Six Playwright definitions are supplied for running on a supported host. Blender images/video and real Three.js logic tests do not replace those checks.

The following 0.4.0 record is retained as asset history, not the current release’s test total or current office layout.

---

# Historical verification · resident and camera iteration 0.4.0

Date: 2026-10-10. Tested in a Linux cloud workspace with Node 24.19.0. No access to or changes on the user's Windows computer. No publication or deployment was used for testing.

## Passed

The unchanged 0.3.0 baseline passed its complete `npm run check`: build, observer typecheck, 23 Node tests and 68 Vitest tests.

The final `npm run check` passed after the final eight GLBs and manifest were frozen on 2026-10-10 (hand/wrist-corrected exports completed at 02:29:41 UTC). It covers:

- Strict frontend TypeScript checking and Vite production build
- Strict structural Pi observer TypeScript check
- 52 Node unit/integration tests:
  - 14 observer, state, protocol, authentication, origin/Host, SSE and production-bundle checks
  - All seven furniture GLBs, the compatibility `agent.glb`, and all eight resident variants parsed by the actual Three.js GLTFLoader with embedded buffers and no remote asset dependencies
  - All eleven clips in each of the eight resident variants evaluated by the actual Three.js AnimationMixer: intact joints, finite keyframes/transforms, standing/seated pelvis positions, motion for animated clips and a static offline pose
  - Distinct authored geometry in all eight resident variants; these are not palette-only copies
  - Sole bounds stay within a 3 mm seated / 6 mm standing-or-walking desk-rug penetration tolerance across all clips, using exported runtime height constants. Work hand bounds overlap the keyboard and remain above the tabletop. This is an approximate AABB check, not exact physical contact. Seated sole minima are about 0.051–0.055 m against a rug top of 0.053 m.
  - 19 hand-anatomy regressions: actual exported skin and nail vertices support the thumb/index landmarks, mirrored finger-length order and opposite signed chirality in all eight variants. Real mixer evaluation checks all eleven clips, palms down/nails up during Work and the raised palm facing forward during Wave/WaveSeated. Two negative controls deliberately flip hand geometry or invert the nail surfaces while retaining correct metadata; both are rejected. The original incorrect meshes were also independently rejected for all sixteen hands after attaching the new metadata. Wrist-skin and sleeve-cuff bounds overlap at rest in all variants.
- 104 Vitest tests:
  - 5 React app interaction tests with the WebGL scene mocked: initially closed panels, demo/live separation, repeated inspection/activity/dismissal, search, visual commands, follow cancellation, room switching, guide interruptions, live SSE and disconnect state
  - 13 label/camera regressions: fixed-size labels, bounded text and actual perspective-camera projection of every room-bound corner across four viewport sizes and one, two and four rooms
  - 22 room/route/cubicle geometry tests: chair-safe exits, complete path-segment collision checks against desks, chair backs and every low partition, bounded desk windows, distinct lounge points and repeated round trips
  - 5 movement-controller tests: room-aisle reservations, queued walkers, interrupted return, bounded wave duration, independent rooms and repeated trips
  - 9 styled-selector tests: keyboard selection, outside/Tab/Escape dismissal, focus return, repeated opening, long labels and dynamic option changes
  - 7 activity-bubble tests: reported data, missing fields, hover/focus/touch selection, repeated dismissal, fixed scaling, visibility tiers and reduced-motion classes
  - 2 reduced-motion preference tests: OS preference changes and listener cleanup
  - 1 static-mesh batching test: reduced draw calls without changing transformed geometry bounds
  - 14 character-runtime regressions using actual React Three Fiber reconciliation/useFrame, shipped resident GLBs and AnimationMixer: repeated room-focus/reindex/back transitions, unchanged authored palettes, replacement rigs, stopped-action recovery, live field updates, state transitions, wave/walk/return, all eight variants, reduced-motion freeze/resume and a static offline pose
  - 3 stable-identity tests: bounded local model URLs, appearance unchanged by reported name/role/task/state or array order, and distribution across all eight variants
  - 19 camera math/runtime tests using actual React Three Fiber and Drei OrbitControls: bounds, easing, pan normalization, safe fits, repeated zoom/focus, live changes/resize, actual pointer orbit/right-pan/cancellation, wheel handling, keyboard ownership, interruption and reduced motion
  - 4 React camera-UI tests: Focus versus Follow, repeatable toolbar commands, selection/follow cancellation, guide interruption and focus restoration

The character/camera runtime tests stub renderer output. React UI tests use jsdom. These tests evaluate real Three.js scene transforms and controller logic, but do not render browser/WebGL pixels or measure frame rate.

Stable IDs select one of eight authored variants. Variants can repeat across rooms or a larger roster; the mapping does not promise a unique model for every agent.

The finalized resident files contain 42,637–59,449 triangles and 34–37 draw primitives each, at 1.27–1.76 MB per GLB. These are measured asset budgets, not measured frame rates. The production build still reports its large JavaScript chunk warning (approximately 1.27 MB before gzip). Test-only duplicate-Three.js import warnings do not fail the checks. No browser performance claim is made.

## Hand convention and regression scope

The legacy rig labels are preserved: `L` is anatomical right (+X), and `R` is anatomical left (−X), for glTF forward −Z/up +Y. Tests derive radial and dorsal directions from actual thumb/nail surfaces, rather than accepting landmark metadata alone. Thumb direction is pose-dependent: inward is checked only in the neutral resting pose; the wave is checked using its palm-facing direction. The hand correction deliberately rolls only the `Hand.R` rotation tracks in `Wave` and `WaveSeated` to keep the raised palm facing outward. Independent binary comparison against the saved pre-hand exports confirmed that those are the only changed animation output payloads in all eight variants; every other sampled animation payload and all sample times are byte-identical. All eleven clip names and durations remain intact.

## Browser gate and remaining limits

Five Playwright browser tests are supplied in `test/ui.spec.ts`; `playwright test --list` successfully discovers them. Their definitions cover asset delivery, selection, repeated visual commands, room switching, guide dismissal, camera toolbar/keyboard controls and a touch-sized viewport. **They have not executed successfully in this environment.**

The previous local Chromium attempt failed before page execution with `socket() failed: Operation not permitted` while creating its profile singleton socket; an approved unsandboxed attempt had the same failure. That unchanged denied route was not repeated. On 2026-10-10, the supported separate cloud Chrome was checked again against a healthy local bridge at `http://127.0.0.1:4317`; it returned `net::ERR_CONNECTION_REFUSED` before loading the app. Its advertised capabilities provided no private preview/port-forward route. The app was not published or copied to the user's computer to work around this.

Consequently, actual browser WebGL appearance, onscreen animation blending, pointer picking and drag-click behavior, mouse/touch gestures, live frame rate, fullscreen, mobile rendering and browser Back/Forward remain unverified. The maximum visible population is four rooms with six desks each (24 residents). Loader/math tests and Blender renders do not substitute for browser validation or GPU profiling.

Real Windows/Pi/pi-subagents operation and the `.cmd`/PowerShell helpers have not been smoke-tested. Compatibility relies on documented event APIs and synthetic Pi event-bus tests. Updating Pi can still change fields and require adapter changes.

## Dependency reproducibility

A fresh `npm ci` did not complete in this executor: the default npm cache location was unavailable and the writable-cache attempt was interrupted. Checks used an already-installed local dependency tree. Installed package versions and lockfile integrity metadata were compared with this checkout's lockfile and matched; only irrelevant optional binaries for other platforms were absent. No dependency versions were changed for this iteration. A clean install remains part of the local smoke check below.

## Blender visual review

The authored assets and sample rooms have CPU Cycles previews. These are **Blender renders, not browser screenshots**. Earlier previews in `asset-renders/` describe the 0.3.0 assets; they are historical and do not show the updated residents or camera HUD:

- `blender-cubicle-layout.png`: runtime cubicle dimensions/positions
- `blender-state-animation-review.png`: earlier state-specific GLB poses
- `blender-room-overview.png`
- `blender-workstation-closeup.png`
- `blender-character-closeup.png`
- `blender-animation-contact-sheet.png`

Final 0.4.0 previews import the exported GLBs. The full-body and office previews were refreshed after the hand/wrist correction; the unchanged face/torso portrait grid is retained from the garment/pocket review. Final hand proof (02:30:46 UTC), lineup (02:32:20 UTC) and office (02:33:26 UTC) images were visually inspected on 2026-10-10:

- `blender-hand-anatomy-proof.png`: closeups of resting hands, palm-down typing and an outward-facing wave, including the closed wrist/cuff transition
- `blender-resident-portraits.png`: all eight faces, hair styles, eyewear and clothing treatments
- `blender-resident-lineup.png`: full-body silhouettes, hands, shoes and material variation
- `blender-office-residents.png`: six seated residents at the runtime cubicle/desk coordinates and two standing in the lounge; the seated 0.05 m / standing 0.04 m height offsets match the application

Review covered hair coverage, jacket insets, pocket seams, seated/standing placement, radial thumb/index adjacency, palm orientation and wrist continuity. These are detailed, stylized human miniatures. The previews use Blender lighting and an authored review camera; they do not validate browser lighting, the HUD, bubbles, input or animation playback on screen.

## Local validation

```powershell
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

Close an already-running bridge before browser tests when it contains live sessions. The suite starts its own bridge when necessary. An installed Chromium can be selected using `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Suggested manual smoke check:

1. Explore demo. Confirm the full-window office, distinct session rooms, initially closed panels and the eight-variant resident style.
2. Orbit, scroll/pinch to zoom and right-drag to pan. Use Zoom in/out and Fit repeatedly. Confirm dragging over a resident does not select it accidentally.
3. Select an agent. Use Focus once, then Follow. Drag or use focused-camera WASD/arrows to stop following. Confirm typing in search or using other controls never pans the camera.
4. Tab to the office canvas; try WASD/arrows, +/− and Home. Open/close the guide with Escape and verify focus returns to its opener. Repeat on a touch device.
5. Inspect and close details; wave; take a walk; send the resident back. Check typing palms face down, the wave shows its palm and thumbs sit beside index fingers. Queue walks for two agents in one room and confirm they take turns in the aisle.
6. Switch between one room and all rooms repeatedly. Confirm appearance stays assigned to the same agent and animations continue. Resize the window and stream new snapshots while exploring; the camera should not reset unexpectedly.
7. Connect one real Pi session, then a second. Check reported state/model/task/tool/usage, disconnect/reconnect, live addition/removal, missing fields and identity stability. Visual commands must never change real task state.
8. Turn on reduced motion, check fixed poses/instant camera changes, then turn it off and verify playback resumes. Check frame rate with the expected number of residents on the target machine.

The actual Pi connection remains view-only. Use Pi itself for all real task commands.
