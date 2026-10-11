import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Building2,
  Coffee,
  DoorOpen,
  Footprints,
  Hand,
  RotateCcw,
  Shield,
  Users,
  X,
} from "lucide-react";
import { activityLine, presentation } from "./agentPresentation";
import { stateColor } from "./state";
import type { Agent, Session } from "./types";
import { projectRosterSummary } from "./projectProjection";
import "./workplace-panel.css";

export type WorkplaceFacility =
  "reception" | "meeting" | "operations" | "breakroom";
export interface WorkplacePanelProps {
  sessions: readonly Session[];
  mode: "live" | "demo";
  connection: "connecting" | "connected" | "disconnected";
  facility: WorkplaceFacility;
  onClose: () => void;
  onSelect: (agentId: string) => void;
  onFocusSession: (sessionId: string) => void;
  onOpenRoster: () => void;
  onVisualCommand?: (
    agentId: string,
    command: "walk" | "return" | "wave",
  ) => void;
}
const facilities = [
  {
    id: "reception",
    label: "Reception",
    subtitle: "Directory & arrivals",
    icon: DoorOpen,
  },
  {
    id: "meeting",
    label: "Meeting room",
    subtitle: "Project briefs",
    icon: Users,
  },
  {
    id: "operations",
    label: "Operations",
    subtitle: "Activity & attention",
    icon: Activity,
  },
  {
    id: "breakroom",
    label: "Break room",
    subtitle: "Resident interactions",
    icon: Coffee,
  },
] as const;
const ATTENTION_STATES = ["error", "waiting", "stale", "offline"];
const MAX_ACTIVITY = 80;
const isWorking = (agent: Agent) =>
  !agent.source?.historical && ["working", "thinking"].includes(agent.state);
function timestamp(value: number | string) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}
function ReportedTime({ value }: { value: number | string }) {
  const time = timestamp(value);
  if (time === null)
    return <span className="workplace-time">Time not reported</span>;
  const date = new Date(time);
  return (
    <time
      className="workplace-time"
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
    >
      {date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
    </time>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="workplace-empty">{children}</p>;
}

/** Shared amenities expose real observations and explicitly visual interactions. */
export default function WorkplacePanel(props: WorkplacePanelProps) {
  const {
    sessions,
    mode,
    connection,
    facility,
    onSelect,
    onFocusSession,
    onOpenRoster,
    onVisualCommand,
  } = props;
  const [active, setActive] = useState(facility);
  const [residentId, setResidentId] = useState("");
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const currentClose = useRef(props.onClose);
  currentClose.current = props.onClose;
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const selectId = useId();
  useEffect(() => setActive(facility), [facility]);
  useEffect(() => {
    opener.current ??=
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    close.current?.focus();
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      );
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        currentClose.current();
      } else if (event.key === "Tab") {
        const nodes = focusables();
        const first = nodes[0];
        const last = nodes.at(-1);
        if (
          !panel.current?.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target)
      )
        close.current?.focus();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      if (opener.current?.isConnected)
        opener.current.focus({ preventScroll: true });
    };
  }, []);
  const residents = sessions.flatMap((session) =>
    session.agents.map((agent) => ({ session, agent })),
  );
  const resident =
    residents.find(({ agent }) => agent.id === residentId) ?? residents[0];
  const attention = residents
    .filter(({ agent }) => ATTENTION_STATES.includes(agent.state))
    .sort(
      (a, b) =>
        Number(!!a.agent.source?.historical) -
          Number(!!b.agent.source?.historical) ||
        ATTENTION_STATES.indexOf(a.agent.state) -
          ATTENTION_STATES.indexOf(b.agent.state) ||
        a.agent.name.localeCompare(b.agent.name),
    );
  const activity = residents
    .flatMap(({ session, agent }) =>
      (agent.logs ?? []).map((entry, index) => ({
        ...entry,
        session,
        agent,
        index,
        at: timestamp(entry.time),
      })),
    )
    .sort((a, b) => {
      if (a.at === null) return b.at === null ? 0 : 1;
      if (b.at === null) return -1;
      return b.at - a.at;
    });
  const run = (action: () => void) => {
    currentClose.current();
    action();
  };
  const heading = facilities.find(({ id }) => id === active)!;
  const connectionLabel =
    mode === "demo"
      ? "Demo data"
      : connection === "connected"
        ? "Live observations"
        : connection === "connecting"
          ? "Connecting to Pi"
          : "Disconnected · last received data";
  const working = residents.filter(({ agent }) => isWorking(agent)).length;
  return (
    <div
      className="workplace-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) currentClose.current();
      }}
    >
      <section
        ref={panel}
        className="workplace-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="workplace-header">
          <div className="workplace-brand">
            <Building2 size={21} aria-hidden="true" />
            <span>
              PI OFFICE<small>Shared workplace</small>
            </span>
          </div>
          <span
            className={`workplace-connection ${connection === "connected" && mode === "live" ? "is-live" : ""}`}
          >
            {connectionLabel}
          </span>
          <button
            ref={close}
            className="workplace-close"
            type="button"
            aria-label="Close workplace"
            onClick={() => currentClose.current()}
          >
            <X size={20} />
          </button>
        </header>
        <div className="workplace-layout">
          <nav className="workplace-navigation" aria-label="Shared facilities">
            {facilities.map(({ id, label, subtitle, icon: Icon }, index) => (
              <button
                key={id}
                type="button"
                aria-pressed={active === id}
                onClick={() => setActive(id)}
              >
                <Icon size={19} aria-hidden="true" />
                <span>
                  {label}
                  <small>{subtitle}</small>
                </span>
                <b aria-hidden="true">0{index + 1}</b>
              </button>
            ))}
            <p className="workplace-nav-note">
              <Shield size={14} aria-hidden="true" />
              Observation only.
              <br />
              Agent commands stay in Pi.
            </p>
          </nav>
          <div className="workplace-content">
            <div className="workplace-title">
              <span className="workplace-eyebrow">
                SHARED FACILITIES /{" "}
                {String(
                  facilities.findIndex(({ id }) => id === active) + 1,
                ).padStart(2, "0")}
              </span>
              <h2 id={titleId}>{heading.label}</h2>
              <p id={descriptionId}>
                {active === "reception"
                  ? "Find a project, meet the residents, and see what Pi is reporting."
                  : active === "meeting"
                    ? "A shared place to review each project and return to its workstations."
                    : active === "operations"
                      ? "Reported activity from across the office, with states worth reviewing."
                      : "A little space to step away. Resident gestures and visits are visual only."}
              </p>
            </div>
            {active === "reception" && (
              <>
                <dl className="workplace-stats" aria-label="Office summary">
                  <div>
                    <dt>Projects</dt>
                    <dd>{sessions.length}</dd>
                  </div>
                  <div>
                    <dt>Agents</dt>
                    <dd>{residents.length}</dd>
                  </div>
                  <div>
                    <dt>Working / thinking</dt>
                    <dd>{working}</dd>
                  </div>
                  <div>
                    <dt>Review states</dt>
                    <dd>{attention.length}</dd>
                  </div>
                </dl>
                <div className="workplace-section-heading">
                  <h3>Office directory</h3>
                  <button type="button" onClick={() => run(onOpenRoster)}>
                    Browse agents <ArrowUpRight size={15} />
                  </button>
                </div>
                {sessions.length ? (
                  <div className="workplace-projects">
                    {sessions.map((session) => (
                      <button
                        className="workplace-project"
                        key={session.id}
                        type="button"
                        onClick={() => run(() => onFocusSession(session.id))}
                        aria-label={`Open project ${session.name}`}
                      >
                        <span className="workplace-project-icon">
                          <Building2 size={19} />
                        </span>
                        <span>
                          <strong>{session.name}</strong>
                          <small>
                            {projectRosterSummary(session)} ·{" "}
                            {session.agents.filter(isWorking).length} working or
                            thinking
                          </small>
                          {session.cwd && <small>{session.cwd}</small>}
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty>
                    No projects reported yet. Connect a Pi session to populate
                    the directory.
                  </Empty>
                )}
                {sessions.length > 4 && (
                  <p className="workplace-note">
                    The overview displays four project sections at a time. Open
                    any project here to view its team.
                  </p>
                )}
              </>
            )}
            {active === "meeting" && (
              <>
                <div className="workplace-section-heading">
                  <h3>Project briefs</h3>
                  <span>
                    {sessions.length}{" "}
                    {sessions.length === 1 ? "project" : "projects"}
                  </span>
                </div>
                {sessions.length ? (
                  <div className="workplace-briefs">
                    {sessions.map((session) => (
                      <article className="workplace-brief" key={session.id}>
                        <div className="workplace-brief-heading">
                          <h4>{session.name}</h4>
                          <span>{projectRosterSummary(session)}</span>
                        </div>
                        {session.cwd && (
                          <p
                            className="workplace-project-path"
                            title={session.cwd}
                          >
                            {session.cwd}
                          </p>
                        )}
                        {session.agents.length ? (
                          <ul className="workplace-brief-agents">
                            {session.agents.slice(0, 3).map((agent) => (
                              <li key={agent.id}>
                                <i
                                  style={{
                                    background: stateColor(agent.state),
                                  }}
                                />
                                <div>
                                  <strong>
                                    {agent.name}
                                    <span>{presentation(agent).label}</span>
                                  </strong>
                                  <p>{activityLine(agent)}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="workplace-note">
                            No agents reported for this project.
                          </p>
                        )}
                        {session.agents.length > 3 && (
                          <p className="workplace-note">
                            +{session.agents.length - 3} more in this project
                          </p>
                        )}
                        <button
                          className="workplace-primary"
                          type="button"
                          onClick={() => run(() => onFocusSession(session.id))}
                        >
                          Focus {session.name}
                          <ArrowUpRight size={15} />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty>
                    Project briefs appear when Pi reports a session.
                  </Empty>
                )}
              </>
            )}
            {active === "operations" && (
              <>
                <div className="workplace-section-heading">
                  <h3>Attention & availability</h3>
                  <span>
                    {attention.length}{" "}
                    {attention.length === 1 ? "agent" : "agents"}
                  </span>
                </div>
                {attention.length ? (
                  <div className="workplace-attention">
                    {attention.map(({ agent, session }) => (
                      <button
                        type="button"
                        key={`${session.id}:${agent.id}`}
                        onClick={() => run(() => onSelect(agent.id))}
                        aria-label={`Inspect ${agent.name} · ${session.name}`}
                      >
                        <i style={{ background: stateColor(agent.state) }} />
                        <span>
                          <strong>{agent.name}</strong>
                          <small>
                            {session.name}
                            {agent.source?.historical ? " · Historical" : ""}
                            {agent.source
                              ? ` · ${agent.source.sessionName}`
                              : ""}
                          </small>
                        </span>
                        <span className="workplace-state">
                          {presentation(agent).label}
                        </span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty>No attention states reported.</Empty>
                )}
                <div className="workplace-section-heading workplace-activity-heading">
                  <h3>Reported activity</h3>
                  <span>
                    {Math.min(activity.length, MAX_ACTIVITY)}
                    {activity.length > MAX_ACTIVITY
                      ? ` of ${activity.length}`
                      : ""}{" "}
                    entries
                  </span>
                </div>
                {activity.length ? (
                  <ol
                    className="workplace-activity"
                    aria-label="Reported activity"
                  >
                    {activity.slice(0, MAX_ACTIVITY).map((entry) => (
                      <li
                        key={`${entry.session.id}:${entry.agent.id}:${entry.index}`}
                      >
                        <button
                          type="button"
                          onClick={() => run(() => onSelect(entry.agent.id))}
                          aria-label={`Inspect activity from ${entry.agent.name}: ${entry.message}`}
                        >
                          <div className="workplace-activity-meta">
                            <strong>{entry.agent.name}</strong>
                            <span>{entry.session.name}</span>
                            <ReportedTime value={entry.time} />
                          </div>
                          <p>{entry.message}</p>
                          <span className="workplace-level">
                            {entry.level || "Level not reported"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty>No activity reported yet.</Empty>
                )}
              </>
            )}
            {active === "breakroom" && (
              <>
                <div className="workplace-break-card">
                  <Coffee size={29} aria-hidden="true" />
                  <h3>Take a breather</h3>
                  <p>
                    Choose a resident for a stroll or a friendly wave. Their
                    reported task keeps its own state.
                  </p>
                </div>
                {resident ? (
                  <div className="workplace-resident-controls">
                    <label htmlFor={selectId}>Resident</label>
                    <select
                      id={selectId}
                      value={resident.agent.id}
                      onChange={(event) => setResidentId(event.target.value)}
                    >
                      {residents.map(({ agent, session }) => (
                        <option
                          key={`${session.id}:${agent.id}`}
                          value={agent.id}
                        >
                          {agent.name} · {session.name}
                          {agent.source ? ` · ${agent.source.sessionName}` : ""}
                          {agent.source?.historical ? " · Historical" : ""}
                        </option>
                      ))}
                    </select>
                    <div className="workplace-resident-status">
                      <i
                        style={{ background: stateColor(resident.agent.state) }}
                      />
                      {presentation(resident.agent).label}
                      <span>{activityLine(resident.agent)}</span>
                    </div>
                    {onVisualCommand ? (
                      <div className="workplace-visual-actions">
                        <button
                          type="button"
                          onClick={() =>
                            run(() =>
                              onVisualCommand(resident.agent.id, "walk"),
                            )
                          }
                        >
                          <Footprints size={18} />
                          Take a break
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            run(() =>
                              onVisualCommand(resident.agent.id, "wave"),
                            )
                          }
                        >
                          <Hand size={18} />
                          Wave hello
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            run(() =>
                              onVisualCommand(resident.agent.id, "return"),
                            )
                          }
                        >
                          <RotateCcw size={18} />
                          Return to desk
                        </button>
                      </div>
                    ) : (
                      <button
                        className="workplace-primary"
                        type="button"
                        onClick={() => run(() => onSelect(resident.agent.id))}
                      >
                        Open resident controls
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                    <p className="workplace-note">
                      Visual interactions only. Pi continues independently.
                    </p>
                  </div>
                ) : (
                  <Empty>
                    Resident interactions will be available when agents appear
                    in the office.
                  </Empty>
                )}
              </>
            )}
          </div>
        </div>
        <footer className="workplace-footer">
          <Shield size={13} aria-hidden="true" />
          <span>
            {mode === "demo"
              ? "Sample data · demo office"
              : "Local Pi observations"}
          </span>
          <span>Esc to close</span>
        </footer>
      </section>
    </div>
  );
}
