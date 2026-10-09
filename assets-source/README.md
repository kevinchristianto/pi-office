# Pi Office Studio — original authored asset library

Original geometry and material design authored for this Pi Office project with Blender 4.3.2. No downloaded 3D models, stock characters, remote texture URLs, or paid assets. All eight runtime GLBs are self-contained and can ship with the app.

## Deliverables

- `pi-office-studio.blend`: compressed editable complete room scene, including original furniture, characters, architecture, lighting and three review cameras.
- `agent-animation-review.blend`: a separate review scene built by re-importing the actual exported runtime GLBs. It demonstrates Idle, Walk, Work and WaveSeated.
- `../public/models/*.glb`: optimized runtime meshes, grouped by material while preserving articulated joints.
- `../public/models/asset-manifest.json`: exact exported axis-aligned sizes, origins, draw-mesh counts and agent integration contract.
- `../asset-renders/blender-*.png`: actual CPU Cycles renders. These are explicitly asset/animation reviews, not screenshots of the browser application.

## Rebuild

Run from the project root:

    HOME=/tmp/blenderhome blender -b --factory-startup --python assets-source/build_assets.py

This creates the original models, the complete source room, optimized embedded-material GLBs, complete animation clips and review PNGs. It requires only Blender and Python's standard library. No network access is required. Rendering uses CPU Cycles without a denoiser because this Blender build does not include OpenImageDenoise.

Supporting scripts:

- `optimize_exports.py`: loads the source scene, batches meshes by material and articulated parent, exports, compresses the source and finalizes clips.
- `finalize_agent.py`: writes deterministic complete-pose GLTF animation tracks, including constant joint channels Blender otherwise omits. Run after a fresh agent export. Each action has all 14 joint rotations plus pelvis translation.
- `render_assets.py`: rerenders the existing source room at 96 samples.
- `render_action_sheet.py`: imports the actual runtime agent/chair GLBs, activates their actual imported NLA clips and renders the action review.

## Placement contract

All GLBs use metres, Y up. Their asset roots are centered on the ground plane. The agent and chair face -Z; the desk user-facing edge is +Z. Place the agent/chair at desk Z + 0.74 m with matching yaw. Desk top is 0.786 m at its upper surface; the keyboard keys are around 0.84 m. Chair seat top is around 0.516 m. Agent pelvis is Y=0.84 m standing and 0.55 m seated. Work hands are forward about 0.51 m and around 0.84 m high, with fingertip reach close to the front keyboard edge; frontend IK is not required.

Agent root is `AgentRoot`. Joint names in GLTF are `Body`, `Head`, `UpperArm.L/R`, `LowerArm.L/R`, `Hand.L/R`, `UpperLeg.L/R`, `LowerLeg.L/R`, and `Foot.L/R`. Three.js GLTFLoader sanitizes periods in node names (for example, `UpperArm.L` may become `UpperArmL`); use animation clips instead of resolving raw joint strings when possible. Local X rotation produces arm/leg flexion. +X is the character's left. All joints are rigid parent hierarchies, not skinned meshes.

Animation clips: `Idle` 2 s, `Walk` 1 s, `Work` 1 s, `Wave` 2 s, `WaveSeated` 2 s, `IdleSeated` 2 s. The base pose is standing. `WaveSeated` maintains the seated lower body. `IdleSeated` leaves hands still, with only subtle breathing/head motion. `Walk` is in-place; the application owns root movement. Crossfade via AnimationMixer. Play Wave and WaveSeated once and return to the prior standing/seated state.

The primary recolorable sweater material is `Agent_Shirt`; use `Agent_ShirtRib` for matching cuffs/collar. Other semantic materials include `Agent_Skin`, `Agent_Hair`, `Agent_Trousers`, `Agent_Shoes`, `ChairFabric`, `SofaFabric`, `Oak`, and `Graphite`. Clone materials before per-agent recoloring.

The workstation includes an oak beveled top, cable tray/cable, pedestal feet, emissive monitor screen with modeled code/activity marks, laptop with keys, compact individually keyed keyboard, mouse/pad, notebook/pen, ceramic mug and coffee. The chair includes 5-star castors, lift, curved ergonomic back slats, lumbar support and padded arms. The agent includes sculpted hair strands, eyes/irises/highlights, brows, nose, smile, ears, individual fingers, watch, knit cuffs, tailored legs, shoe soles/laces and articulation.

## Runtime batching

Draw-mesh counts are 15 desk, 4 chair, 34 agent, 5 plant, 11 bookshelf, 4 sofa, 6 floorlamp and 5 coffee table. All original geometric detail is retained. Source scene objects remain editable in Blender. Glass and other fragile transmission materials are intentionally avoided so appearance is reliable in realtime rendering.
