import { paletteFor } from "./model";
import { residentActivity, residentStatus } from "./residentMotion";
import "./resident-animations.css";

/** Tiny articulated residents. Pose nodes stay mounted across bridge snapshots. */
export function AgentPortrait({
  identity,
  state,
  historical = false,
  connected = true,
}: {
  identity: string;
  state: string;
  historical?: boolean;
  connected?: boolean;
}) {
  const activity = residentActivity(state, historical || !connected);
  const status = residentStatus(state, historical, connected);
  return (
    <svg
      className={`resident-art palette-${paletteFor(identity)} activity-${activity}`}
      viewBox="0 -22 84 104"
      aria-hidden="true"
    >
      {/* Decorative duplicate of the accessible parent status. Never dialogue. */}
      <g className="resident-status-bubble">
        <path className="resident-status-tail" d="M37.5 0 L42 4 L46.5 0" />
        <rect
          className="resident-status-surface"
          x="1.5"
          y="-21"
          width="81"
          height="21"
          rx="7"
        />
        <text
          className="resident-status-text"
          x="42"
          y="-6"
          textAnchor="middle"
          textLength={status.length > 8 ? 70 : undefined}
          lengthAdjust="spacingAndGlyphs"
        >
          {status}
        </text>
      </g>
      <ellipse className="resident-shadow" cx="42" cy="74" rx="27" ry="4" />
      <path
        className="chair"
        d="M22 46 Q22 41 27 41 H58 Q63 41 63 46 V65 H22Z"
      />
      <path className="chair-line" d="M42 58 V75 M31 76 H53" />
      <g className="resident-body">
        <g className="resident-torso">
          <path
            className="shirt"
            d="M26 48 Q26 38 42 38 Q58 38 58 48 L61 64 H23Z"
          />
          <path className="shirt-shadow" d="M46 43 Q58 43 58 52 L60 65 H48Z" />
        </g>
        <g className="resident-head">
          <path
            className="hair-back"
            d="M24 25 Q24 8 42 8 Q59 8 60 27 L57 42 H26Z"
          />
          <rect className="skin" x="27" y="17" width="30" height="29" rx="13" />
          <path
            className="hair-front"
            d="M25 26 Q23 7 42 9 Q58 7 60 25 Q49 24 45 17 Q39 27 25 26Z"
          />
          <g className="resident-face">
            <g className="resident-eyes">
              <path className="face-line" d="M35 31 V33 M49 31 V33" />
            </g>
            <path className="smile resident-smile" d="M39 38 Q42 40 45 38" />
            <path className="smile resident-concern" d="M39 39 Q42 37 45 39" />
            <path
              className="smile resident-brows"
              d="M32 28 L36 29 M48 29 L52 28"
            />
            <ellipse className="cheek" cx="32" cy="36" rx="3" ry="1.5" />
            <ellipse className="cheek" cx="52" cy="36" rx="3" ry="1.5" />
          </g>
        </g>
      </g>
      <path className="desk-leg" d="M15 67 V76 M69 67 V76" />
      <rect className="desk" x="10" y="62" width="64" height="6" rx="3" />
      {/* The keyboard sits on the resident's side of the upright display. */}
      <path className="laptop-deck" d="M25.5 54 H58.5 L60.5 61 H23.5Z" />
      <path
        className="keyboard-lines"
        d="M26 55.5 H58 M25.5 57.5 H58.5 M25 59.5 H59 M27.5 55 V60 M56.5 55 V60"
      />
      <g className="typing-arm-left">
        <path className="arm arm-left" d="M28 49 Q18.5 54 25.5 57" />
      </g>
      <g className="typing-arm-right desk-arm-right">
        <path className="arm arm-right" d="M55 49 Q65.5 54 58.5 57" />
      </g>
      {/* Wrists meet the keyboard at its sides; the foreground lid masks travel. */}
      <g className="typing-hand-left">
        <ellipse className="skin" cx="28.5" cy="56.8" rx="4.2" ry="2.2" />
        <g className="typing-fingers-left">
          <path className="finger-line" d="M26.7 55.6 V57.3 M28.3 55.7 V57.4" />
        </g>
      </g>
      <g className="typing-hand-right desk-arm-right">
        <ellipse className="skin" cx="55.5" cy="56.8" rx="4.2" ry="2.2" />
        <g className="typing-fingers-right">
          <path className="finger-line" d="M55.7 55.7 V57.4 M57.3 55.6 V57.3" />
        </g>
      </g>
      {/* Every pose remains in the DOM; CSS selects only the current one. */}
      <g className="thinking-arm resident-gesture">
        <path className="arm" d="M56 49 Q65 51 60 44 L49 40" />
        <ellipse className="skin" cx="48" cy="39" rx="3.4" ry="2.8" />
        <path
          className="finger-line"
          d="M46.8 37.5 L47.5 39.2 M48.5 37.3 L49.2 39"
        />
      </g>
      <g className="waiting-arm resident-gesture">
        <path className="arm" d="M56 49 Q65 54 65 43 L65 34" />
        <g className="waiting-hand">
          <ellipse className="skin" cx="65" cy="30" rx="3.5" ry="4.8" />
          <path
            className="raised-fingers arm"
            d="M62.5 29 V25 M65 28 V23 M67.5 29 V25 M62 32 L59.5 29"
          />
        </g>
      </g>
      <g className="error-arm resident-gesture">
        <path className="arm" d="M56 49 Q65 50 60 39 L56 32" />
        <ellipse className="skin" cx="55.7" cy="31.2" rx="2.7" ry="3.4" />
        <path
          className="finger-line"
          d="M54.6 29.5 L55.1 31.3 M56.2 29.4 L56.7 31.2"
        />
      </g>
      {/* This opaque foreground surface occludes every hand/forearm pose. */}
      <g className="laptop-lid">
        <path
          className="laptop-edge"
          d="M30 61 L26 43 Q26 41 29 41 H55 Q58 41 58 44 L54 61Z"
        />
        <path className="laptop" d="M30 59 L27 44 H56 L53 59Z" />
        <g className="laptop-mark" aria-label="Apple logo">
          <path
            className="apple-body"
            d="M42 48.6 C40.8 48.6 40.2 47.9 39.1 48.1 C37.4 48.4 36.9 50.2 37.5 52 C37.9 53.4 38.8 55.1 39.8 55.1 C40.5 55.1 41 54.6 41.9 54.6 C42.8 54.6 43.2 55.1 44 55 C45 54.9 45.8 53.5 46.2 52.5 C44.2 51.8 43.9 49.5 45.9 48.5 C45.2 47.7 44.4 47.7 43.8 47.9 C43 48.1 42.6 48.6 42 48.6Z"
          />
          <path
            className="apple-leaf"
            d="M42 47.5 C41.8 46.1 42.9 44.9 44.3 44.7 C44.5 46.1 43.4 47.5 42 47.5Z"
          />
        </g>
        <path className="laptop-edge" d="M28 61 H56" />
      </g>
      <g className="thought-bubbles resident-gesture">
        <circle cx="68" cy="25" r="1.8" />
        <circle cx="73" cy="18" r="2.5" />
        <circle cx="76" cy="10" r="3.2" />
      </g>
    </svg>
  );
}
