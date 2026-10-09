# Verification record · immersive office 0.2.0

Date: 2026-10-09. Tested in a Linux cloud workspace with Node 24.19.0. No access to or changes on the user's Windows computer.

## Passed

`npm run check` passes:

- Strict frontend TypeScript checking and Vite production build
- Strict structural Pi observer TypeScript check
- 23 Node unit/integration tests:
  - 14 observer, state, protocol, authentication, origin/Host, SSE and production-bundle checks
  - All eight original GLB files parsed by the actual Three.js GLTFLoader; finite geometry and embedded buffers with no remote asset dependencies
  - Character animation clips loaded and evaluated by the actual Three.js AnimationMixer; correct standing/seated pelvis positions and finite transforms for Idle, Walk, Work, Wave, WaveSeated and IdleSeated
- 41 Vitest tests:
  - 5 actual React UI interaction tests with the WebGL scene mocked: initially closed panels, demo/live separation, repeated inspection/activity/dismissal, search, visual commands, follow cancellation, room switching, guide interruptions, live SSE and disconnect state
  - 13 label/camera regressions: fixed-size label configuration and bounded text; actual perspective-camera projection of all room-bound corners across four viewport sizes and one, two and four rooms
  - 17 room/route geometry tests: chair-safe exits, complete path-segment collision checks against desks and chair backs, bounded desk windows, distinct lounge points and repeated round trips
  - 5 movement-controller tests: room-aisle reservations, queued walkers, interrupted return, bounded wave duration, independent rooms and repeated trips
  - 1 static-mesh batching test: reduced draw calls without changing transformed geometry bounds

## Rendered and visually inspected

The original authored assets and sample room were rendered in Blender CPU Cycles, then the actual image pixels were inspected. These are **Blender renders, not browser screenshots**:

- `asset-renders/blender-room-overview.png`
- `asset-renders/blender-workstation-closeup.png`
- `asset-renders/blender-character-closeup.png`
- `asset-renders/blender-animation-contact-sheet.png`

They demonstrate the authored geometry/materials and character pose work. The sample room composition is an asset-review scene; it is not the exact runtime multi-session room layout or the in-browser HUD.

## Still unverified

The full Chromium suite is provided in `test/ui.spec.ts` but has not successfully run here. Chromium startup failed before page execution with `socket() failed: Operation not permitted` while creating its profile singleton socket; an approved unsandboxed attempt had the same failure. Separate cloud Chrome could not reach the executor's loopback URL. The app was not published remotely or placed on the user's computer to work around this.

Consequently, actual browser WebGL appearance, animation blending on screen, pointer picking, camera gestures, live frame rate, touch/mobile rendering, fullscreen and browser Back/Forward behavior remain unverified. The DOM/math/Three.js-loader checks and Blender renders do not substitute for browser validation.

Real Windows/Pi/pi-subagents operation and the `.cmd`/PowerShell helpers have not been smoke-tested. Compatibility relies on official documented event APIs and synthetic Pi event-bus tests. Updating Pi can still change fields and require adapter changes.

## Local validation

```powershell
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

Close an already-running bridge before browser tests when it contains live sessions. The suite starts its own bridge when necessary. An installed Chromium can be selected using `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Suggested manual smoke check:

1. Explore demo. Confirm the entire window is the office, session rooms are distinct, and panels begin closed.
2. Orbit, zoom, pan with right-drag/WASD and reset. Select an agent; its label should remain small at every zoom.
3. Inspect and close details; wave; take a walk; follow; cancel follow with Escape; send the character back to its desk. Queue walks for two agents in one room and confirm they take turns in the aisle.
4. Switch rooms and live/demo modes. Real task state must never change because of visual commands.
5. Connect a real Pi session, then a second one. Check reported state/model/task/tool/usage, disconnect/reconnect and missing-field behavior.

The actual Pi connection remains view-only. Use Pi itself for all real task commands.
