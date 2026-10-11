/**
 * Pi Office: a passive, loopback-only observer. Load with: pi --extension ./extension/pi-office.ts
 * Public APIs: Pi lifecycle events + pi-subagents v1 ping/status/cost RPC.
 * Never registers a tool, changes a prompt, or sends a user/model message.
 * Never sends tool arguments, tool output, assistant text, or thinking content.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";

export type ProjectIdentity = {
  id: string;
  root: string;
  name: string;
  kind: "git" | "directory";
  platform: NodeJS.Platform;
  filesystemId?: string;
};

// Normalize only paths belonging to the observer's platform. A POSIX filename
// can contain a backslash, and a drive-relative Windows path is not an identity.
// Exported pure helpers also permit Windows fixtures without claiming a native
// Windows filesystem test. Live inputs are always realpath-resolved first.
export function normalizeProjectRoot(
  root: unknown,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (
    typeof root !== "string" ||
    !root.length ||
    root.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(root)
  )
    return null;
  if (platform === "win32") {
    const windowsRoot = root
      .replace(/^\\\\\?\\UNC\\/i, "\\\\")
      .replace(/^\\\\\?\\(?=[a-z]:\\)/i, "");
    if (
      !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/.][^\\/]*[\\/][^\\/.][^\\/]*(?:[\\/]|$))/i.test(
        windowsRoot,
      )
    )
      return null;
    const normalized = path.win32.normalize(windowsRoot).replace(/\\/g, "/");
    return /^[a-z]:\/$/i.test(normalized)
      ? normalized
      : normalized.replace(/\/+$/, "");
  }
  if (!path.posix.isAbsolute(root)) return null;
  return path.posix.normalize(root).replace(/\/+$/, "") || "/";
}

export function projectMetadata(
  root: unknown,
  kind: ProjectIdentity["kind"],
  platform: NodeJS.Platform = process.platform,
  filesystemId?: string,
): ProjectIdentity | null {
  const canonical = normalizeProjectRoot(root, platform);
  if (!canonical) return null;
  // Windows supports case-sensitive directories too. Fold case only with a
  // filesystem discriminator: same-fold names with different inodes stay apart.
  // If it is unavailable, prefer under-grouping to collapsing distinct projects.
  const fileId =
    platform === "win32" &&
    typeof filesystemId === "string" &&
    /^\d{1,24}:[1-9]\d{0,23}$/.test(filesystemId)
      ? filesystemId
      : undefined;
  const identityRoot = fileId ? canonical.toLowerCase() : canonical;
  return {
    id: `project:${createHash("sha256")
      .update(`${platform}\0${identityRoot}${fileId ? `\0${fileId}` : ""}`)
      .digest("hex")}`,
    root: canonical,
    name:
      (platform === "win32" ? path.win32 : path.posix).basename(canonical) ||
      canonical,
    kind,
    platform,
    ...(fileId ? { filesystemId: fileId } : {}),
  };
}

async function canonicalDirectory(value: unknown): Promise<string | null> {
  if (!normalizeProjectRoot(value)) return null;
  try {
    const root = await fs.realpath(value as string);
    return (await fs.stat(root)).isDirectory()
      ? normalizeProjectRoot(root)
      : null;
  } catch {
    return null;
  }
}

/** One read-only, bounded Git lookup per session start, never per heartbeat.
 * No hooks, shell, task commands, settings writes or safe.directory overrides.
 * Missing/unsafe Git falls back to the exact canonical cwd, never its basename.
 */
export async function resolveProjectMetadata(
  cwd: unknown,
): Promise<ProjectIdentity | null> {
  const directory = await canonicalDirectory(cwd);
  if (!directory) return null;
  const env = { ...process.env };
  // Parent shells may carry another repository's GIT_DIR/GIT_WORK_TREE or
  // config injection. Discover this cwd using Git's ordinary trust checks.
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  const topLevel = await new Promise<string | null>((resolve) => {
    execFile(
      "git",
      ["-C", directory, "rev-parse", "--show-toplevel"],
      {
        env,
        encoding: "utf8",
        timeout: 1000,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, stdout) => resolve(error ? null : stdout.replace(/\r?\n$/, "")),
    );
  });
  const gitRoot = topLevel ? await canonicalDirectory(topLevel) : null;
  const root = gitRoot || directory;
  let filesystemId: string | undefined;
  if (process.platform === "win32") {
    try {
      const stat = await fs.stat(root, { bigint: true });
      if (stat.ino > 0n && stat.dev >= 0n)
        filesystemId = `${stat.dev}:${stat.ino}`;
    } catch {}
  }
  return projectMetadata(
    root,
    gitRoot ? "git" : "directory",
    process.platform,
    filesystemId,
  );
}

type Data = Record<string, any>;
type Handler = (event: Data, context: Data) => void | Promise<void>;
// Structural public API keeps the observer independent of Pi's package rename.
type Pi = {
  on: (name: any, handler: Handler) => unknown;
  events?: {
    on: (name: string, handler: (event: any) => void) => (() => void) | void;
    emit: (name: string, data: unknown) => void;
  };
  getSessionName?: () => string | undefined;
};
type LifecycleMarker = {
  version: 1;
  eventId: string;
  kind: "start" | "stop";
  source:
    "pi:session_start" | "pi:session_shutdown" | "pi-subagents:child-status";
  at: string;
};
type Agent = {
  id: string;
  name: string;
  role: string;
  task: string;
  state: string;
  tool: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  updatedAt: string;
  logs: { time: string; level: string; message: string }[];
  lifecycle: LifecycleMarker | null;
};
const record = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const str = (v: unknown, max = 240) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "";
// Display strings may be shortened; identity components must never be rewritten
// or prefix-truncated, since that merges unrelated sessions or children.
const identity = (v: unknown, max = 4096): string | null =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(v)
    ? v
    : null;
const identityComponent = (value: string) =>
  value.replace(
    /[/%:]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const timestamp = () => new Date().toISOString();
const modelName = (v: unknown): string | null =>
  typeof v === "string"
    ? str(v)
    : record(v)
      ? str(v.id || v.name) || null
      : null;
const stateAliases: Record<string, string> = {
  running: "working",
  started: "working",
  busy: "working",
  pending: "waiting",
  queued: "waiting",
  paused: "waiting",
  stopping: "waiting",
  stopped: "idle",
  done: "completed",
  succeeded: "completed",
  failed: "error",
  aborted: "idle",
  finished: "completed",
  complete: "completed",
  cancelled: "idle",
  rejected: "error",
  partial: "waiting",
};
const stateName = (v: unknown): string =>
  stateAliases[str(v)] ||
  ([
    "idle",
    "thinking",
    "working",
    "waiting",
    "completed",
    "error",
    "stale",
    "offline",
  ].includes(str(v))
    ? str(v)
    : "working");
const safeTask = (v: unknown) =>
  process.env.PI_OFFICE_INCLUDE_TASKS === "0"
    ? "Task details hidden"
    : str(v, 1200)
        .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
        .replace(
          /\b(api[_-]?key|password|token|secret)\s*[:=]\s*["']?[^\s"',;]+/gi,
          "$1=[redacted]",
        );

export default function piOffice(pi: Pi) {
  let session: Data | null = null;
  const agents = new Map<string, Agent>();
  // Keep replay watermarks after display-row eviction. Saturation deliberately
  // suppresses only new child animations until the next session/reload.
  const childLifecycle = new Map<
    string,
    { marker: LifecycleMarker; at: number }
  >();
  let childObservedAt = new WeakMap<Agent, number>();
  let retiredAgents = new WeakSet<Agent>();
  const activeTools = new Map<string, string>();
  let interval: ReturnType<typeof setInterval> | undefined;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  let context: Data | null = null;
  let stopped = true;
  let dirty = false;
  let sending: Promise<void> | null = null;
  let endpoint = "";
  let token = "";
  let negotiated = false;
  let nextAttempt = 0;
  let generation = 0;
  let lifecycleRequest = 0;
  let shutdownPromise: Promise<void> | null = null;
  let warned = false;
  let rpcBusy = false;
  let rpcReady = false;
  let rpcEpoch = 0;
  let costPending = false;
  let subCapabilities: Data = {};
  let capabilities = {
    pi: true,
    subagents: false,
    fleet: false,
    childStatus: false,
    usage: true,
    logs: true,
  };
  let lastRpc = 0;
  let knownFleet = new Set<string>();
  const busCleanup = new Set<() => void>();
  const pendingRpc = new Set<() => void>();
  let seenMessages = new WeakSet<object>();
  let observingSince = 0;
  function root() {
    return session ? agents.get(`${session.id}:main`) : undefined;
  }
  function addLog(agent: Agent, message: string, level = "info") {
    agent.logs.push({ time: timestamp(), level, message: str(message, 300) });
    agent.logs = agent.logs.slice(-24);
  }
  function agentId(key: string) {
    return `${session!.id}:${key === "main" ? "main" : createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
  }
  function agent(key: string, patch: Data = {}) {
    if (!session) return undefined;
    const id = agentId(key);
    let row = agents.get(id);
    if (!row) {
      if (agents.size >= 48) {
        const candidate = [...agents.values()].find(
          (a) =>
            a.id !== agentId("main") &&
            (["completed", "error", "stale"].includes(a.state) ||
              retiredAgents.has(a)),
        );
        if (candidate) agents.delete(candidate.id);
        else return undefined;
      }
      row = {
        id,
        name: "Agent",
        role: "subagent",
        task: "",
        state: "idle",
        tool: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
        updatedAt: timestamp(),
        logs: [],
        lifecycle: childLifecycle.get(id)?.marker || null,
      };
      agents.set(id, row);
    }
    Object.assign(row, patch, { updatedAt: timestamp() });
    return row;
  }
  // A display state or a missing fleet row is not evidence of birth/death.
  // Only exact lifecycle observations can mint a marker. The last marker per
  // bounded agent row survives coalesced snapshots without creating an event log.
  function markLifecycle(
    row: Agent,
    kind: LifecycleMarker["kind"],
    source: LifecycleMarker["source"],
    at = Date.now(),
  ) {
    const previous = row.lifecycle;
    const previousAt = previous ? Date.parse(previous.at) : -Infinity;
    if (
      previous &&
      (previous.kind === kind ||
        at < previousAt ||
        (at === previousAt && kind === "start"))
    )
      return;
    if (
      source === "pi-subagents:child-status" &&
      !childLifecycle.has(row.id) &&
      childLifecycle.size >= 512
    )
      return;
    row.lifecycle = {
      version: 1,
      eventId: randomUUID(),
      kind,
      source,
      at: new Date(at).toISOString(),
    };
    if (source === "pi-subagents:child-status")
      childLifecycle.set(row.id, { marker: row.lifecycle, at });
  }
  function changeMain(patch: Data, message?: string, level?: string) {
    const row = agent("main", patch);
    if (row && message) addLog(row, message, level);
    schedule();
  }
  function warn(message: string) {
    if (!warned && context?.hasUI && context.ui?.notify) {
      warned = true;
      try {
        context.ui.notify(message, "warning");
      } catch {}
    }
  }
  function schedule() {
    if (stopped || !session || !endpoint || !token) return;
    dirty = true;
    if (!sendTimer)
      sendTimer = setTimeout(
        () => {
          sendTimer = undefined;
          void flush();
        },
        Math.max(100, nextAttempt - Date.now()),
      );
    sendTimer?.unref?.();
  }
  async function post(
    route: string,
    payload: Data,
    target: string,
    credential: string,
  ) {
    const response = await fetch(`${target}${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
    return response.json();
  }
  async function flush() {
    while (sending) await sending;
    if (!session || !token || !endpoint || !dirty) return;
    if (Date.now() < nextAttempt) {
      schedule();
      return;
    }
    const current = generation;
    const target = endpoint,
      credential = token;
    const payload = {
      version: 1,
      session: {
        ...session,
        agents: [...agents.values()].map((row) => ({
          ...row,
          logs: [...row.logs],
        })),
      },
      capabilities: { ...capabilities },
    };
    dirty = false;
    sending = (async () => {
      try {
        if (!negotiated) {
          const hello = await post(
            "/api/hello",
            {
              version: 1,
              client: "pi-office-observer",
            },
            target,
            credential,
          );
          if (hello.version !== 1 || hello.capabilities?.readOnly !== true)
            throw new Error("Incompatible bridge");
          if (generation === current) negotiated = true;
        }
        await post("/api/ingest", payload, target, credential);
        if (generation === current) nextAttempt = 0;
      } catch {
        if (generation !== current) return;
        negotiated = false;
        nextAttempt = Date.now() + 5000;
        dirty = true;
        warn(
          "Pi Office is not connected. Start its local bridge and check PI_OFFICE_TOKEN_FILE. Pi keeps working normally.",
        );
      }
    })();
    try {
      await sending;
    } finally {
      sending = null;
    }
    if (dirty && !stopped) schedule();
  }
  function listen(name: string, callback: (data: Data) => void) {
    if (!pi.events) return;
    const current = generation;
    try {
      const off = pi.events.on(name, (value) => {
        if (!stopped && generation === current && record(value)) {
          try {
            callback(value);
          } catch {
            /* A malformed optional observation cannot affect Pi. */
          }
        }
      });
      if (typeof off === "function") busCleanup.add(off);
    } catch {
      /* Optional bus support must not disable root observation. */
    }
  }
  function rpc(method: "ping" | "status" | "cost"): Promise<Data | null> {
    if (!pi.events || stopped) return Promise.resolve(null);
    const bus = pi.events;
    const current = generation;
    return new Promise((resolve) => {
      const requestId = randomUUID();
      let complete = false;
      let off: (() => void) | void;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        try {
          if (typeof off === "function") off();
        } catch {}
      };
      const finish = (data: Data | null) => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        cleanup();
        pendingRpc.delete(cancel);
        resolve(data);
      };
      const cancel = () => finish(null);
      timer = setTimeout(cancel, 1200);
      timer.unref?.();
      pendingRpc.add(cancel);
      try {
        off = bus.on(`subagents:rpc:v1:reply:${requestId}`, (reply) =>
          finish(
            !stopped &&
              generation === current &&
              record(reply) &&
              (reply.requestId === undefined ||
                reply.requestId === requestId) &&
              reply.version === 1 &&
              reply.success === true &&
              record(reply.data)
              ? reply.data
              : null,
          ),
        );
        if (complete) {
          cleanup();
          return;
        }
        bus.emit("subagents:rpc:v1:request", {
          version: 1,
          requestId,
          method,
          params: {},
        });
      } catch {
        finish(null);
      }
    });
  }
  function usage(row: Agent, raw: unknown, cumulative = false) {
    if (!record(raw)) return;
    for (const [target, key] of [
      ["inputTokens", "input"],
      ["outputTokens", "output"],
    ] as const) {
      const value = numeric(raw[key]);
      if (value !== null)
        row[target] = cumulative ? (row[target] || 0) + value : value;
    }
    const cost = numeric(record(raw.cost) ? raw.cost.total : raw.cost);
    if (cost !== null) row.cost = cumulative ? (row.cost || 0) + cost : cost;
  }
  function observeMessage(message: unknown, restored = false) {
    if (!record(message) || seenMessages.has(message)) return;
    seenMessages.add(message);
    const main = root();
    if (!main) return;
    if (message.role === "assistant") {
      usage(main, message.usage, true);
      if (modelName(message.model)) main.model = modelName(message.model);
      if (message.stopReason === "error") {
        main.state = "error";
        addLog(main, "Model response failed. Check Pi for details.", "error");
      }
      if (!restored) schedule();
    }
  }
  function observeRows(raw: unknown, parentId: string, terminal = false) {
    if (!record(raw) || capabilities.fleet) return;
    const rows = Array.isArray(raw.results)
      ? raw.results
      : Array.isArray(raw.steps)
        ? raw.steps
        : [];
    for (const [index, item] of rows.slice(0, 40).entries()) {
      if (!record(item)) continue;
      const runId = identity(item.runId ?? raw.runId ?? raw.id ?? parentId);
      if (!runId) continue;
      const key = `run:${identityComponent(runId)}:${numeric(item.index) ?? numeric(item.stepIndex) ?? index}`;
      const row = agent(key, {
        name: str(item.agent || item.name) || "Subagent",
        role: str(item.role) || "subagent",
        task: safeTask(item.task || item.goal || item.label),
        state: stateName(
          item.state ||
            item.status ||
            (item.exitCode === 0 || item.success === true
              ? "completed"
              : (typeof item.exitCode === "number" &&
                    Number.isInteger(item.exitCode) &&
                    item.exitCode !== 0) ||
                  item.success === false
                ? "error"
                : terminal
                  ? "stale"
                  : "running"),
        ),
        model: modelName(item.model || item.requestedModel),
        tool: str(item.currentTool || item.toolName) || null,
      });
      if (row) {
        usage(row, item.usage || item.tokens);
        if (numeric(item.inputTokens) !== null)
          row.inputTokens = item.inputTokens;
        if (numeric(item.outputTokens) !== null)
          row.outputTokens = item.outputTokens;
        if (numeric(item.cost ?? item.totalCost) !== null)
          row.cost = item.cost ?? item.totalCost;
        if (!row.logs.length)
          addLog(row, "Subagent observed through Pi tool progress.");
      }
    }
    schedule();
  }
  function observeAsyncSnapshot(snapshot: unknown) {
    if (
      !record(snapshot) ||
      snapshot.kind !== "pi-subagents.async-status-snapshot" ||
      snapshot.version !== 1 ||
      !Array.isArray(snapshot.runs)
    )
      return;
    let count = 0;
    const visit = (node: unknown, parentPath: string, depth: number) => {
      if (
        !record(node) ||
        depth > 3 ||
        count >= 40 ||
        node.kind === "host-step" ||
        typeof node.id !== "string"
      )
        return;
      const nodeId = identity(node.id);
      if (!nodeId) return;
      const key = `${parentPath}/${identityComponent(nodeId)}`;
      const children = Array.isArray(node.children)
        ? node.children.filter(record)
        : [];
      if (!children.length) {
        const row = agent(`async:${key}`, {
          name: str(node.label) || "Subagent",
          role: "subagent",
          state: stateName(node.state),
          tool: str(node.activity?.currentTool) || null,
        });
        if (row) {
          count++;
          if (!row.logs.length)
            addLog(
              row,
              `Subagent status reported: ${str(node.state) || "unknown"}.`,
            );
        }
      }
      for (const child of children.slice(0, 8)) visit(child, key, depth + 1);
    };
    for (const run of snapshot.runs.slice(0, 20)) visit(run, "", 0);
  }
  function applyStatus(data: Data) {
    if (
      capabilities.fleet &&
      record(data.fleet) &&
      data.fleet.version === 1 &&
      Array.isArray(data.fleet.entries)
    ) {
      const current = new Set<string>();
      for (const entry of data.fleet.entries.slice(0, 40)) {
        if (!record(entry)) continue;
        const entryKey = identity(entry.key);
        if (!entryKey) continue;
        const key = `fleet:${entryKey}`;
        const row = agent(key, {
          name: str(entry.agent || entry.label) || "Subagent",
          role: str(entry.role) || "subagent",
          task: safeTask(entry.goal || entry.task || entry.label),
          state: stateName(entry.state || entry.status || "running"),
          model: modelName(entry.model),
          tool: str(entry.currentTool || entry.currentAction) || null,
        });
        if (row) {
          usage(row, entry.tokens);
          current.add(row.id);
          if (!row.logs.length)
            addLog(row, "Active child observed in Pi fleet.");
        }
      }
      // An absent display entry is not proof of successful completion.
      const complete =
        data.fleet.omitted === 0 && data.fleet.entries.length <= 40;
      if (complete)
        for (const old of knownFleet)
          if (!current.has(old)) {
            const row = agents.get(old);
            if (row && !["completed", "error"].includes(row.state)) {
              row.state = "stale";
              row.tool = null;
              addLog(
                row,
                "No longer present in the active fleet; final outcome unavailable.",
                "warn",
              );
            }
          }
      knownFleet = complete
        ? current
        : new Set([...knownFleet, ...current].filter((id) => agents.has(id)));
    } else {
      if (record(data.details)) observeRows(data.details, "status");
      observeAsyncSnapshot(data.asyncSnapshot);
    }
    schedule();
  }
  async function refresh(withCost = false) {
    if (stopped || !pi.events) return;
    if (withCost) costPending = true;
    if (rpcBusy) return;
    rpcBusy = true;
    const current = generation;
    const epoch = rpcEpoch;
    const active = () =>
      !stopped && generation === current && rpcEpoch === epoch;
    try {
      if (!rpcReady) {
        const ping = await rpc("ping");
        if (!ping || !active()) return;
        rpcReady = true;
        subCapabilities = record(ping.capabilities) ? ping.capabilities : {};
        capabilities.subagents = true;
        capabilities.fleet = subCapabilities.fleetStatus?.version === 1;
        capabilities.childStatus =
          (ping.events?.childStatus ?? subCapabilities.events?.childStatus) ===
          "subagent:child-status";
      }
      const status = await rpc("status");
      if (!active()) return;
      if (status) applyStatus(status);
      // Retain one coalesced turn-boundary read while another request is active.
      // Timers never create cost work; a failed read waits for the next boundary.
      if (costPending) {
        costPending = false;
        if (subCapabilities.cost?.version === 1) {
          const report = await rpc("cost");
          if (active() && report && record(report.parent) && root()) {
            usage(root()!, report.parent);
            schedule();
          }
        }
      }
      if (active()) lastRpc = Date.now();
    } catch {
      /* Optional RPC failures never escape into Pi. */
    } finally {
      if (generation === current) {
        rpcBusy = false;
        if (!stopped && (rpcEpoch !== epoch || (costPending && rpcReady)))
          void refresh();
      }
    }
  }
  function lifecycle(event: Data, kind: string) {
    if (event.sessionId && session && event.sessionId !== session.id) return;
    if (kind === "child") {
      const at =
        typeof event.ts === "number" || typeof event.ts === "string"
          ? new Date(event.ts).getTime()
          : NaN;
      if (
        event.type !== "subagent.child-status" ||
        event.version !== 1 ||
        !identity(event.runId) ||
        !identity(event.childId) ||
        !["started", "stopping", "stopped"].includes(event.status) ||
        !Number.isFinite(at) ||
        at < observingSince ||
        at > Date.now()
      )
        return;
    } else if (event.childId !== undefined && !identity(event.childId)) return;
    const main = root();
    if (main && kind === "complete")
      addLog(
        main,
        `${str(event.agent || event.label) || "Subagent"} completion observed${event.success === false ? " with an error" : ""}.`,
        event.success === false ? "error" : "info",
      );
    if (!capabilities.fleet) {
      const runId = identity(event.runId ?? event.id);
      const child =
        identity(event.childId) ??
        (numeric(event.stepIndex) !== null ? String(event.stepIndex) : "root");
      if (runId) {
        const key = `run:${identityComponent(runId)}:${identityComponent(child)}`;
        const at =
          typeof event.ts === "number" || typeof event.ts === "string"
            ? new Date(event.ts).getTime()
            : NaN;
        const existing = agents.get(agentId(key));
        const history = childLifecycle.get(agentId(key));
        const previous = existing?.lifecycle || history?.marker;
        // Duplicate starts/stopping hints can advance observation time without
        // replacing an animation marker. Keep their ordering watermark too.
        const lastAt = Math.max(
          existing ? (childObservedAt.get(existing) ?? -Infinity) : -Infinity,
          history?.at ?? -Infinity,
          previous ? Date.parse(previous.at) : -Infinity,
        );
        // An exact hint may be replayed after a stop. Ignore the observation,
        // not just its animation marker, so old state cannot revive the row.
        if (
          kind === "child" &&
          Number.isFinite(lastAt) &&
          (at < lastAt ||
            (at === lastAt &&
              (previous?.kind === "stop" || event.status === "started")))
        )
          return;
        const name = event.agent ?? event.label;
        const task = event.task ?? event.goal ?? event.label;
        const row = agent(key, {
          ...(typeof name === "string"
            ? { name: str(name) || "Subagent" }
            : {}),
          role: "subagent",
          ...(typeof task === "string" ? { task: safeTask(task) } : {}),
          state:
            kind === "complete"
              ? event.success === false
                ? "error"
                : stateName(
                    event.state ||
                      (event.success === true ? "completed" : "stale"),
                  )
              : stateName(event.status || "running"),
          ...(event.model !== undefined
            ? { model: modelName(event.model) }
            : {}),
          tool: null,
        });
        if (row && kind === "child") {
          if (event.status === "stopped") retiredAgents.add(row);
          else if (event.status === "started") retiredAgents.delete(row);
        }
        if (
          row &&
          kind === "child" &&
          rpcReady &&
          capabilities.childStatus &&
          event.type === "subagent.child-status" &&
          typeof event.runId === "string" &&
          event.runId.length > 0 &&
          typeof event.childId === "string" &&
          event.childId.length > 0 &&
          ["started", "stopped"].includes(event.status)
        ) {
          // Child hints can be replayed. Never animate restored history, malformed
          // timestamps, future events, or older/duplicate transitions for this ID.
          if (Number.isFinite(at) && at >= observingSince && at <= Date.now())
            markLifecycle(
              row,
              event.status === "started" ? "start" : "stop",
              "pi-subagents:child-status",
              at,
            );
        }
        if (row && kind === "child") {
          childObservedAt.set(row, at);
          const saved = childLifecycle.get(row.id);
          if (saved) saved.at = at;
        }
        if (row)
          addLog(
            row,
            kind === "complete"
              ? "Subagent completion observed."
              : "Subagent lifecycle update observed.",
            event.success === false ? "error" : "info",
          );
        observeRows(event, runId, kind === "complete");
      }
    }
    schedule();
    void refresh(kind === "complete");
  }
  function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    if (stopped) return Promise.resolve();
    stopped = true;
    generation++;
    if (interval) clearInterval(interval);
    interval = undefined;
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = undefined;
    for (const off of busCleanup) {
      try {
        off();
      } catch {}
    }
    busCleanup.clear();
    for (const cancel of [...pendingRpc]) cancel();
    if (session) {
      session.connected = false;
      const main = root();
      if (main) {
        main.state = "offline";
        main.tool = null;
        addLog(main, "Pi session disconnected.");
      }
      dirty = true;
      nextAttempt = 0;
    }
    shutdownPromise = flush().finally(() => {
      shutdownPromise = null;
    });
    return shutdownPromise;
  }
  // Registering observers has no side effects on model behavior. Resources start only at session_start.
  function on(name: string, handler: Handler) {
    try {
      pi.on(name, (event, ctx) => {
        try {
          if (
            name !== "session_start" &&
            name !== "session_shutdown" &&
            (stopped || !session)
          )
            return;
          const result = handler(
            record(event) ? event : {},
            record(ctx) ? ctx : {},
          );
          if (result && typeof result.then === "function")
            return result.catch(() => undefined);
        } catch {}
      });
    } catch {
      /* Older Pi versions can omit newer events. */
    }
  }
  on("session_start", async (event, ctx) => {
    const request = ++lifecycleRequest;
    await shutdown();
    if (request !== lifecycleRequest) return;
    generation++;
    const startGeneration = generation;
    stopped = false;
    observingSince = Date.now();
    context = ctx;
    session = null;
    dirty = false;
    endpoint = "";
    token = "";
    agents.clear();
    childLifecycle.clear();
    childObservedAt = new WeakMap<Agent, number>();
    retiredAgents = new WeakSet<Agent>();
    seenMessages = new WeakSet<object>();
    activeTools.clear();
    knownFleet.clear();
    negotiated = false;
    rpcReady = false;
    rpcBusy = false;
    rpcEpoch++;
    costPending = false;
    lastRpc = 0;
    subCapabilities = {};
    warned = false;
    nextAttempt = 0;
    capabilities = {
      pi: true,
      subagents: false,
      fleet: false,
      childStatus: false,
      usage: true,
      logs: true,
    };
    try {
      const url = new URL(process.env.PI_OFFICE_URL || "http://127.0.0.1:4317");
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new Error("Loopback URL required");
      url.hostname = "127.0.0.1";
      const target = url.origin;
      const tokenFile =
        process.env.PI_OFFICE_TOKEN_FILE ||
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../.pi-office-token",
        );
      const credential =
        process.env.PI_OFFICE_TOKEN ||
        (await fs.readFile(tokenFile, "utf8")).trim();
      if (
        stopped ||
        startGeneration !== generation ||
        request !== lifecycleRequest
      )
        return;
      if (!/^[A-Za-z0-9_.~+\/-]{32,512}$/.test(credential))
        throw new Error("Invalid observer credential");
      endpoint = target;
      token = credential;
    } catch {
      if (
        stopped ||
        startGeneration !== generation ||
        request !== lifecycleRequest
      )
        return;
      endpoint = "";
      token = "";
      warn(
        "Pi Office is disabled: start the local bridge and configure its token file.",
      );
      return;
    }
    let id: string;
    try {
      // Reserve 25 characters for the colon + hashed child suffix (bridge max 240).
      id = identity(ctx.sessionManager?.getSessionId?.(), 215) || randomUUID();
    } catch {
      id = randomUUID();
    }
    const project = await resolveProjectMetadata(ctx.cwd);
    if (
      stopped ||
      startGeneration !== generation ||
      request !== lifecycleRequest
    )
      return;
    session = {
      id,
      name:
        str(pi.getSessionName?.()) ||
        path.basename(ctx.cwd || "") ||
        "Pi session",
      cwd: str(ctx.cwd, 1000),
      project,
      model: modelName(ctx.model),
      connected: true,
    };
    const main = agent("main", {
      name: "Pi",
      role: "orchestrator",
      state: ctx.isIdle?.() === false ? "thinking" : "idle",
      model: session.model,
    });
    if (main) {
      addLog(main, "Observer connected to Pi session.");
      // Older Pi versions without a reason, /reload, and /resume are baselines.
      if (["startup", "new", "fork"].includes(event.reason))
        markLifecycle(main, "start", "pi:session_start");
    }
    try {
      for (const entry of (ctx.sessionManager?.getBranch?.() || []).slice(
        -5000,
      ))
        if (record(entry) && entry.type === "message")
          observeMessage(entry.message, true);
    } catch {}
    listen("subagents:rpc:v1:ready", () => {
      rpcEpoch++;
      rpcReady = false;
      void refresh();
    });
    listen("subagent:async-started", (e) => lifecycle(e, "start"));
    listen("subagent:async-complete", (e) => lifecycle(e, "complete"));
    listen("subagent:child-status", (e) => {
      if (e.version === 1) lifecycle(e, "child");
    });
    interval = setInterval(() => {
      schedule();
      if (Date.now() - lastRpc > 8000) void refresh();
    }, 8000);
    interval.unref?.();
    schedule();
    void refresh();
  });
  on("session_shutdown", (event) => {
    lifecycleRequest++;
    // Preserve shutdown behavior; record only an explicit quit, never inferred
    // disconnects, session replacement, reload, or the internal cleanup call.
    const main = root();
    if (!stopped && main && event.reason === "quit")
      markLifecycle(main, "stop", "pi:session_shutdown");
    return shutdown();
  });
  on("session_info_changed", (e) => {
    if (session) {
      session.name = str(e.name) || "Pi session";
      schedule();
    }
  });
  on("before_agent_start", (e) =>
    changeMain(
      { task: safeTask(e.prompt), state: "thinking", tool: null },
      "New task started.",
    ),
  );
  on("agent_start", () =>
    changeMain({ state: "thinking" }, "Agent is reasoning."),
  );
  on("tool_execution_start", (e) => {
    activeTools.set(str(e.toolCallId), str(e.toolName));
    changeMain(
      { state: "working", tool: str(e.toolName) },
      `Tool started: ${str(e.toolName)}.`,
    );
  });
  on("tool_execution_update", (e) => {
    if (e.toolName === "subagent" && record(e.partialResult?.details))
      observeRows(e.partialResult.details, str(e.toolCallId));
  });
  on("tool_execution_end", (e) => {
    activeTools.delete(str(e.toolCallId));
    const remaining = [...activeTools.values()];
    changeMain(
      {
        state: remaining.length ? "working" : e.isError ? "error" : "thinking",
        tool: remaining.at(-1) || null,
      },
      `Tool ${e.isError ? "failed" : "finished"}: ${str(e.toolName)}.`,
      e.isError ? "error" : "info",
    );
    if (e.toolName === "subagent" && record(e.result?.details))
      observeRows(e.result.details, str(e.toolCallId), true);
    if (e.toolName === "subagent") void refresh(true);
  });
  on("message_end", (e) => observeMessage(e.message));
  on("model_select", (e) => {
    if (session) session.model = modelName(e.model);
    changeMain({ model: modelName(e.model) }, "Active model changed.");
  });
  on("ui_prompt_start", () =>
    changeMain({ state: "waiting" }, "Waiting for a response in Pi."),
  );
  on("ui_prompt_end", () =>
    changeMain({ state: activeTools.size ? "working" : "thinking" }),
  );
  on("session_before_compact", () =>
    changeMain(
      { state: "working", tool: "compaction" },
      "Compacting the session context.",
    ),
  );
  on("session_compact", () =>
    changeMain(
      { state: "thinking", tool: null },
      "Context compaction finished.",
    ),
  );
  on("agent_end", (e) => {
    for (const message of Array.isArray(e.messages) ? e.messages : [])
      observeMessage(message);
    changeMain(
      { state: root()?.state === "error" ? "error" : "idle", tool: null },
      "Agent turn ended.",
    );
  });
  on("agent_settled", (e) => {
    activeTools.clear();
    changeMain(
      { state: root()?.state === "error" ? "error" : "idle", tool: null },
      e.aborted ? "Agent run was interrupted." : "Agent run settled.",
      e.aborted ? "warn" : "success",
    );
    void refresh(true);
  });
}
