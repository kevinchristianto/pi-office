# Updating to the immersive office · 0.2.0

1. Stop the Pi Office bridge with Ctrl+C. Leave your Pi sessions and observer configuration in place.
2. Update source files in the **same app folder**. Keep `.pi-office-token` and all local configuration. Keep the `extension/pi-office.ts` path unchanged if Pi settings reference it.
3. Run `npm ci`, then `npm run build` so the local GLB assets are copied into `dist/models/`.
4. Restart with `npm start` or `START-OFFICE.cmd`. Hard-refresh the office tab with Ctrl+F5.

There is no token rotation, Pi settings change or CONNECT-PI relaunch needed for this presentation update. Do not use `git clean -fdx`: it can delete ignored local credentials and dependencies.

## What's new

- Full-window perspective 3D world with minimal floating controls
- A room per participating session, with the full roster available on demand
- Original Blender-authored furniture, articulated characters and local GLB assets
- Click-to-select inspection, waving, safe lounge strolls, camera following and return-to-desk
- Working and seated-idle animations reflect reported state; walking/waving are explicitly visual actions and never command Pi
- The giant-label bug remains fixed: labels use screen-space scale 1, bounded text and appear only for a selected/hovered character

See TESTING.md for passed checks, inspected Blender renders and the remaining browser/Windows/Pi validation boundaries.
