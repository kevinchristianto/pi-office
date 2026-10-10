# Pi Office Studio — original authored asset library

Original geometry and material design authored for this Pi Office project with Blender 4.3.2. No downloaded 3D models, stock characters, remote texture URLs, or paid assets. All runtime GLBs are self-contained and can ship with the app. The current eight-resident collection is described first; older studio scenes are retained as historical furniture/animation sources.

## Current adult resident collection

Eight original semi-realistic adult character variants replace the single cartoon resident. They vary in skin tone, face proportions, facial features, hair, eyewear, facial hair, torso breadth and clothing. The style remains a lightweight authored real-time character, not a photorealistic scan.

- `agent-01.blend` through `agent-08.blend`: compressed, editable individual sources. Anatomical pieces, hair, garment seams and accessories remain separate, with all eleven motions editable as NLA tracks.
- `build_residents.py`: deterministic original geometry, animation embedding, optimized GLB exports and current public manifest update. Requires Blender only, with no downloads.
- `resident-contract-validation.json`: SHA-256 identity of all eight final GLBs and the targeted hand correction contract, including unchanged joint/rest transforms, bounded non-hand export retessellation, and the two explicitly changed wave-hand rotation outputs.
- `resident-variants.json`: exact measured bounds, standing heights, neck/head/build parameters, material names, bytes, triangles and draw primitives for each export.
- `LICENSE-residents.txt`: CC0-1.0 dedication for the new original resident assets/scripts.
- `../public/models/agent-01.glb` through `agent-08.glb`: runtime variants. `agent.glb` is a byte-identical compatibility alias of variant 01.
- `resident-lineup-review.blend`, `resident-office-review.blend`: editable review scenes assembled by importing the actual runtime GLBs.
- `../asset-renders/blender-resident-lineup.png`: all eight standing variants, with the exact same contact rig.
- `../asset-renders/blender-resident-portraits.png`: labeled face/hair/upper-garment closeups from actual imported exports.
- `../asset-renders/blender-office-residents.png`: staged office with six seated residents in distinct original clips and two standing residents. Desk/seat/partition coordinates come from `cubicle-layout.json`. This is a Blender asset review, not an application screenshot or a claim that eight agents occupy six runtime desks.

The current exports contain 14 articulated mesh objects and 34–37 material draw primitives each, about 41,700–58,500 triangles and 1.24–1.74 MB per variant. Exact counts are in `resident-variants.json`. Subtle stature variation is approximately 1.64–1.71 m, including neck offsets from −1 to +4 cm and differing head proportions/hair. Leg, pelvis, shoulder, elbow, wrist and foot pivots deliberately remain shared to preserve seating and typing contact. The collection does not simulate arbitrary adult height through whole-rig scaling.

Current material controls: `Agent_Shirt`, `Agent_ShirtRib`, `Agent_Skin`, `Agent_SkinShade`, `Agent_Lips`, `Agent_Hair`, `Agent_HairLight`, `Agent_Trousers`, `Agent_Shoes`, `Agent_Sole`, `Agent_Inner`, `Agent_Undershirt`, `Agent_Metal`, `Agent_Frames`, `Agent_EyeWhite`, `Agent_Iris` and `Agent_Pupil`. Runtime keeps authored palettes and selects the numbered URL by a stable agent-ID hash. No remote textures or model downloads are needed.

All eleven clips and all original sample times are retained. Wave and WaveSeated deliberately change only the waving hand's Hand.R rotation output to present its palm outward after correcting pronation. Every other animation input/output float payload remains byte-identical. Head's rest translation varies between residents for authored neck proportions; the lower body and wrist/contact joint pivots are unchanged. The final application/render integration uses root Y = 0.05 m for seated states and 0.04 m when standing/walking. Full-sample Work checks across all eight variants put soles at 0.0507–0.0547 m on the 0.053 m rug surface (maximum 2.31 mm tolerance), while typing-hand bounds overlap the keyboard region above the 0.826 m desk surface. Offline remains exactly static.

### Corrected hand anatomy

Hands are authored with inward thumbs and rear-facing palms at rest. During Work, dorsal/nail surfaces face up and palms face down. Finger lengths/order are mirrored by side so the index finger is adjacent to the thumb. A short hand-owned wrist contour overlaps the sleeve cuff. The waving hand rolls only during Wave/WaveSeated so its open palm faces outward. Each exported Hand joint carries `extras.handAnatomy` with explicit glTF joint-local thumb/finger landmarks and palmar/dorsal/radial directions; those arrays are already converted to Y-up coordinates.

`render_hand_proof.py` and `assemble_hand_proof.py` reproduce `../asset-renders/blender-hand-anatomy-proof.png`, showing actual exported geometry in rest, typing and waving poses. `resident-hand-proof.blend` preserves the final waving closeup scene. The unchanged portrait grid crops out hands and was retained after the hand correction; lineup and office renders were refreshed.

`validate_hand_revision.py /path/to/prior/glbs` checks a saved pre-revision export set. It reports benign exporter vertex reordering/retessellation honestly rather than claiming unrelated byte buffers are identical. Full runtime tests additionally check actual hand skin/nail geometry, radial/index adjacency, world-space palm directions and cuff overlap.

### Rebuild current residents and review images

Run these from the project root after any optional legacy furniture build:

    HOME=/tmp/blenderhome blender -b --factory-startup --python assets-source/build_residents.py
    HOME=/tmp/blenderhome blender -b --factory-startup --python assets-source/render_residents.py -- portraits 96
    python assets-source/assemble_resident_portraits.py
    HOME=/tmp/blenderhome blender -b --factory-startup --python assets-source/render_residents.py -- lineup 96
    HOME=/tmp/blenderhome blender -b --factory-startup --python assets-source/render_residents.py -- office 64

Portrait assembly requires Pillow. The Blender model/export/render scripts need only Blender and Python's standard library. All review lighting is CPU Cycles without denoising; these renders are clearly separate from browser QA. Intermediate portrait files are removed by the assembly script.

`build_assets.py` below is the legacy room/furniture authoring script and also writes the historical single character. Always run `build_residents.py` afterwards to restore the current numbered collection and compatibility alias. Do not use a historical character preview as the current resident review.

## Historical studio and furniture deliverables

- `pi-office-studio.blend`: compressed editable complete room scene, including original furniture, characters, architecture, lighting and three review cameras.
- `agent-animation-review.blend`: a separate review scene built by re-importing the actual exported runtime GLBs. It demonstrates Idle, Walk, Work and WaveSeated.
- `agent-state-review.blend`: imported-runtime review of ThinkSeated, WaitSeated, ErrorSeated, DoneSeated and OfflineSeated.
- `agent-animation-validation.json`: full-frame bounds, loop-seam and track-count checks for all eleven exported clips.
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
- `embed_state_clips.py`: adds the exact authored state motions to the editable room rig and saves compressed source.
- `render_state_sheet.py`: imports the actual runtime GLB and renders the five new state gestures.
- `validate_agent_animations.py`: checks every exported animation frame, finite normalized rotations, complete 15-track poses, bounds and loop seams (requires NumPy, included in Blender).
- `render_action_sheet.py`: imports the actual runtime agent/chair GLBs, activates their actual imported NLA clips and renders the action review.

## Shared placement contract

All GLBs use metres, Y up. Their asset roots are centered on the ground plane. The agent and chair face -Z; the desk user-facing edge is +Z. Place the agent/chair at desk Z + 0.74 m with matching yaw. Desk top is 0.786 m at its upper surface; the keyboard keys are around 0.84 m. Chair seat top is around 0.516 m. Agent pelvis is Y=0.84 m standing and 0.55 m seated. Work hands are forward about 0.51 m and around 0.84 m high, with fingertip reach close to the front keyboard edge; frontend IK is not required.

Agent root is `AgentRoot`. Joint names in GLTF are `Body`, `Head`, `UpperArm.L/R`, `LowerArm.L/R`, `Hand.L/R`, `UpperLeg.L/R`, `LowerLeg.L/R`, and `Foot.L/R`. Three.js GLTFLoader sanitizes periods in node names (for example, `UpperArm.L` may become `UpperArmL`); use animation clips instead of resolving raw joint strings when possible. Local X rotation produces arm/leg flexion. Legacy rig label `.L` is +X and `.R` is −X. With the exported character facing −Z/up +Y, +X is anatomically right. Labels remain unchanged for animation compatibility; do not infer anatomical side from their spelling. All joints are rigid parent hierarchies, not skinned meshes.

Animation clips: `Idle` 2 s, `Walk` 1 s, `Work` 1 s, `Wave` 2 s, `WaveSeated` 2 s, `IdleSeated` 2 s. The base pose is standing. `WaveSeated` maintains the seated lower body. `IdleSeated` leaves hands still, with only subtle breathing/head motion. `Walk` is in-place; the application owns root movement. Crossfade via AnimationMixer. Play Wave and WaveSeated once and return to the prior standing/seated state.

The primary recolorable sweater material is `Agent_Shirt`; use `Agent_ShirtRib` for matching cuffs/collar. Other semantic materials include `Agent_Skin`, `Agent_Hair`, `Agent_Trousers`, `Agent_Shoes`, `ChairFabric`, `SofaFabric`, `Oak`, and `Graphite`. Clone materials before per-agent recoloring.

The workstation includes an oak beveled top, cable tray/cable, pedestal feet, emissive monitor screen with modeled code/activity marks, laptop with keys, compact individually keyed keyboard, mouse/pad, notebook/pen, ceramic mug and coffee. The chair includes 5-star castors, lift, curved ergonomic back slats, lumbar support and padded arms. The agent includes sculpted hair strands, eyes/irises/highlights, brows, nose, smile, ears, individual fingers, watch, knit cuffs, tailored legs, shoe soles/laces and articulation.

## Runtime batching

Furniture draw-mesh counts are 15 desk, 4 chair, 5 plant, 11 bookshelf, 4 sofa, 6 floorlamp and 5 coffee table. The historical agent used 34 meshes; the current numbered residents use 14 meshes with 34–37 material primitives. All original geometric detail is retained. Source scene objects remain editable in Blender. Glass and other fragile transmission materials are intentionally avoided so appearance is reliable in realtime rendering.

## Intentional state animations

The application maps working to `Work`, thinking to `ThinkSeated`, waiting to `WaitSeated`, idle to `IdleSeated`, error to `ErrorSeated`, done to `DoneSeated`, and offline to `OfflineSeated`. Only Work moves the hands as typing. The five additional clips preserve the exact original hierarchy, geometry and materials.

- `ThinkSeated` (6 seconds): slowly lifts one hand to the chin, holds a slight thoughtful head tilt, and returns smoothly to rest.
- `WaitSeated` (6 seconds): briefly raises the watch wrist and glances down, then resumes attentive stillness.
- `ErrorSeated` (5 seconds): a restrained head shake followed by calm. No panic or exaggerated motion. Play once and hold the final frame, or use its seamless slow cycle.
- `DoneSeated` (6 seconds): one small satisfied nod and hand gesture, then stillness. Play once upon entering done, then use IdleSeated while the status remains done; do not restart the celebration on rerenders.
- `OfflineSeated` (4 seconds): an exactly static, rested pose. It can be sampled once with no running mixer.

Each new clip contains all 14 rigid-joint rotations plus Body translation. Every first/last pose matches exactly, including the subtle breathing cycle. Under reduced motion the application should sample a representative seated state pose without advancing animation, and snap expressly requested movement instead of interpolating it. Root translation remains application-owned.

`blender-state-animation-review.png` is a Blender render of the exported GLB's actual imported animations, with each state shown at a representative frame. It is not a browser screenshot.

## Current cubicle-layout review

`cubicle-layout.json` is the six-desk section exported from the tested runtime `createRoomLayout`. `render_cubicle_preview.py` imports the actual runtime GLBs and renders those desk/partition positions to `asset-renders/blender-cubicle-layout.png`. It also saves the editable `pi-office-cubicles.blend`; `compact_cubicle_scene.py` shares identical mesh data to keep that source compact. This preview validates the room arrangement, not browser HUD or bubble rendering.
