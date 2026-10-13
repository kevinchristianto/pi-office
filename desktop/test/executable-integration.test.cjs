"use strict";
// Independent executable integration checks. Electron is mocked: these do not
// claim a native Windows execution, desktop benchmark, or PowerShell run.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { createCompanion, IPC } = require("../main.cjs");
const {
  prepareObserverConnection,
  quotePowerShell,
} = require("../observer-connect.cjs");
const { isAllowedCommand } = require("../core.cjs");
const ROOT = path.resolve(__dirname, "../..");
const IMMUTABLE_BASELINE = "293f83a1c3b2668814934e55accd6c47865e5da9";
// Pinned from the immutable baseline tree at authoring time, not live files.
// Inline manifest also verifies source archives and shallow CI checkouts.
const IMMUTABLE_FILE_BLOBS = Object.freeze({
  ".gitignore": "22bb9cf55fd70ad023693acc65bc42dd46640927",
  "AUDIT.md": "6072349b7eac4e3be2a830f4256d6121dd0558d7",
  "CHANGELOG.md": "cad5e94d26756def6d0effdfee41e70227ea25a8",
  "CONNECT-PI.cmd": "4f9d4fc7d19b0d850653065aba31e88a82ed4d16",
  "QUICKSTART.txt": "284a18f08a1fc46517a4be022e5add0e1badcfc2",
  "README.md": "2477cba8574d7c7477114d8900362e0947d1190a",
  "START-OFFICE.cmd": "c8324a6b777bc60b557445c64b97b344e4334484",
  "TESTING.md": "9e0d4ef2bcd8608a6c8b154b446f4c4d4d2b7003",
  "THIRD_PARTY_NOTICES.md": "9b3f23b359302e9e0c121b45585c09ed3818363d",
  "UPDATING.md": "e56dd62297811a627fdaa24fb797ab19deb63575",
  "asset-renders/blender-animation-contact-sheet.png":
    "0b8ea8a79891669fb4ad04fd4bb8427ea1cbafc1",
  "asset-renders/blender-character-closeup.png":
    "e40989eb4ad009084da8b518caf41100692d34f3",
  "asset-renders/blender-corporate-natural-walking-lifecycle.mp4":
    "fb067aeb143c93ba8dd99d04b4e19cf8e88fc974",
  "asset-renders/blender-corporate-walking-lifecycle.mp4":
    "9c939cb1c4e1b5790797419615c0a278fec62517",
  "asset-renders/blender-cubicle-layout.png":
    "57b49cd10e0664c4ef01e1597c3e42924eeac67a",
  "asset-renders/blender-hand-anatomy-proof.png":
    "2487bbb0064f329088362d583e22e1b0899c1b12",
  "asset-renders/blender-office-residents.png":
    "dc93ab3f25cac7a3a009bcf21e3cd2a82fe5d753",
  "asset-renders/blender-resident-lineup.png":
    "7c52d662374f247249e50957d83eac6010c93e14",
  "asset-renders/blender-resident-portraits.png":
    "ebe6768b352f063a3325f7d401c47dc06d9db35f",
  "asset-renders/blender-room-overview.png":
    "11363882e099147c77599a65dad7eae9ac54b049",
  "asset-renders/blender-state-animation-review.png":
    "1a4ece45e76d28a94bfc1034f26e45c1eb35306a",
  "asset-renders/blender-workstation-closeup.png":
    "060e7ffcd70450440e05f6c91d699109f545b206",
  "assets-source/LICENSE-residents.txt":
    "3c6344294829a443aa431723377414cc7267e1a3",
  "assets-source/README.md": "89ed5b7dc81b54244708c2b415e3845b4bcfbafa",
  "assets-source/agent-01.blend": "22930edcc0eba80b006eb5daea21c87a5aa06ba2",
  "assets-source/agent-02.blend": "cbcd5304ebe8a7146758ba5ebfbaa5dd70abbd01",
  "assets-source/agent-03.blend": "534f940bb9bf0d61b1414d5233e58ea3a971837e",
  "assets-source/agent-04.blend": "a14ed9b287416dd6171186dd5275b3823cbd3e1b",
  "assets-source/agent-05.blend": "7f6ae4cdd9a21e053f8cc0ee8f5848fb98a35bd4",
  "assets-source/agent-06.blend": "87e62574f2623cba92f1a68bc18b9377d67ed724",
  "assets-source/agent-07.blend": "59fca013764bda2c510db543f7ec970dd7bf6f54",
  "assets-source/agent-08.blend": "27fc69859b6fbee472c82591a79fb6e9a18bec35",
  "assets-source/agent-animation-review.blend":
    "eb417c1c9cf52a6995e962ab8f65557331912bcd",
  "assets-source/agent-animation-validation.json":
    "138a0361c75434d6b41c6a89013c072cdcbd9938",
  "assets-source/agent-state-review.blend":
    "495beb8b3af00181463d3896d732349fdcb68831",
  "assets-source/assemble_hand_proof.py":
    "8ac29f398341cde35869a1c22e4aa55ff32bc972",
  "assets-source/assemble_resident_portraits.py":
    "9e7c586bd1850075477be5e3d7eeedd8533ca3b5",
  "assets-source/build_assets.py": "a5a3c859b4efb30ffcf1ddeeb7de679b6097d00a",
  "assets-source/build_residents.py":
    "e55cd59974e2b0a7cdbfe0bba97f9e9532fec4d3",
  "assets-source/compact_cubicle_scene.py":
    "1aa3491ccd97620a232fb5ddcc89e1e3958c0034",
  "assets-source/corporate-layout.json":
    "fa4dcb5f5b55b70f3438240263b3997627ea49e5",
  "assets-source/corporate-office-walking-review.blend":
    "800db13f99f05d8eb11981563c882badc2c1956d",
  "assets-source/corporate-walking-validation.json":
    "8e61976a630255795f4f83eb2c503f9a0a4b0eba",
  "assets-source/cubicle-layout.json":
    "7add1f63dec74bf9e32b032c4260589be557befb",
  "assets-source/embed_state_clips.py":
    "b8a63aef4c642e50307b2d0649eee9647128e225",
  "assets-source/export_corporate_layout.mjs":
    "036d933cee1b867ec00aee46e300e38f7ed07f36",
  "assets-source/finalize_agent.py": "97efab216f3018848dbbf12a9cf76bd3eaa9ed6c",
  "assets-source/optimize_exports.py":
    "41ee8e59609895489556f7f203e6171e9defb9ac",
  "assets-source/pi-office-cubicles.blend":
    "fe87b83f065b51d38bdcb1d363e992b432d6059d",
  "assets-source/pi-office-studio.blend":
    "2d2182143c902135ec2e9c8491da7dc5e6649f8a",
  "assets-source/render_action_sheet.py":
    "3ca4bb8cba28b6e9e7f9b73ef782c6ea22237e4e",
  "assets-source/render_assets.py": "1aadf892bd6ac7223eceacb674c05f383cff356b",
  "assets-source/render_corporate_workplace.py":
    "d23dfd58ddb601a9b135b4e24b3315996bbc077d",
  "assets-source/render_cubicle_preview.py":
    "83b2812de0e4b724da3087c220b29f437ab0028c",
  "assets-source/render_hand_proof.py":
    "51f579a4e8ab960385c650f7924cf155a5cd90cb",
  "assets-source/render_residents.py":
    "8202b4da19fa7da6a5675075c15fd0ae4c43f485",
  "assets-source/render_state_sheet.py":
    "227340fac287d66a6ea8310cbfbb950d2bc62ddd",
  "assets-source/resident-contract-validation.json":
    "1c0ae4317a89ebe5e4c5c0f6058953070e22beee",
  "assets-source/resident-hand-proof.blend":
    "ad918861f73fd23ddfad0b9bada2fd705aee26ad",
  "assets-source/resident-lineup-review.blend":
    "7c6bbd4d2424916280f2c31e324e66ac2dffb42a",
  "assets-source/resident-office-review.blend":
    "b1284993738b0fa930d5edcc4ffca552c8a27c43",
  "assets-source/resident-variants.json":
    "021f6459aafdd029000629b7ba3da1b4483d7e72",
  "assets-source/validate_agent_animations.py":
    "7cffffe5fce6cb492c4089bfeac60bedc285e3b3",
  "assets-source/validate_corporate_walking.py":
    "8c1ab540093ba6d1c28073c8104ce10de5a6fc57",
  "assets-source/validate_hand_revision.py":
    "8428f7ad161f0dd142bb68ad465bef2d8751f9dc",
  "bridge/README.md": "73aa7fd90e59824b678be2475c735682a84311a7",
  "bridge/server.mjs": "bc4e3eee5c1fd58cb428e72c0592e9682f3383ac",
  "bridge/state.mjs": "574d31031fd4da1767b7fd85557c18e205ea7a27",
  "extension/pi-office.ts": "82c5d937c9fd20504345e500606ba30bc7a45bd1",
  "index.html": "6f7d57b406782a5cae708a587d91ba36a80bb361",
  "package-lock.json": "69b60332ca6a389c389a65afdf5cd8500fa110e6",
  "package.json": "bec7909e9e4d174a156c31b3aa0e269ee69c25a6",
  "playwright.config.ts": "788b61f04dd36a17c7fc7c1e819d29a98b716c76",
  "public/models/agent-01.glb": "a0c7d111f4eaaa4ca3308e9469e21c286995380a",
  "public/models/agent-02.glb": "ad32f1fa1206bb18487af65c3a415c21b9d64c40",
  "public/models/agent-03.glb": "de07092fd0a1a4ac92a8adcc4918d5c50a6e1241",
  "public/models/agent-04.glb": "e6abafe17a7666edf96f394c2934d7b1c1b9ffd1",
  "public/models/agent-05.glb": "b5d2ea7305c6636219aca0cc6e256144bcad588f",
  "public/models/agent-06.glb": "50c46e7710bafd6a1d3a3114a64a374b30c86c14",
  "public/models/agent-07.glb": "b419f090c26ff31ba8400d6e40238bc87ee4a4b0",
  "public/models/agent-08.glb": "f6649dab5e127a65574547916a6a6c47868a9b0b",
  "public/models/agent.glb": "a0c7d111f4eaaa4ca3308e9469e21c286995380a",
  "public/models/asset-manifest.json":
    "b3254d739cdcc1be429ace69e830315766b07b33",
  "public/models/bookshelf.glb": "a44c3aa0710898a33b2e497ecd862c04d8b7903c",
  "public/models/chair.glb": "73e9d3fdb4795025e65c34a75b53955b374ee1c4",
  "public/models/coffeetable.glb": "841bf6eb903f6bffb2c222e689e46d23d55fa3ba",
  "public/models/desk.glb": "f0893f2c7380f86287d4ad23a112b3255691bf7b",
  "public/models/floorlamp.glb": "f1a7382f49107e79dc4002cd78a933fec49f1bd5",
  "public/models/plant.glb": "5acadf7020831d2e782b0504a6a2acf40822dc8e",
  "public/models/sofa.glb": "77d99b07b7424b27b4368da9e0b6e8292901ad11",
  "src/AgentBubble.tsx": "9805b8a1c2c571104299e1a95536e43551889644",
  "src/AgentLabel.tsx": "e7b00a43f8a802fd5c461c6e855c3f84a216a72f",
  "src/App.tsx": "000dbb4d8eeb2576f3b2aabb5f69913624b3015a",
  "src/BuildingEntrance.tsx": "88b00fc9d5b450c2c0884025fd8c13da55a4f751",
  "src/CameraRig.tsx": "6203e2af2396a14e752b548a188ea60dabbda8ed",
  "src/Office.tsx": "01d9a31ed62f4ab64affccfeb3e28290898e252b",
  "src/RoomSelector.tsx": "96b9b67d684daef04b86530eaaba74a834910a36",
  "src/WorkplacePanel.tsx": "bda8668da441ef895b7614e485eab6e7d249ab34",
  "src/agentPresentation.ts": "a96662b58ca6d0bc84a8a72a71be1a2645acf883",
  "src/animationBlend.ts": "bc289cd85f467750a1f7db589a537b59438c96c5",
  "src/appearance.ts": "d2d9a6fbaefc4052698d49c4dd53e66e0ca45946",
  "src/camera.ts": "fc8f3dc20bb218caa52ad34d193e3dc8874281df",
  "src/demo.ts": "9a7fadddae300d08678acf210099661911a98669",
  "src/entranceDecor.ts": "953f9276af852bf3d1617b1920efd6043e7e17a6",
  "src/lifecycle.ts": "e238f061457f3fe62b2ec58d1ed73fed91e1634a",
  "src/lifecycleRoutes.ts": "265b2fc64c5748625990ccc5f28291279e0c9dee",
  "src/lifecycleWalking.ts": "e0f034e15a84d7701993a048fb92e0877b73b1cc",
  "src/main.tsx": "c528e68af4bc1a52ec2ecb7d5cf61aca94bee087",
  "src/models.ts": "502c9c424120cad1c30ef160a1ad57ecb3594961",
  "src/motion.ts": "68ec8fb8132b37a4c069c02fbdb88ffe8ae9504e",
  "src/naturalNavigation.ts": "29d50a05991f33a315d9ac9261dbd850af820c9b",
  "src/navigationObstacles.ts": "5bddf714bb3b8ffc26ad0b8eebc0016817621400",
  "src/officeDecor.ts": "61c67e31f5af2ba5a430eb57bc8c41253ac75a75",
  "src/projectProjection.ts": "d385f3a7a12e4e10d699e334a566b21000475179",
  "src/room-selector.css": "5e5e44fa8a13d75fe2e1ac9fda5fc989c45100a0",
  "src/state.ts": "7c80608d91102e725fd840c9d94e3c1f2f24d083",
  "src/styles.css": "f395025bbdcb7f6e0bf5f97cd7be0cb436cd5b2e",
  "src/types.ts": "d6ee806c8b4c3c4e6c988ca88217926d06ef1baa",
  "src/useOfficeData.ts": "c9a1b0015dd07b623b5955109258ec8d22aee9ee",
  "src/useReducedMotion.ts": "97029d3c5095df8567edbbd7161eb23328b17016",
  "src/useResidentLifecycle.ts": "dd582edc27deeed611172ca1120353e5db7f5445",
  "src/workplace-panel.css": "08fb4681eba195f1442fda7e1e7b85dc565e9a35",
  "src/world.ts": "b5f4db0878a844e1505b28182f9a552f7c94780d",
  "test/agent-bubble.test.tsx": "e82d1c0fcbeace27f71e985c0ffbe7f282d23c15",
  "test/animation-continuity.test.tsx":
    "4590e7519848d93d983d32492211e6e5d2520d5d",
  "test/animation-runtime.test.tsx": "cf157900dbf931b03904ccf037315218758594dc",
  "test/appearance.test.tsx": "cbad8b980fe5ebdc3227a24b30bb1466a3307cf1",
  "test/assets.test.mjs": "c76d9d7339c3f0c4f737d29c3bfb1b11cd99ae10",
  "test/backend-observer.test.mjs": "a9277b62ca5e99ea82cb5bfab1570019f2ff1798",
  "test/backend.test.mjs": "acf46c3c4d7c9e4ef80858e4d3b32f68aa634e45",
  "test/bridge-audit.test.mjs": "497caaa1adf50d2c3782e5eff35d0cd6c0324553",
  "test/camera-controls.test.tsx": "ea359bcb580801a1b1e23c129c397d553330ed67",
  "test/camera-ui.test.tsx": "07f7da9fea7199c20b83dd8cd2c92f2ca6ab0187",
  "test/flicker-identity-review.test.tsx":
    "7a13e2b1bc419804bd75c82aa5141e334c0cf002",
  "test/flicker-office-runtime-review.test.tsx":
    "0092e311ccb42d6cc105af1bc56cabfbca0b44fd",
  "test/frontend-audit.test.tsx": "c4b7e434e3e14a9c66ab3e4914922b4fe4a3cf02",
  "test/frontend-style-audit.test.tsx":
    "35d4ac946dbe83a63ddbc78379704d26e4915daf",
  "test/frontend-transport-audit.test.tsx":
    "7af10db0811917d55b156ccfaa07bbc8c7b7c0d4",
  "test/geometry-assets-review.test.tsx":
    "ee8743087b021478c73c723c29635455f57713b5",
  "test/hand-anatomy.test.mjs": "bed2c3f1942b9ad2762260a147d701d7bdde7f79",
  "test/lifecycle-routes.test.tsx": "43a8cf55ebc1ecfa97a02f482b5d1592c1e61396",
  "test/lifecycle-runtime-review.test.tsx":
    "477ee8c9214da2b7540f130da833c8a5722063bf",
  "test/lifecycle-walking.test.tsx": "6ad0d2ea03caa2f49ab972683db93244ba7bd0c9",
  "test/lifecycle.test.tsx": "acef0ab60b48de0a06f0b3aca132cb6df59d6c03",
  "test/live-history-lifecycle.test.tsx":
    "2f79a5336e455201a7e2651967e8009b1a6873ad",
  "test/live-history-projection.test.tsx":
    "d3796840cbaf5e2ae5864d73f71e5abef11fd7b2",
  "test/live-history-ui.test.tsx": "541c1ae77f820151d07640bb1bf6a692cd2ec704",
  "test/model-optimization.test.tsx":
    "7dc6ca05a1bb137605d8de57e6b87fc2bda2e54f",
  "test/motion.test.tsx": "74e0079d0ccdcb0fd6114b0119689c6755a8bdee",
  "test/natural-navigation-review.test.tsx":
    "c5a953f9617bd0aabdde304c1de9b8f9b89fb474",
  "test/natural-navigation.test.tsx":
    "e5a71d2fd01138ab1d640ffbd8468726da6b8e84",
  "test/observer-lifecycle.test.mjs":
    "ef0ff6ee5738faf03585c8afe1109da059e07bbb",
  "test/observer-reliability-audit.test.mjs":
    "69103816c368dcbdf090e435b7199086b81c5882",
  "test/production.test.mjs": "830f51e3eea477b2f3c20045a146de12f9326dff",
  "test/project-grouping-observer-review.test.mjs":
    "ca64ce3680b3b5dd651a384b71fdf18532af72c0",
  "test/project-grouping-review.test.tsx":
    "8be7b39b0bad9cb7dd85e2b45bae7206c5003b84",
  "test/project-grouping-runtime-review.test.tsx":
    "160d2fb3ba9c6d74d5ab2c6f9c0c0951d7ecb54b",
  "test/project-identity.test.mjs": "d5d38a38a39d6a40a1ac51a770d20c82cb67edea",
  "test/project-projection.test.tsx":
    "c9e4f50aedc045407e2c35bed59733053243084f",
  "test/reduced-motion.test.tsx": "da260e543b601500813d89cb3530db870dc47dfa",
  "test/resident-anatomy.mjs": "871eb941f44c4c982389554d944b4cfec9e62222",
  "test/resident-bubble-runtime-review.test.tsx":
    "2a83edd02d6f5483b5eb195a7198b4cc1abaa43a",
  "test/resident-lifecycle.test.tsx":
    "fdd4e3e40697d5b79f7fd84b635c728afc9c8db8",
  "test/room-selector.test.tsx": "3b889e6c6ad0d7a9bd13333e0952fdaa4217e390",
  "test/runtime-hardening.test.mjs": "e0c6741cb180b888cb7f745976967d240807cba8",
  "test/scene-regression.test.tsx": "3428df8bf620f51ef173ee45b1ed6e3e9559f446",
  "test/ui-component.test.tsx": "f97f7dd0c3f3eace3a613807ef9fac7dda25f91b",
  "test/ui.spec.ts": "2b73197660da268296c1a7e2e0ebde81c40db4f2",
  "test/workplace-panel.test.tsx": "45fe297d1002f961dc2dc887a08b4152ba92e1f2",
  "test/workplace-scene.test.tsx": "acbcd45de165bd7e1ad571fba0f57908dda21b27",
  "test/workplace-ui.test.tsx": "9455585280f2171e30b9775a8c1b0cca5f28de33",
  "test/world.test.tsx": "dc084e98b941c0d5dd9ebde5d28f7750ce54cb0e",
  "tsconfig.json": "96ef9d25d46c24a3048561adebec1e392e585a45",
  "vite.config.ts": "dcea42329343cae1a5531b1c5db5af8f7157e95e",
  "vitest.config.ts": "c1a3340b5fd306186eec5113587d1698fabd1144",
});
const gitBlobHash = (bytes) =>
  createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
function matchesBaseline(bytes, expected) {
  if (gitBlobHash(bytes) === expected) return true;
  // Git for Windows may check out text as CRLF. Only canonical line endings
  // may differ; binary payloads remain byte-strict against the baseline.
  return (
    !bytes.includes(0) &&
    gitBlobHash(Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"))) ===
      expected
  );
}
const SECRET = "audit-token-content-that-must-never-escape-987654321";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

async function temporary(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "office-executable-audit-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(
  t,
  {
    packaged = true,
    mode = "starting",
    userData = "/app/user-data",
    resourcesPath = "/app/resources",
    ready = Promise.resolve(),
    load = Promise.resolve(),
    start = Promise.resolve(),
    stop = Promise.resolve(),
    tokenFile = null,
    dialogResponse = async () => ({ response: 1 }),
  } = {},
) {
  const events = [],
    requests = [],
    dialogs = [],
    clipboard = [],
    external = [],
    handlers = new Map(),
    shortcuts = new Map();
  const dialogOpened = deferred();
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: packaged,
    setName() {},
    enableSandbox() {},
    requestSingleInstanceLock: () => true,
    whenReady: () => ready,
    getPath: () => userData,
    quit() {
      events.push("app.quit");
    },
  });
  let state = { mode, error: null };
  let runtimeOptions;
  const runtime = {
    getState: () => state,
    getTokenFile: () => tokenFile,
    start() {
      events.push("runtime.start");
      return start;
    },
    stop() {
      events.push("runtime.stop");
      return stop;
    },
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.bounds = {
        x: 10,
        y: 10,
        width: options.width,
        height: options.height,
      };
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: "" },
        isDestroyed: () => false,
        getURL: () => this.webContents.mainFrame.url,
        setWindowOpenHandler() {},
        send: (channel, data) => events.push({ channel, data }),
      });
      events.push("window.create");
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    isMinimized() {
      return false;
    }
    setMenu() {}
    setIgnoreMouseEvents() {}
    setFocusable() {}
    setMovable() {}
    setAlwaysOnTop() {}
    blur() {}
    focus() {}
    getBounds() {
      return this.bounds;
    }
    setPosition(x, y) {
      Object.assign(this.bounds, { x, y });
    }
    setSize(width, height) {
      Object.assign(this.bounds, { width, height });
    }
    setBounds(bounds) {
      this.bounds = { ...bounds };
    }
    show() {
      this.visible = true;
      this.emit("show");
    }
    hide() {
      this.visible = false;
      this.emit("hide");
    }
    async loadURL(url) {
      await load;
      this.webContents.mainFrame.url = url;
      this.webContents.emit("did-finish-load");
      this.emit("ready-to-show");
    }
  }
  class Tray extends EventEmitter {
    setContextMenu(menu) {
      this.menu = menu;
    }
    setToolTip() {}
    isDestroyed() {
      return Boolean(this.destroyed);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const companionSession = new EventEmitter();
  Object.assign(companionSession, {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    setDevicePermissionHandler() {},
    webRequest: { onBeforeRequest() {} },
  });
  const electron = {
    app,
    BrowserWindow: Window,
    Tray,
    Menu: { buildFromTemplate: (items) => items },
    nativeImage: { createFromBitmap: () => ({}) },
    globalShortcut: {
      register(key, fn) {
        shortcuts.set(key, fn);
        return true;
      },
      isRegistered: (key) => shortcuts.has(key),
      unregisterAll: () => shortcuts.clear(),
    },
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      removeHandler: (channel) => handlers.delete(channel),
    },
    session: { fromPartition: () => companionSession },
    shell: { openExternal: async (url) => external.push(url) },
    screen: {
      getDisplayMatching: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    },
    dialog: {
      showMessageBox: async (_window, options) => {
        dialogs.push(options);
        dialogOpened.resolve(options);
        return dialogResponse(options);
      },
    },
    clipboard: { writeText: (text) => clipboard.push(text) },
    utilityProcess: {},
  };
  const companion = createCompanion(electron, {
    geometryStore: null,
    env: { PI_OFFICE_PORT: "5417", PI_OFFICE_TOKEN: SECRET },
    baseDirectory: "/app",
    resourcesPath,
    fetchSnapshot: ({ signal, port }) => {
      const pending = deferred();
      requests.push({ signal, port, ...pending });
      return pending.promise;
    },
    bridgeFactory(options) {
      events.push("runtime.create");
      runtimeOptions = options;
      return runtime;
    },
  });
  t.after(() => companion.dispose());
  return {
    companion,
    app,
    events,
    dialogs,
    clipboard,
    requests,
    handlers,
    shortcuts,
    external,
    dialogOpened: dialogOpened.promise,
    changeState(next) {
      state = next;
      runtimeOptions.onState(next);
    },
    get event() {
      const window = companion.getWindow();
      return {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      };
    },
  };
}

test("executable: every original non-desktop tracked file matches the immutable baseline", async () => {
  let checked = 0;
  for (const [filename, expected] of Object.entries(IMMUTABLE_FILE_BLOBS)) {
    const bytes = await fs.readFile(path.join(ROOT, filename));
    assert.ok(
      matchesBaseline(bytes, expected),
      `${filename} changed from ${IMMUTABLE_BASELINE}`,
    );
    checked++;
  }
  assert.ok(
    checked > 100,
    `Expected a full baseline comparison, checked ${checked} files`,
  );
});

test("executable: development startup remains external-only and does not create an owned bridge", async (t) => {
  const f = fixture(t, { packaged: false });
  assert.equal(await f.companion.start(), true);
  assert.equal(f.events.includes("runtime.create"), false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].port, 5417);
  await f.companion.runCommand("open-office");
  assert.deepEqual(f.external, ["http://127.0.0.1:5417/"]);
});

test("executable: packaged UI never polls an unverified or conflicting listener", async (t) => {
  const f = fixture(t);
  await f.companion.start();
  assert.equal(f.events.filter((x) => x === "runtime.start").length, 1);
  assert.equal(f.companion.getState().visible, true);
  assert.equal(f.requests.length, 0);
  f.changeState({ mode: "error", error: "Port already in use" });
  assert.equal(f.requests.length, 0);
  assert.equal(f.companion.getState().connection.status, "offline");
  f.changeState({ mode: "owned", error: null });
  assert.equal(f.requests.length, 1);
  f.changeState({ mode: "error", error: "Owned bridge exited" });
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve({ sessions: [{ id: "late-untrusted", agents: [] }] });
  await flush();
  assert.equal(f.companion.getState().snapshot, null);
  assert.equal(f.requests.length, 1);
});

test("executable: recognized external mode preserves its observer and exposes no token", async (t) => {
  const directory = await temporary(t);
  const f = fixture(t, {
    mode: "external",
    userData: path.join(directory, "not-created"),
  });
  await f.companion.start();
  assert.equal(f.requests.length, 1);
  await f.handlers.get(IPC.command)(f.event, "connect-pi");
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].detail, /managed separately/i);
  assert.deepEqual(f.clipboard, []);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(
    JSON.stringify([f.companion.getState(), f.events, f.dialogs]).includes(
      SECRET,
    ),
    false,
  );
});

test("executable: quit before Electron readiness cannot create a bridge or window later", async (t) => {
  const ready = deferred();
  const f = fixture(t, { ready: ready.promise });
  const starting = f.companion.start();
  f.companion.quit();
  ready.resolve();
  assert.equal(await starting, false);
  assert.equal(f.events.includes("runtime.create"), false);
  assert.equal(f.events.includes("window.create"), false);
  assert.equal(f.requests.length, 0);
});

test("executable: repeated quits during bridge startup stop only once and wait for cleanup", async (t) => {
  const start = deferred(),
    stop = deferred();
  const f = fixture(t, { start: start.promise, stop: stop.promise });
  await f.companion.start();
  let prevented = 0;
  f.app.emit("before-quit", {
    preventDefault() {
      prevented++;
    },
  });
  f.companion.quit();
  f.app.emit("before-quit", {
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 2);
  assert.equal(f.events.filter((x) => x === "runtime.stop").length, 1);
  assert.equal(f.events.includes("app.quit"), false);
  assert.equal(f.handlers.size, 0);
  assert.equal(f.shortcuts.size, 0);
  start.resolve();
  f.changeState({ mode: "owned", error: null });
  assert.equal(f.requests.length, 0);
  stop.resolve();
  await flush();
  assert.equal(f.events.filter((x) => x === "app.quit").length, 1);
  f.app.emit("before-quit", {
    preventDefault() {
      throw new Error("Cleanup must not veto final quit");
    },
  });
});

test("executable: quit during renderer loading cannot restart polling when load finishes", async (t) => {
  const load = deferred();
  const f = fixture(t, { mode: "owned", load: load.promise });
  const starting = f.companion.start();
  await flush();
  f.companion.quit();
  load.resolve();
  await starting;
  assert.equal(f.requests.length, 0);
  assert.equal(f.companion.getState().visible, false);
  assert.equal(f.handlers.size, 0);
  assert.equal(f.events.filter((x) => x === "runtime.stop").length, 1);
});

test("executable: connect-pi is a fixed, argument-free, trusted-main-frame IPC action", async (t) => {
  const f = fixture(t, { mode: "external" });
  await f.companion.start();
  assert.equal(isAllowedCommand("connect-pi"), true);
  const invoke = f.handlers.get(IPC.command);
  for (const args of [
    ["connect-pi", {}],
    ["connect-pi", "/outside"],
    [{ command: "connect-pi" }],
    [["connect-pi"]],
    ["connect-pi https://evil.test"],
    [],
  ]) {
    assert.throws(
      () => invoke(f.event, ...args),
      /Untrusted companion command/,
    );
  }
  assert.throws(
    () =>
      invoke(
        { ...f.event, senderFrame: { url: f.event.senderFrame.url } },
        "connect-pi",
      ),
    /Untrusted/,
  );
  assert.equal(f.dialogs.length, 0);
  await invoke(f.event, "connect-pi");
  assert.equal(f.dialogs.length, 1);
});

test("executable: observer export is stable, byte-identical, token-free, and PowerShell quoted", async (t) => {
  const directory = await temporary(t);
  const userData = path.join(directory, "user's $(touch injected); `folder");
  const tokenFile = path.join(directory, "token's $(not-executed)");
  await fs.writeFile(tokenFile, SECRET);
  await fs.mkdir(userData);
  const input = { officeDirectory: ROOT, userData, tokenFile, port: 5417 };
  const first = await prepareObserverConnection(input);
  const second = await prepareObserverConnection(input);
  assert.deepEqual(second, first);
  assert.equal(
    first.observer,
    path.join(
      await fs.realpath(userData),
      "observer",
      "extension",
      "pi-office.ts",
    ),
  );
  assert.ok(
    matchesBaseline(
      await fs.readFile(first.observer),
      IMMUTABLE_FILE_BLOBS["extension/pi-office.ts"],
    ),
  );
  assert.deepEqual(
    await fs.readFile(first.observer),
    await fs.readFile(path.join(ROOT, "extension", "pi-office.ts")),
  );
  assert.equal(
    first.command,
    `Remove-Item Env:PI_OFFICE_TOKEN -ErrorAction SilentlyContinue; $env:PI_OFFICE_TOKEN_FILE=${quotePowerShell(tokenFile)}; $env:PI_OFFICE_URL='http://127.0.0.1:5417'; pi -e ${quotePowerShell(first.observer)}`,
  );
  assert.equal(first.command.includes(SECRET), false);
  assert.equal(await fs.readFile(tokenFile, "utf8"), SECRET);
  assert.deepEqual(await fs.readdir(path.dirname(first.observer)), [
    "pi-office.ts",
  ]);
  assert.equal(
    quotePowerShell("C:\\O'Brien\\$x; `x"),
    "'C:\\O''Brien\\$x; `x'",
  );
});

test("executable: supplied token environment is preserved when no token file is selected", async (t) => {
  const directory = await temporary(t);
  const result = await prepareObserverConnection({
    officeDirectory: ROOT,
    userData: directory,
    tokenFile: null,
    port: 4317,
  });
  assert.equal(result.command.includes("PI_OFFICE_TOKEN"), false);
  assert.match(
    result.command,
    /^\$env:PI_OFFICE_URL='http:\/\/127\.0\.0\.1:4317'; pi -e '/,
  );
});

test("executable: invalid observer paths and ports fail before writing", async (t) => {
  const directory = await temporary(t);
  for (const override of [
    { port: 0 },
    { port: 65536 },
    { port: "4317" },
    { userData: "relative" },
    { tokenFile: "relative" },
    { officeDirectory: "relative" },
    { userData: directory + "\nBAD" },
  ]) {
    await assert.rejects(
      prepareObserverConnection({
        officeDirectory: ROOT,
        userData: directory,
        port: 4317,
        ...override,
      }),
    );
  }
  assert.deepEqual(await fs.readdir(directory), []);
});

for (const segment of ["observer", path.join("observer", "extension")]) {
  test(`executable: symlinked ${segment} cannot create or replace files outside app data`, async (t) => {
    const directory = await temporary(t),
      userData = path.join(directory, "data"),
      outside = path.join(directory, "outside");
    await fs.mkdir(path.dirname(path.join(userData, segment)), {
      recursive: true,
    });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "keep"), "unchanged");
    await fs.symlink(outside, path.join(userData, segment), "junction");
    await assert.rejects(
      prepareObserverConnection({
        officeDirectory: ROOT,
        userData,
        port: 4317,
      }),
    );
    assert.deepEqual(await fs.readdir(outside), ["keep"]);
    assert.equal(
      await fs.readFile(path.join(outside, "keep"), "utf8"),
      "unchanged",
    );
  });
}

test("executable: symlink observer file is rejected without touching its target", async (t) => {
  const directory = await temporary(t),
    target = path.join(directory, "victim"),
    userData = path.join(directory, "data");
  await fs.writeFile(target, "do not replace");
  await fs.mkdir(path.join(userData, "observer", "extension"), {
    recursive: true,
  });
  await fs.symlink(
    target,
    path.join(userData, "observer", "extension", "pi-office.ts"),
  );
  await assert.rejects(
    prepareObserverConnection({ officeDirectory: ROOT, userData, port: 4317 }),
  );
  assert.equal(await fs.readFile(target, "utf8"), "do not replace");
});

test("executable: owned Connect Pi copies only on native confirmation and suppresses duplicate dialogs", async (t) => {
  const directory = await temporary(t),
    resourcesPath = path.join(directory, "resources"),
    userData = path.join(directory, "data"),
    tokenFile = path.join(directory, "token");
  await fs.mkdir(path.join(resourcesPath, "office", "extension"), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(ROOT, "extension", "pi-office.ts"),
    path.join(resourcesPath, "office", "extension", "pi-office.ts"),
  );
  await fs.writeFile(tokenFile, SECRET);
  await fs.mkdir(userData);
  const response = deferred();
  const f = fixture(t, {
    mode: "owned",
    userData,
    resourcesPath,
    tokenFile,
    dialogResponse: () => response.promise,
  });
  await f.companion.start();
  assert.equal(f.dialogs.length, 0);
  const connecting = f.companion.runCommand("connect-pi");
  // Wait for the native dialog itself, not timing or a polling delay.
  await f.dialogOpened;
  assert.equal(f.dialogs.length, 1);
  await f.companion.runCommand("connect-pi");
  assert.equal(f.dialogs.length, 1);
  assert.equal(f.clipboard.length, 0);
  response.resolve({ response: 0 });
  await connecting;
  assert.equal(f.clipboard.length, 1);
  assert.match(f.clipboard[0], /PI_OFFICE_TOKEN_FILE=/);
  assert.equal(
    JSON.stringify([
      f.companion.getState(),
      f.events,
      f.dialogs,
      f.clipboard,
    ]).includes(SECRET),
    false,
  );
  assert.equal(await fs.readFile(tokenFile, "utf8"), SECRET);
});

// PowerShell treats typographic single quotes as delimiters as well as ASCII '.
test("executable: PowerShell escaping includes smart single-quote delimiters", () => {
  for (const quote of ["'", "\u2018", "\u2019", "\u201a", "\u201b"]) {
    assert.equal(
      quotePowerShell(`C:\\O${quote}Brien\\$x; `),
      `'C:\\O${quote}${quote}Brien\\$x; '`,
    );
  }
});
