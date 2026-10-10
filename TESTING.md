# Verification record · resident and camera iteration 0.4.0

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
