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
};
const record = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const str = (v: unknown, max = 240) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "";
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
  let warned = false;
  let rpcBusy = false;
  let rpcReady = false;
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
  function root() {
    return session ? agents.get(`${session.id}:main`) : undefined;
  }
  function addLog(agent: Agent, message: string, level = "info") {
    agent.logs.push({ time: timestamp(), level, message: str(message, 300) });
    agent.logs = agent.logs.slice(-24);
  }
  function agent(key: string, patch: Data = {}) {
    if (!session) return undefined;
    const id = `${session.id}:${key === "main" ? "main" : createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
    let row = agents.get(id);
    if (!row) {
      if (agents.size >= 48) {
        const candidate = [...agents.values()].find(
          (a) =>
            a.role !== "orchestrator" &&
            ["completed", "error", "stale"].includes(a.state),
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
      };
      agents.set(id, row);
    }
    Object.assign(row, patch, { updatedAt: timestamp() });
    return row;
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
  async function post(route: string, payload: Data) {
    const response = await fetch(`${endpoint}${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
    return response.json();
  }
  async function flush() {
    if (sending) {
      await sending;
      if (!dirty) return;
    }
    if (!session || !token || !endpoint || !dirty) return;
    if (Date.now() < nextAttempt) {
      schedule();
      return;
    }
    const current = generation;
    const payload = {
      version: 1,
      session: { ...session, agents: [...agents.values()] },
      capabilities: { ...capabilities },
    };
    dirty = false;
    sending = (async () => {
      try {
        if (!negotiated) {
          const hello = await post("/api/hello", {
            version: 1,
            client: "pi-office-observer",
          });
          if (hello.version !== 1 || hello.capabilities?.readOnly !== true)
            throw new Error("Incompatible bridge");
          negotiated = true;
        }
        await post("/api/ingest", payload);
        nextAttempt = 0;
      } catch {
        negotiated = false;
        nextAttempt = Date.now() + 5000;
        if (generation === current) dirty = true;
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
  }
  function rpc(method: "ping" | "status" | "cost"): Promise<Data | null> {
    if (!pi.events || stopped) return Promise.resolve(null);
    return new Promise((resolve) => {
      const requestId = randomUUID();
      let complete = false;
      let off: (() => void) | void;
      const finish = (data: Data | null) => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        if (typeof off === "function") off();
        pendingRpc.delete(cancel);
        resolve(data);
      };
      const cancel = () => finish(null);
      const timer = setTimeout(cancel, 1200);
      timer.unref?.();
      pendingRpc.add(cancel);
      off = pi.events!.on(`subagents:rpc:v1:reply:${requestId}`, (reply) =>
        finish(
          record(reply) &&
            reply.version === 1 &&
            reply.success === true &&
            record(reply.data)
            ? reply.data
            : null,
        ),
      );
      try {
        pi.events!.emit("subagents:rpc:v1:request", {
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
      const runId = str(item.runId || raw.runId || raw.id || parentId);
      const key = `run:${runId}:${numeric(item.index) ?? numeric(item.stepIndex) ?? index}`;
      const row = agent(key, {
        name: str(item.agent || item.name) || "Subagent",
        role: str(item.role) || "subagent",
        task: safeTask(item.task || item.goal || item.label),
        state: stateName(
          item.state ||
            item.status ||
            (item.exitCode === 0 || item.success === true
              ? "completed"
              : (numeric(item.exitCode) !== null && item.exitCode !== 0) ||
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
      const key = `${parentPath}/${str(node.id, 160)}`;
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
        if (!record(entry) || typeof entry.key !== "string") continue;
        const key = `fleet:${str(entry.key, 180)}`;
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
      if (!data.fleet.omitted)
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
      knownFleet = current;
    } else {
      if (record(data.details)) observeRows(data.details, "status");
      observeAsyncSnapshot(data.asyncSnapshot);
    }
    schedule();
  }
  async function refresh(withCost = false) {
    if (rpcBusy || stopped || !pi.events) return;
    rpcBusy = true;
    const current = generation;
    try {
      if (!rpcReady) {
        const ping = await rpc("ping");
        if (!ping || generation !== current) return;
        rpcReady = true;
        subCapabilities = record(ping.capabilities) ? ping.capabilities : {};
        capabilities.subagents = true;
        capabilities.fleet = subCapabilities.fleetStatus?.version === 1;
        capabilities.childStatus = Boolean(
          ping.events?.childStatus || subCapabilities.events?.childStatus,
        );
      }
      const status = await rpc("status");
      if (status && generation === current) applyStatus(status);
      // The package explicitly says cost is a turn-boundary read, never a timer poll.
      if (withCost && subCapabilities.cost?.version === 1) {
        const report = await rpc("cost");
        if (report && generation === current && record(report.parent) && root())
          usage(root()!, report.parent);
      }
      lastRpc = Date.now();
    } finally {
      rpcBusy = false;
    }
  }
  function lifecycle(event: Data, kind: string) {
    if (event.sessionId && session && event.sessionId !== session.id) return;
    const main = root();
    if (main && kind === "complete")
      addLog(
        main,
        `${str(event.agent || event.label) || "Subagent"} completion observed${event.success === false ? " with an error" : ""}.`,
        event.success === false ? "error" : "info",
      );
    if (!capabilities.fleet) {
      const runId = str(event.runId || event.id);
      const child = str(event.childId || event.stepIndex || "root");
      if (runId) {
        const row = agent(`run:${runId}:${child}`, {
          name: str(event.agent || event.label) || "Subagent",
          role: "subagent",
          task: safeTask(event.task || event.goal || event.label),
          state:
            kind === "complete"
              ? event.success === false
                ? "error"
                : stateName(
                    event.state ||
                      (event.success === true ? "completed" : "stale"),
                  )
              : stateName(event.status || "running"),
          model: modelName(event.model),
          tool: null,
        });
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
  async function shutdown() {
    if (stopped) return;
    stopped = true;
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
      await flush();
    }
  }
  // Registering observers has no side effects on model behavior. Resources start only at session_start.
  function on(name: string, handler: Handler) {
    try {
      pi.on(name, (event, ctx) => {
        try {
          const result = handler(event, ctx);
          if (result && typeof result.then === "function")
            return result.catch(() => undefined);
        } catch {}
      });
    } catch {
      /* Older Pi versions can omit newer events. */
    }
  }
  on("session_start", async (_event, ctx) => {
    await shutdown();
    generation++;
    stopped = false;
    context = ctx;
    agents.clear();
    seenMessages = new WeakSet<object>();
    activeTools.clear();
    knownFleet.clear();
    negotiated = false;
    rpcReady = false;
    rpcBusy = false;
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
      endpoint = url.origin;
      const tokenFile =
        process.env.PI_OFFICE_TOKEN_FILE ||
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../.pi-office-token",
        );
      token =
        process.env.PI_OFFICE_TOKEN ||
        (await fs.readFile(tokenFile, "utf8")).trim();
      if (!/^[A-Za-z0-9_.~+\/-]{32,512}$/.test(token))
        throw new Error("Invalid observer credential");
    } catch {
      endpoint = "";
      token = "";
      warn(
        "Pi Office is disabled: start the local bridge and configure its token file.",
      );
      return;
    }
    let id: string;
    try {
      id = str(ctx.sessionManager?.getSessionId?.(), 160) || randomUUID();
    } catch {
      id = randomUUID();
    }
    session = {
      id,
      name:
        str(pi.getSessionName?.()) ||
        path.basename(ctx.cwd || "") ||
        "Pi session",
      cwd: str(ctx.cwd, 1000),
      model: modelName(ctx.model),
      connected: true,
    };
    const main = agent("main", {
      name: "Pi",
      role: "orchestrator",
      state: ctx.isIdle?.() === false ? "thinking" : "idle",
      model: session.model,
    });
    if (main) addLog(main, "Observer connected to Pi session.");
    try {
      for (const entry of (ctx.sessionManager?.getBranch?.() || []).slice(
        -5000,
      ))
        if (record(entry) && entry.type === "message")
          observeMessage(entry.message, true);
    } catch {}
    listen("subagents:rpc:v1:ready", () => {
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
  on("session_shutdown", shutdown);
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
    if (record(e.partialResult?.details))
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
    if (record(e.result?.details))
      observeRows(e.result.details, str(e.toolCallId), true);
    if (str(e.toolName).includes("subagent")) void refresh(true);
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
