import { Html } from "@react-three/drei";
import { useEffect, useId, useState, useRef } from "react";
import type { Agent } from "./types";
import { activityLine, freshness, presentation } from "./agentPresentation";
import { stateColor } from "./state";
export default function AgentBubble({
  agent,
  selected,
  hovered,
  mode,
  onSelect,
  onHover,
  visual,
  reduced = false,
  placement = "above",
  alignment = "center",
}: {
  agent: Agent;
  selected: boolean;
  hovered: boolean;
  mode: "hidden" | "dot" | "compact" | "detail";
  onSelect: () => void;
  onHover: (value: boolean) => void;
  visual?: string;
  reduced?: boolean;
  placement?: "above" | "below";
  alignment?: "left" | "center" | "right";
}) {
  const [focused, setFocused] = useState(false),
    [inside, setInside] = useState(false),
    [dismissed, setDismissed] = useState(false),
    [now, setNow] = useState(Date.now());
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const info = presentation(agent);
  const expanded = (hovered || focused || inside) && !dismissed;
  useEffect(() => {
    if (hovered || focused || inside) setDismissed(false);
  }, [hovered, focused, inside]);
  useEffect(() => {
    if (!expanded) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      setFocused(false);
      setInside(false);
      setDismissed(true);
      onHover(false);
      if (root.current?.contains(document.activeElement))
        (document.activeElement as HTMLElement)?.blur();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded, onHover]);
  if (mode === "hidden" && !selected && !focused) return null;
  const dot = mode === "dot" && !selected && !expanded;
  return (
    <Html
      center
      position={[0, 1.92, 0]}
      zIndexRange={expanded || selected ? [24, 20] : [12, 3]}
      style={{ pointerEvents: "auto" }}
    >
      <div
        ref={root}
        className={`agent-bubble ${selected ? "selected" : ""} ${dot ? "is-dot" : ""} ${reduced ? "reduced" : ""} tooltip-${placement} align-${alignment}`}
        style={
          { "--state-color": stateColor(agent.state) } as React.CSSProperties
        }
        onPointerEnter={() => {
          setInside(true);
          onHover(true);
        }}
        onPointerLeave={() => {
          setInside(false);
          onHover(false);
        }}
      >
        <button
          className="bubble-trigger"
          aria-label={`${agent.name}: ${info.label}. Show agent details`}
          aria-describedby={expanded ? id : undefined}
          onFocus={() => {
            setFocused(true);
            onHover(true);
          }}
          onBlur={() => {
            setFocused(false);
            onHover(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setDismissed(true);
              setFocused(false);
              setInside(false);
              onHover(false);
              e.currentTarget.blur();
            }
          }}
        >
          <span
            className={`bubble-status state-${agent.state}`}
            aria-hidden="true"
          >
            {info.symbol}
          </span>
          {!dot && (
            <span className="bubble-copy">
              <strong>
                {agent.name}
                <small>{info.label}</small>
              </strong>
              <span>{visual ? `${visual} · visual` : activityLine(agent)}</span>
            </span>
          )}
        </button>
        {expanded && (
          <div className="bubble-tooltip" role="tooltip" id={id}>
            <div className="bubble-tooltip-heading">
              <strong>{agent.name}</strong>
              <span>{info.label}</span>
            </div>
            <p>{agent.task?.trim() || "No task reported"}</p>
            <dl>
              <div>
                <dt>Tool</dt>
                <dd>{agent.tool?.trim() || "No active tool"}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{agent.model?.trim() || "Not reported"}</dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>{freshness(agent.updatedAt, now)}</dd>
              </div>
            </dl>
            {visual && (
              <div className="bubble-visual">{visual} · animation only</div>
            )}
            <div className="bubble-tooltip-foot">
              Click to inspect · Esc to dismiss
            </div>
          </div>
        )}
      </div>
    </Html>
  );
}
