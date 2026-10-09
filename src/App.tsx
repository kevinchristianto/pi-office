import { Component, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Eye,
  Footprints,
  HelpCircle,
  Hand,
  Maximize,
  MousePointer2,
  Radio,
  RotateCcw,
  Search,
  Shield,
  Users,
  X,
} from "lucide-react";
import Office from "./Office";
import { stateColor } from "./state";
import { demo } from "./demo";
import { useOfficeData } from "./useOfficeData";
import type { Agent } from "./types";
const metric = (n: number | null | undefined) =>
  n == null ? "Not reported" : n.toLocaleString();
const time = (n: number | string | undefined) =>
  n
    ? new Date(n).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "Not reported";
class SceneBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="scene-error">
        <h2>The 3D office couldn't open.</h2>
        <p>
          Check that the local model files are available and WebGL / hardware
          acceleration is enabled. Your live data is still available under
          Agents.
        </p>
        <button onClick={() => this.setState({ error: false })}>
          Try again
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const { snapshot, connection } = useOfficeData();
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusSession, setFocusSession] = useState("all");
  const [roster, setRoster] = useState(false);
  const [guide, setGuide] = useState(false);
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState(false);
  const [tab, setTab] = useState("overview");
  const [reset, setReset] = useState(0);
  const [follow, setFollow] = useState<string | null>(null);
  const [command, setCommand] = useState<{
    id: string;
    type: "wave" | "walk" | "return";
    serial: number;
  } | null>(null);
  const sessions = mode === "demo" ? demo.sessions : snapshot.sessions;
  const agents = sessions.flatMap((s) => s.agents);
  const agent = agents.find((a) => a.id === selected);
  const currentSession = sessions.find((s) =>
    s.agents.some((a) => a.id === selected),
  );
  const shownSessions =
    focusSession === "all"
      ? sessions.slice(0, 4)
      : sessions.filter((s) => s.id === focusSession);
  const filtered = agents.filter((a) =>
    `${a.name} ${a.task || ""} ${a.role || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const choose = (id: string) => {
    setSelected(id);
    setDetails(false);
    setRoster(false);
    setFollow(null);
    const target = sessions.find((s) => s.agents.some((a) => a.id === id));
    if (target && !shownSessions.some((s) => s.id === target.id))
      setFocusSession(target.id);
  };
  useEffect(() => {
    setSelected(null);
    setFollow(null);
    setCommand(null);
    setFocusSession("all");
    setDetails(false);
  }, [mode]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (guide) setGuide(false);
      else if (roster) setRoster(false);
      else if (details) setDetails(false);
      else if (follow) setFollow(null);
      else setSelected(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [guide, roster, details, follow]);
  useEffect(() => {
    if (!guide) return;
    const previous = document.activeElement as HTMLElement | null;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"] button'),
      );
      const first = buttons[0],
        last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [guide]);
  const act = (type: "wave" | "walk" | "return") => {
    if (selected) setCommand({ id: selected, type, serial: Date.now() });
  };
  const resetView = () => {
    setFollow(null);
    setReset((n) => n + 1);
  };
  return (
    <div className="game-shell">
      <div className="world-layer">
        <SceneBoundary>
          <Office
            sessions={shownSessions}
            selected={selected}
            onSelect={choose}
            reset={reset}
            follow={follow}
            command={command}
            onStopFollow={() => setFollow(null)}
          />
        </SceneBoundary>
      </div>
      <header className="game-header">
        <div className="identity">
          <div className="pi-mark">π</div>
          <div>
            <strong>pi office</strong>
            <span>
              {mode === "demo" ? "A sample world" : "Your agents, together"}
            </span>
          </div>
        </div>
        <div className={`connection ${mode === "demo" ? "is-demo" : ""}`}>
          <i />
          {mode === "demo"
            ? "DEMO"
            : connection === "connected"
              ? "LOCAL · LIVE"
              : connection === "connecting"
                ? "CONNECTING"
                : "OFFLINE"}
        </div>
        <div className="header-spacer" />
        <div className="room-switch">
          <span>ROOM</span>
          <select
            aria-label="Choose session room"
            value={focusSession}
            onChange={(e) => {
              setFocusSession(e.target.value);
              setSelected(null);
              setFollow(null);
              setReset((n) => n + 1);
            }}
          >
            <option value="all">
              {sessions.length > 4 ? "First 4 rooms" : "Whole office"}
            </option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </div>
        <button
          className={`hud-button ${roster ? "chosen" : ""}`}
          aria-label="Open agent roster"
          title="Agents"
          onClick={() => setRoster((v) => !v)}
        >
          <Users size={17} />
          <span>{agents.length}</span>
        </button>
        <button
          className="hud-button help-button"
          aria-label="Open guide"
          onClick={() => setGuide(true)}
        >
          <HelpCircle size={17} />
        </button>
      </header>
      <div className="mode-dock" aria-label="Data source">
        <button
          className={mode === "live" ? "active" : ""}
          onClick={() => setMode("live")}
        >
          <Radio size={12} />
          Live
        </button>
        <button
          className={mode === "demo" ? "active" : ""}
          onClick={() => setMode("demo")}
        >
          Explore demo
        </button>
      </div>
      {mode === "demo" && (
        <div className="demo-note">
          Sample agents · visual interactions don't control Pi
        </div>
      )}
      {agents.length === 0 && (
        <div className="welcome-note">
          <span>THE OFFICE IS READY</span>
          <h1>
            A place for your
            <br />
            next great thing.
          </h1>
          <p>Connect a Pi session to bring it to life.</p>
          <div>
            <button onClick={() => setGuide(true)}>
              Connect Pi <ArrowUpRight size={13} />
            </button>
            <button className="quiet" onClick={() => setMode("demo")}>
              Take a look around
            </button>
          </div>
        </div>
      )}
      <div className="navigation-hint">
        <MousePointer2 size={13} />
        <span>
          Drag to look around · Scroll to zoom · Right-drag or WASD to pan
        </span>
      </div>
      <div className="view-controls">
        {follow && (
          <button className="follow-chip" onClick={() => setFollow(null)}>
            <Eye size={13} />
            Following {agent?.name || "agent"}
            <X size={12} />
          </button>
        )}
        <button
          aria-label="Reset camera"
          title="Reset camera"
          onClick={resetView}
        >
          <RotateCcw size={17} />
        </button>
        <button
          aria-label="Toggle fullscreen"
          title="Fullscreen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen?.();
            else
              void document.documentElement
                .requestFullscreen?.()
                .catch(() => {});
          }}
        >
          <Maximize size={17} />
        </button>
      </div>
      {agent && (
        <section className="agent-context" aria-label="Selected agent">
          <div
            className="context-person"
            style={
              {
                "--agent-color": stateColor(agent.state),
              } as React.CSSProperties
            }
          >
            <div className="context-initial">{agent.name.slice(0, 1)}</div>
            <div>
              <strong>{agent.name}</strong>
              <span>
                <i style={{ background: stateColor(agent.state) }} />
                {agent.state} · {currentSession?.name}
              </span>
            </div>
            <button
              aria-label="Clear selected agent"
              onClick={() => {
                setSelected(null);
                setDetails(false);
                setFollow(null);
              }}
            >
              <X size={15} />
            </button>
          </div>
          <div className="context-actions">
            <button
              onClick={() => {
                setDetails((v) => !v);
                setTab("overview");
              }}
            >
              <Eye size={14} />
              Inspect
            </button>
            <button onClick={() => act("wave")}>
              <Hand size={14} />
              Wave
            </button>
            <button onClick={() => act("walk")}>
              <Footprints size={14} />
              Take a walk
            </button>
            <button
              onClick={() => setFollow(follow === agent.id ? null : agent.id)}
              className={follow === agent.id ? "active" : ""}
            >
              <MousePointer2 size={14} />
              {follow === agent.id ? "Unfollow" : "Follow"}
            </button>
            <button
              className="return-button"
              title="Return to desk"
              aria-label="Return agent to desk"
              onClick={() => act("return")}
            >
              <ArrowLeft size={14} />
            </button>
          </div>
          <p>
            Character actions are visual only. Pi keeps working independently.
          </p>
        </section>
      )}
      {roster && (
        <aside className="floating-panel roster-panel">
          <div className="panel-heading">
            <div>
              <span>WHO'S HERE</span>
              <h2>Your agents</h2>
            </div>
            <button
              aria-label="Close agent roster"
              onClick={() => setRoster(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="roster-search">
            <Search size={14} />
            <input
              aria-label="Search agents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a name or task…"
            />
          </div>
          <div className="roster-content">
            {sessions.map((s) => (
              <section key={s.id}>
                <h3>
                  {s.name}
                  <span>{s.agents.length}</span>
                </h3>
                {s.agents
                  .filter((a) => filtered.includes(a))
                  .map((a) => (
                    <button
                      className="roster-agent"
                      key={a.id}
                      onClick={() => choose(a.id)}
                    >
                      <i style={{ background: stateColor(a.state) }} />
                      <div>
                        <strong>{a.name}</strong>
                        <span>{a.task || "No task reported"}</span>
                      </div>
                      <small>{a.state}</small>
                    </button>
                  ))}
              </section>
            ))}
            {!agents.length && (
              <p className="empty-roster">
                No sessions connected yet. Open the guide to connect your
                existing Pi sessions.
              </p>
            )}
            {agents.length > 0 && !filtered.length && (
              <p className="empty-roster">No matching agents.</p>
            )}
          </div>
          <div className="panel-foot">
            <Shield size={12} />
            Local observation. No agent commands.
          </div>
        </aside>
      )}
      {details && agent && (
        <aside className="floating-panel detail-panel">
          <div className="panel-heading">
            <div>
              <span>AGENT DETAILS</span>
              <h2>{agent.name}</h2>
            </div>
            <button
              aria-label="Close agent details"
              onClick={() => setDetails(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="detail-tabs">
            <button
              className={tab === "overview" ? "active" : ""}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            <button
              className={tab === "activity" ? "active" : ""}
              onClick={() => setTab("activity")}
            >
              Activity <small>{agent.logs?.length || 0}</small>
            </button>
          </div>
          <div className="detail-scroll">
            {tab === "overview" ? (
              <>
                <label>CURRENT TASK</label>
                <p className="task-copy">
                  {agent.task || "No task reported yet."}
                </p>
                <label>CURRENT TOOL</label>
                <p className="tool-copy">
                  {agent.tool || "No active tool reported"}
                </p>
                <dl>
                  <div>
                    <dt>State</dt>
                    <dd>{agent.state}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>
                      {agent.model || currentSession?.model || "Not reported"}
                    </dd>
                  </div>
                  <div>
                    <dt>Input tokens</dt>
                    <dd>{metric(agent.inputTokens)}</dd>
                  </div>
                  <div>
                    <dt>Output tokens</dt>
                    <dd>{metric(agent.outputTokens)}</dd>
                  </div>
                  <div>
                    <dt>Reported cost</dt>
                    <dd>
                      {agent.cost == null
                        ? "Not reported"
                        : `$${agent.cost.toFixed(3)}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Last observed</dt>
                    <dd>{time(agent.updatedAt)}</dd>
                  </div>
                </dl>
                <label>WORKSPACE</label>
                <p className="path-copy">
                  {currentSession?.cwd || "Not reported"}
                </p>
                <p className="small-note">
                  {mode === "demo"
                    ? "Illustrative sample values."
                    : "Unavailable data is never estimated. Some Pi versions expose fewer fields."}
                </p>
              </>
            ) : (
              <div className="activity-list">
                {agent.logs?.length ? (
                  agent.logs
                    .slice()
                    .reverse()
                    .map((l, i) => (
                      <article key={i}>
                        <span>
                          {time(l.time)} · {l.level}
                        </span>
                        <p>{l.message}</p>
                      </article>
                    ))
                ) : (
                  <p className="empty-roster">No activity reported yet.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      )}
      {guide && (
        <div className="guide-backdrop" onClick={() => setGuide(false)}>
          <section
            className="guide-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Office guide"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <span>MAKE YOURSELF AT HOME</span>
                <h2>A living view of your work.</h2>
              </div>
              <button
                aria-label="Close guide"
                autoFocus
                onClick={() => setGuide(false)}
              >
                <X size={19} />
              </button>
            </div>
            <p>
              Each Pi session gets its own room. Click an agent to inspect,
              wave, take a stroll, or follow. These actions animate the
              character; they never send instructions to Pi.
            </p>
            <ol>
              <li>
                <strong>Start the local bridge</strong>
                <span>Run npm start or START-OFFICE.cmd. Keep it open.</span>
              </li>
              <li>
                <strong>Add the observer once</strong>
                <span>
                  Add the absolute path to extension/pi-office.ts to the
                  extensions array in your Pi user settings. Keep the observer
                  in this app folder so it can find the local token.
                </span>
              </li>
              <li>
                <strong>Connect an open session</strong>
                <span>
                  When your Pi work is idle, run /reload. Future Pi launches
                  load the observer automatically. See README.md for setup and
                  limits.
                </span>
              </li>
            </ol>
            <div className="guide-controls">
              <span>Drag · Orbit</span>
              <span>Scroll · Zoom</span>
              <span>WASD · Pan</span>
              <span>Esc · Close / unfollow</span>
            </div>
            <button className="guide-done" onClick={() => setGuide(false)}>
              Let's go <Check size={15} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
