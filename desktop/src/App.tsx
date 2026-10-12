import { useEffect, useMemo, useRef, useState } from "react";
import { AgentPortrait } from "./AgentPortrait";
import { Icon } from "./Icon";
import {
  isBusy,
  needsAttention,
  projectResidents,
  stateLabel,
  type Resident,
} from "./model";
import { useCompanion } from "./useCompanion";
import type { CompanionCommand } from "./types";

function ResidentStatus({ resident }: { resident: Resident }) {
  return (
    <span
      className={`state-tag state-${resident.historical ? "historical" : resident.agent.state}`}
    >
      <span className="state-dot" />
      {resident.historical ? "Historical" : stateLabel(resident.agent.state)}
    </span>
  );
}

export function App() {
  const { state, command, commandError, dismissError } = useCompanion();
  const { offices, residents } = useMemo(
    () => projectResidents(state.snapshot),
    [state.snapshot],
  );
  const [project, setProject] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [listing, setListing] = useState<"history" | "current" | null>(null);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [documentHidden, setDocumentHidden] = useState(document.hidden);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hadPanelRef = useRef(false);
  const filtered = residents.filter(
    (resident) => project === "all" || resident.projectId === project,
  );
  const current = filtered.filter((resident) => !resident.historical);
  const history = filtered.filter((resident) => resident.historical);
  const chosen = residents.find((resident) => resident.key === selected);
  const attention = current.filter(needsAttention).length;
  const busy = current.filter(isBusy).length;
  const isLive = state.connection.status === "live";
  const paused = documentHidden || !state.visible || !isLive;
  const panelOpen = !!chosen || !!listing;
  const listResidents = listing === "history" ? history : current;

  useEffect(() => {
    const update = () => setDocumentHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (project !== "all" && !offices.some((office) => office.id === project))
      setProject("all");
    if (selected && !residents.some((resident) => resident.key === selected)) {
      setSelected(null);
      setNotice("That agent is no longer in the latest snapshot.");
      lastTriggerRef.current?.isConnected && lastTriggerRef.current.focus();
    }
  }, [offices, residents, project, selected]);
  useEffect(() => {
    if (panelOpen) panelCloseRef.current?.focus();
    else if (hadPanelRef.current) {
      const previous = lastTriggerRef.current;
      if (previous?.isConnected) previous.focus();
      else {
        const identity = previous?.getAttribute("data-resident-key");
        const replacement = [
          ...document.querySelectorAll<HTMLButtonElement>(
            "[data-resident-key]",
          ),
        ].find((node) => node.getAttribute("data-resident-key") === identity);
        (replacement ?? menuButtonRef.current)?.focus();
      }
    }
    hadPanelRef.current = panelOpen;
  }, [panelOpen, selected, listing]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !menuButtonRef.current?.contains(event.target as Node)
      )
        setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);

  function closePanel() {
    if (chosen && listing) setSelected(null);
    else {
      setSelected(null);
      setListing(null);
      if (lastTriggerRef.current?.isConnected) lastTriggerRef.current.focus();
    }
  }
  function openResident(resident: Resident, trigger: HTMLButtonElement) {
    if (!listing) lastTriggerRef.current = trigger;
    setSelected(resident.key);
    setNotice(null);
  }
  function openListing(
    type: "history" | "current",
    trigger: HTMLButtonElement,
  ) {
    lastTriggerRef.current = trigger;
    setSelected(null);
    setListing(type);
    setNotice(null);
  }
  function run(name: CompanionCommand) {
    setMenu(false);
    void command(name);
  }

  return (
    <main
      className={`companion ${paused ? "is-paused" : ""} ${state.locked ? "is-locked" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (menu) {
          setMenu(false);
          menuButtonRef.current?.focus();
        } else if (panelOpen) closePanel();
        else {
          dismissError();
          setNotice(null);
        }
      }}
    >
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            π
          </span>
          <span className="brand-name">
            pi office
            <span className="brand-caption">little office, big ideas</span>
          </span>
        </div>
        <div className="window-tools">
          <button
            className="icon-button"
            aria-label="Open full 3D office"
            title="Open full 3D office"
            onClick={() => run("open-office")}
          >
            <Icon name="open" />
          </button>
          <button
            className={`icon-button ${state.alwaysOnTop ? "is-on" : ""}`}
            aria-label="Always on top"
            aria-pressed={state.alwaysOnTop}
            title={state.alwaysOnTop ? "Turn off always on top" : "Keep on top"}
            onClick={() => run("toggle-top")}
          >
            <Icon name="pin" />
          </button>
          <button
            ref={menuButtonRef}
            className={`icon-button ${menu ? "is-on" : ""}`}
            aria-label="Companion options"
            aria-expanded={menu}
            aria-controls="companion-options"
            onClick={() => setMenu(!menu)}
          >
            <Icon name="menu" />
          </button>
        </div>
      </header>

      {menu && (
        <div
          ref={menuRef}
          id="companion-options"
          className="options-panel"
          aria-label="Companion options"
        >
          <div className="menu-label">YOUR LITTLE WINDOW</div>
          <button
            onClick={() => run(state.locked ? "restore" : "lock")}
            aria-pressed={state.locked}
            disabled={!state.locked && !state.shortcutAvailable}
            title="Ctrl+Shift+Space restores the window and unlocks it"
          >
            <span>
              {state.locked ? "Unlock click-through" : "Click-through lock"}
            </span>
            <span className="menu-check">{state.locked ? "✓" : ""}</span>
          </button>
          <p className="menu-note recovery-note">
            Ctrl+Shift+Space restores and unlocks.
          </p>
          <button onClick={() => run("compact")}>
            Compact size <span className="menu-hint">440 × 260</span>
          </button>
          <button onClick={() => run("roomy")}>
            Roomy size <span className="menu-hint">640 × 380</span>
          </button>
          <div className="menu-rule" />
          <button onClick={() => run("hide")}>
            Hide companion <span className="menu-hint">shortcut or tray</span>
          </button>
          <button onClick={() => run("quit")}>Quit companion</button>
          {!state.shortcutAvailable && (
            <p className="menu-note">
              Global shortcut unavailable. Use the tray icon to show this
              window.
            </p>
          )}
        </div>
      )}

      <section className="office-content" aria-label="Agent office">
        {!panelOpen && (
          <>
            <div className="office-heading">
              <div>
                <h1>
                  {isLive
                    ? current.length
                      ? "A good day to build."
                      : "Your desks are ready."
                    : state.connection.status === "connecting"
                      ? "Finding your office…"
                      : state.connection.status === "paused"
                        ? "Taking a little pause."
                        : "Your office is offline."}
                </h1>
                <p className="office-summary">
                  {isLive
                    ? `${current.length} current · ${busy} busy${attention ? ` · ${attention} needs attention` : ""}`
                    : state.connection.status === "connecting"
                      ? "Connecting to the local office bridge"
                      : state.connection.status === "paused"
                        ? "Updates resume when the window is shown"
                        : "We'll reconnect when the bridge is back"}
                </p>
              </div>
              {offices.length > 1 && (
                <label className="project-filter">
                  <span className="sr-only">Filter by project</span>
                  <select
                    value={project}
                    onChange={(event) => {
                      setProject(event.target.value);
                      setNotice(null);
                    }}
                  >
                    <option value="all">All projects</option>
                    {offices.map((office) => (
                      <option key={office.id} value={office.id}>
                        {office.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {isLive && offices.length === 1 && (
                <span className="single-project" title={offices[0].cwd}>
                  {offices[0].name}
                </span>
              )}
            </div>

            {isLive && current.length > 0 ? (
              <div
                className={`agent-dock roster-${Math.min(current.length, 8)}`}
                aria-label="Current agents"
              >
                <div className="dock-scenery" aria-hidden="true">
                  <span className="wall-print">make good things</span>
                  <span className="plant">
                    <i />
                    <i />
                    <i />
                    <b />
                  </span>
                  <span className="shelf" />
                </div>
                {current.slice(0, 8).map((resident) => (
                  <button
                    className={`resident ${needsAttention(resident) ? "needs-attention" : ""}`}
                    key={resident.key}
                    data-resident-key={resident.key}
                    aria-label={`${resident.agent.name}, ${stateLabel(resident.agent.state)}, ${resident.project}`}
                    onClick={(event) =>
                      openResident(resident, event.currentTarget)
                    }
                    title={`${resident.agent.name} · ${resident.project}\n${resident.agent.task || stateLabel(resident.agent.state)}`}
                  >
                    {needsAttention(resident) && (
                      <span
                        className={`attention-bubble ${resident.agent.state === "error" ? "attention-error" : ""}`}
                        aria-hidden="true"
                      >
                        {resident.agent.state === "error" ? "!" : "?"}
                      </span>
                    )}
                    <AgentPortrait
                      identity={resident.key}
                      state={resident.agent.state}
                    />
                    <span className="resident-name">{resident.agent.name}</span>
                    <span
                      className={`resident-state state-${resident.agent.state}`}
                    >
                      {stateLabel(resident.agent.state)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-office">
                <div className="empty-illustration" aria-hidden="true">
                  <Icon name="leaf" />
                  <span />
                  <i />
                </div>
                <div className="empty-copy">
                  <strong>
                    {isLive
                      ? "Room for your next idea."
                      : state.connection.status === "connecting"
                        ? "Just a moment."
                        : state.connection.status === "paused"
                          ? "A quieter desktop."
                          : "Start your existing office bridge."}
                  </strong>
                  <p>
                    {isLive
                      ? "Connect a Pi session with your existing observer. Current agents will settle in here."
                      : state.connection.status === "connecting"
                        ? "Your companion only watches the bridge you already use."
                        : state.connection.status === "paused"
                          ? "The companion saves work while hidden. Your agents keep going."
                          : "Run START-OFFICE.cmd or npm start in Pi Office. Keep your existing observer; no second one is needed."}
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {panelOpen && (
          <section
            className="detail-panel"
            role="region"
            aria-label={
              chosen
                ? `Details for ${chosen.agent.name}`
                : listing === "history"
                  ? "Agent history"
                  : "All current agents"
            }
          >
            <div className="panel-header">
              <button
                ref={panelCloseRef}
                className="icon-button panel-back"
                aria-label={
                  chosen && listing ? "Back to agents" : "Back to office"
                }
                onClick={closePanel}
              >
                <Icon name="back" />
              </button>
              <span>
                {chosen
                  ? "AT A GLANCE"
                  : listing === "history"
                    ? "AGENT HISTORY"
                    : "CURRENT AGENTS"}
              </span>
              <span className="read-only">read-only</span>
            </div>
            {chosen ? (
              <div className="resident-detail">
                <div className="detail-portrait">
                  <AgentPortrait
                    identity={chosen.key}
                    state={chosen.agent.state}
                    historical={chosen.historical}
                  />
                </div>
                <div className="detail-copy">
                  <div className="detail-name-row">
                    <h2 title={chosen.agent.name}>{chosen.agent.name}</h2>
                    <ResidentStatus resident={chosen} />
                  </div>
                  <p className="detail-task">
                    {chosen.agent.task || "No task has been reported yet."}
                  </p>
                  <dl className="detail-meta">
                    <div>
                      <dt>Project</dt>
                      <dd title={chosen.cwd}>{chosen.project}</dd>
                    </div>
                    <div>
                      <dt>Session</dt>
                      <dd title={chosen.agent.source?.sessionId}>
                        {chosen.session}
                      </dd>
                    </div>
                    {chosen.agent.tool && (
                      <div>
                        <dt>Tool</dt>
                        <dd>{chosen.agent.tool}</dd>
                      </div>
                    )}
                    {chosen.historical && (
                      <div>
                        <dt>Last state</dt>
                        <dd>{stateLabel(chosen.agent.state)}</dd>
                      </div>
                    )}
                  </dl>
                  {!isLive && (
                    <p className="detail-stale">
                      Last received snapshot. Live updates are unavailable.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="resident-list">
                {!listResidents.length && (
                  <p className="list-empty">
                    {listing === "history"
                      ? "No historical agents in this project."
                      : "No current agents in this project."}
                  </p>
                )}
                {listResidents.map((resident) => (
                  <button
                    key={resident.key}
                    className="resident-list-item"
                    onClick={(event) =>
                      openResident(resident, event.currentTarget)
                    }
                  >
                    <span
                      className={`list-avatar palette-${Math.abs(resident.key.length % 6)}`}
                      aria-hidden="true"
                    >
                      {resident.agent.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="list-person">
                      <strong>{resident.agent.name}</strong>
                      <span>
                        {resident.project} · {resident.session}
                      </span>
                    </span>
                    <ResidentStatus resident={resident} />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </section>

      <footer className="footer">
        <span
          className={`connection connection-${state.connection.status}`}
          role="status"
          title={
            state.connection.error ??
            (state.connection.lastSuccessAt
              ? `Last update: ${new Date(state.connection.lastSuccessAt).toLocaleTimeString()}`
              : "Waiting for the local bridge")
          }
        >
          <span className="connection-light" />
          {isLive
            ? "Live bridge"
            : state.connection.status === "connecting"
              ? "Connecting"
              : state.connection.status === "paused"
                ? "Paused"
                : "Bridge offline"}
        </span>
        <div className="footer-actions">
          {current.length > 8 && (
            <button
              className="text-button"
              onClick={(event) => openListing("current", event.currentTarget)}
              aria-label={`View all ${current.length} current agents`}
            >
              +{current.length - 8} more
            </button>
          )}
          {history.length > 0 && (
            <button
              className="text-button history-button"
              onClick={(event) => openListing("history", event.currentTarget)}
            >
              <Icon name="history" />
              {history.length} history
            </button>
          )}
          <button
            className="icon-button size-button"
            aria-label="Use roomy window"
            title="Roomy window"
            onClick={() => run("roomy")}
          >
            <Icon name="expand" />
          </button>
        </div>
      </footer>
      {(commandError || notice) && (
        <div className="notice" role="status">
          <span>{commandError || notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notice"
            onClick={() => {
              dismissError();
              setNotice(null);
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </main>
  );
}
