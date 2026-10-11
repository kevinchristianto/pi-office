import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Building2,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Eye,
  Focus,
  Footprints,
  HelpCircle,
  Hand,
  Maximize,
  MousePointer2,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Shield,
  Users,
  X,
} from "lucide-react";
const Office = lazy(() => import("./Office"));
import WorkplacePanel, { type WorkplaceFacility } from "./WorkplacePanel";
import RoomSelector from "./RoomSelector";
import { stateColor } from "./state";
import { demo } from "./demo";
import { useOfficeData } from "./useOfficeData";
import {
  isHistoricalAgent,
  projectOffices,
  projectRosterSummary,
} from "./projectProjection";
import type { CameraAction } from "./camera";
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
  const { snapshot, connection, lifecycleEvents, lifecycleEpoch } =
    useOfficeData();
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusSession, setFocusSession] = useState("all");
  const [roster, setRoster] = useState(false);
  const [facility, setFacility] = useState<WorkplaceFacility | null>(null);
  const [guide, setGuide] = useState(false);
  const guideOpener = useRef<HTMLElement | null>(null);
  const guidePanel = useRef<HTMLElement | null>(null);
  const openGuide = () => {
    guideOpener.current = document.activeElement as HTMLElement | null;
    setGuide(true);
  };
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState(false);
  const [tab, setTab] = useState("overview");
  const [reset, setReset] = useState(0);
  const [follow, setFollow] = useState<string | null>(null);
  const [cameraAction, setCameraAction] = useState<CameraAction | null>(null);
  const commandSerial = useRef(0);
  const [command, setCommand] = useState<{
    id: string;
    type: "wave" | "walk" | "return";
    serial: number;
  } | null>(null);
  const sessions = useMemo(
    () => (mode === "demo" ? demo.sessions : projectOffices(snapshot.sessions)),
    [mode, snapshot.sessions],
  );
  const previousSessions = useRef(sessions);
  const agents = sessions.flatMap((s) => s.agents);
  const currentAgents = sessions.flatMap((session) =>
    session.agents.filter((item) => !isHistoricalAgent(session, item)),
  );
  const currentIds = new Set(currentAgents.map((item) => item.id));
  const historyCount = agents.length - currentAgents.length;
  const agent = agents.find((a) => a.id === selected);
  const currentSession = sessions.find((s) =>
    s.agents.some((a) => a.id === selected),
  );
  const historical = !!agent && !currentIds.has(agent.id);
  // History is selectable for inspection, but never promoted into a desk or
  // passed to the camera/character controls as a physical resident.
  const physicalSelection =
    selected && currentIds.has(selected) ? selected : null;
  const physicalFollow = follow && currentIds.has(follow) ? follow : null;
  const physicalCommand =
    command && currentIds.has(command.id) ? command : null;
  const physicalCameraAction =
    cameraAction?.type === "focus" && !currentIds.has(cameraAction.id)
      ? null
      : cameraAction;
  // A legacy cwd room can acquire a canonical project ID after observer reload.
  // Resolve that view by its raw source sessions before rendering: an interim
  // empty room list would unmount the same selected/followed resident.
  const previousFocus = previousSessions.current.find(
    (session) => session.id === focusSession,
  );
  const focusedSources = new Set(
    previousFocus?.sourceSessions?.map((session) => session.id) ?? [],
  );
  const replacementRooms = sessions.filter((session) =>
    session.sourceSessions?.some((source) => focusedSources.has(source.id)),
  );
  const effectiveFocus =
    focusSession === "all" ||
    sessions.some((session) => session.id === focusSession)
      ? focusSession
      : (currentSession?.id ??
        (replacementRooms.length === 1 ? replacementRooms[0].id : "all"));
  const visibleWindow =
    effectiveFocus === "all"
      ? sessions.slice(0, 4)
      : sessions.filter((s) => s.id === effectiveFocus);
  // Availability chooses which four projects receive scarce overview space.
  // It must not reshuffle the physical rooms when that membership is unchanged:
  // a last-root stop still needs its original room and departure route.
  const shownSessions =
    mode === "live"
      ? [...visibleWindow].sort((a, b) => a.id.localeCompare(b.id))
      : visibleWindow;
  const shownCurrentCount = shownSessions.reduce(
    (count, session) =>
      count +
      session.agents.filter((item) => !isHistoricalAgent(session, item)).length,
    0,
  );
  const filtered = agents.filter((a) =>
    `${a.name} ${a.task || ""} ${a.role || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const choose = (id: string) => {
    setFacility(null);
    setSelected(id);
    setDetails(false);
    setRoster(false);
    setFollow(null);
    setCommand(null);
    setCameraAction(null);
    const target = sessions.find((s) => s.agents.some((a) => a.id === id));
    if (target && !shownSessions.some((s) => s.id === target.id)) {
      setFocusSession(target.id);
      setReset((n) => n + 1);
    }
  };
  useEffect(() => {
    setFacility(null);
    setSelected(null);
    setFollow(null);
    setCommand(null);
    setFocusSession("all");
    setCameraAction(null);
    setReset((n) => n + 1);
    setDetails(false);
  }, [mode]);
  useEffect(() => {
    // Live snapshots can remove a person or a project while its panel is open.
    if (selected && !agents.some((item) => item.id === selected)) {
      setSelected(null);
      setDetails(false);
      setFollow(null);
      setCameraAction(null);
    }
    if (focusSession !== effectiveFocus) setFocusSession(effectiveFocus);
    previousSessions.current = sessions;
  }, [sessions, selected, focusSession, effectiveFocus]);
  useEffect(() => {
    // An offline timeout needs no invented departure. Keep its selected
    // observation open while dropping physical interactions immediately.
    if (follow && !currentIds.has(follow)) setFollow(null);
    if (command && !currentIds.has(command.id)) setCommand(null);
    if (cameraAction?.type === "focus" && !currentIds.has(cameraAction.id))
      setCameraAction(null);
  }, [sessions, follow, command, cameraAction]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || facility) return;
      if (guide) setGuide(false);
      else if (roster) setRoster(false);
      else if (details) setDetails(false);
      else if (follow) setFollow(null);
      else setSelected(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [guide, roster, details, follow, facility]);
  useEffect(() => {
    if (!guide) return;
    const previous = guideOpener.current;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        guidePanel.current?.querySelectorAll<HTMLElement>("button") ?? [],
      );
      const first = buttons[0],
        last = buttons.at(-1);
      if (!guidePanel.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !guidePanel.current?.contains(event.target)
      )
        guidePanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("keydown", trap);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", trap);
      document.removeEventListener("focusin", containFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [guide]);
  const issueCommand = (id: string, type: "wave" | "walk" | "return") => {
    if (!currentIds.has(id)) return;
    // Wall clocks can repeat or move backwards. Keep each explicit gesture
    // unique even across data-mode changes and view-only resident remounts.
    setCommand({ id, type, serial: ++commandSerial.current });
  };
  const act = (type: "wave" | "walk" | "return") => {
    if (selected) issueCommand(selected, type);
  };
  const resetView = () => {
    setFollow(null);
    setReset((n) => n + 1);
  };
  return (
    <div className="game-shell">
      <div className="world-layer">
        <SceneBoundary>
          <Suspense
            fallback={
              <div className="scene-loading" role="status">
                Opening the workplace…
              </div>
            }
          >
            <Office
              onFacility={(kind) => {
                setFacility(kind);
                setRoster(false);
                setDetails(false);
              }}
              lifecycleEvents={lifecycleEvents}
              lifecycleEpoch={lifecycleEpoch}
              lifecycleEnabled={mode === "live"}
              connection={connection}
              sessions={shownSessions}
              selected={physicalSelection}
              onSelect={choose}
              reset={reset}
              follow={physicalFollow}
              command={physicalCommand}
              onStopFollow={() => setFollow(null)}
              cameraAction={physicalCameraAction}
            />
          </Suspense>
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
        <RoomSelector
          value={effectiveFocus}
          options={[
            {
              value: "all",
              label: sessions.length > 4 ? "First 4 projects" : "Whole office",
              description: "Shared office overview",
            },
            ...sessions.map((session) => ({
              value: session.id,
              label: session.name,
              description: `${projectRosterSummary(session)} · ${session.cwd || "Path not reported"}`,
            })),
          ]}
          onChange={(value) => {
            setFocusSession(value);
            setSelected(null);
            setFollow(null);
            setReset((n) => n + 1);
          }}
        />
        <button
          className={`hud-button ${roster ? "chosen" : ""}`}
          aria-label="Open agent roster"
          aria-expanded={roster}
          title={`${currentAgents.length} current · ${historyCount} historical observations`}
          onClick={() => {
            setDetails(false);
            setRoster((v) => !v);
          }}
        >
          <Users size={17} />
          <span>{currentAgents.length} current</span>
        </button>
        <button
          className="hud-button help-button"
          aria-label="Open guide"
          onClick={openGuide}
        >
          <HelpCircle size={17} />
        </button>
      </header>
      <button
        className="workplace-open"
        onClick={() => {
          setFacility("reception");
          setRoster(false);
          setDetails(false);
        }}
        aria-label="Open workplace overview"
      >
        <Building2 size={16} /> Workplace
      </button>
      {facility && (
        <WorkplacePanel
          sessions={sessions}
          mode={mode}
          connection={connection}
          facility={facility}
          onClose={() => setFacility(null)}
          onSelect={choose}
          onOpenRoster={() => {
            setFacility(null);
            setRoster(true);
          }}
          onFocusSession={(id) => {
            setFacility(null);
            setFocusSession(id);
            setSelected(null);
            setFollow(null);
            setReset((n) => n + 1);
          }}
          onVisualCommand={(id, type) => {
            choose(id);
            issueCommand(id, type);
          }}
        />
      )}
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
            Your work.
            <br />
            One shared office.
          </h1>
          <p>Connect a Pi session to bring it to life.</p>
          <div>
            <button onClick={openGuide}>
              Connect Pi <ArrowUpRight size={13} />
            </button>
            <button className="quiet" onClick={() => setMode("demo")}>
              Take a look around
            </button>
          </div>
        </div>
      )}
      {agents.length > 0 && shownCurrentCount === 0 && (
        <div className="history-empty-note" role="status">
          <strong>This office is quiet.</strong>
          <p>
            No current agents in this view. Previous observations are still
            available in Agents.
          </p>
          <button
            onClick={() => {
              setDetails(false);
              setRoster(true);
            }}
          >
            Browse agent history <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <div className="navigation-hint">
        <MousePointer2 size={13} />
        <span>Drag to orbit · Scroll to zoom · Right-drag to pan</span>
      </div>
      <p id="camera-instructions" className="visually-hidden">
        Drag to orbit. Scroll or pinch to zoom. Right-drag, Shift-drag, or
        two-finger drag to pan. Click or Tab to the office camera, then use WASD
        or arrow keys to pan, plus and minus to zoom, or Home to fit the office.
        Manual camera controls stop following.
      </p>
      <div className="view-controls" role="group" aria-label="Camera controls">
        {physicalFollow && (
          <button
            className="follow-chip"
            aria-label={`Stop following ${agent?.name || "agent"}`}
            onClick={() => setFollow(null)}
          >
            <Eye size={13} />
            Following {agent?.name || "agent"}
            <X size={12} />
          </button>
        )}
        <button
          aria-label="Zoom out"
          title="Zoom out (−)"
          onClick={() => {
            setFollow(null);
            setCameraAction((action) => ({
              type: "zoom-out",
              serial: (action?.serial || 0) + 1,
            }));
          }}
        >
          <Minus size={16} />
        </button>
        <button
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => {
            setFollow(null);
            setCameraAction((action) => ({
              type: "zoom-in",
              serial: (action?.serial || 0) + 1,
            }));
          }}
        >
          <Plus size={16} />
        </button>
        <button
          aria-label="Reset camera"
          title="Fit office (Home)"
          onClick={resetView}
        >
          <RotateCcw size={16} />
          <span className="fit-label">Fit</span>
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
                {historical ? "Historical · " : ""}
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
                setRoster(false);
                setDetails((v) => !v);
                setTab("overview");
              }}
            >
              <Eye size={14} />
              Inspect
            </button>
            <button
              disabled={historical}
              title="Frame this agent once"
              onClick={() => {
                setFollow(null);
                setCameraAction((action) => ({
                  type: "focus",
                  id: agent.id,
                  serial: (action?.serial || 0) + 1,
                }));
              }}
            >
              <Focus size={14} />
              Focus
            </button>
            <button disabled={historical} onClick={() => act("wave")}>
              <Hand size={14} />
              Wave
            </button>
            <button disabled={historical} onClick={() => act("walk")}>
              <Footprints size={14} />
              Take a walk
            </button>
            <button
              disabled={historical}
              onClick={() => setFollow(follow === agent.id ? null : agent.id)}
              aria-pressed={follow === agent.id}
              title="Keep the camera with this agent; drag to stop"
              className={follow === agent.id ? "active" : ""}
            >
              <MousePointer2 size={14} />
              {follow === agent.id ? "Unfollow" : "Follow"}
            </button>
            <button
              disabled={historical}
              className="return-button"
              title="Return to desk"
              aria-label="Return agent to desk"
              onClick={() => act("return")}
            >
              <ArrowLeft size={14} />
            </button>
          </div>
          <p>
            {historical
              ? "Historical observation. No current character to focus, follow, or animate."
              : "Character actions are visual only. Pi keeps working independently."}
          </p>
        </section>
      )}
      {roster && (
        <aside className="floating-panel roster-panel">
          <div className="panel-heading">
            <div>
              <span>CURRENT & HISTORY</span>
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
                {s.sourceSessions && (
                  <p className="small-note">{projectRosterSummary(s)}</p>
                )}
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
                        <span>
                          {isHistoricalAgent(s, a) ? "Historical · " : ""}
                          {a.task || "No task reported"}
                        </span>
                        {a.source && (
                          <span>
                            {a.source.sessionName} · {a.source.sessionId}
                          </span>
                        )}
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
                <label>
                  {historical ? "LAST REPORTED TASK" : "CURRENT TASK"}
                </label>
                <p className="task-copy">
                  {agent.task || "No task reported yet."}
                </p>
                <label>
                  {historical ? "LAST REPORTED TOOL" : "CURRENT TOOL"}
                </label>
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
                      {agent.model ||
                        agent.source?.model ||
                        currentSession?.model ||
                        "Not reported"}
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
                  {agent.source && (
                    <>
                      <div>
                        <dt>Source session</dt>
                        <dd>{agent.source.sessionName}</dd>
                      </div>
                      <div>
                        <dt>Session ID</dt>
                        <dd>{agent.source.sessionId}</dd>
                      </div>
                      <div>
                        <dt>Agent ID</dt>
                        <dd>{agent.source.agentId}</dd>
                      </div>
                      <div>
                        <dt>Roster</dt>
                        <dd>
                          {historical
                            ? "Historical observation"
                            : "Current observation"}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                <label>WORKSPACE</label>
                <p className="path-copy">
                  {(agent.source ? agent.source.cwd : currentSession?.cwd) ||
                    "Not reported"}
                </p>
                {currentSession?.project && (
                  <>
                    <label>PROJECT ROOT</label>
                    <p className="path-copy">{currentSession.project.root}</p>
                  </>
                )}
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
            ref={guidePanel}
            className="guide-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Office guide"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <span>YOUR WORKPLACE GUIDE</span>
                <h2>A clear view of your team.</h2>
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
              Each project gets an airy cubicle section, shared by its Pi
              sessions. Click an agent to inspect, wave, take a stroll, or
              follow. These actions animate the character; they never send
              instructions to Pi.
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
              <span>Scroll / pinch · Zoom</span>
              <span>Right / Shift-drag · Pan</span>
              <span>Two-finger drag · Pan</span>
              <span>Focus camera, then WASD / arrows · Pan</span>
              <span>+ / − · Zoom</span>
              <span>Home · Fit office</span>
              <span>Esc · Close / unfollow</span>
            </div>
            <p className="guide-camera-note">
              Click or Tab to the office for keyboard controls. Focus frames an
              agent once; Follow moves with them. Dragging, panning, or zooming
              returns control to you.
            </p>
            <button className="guide-done" onClick={() => setGuide(false)}>
              Let's go <Check size={15} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
