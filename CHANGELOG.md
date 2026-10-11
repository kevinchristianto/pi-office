# 0.5.1 · Stable resident animation and code audit

- Keep continuous older bridge snapshots from repeatedly resetting the scene; unversioned data remains ineligible for inferred arrival/departure events
- Preserve a selected resident's departure when live/history ordering moves it beyond the six-desk window
- Blend rapidly changing status clips from their current weights instead of restarting interrupted fades
- Preserve resident rigs across display-only project/view changes while keeping source session and agent identities separate

- Handle lifecycle reversals before the next frame and remove hidden actor bubbles, hit targets and stale hover cursors
- Fix overlapping panels, rapid visual commands, guide focus/scroll and workplace summary contrast
- Harden observer generation races, sparse child events, identity handling, lifecycle ordering and bounded replay tracking
- Restrict child-task previews to supported subagent results; preserve preview opt-out
- Reject ambiguous transport IDs and hidden symlink targets; normalize default-port loopback requests
- Upgrade the development test runner to Vitest 4.1.11; final dependency advisory scan is clean

See AUDIT.md for the review scope, confirmed fixes and remaining limitations. This release includes observer fixes, so participating Pi sessions need an idle observer reload after updating.

Regression checks exercise actual React Three Fiber reconciliation, shipped GLBs and AnimationMixer. Browser pixels and native Windows/Pi remain unverified; see TESTING.md for the current run.

# 0.5.0 · Shared workplace and walking lifecycle

- Fixed duplicate offices: group same-project sessions by canonical Git worktree root while preserving source identities and prioritizing live members
- Compact centered departments and opposing desk/chair/resident pairs
- Corporate materials, shared reception, project room, coffee/print facilities and operations display
- Accessible Workplace directory, project focus, actual activity/attention and visual resident actions
- Genuine full-size entrance-to-desk and desk-to-exit lifecycle travel replaces desk scale/fade effects
- Direct collision-aware routes, rounded corners, bounded heading and 50% brisker walking with matching foot-cycle speed
- Conservative explicit event gating, frame-driven completion, traffic reservations, interruption/restart and reduced-motion handling
- Lazy 3D loading, material-batched architecture and furniture-buffer cleanup
- Bounded bridge shutdown/uploads/SSE, token/static-path safeguards and clearer native Windows setup/update checks
- Original eight resident GLBs, corrected hands and authored clip data unchanged

This source was reconstructed after the executor lost the previous uncommitted workspace. Its current tests and render results are recorded separately; earlier test totals are not reused as evidence. Source recovery checkpoints and a final archive are saved before review. Nothing is committed or published until approved.

Browser WebGL/input/performance and native Windows/Pi integration remain unverified here. Blender review footage uses illustrative lifecycle events and is not a live runtime recording.
