import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { App } from "../src/App";
import { AgentPortrait } from "../src/AgentPortrait";
import { initialState } from "../src/useCompanion";
import type { CompanionState } from "../src/types";
import type { Agent } from "../../src/types";

// Independent regression audit. DOM/CSS contracts are testable here; jsdom does
// not animate or rasterize SVG, so this suite is not a native visual/CPU test.
const agent = (id: string, state = "working"): Agent => ({
  id,
  name: id,
  state,
  task: `Build ${id}`,
});
const snapshot = (agents: Agent[], revision = 1): CompanionState => ({
  ...initialState,
  connection: { status: "live", lastSuccessAt: revision, error: null },
  snapshot: {
    revision,
    updatedAt: revision,
    sessions: [
      {
        id: "garden",
        name: "Garden session",
        cwd: "/projects/garden",
        connectionState: "live",
        agents,
      },
    ],
  },
});
let current: CompanionState;
let listeners: Set<(state: CompanionState) => void>;
function push(next: CompanionState) {
  current = next;
  act(() => listeners.forEach((listener) => listener(next)));
}
async function show() {
  const rendered = render(<App />);
  await screen.findByLabelText("Current agents");
  return rendered;
}
function portraitFor(name: string) {
  return screen
    .getByRole("button", { name: new RegExp(`^${name},`) })
    .querySelector<SVGSVGElement>(".resident-art")!;
}
function rulesOf(sheet: CSSStyleSheet, media?: string): CSSStyleRule[] {
  const result: CSSStyleRule[] = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type === CSSRule.STYLE_RULE && !media)
      result.push(rule as CSSStyleRule);
    if (
      rule.type === CSSRule.MEDIA_RULE &&
      media &&
      (rule as CSSMediaRule).conditionText === media
    ) {
      result.push(
        ...(Array.from((rule as CSSMediaRule).cssRules).filter(
          (nested) => nested.type === CSSRule.STYLE_RULE,
        ) as CSSStyleRule[]),
      );
    }
  }
  return result;
}
function matchingValue(element: Element, rules: CSSStyleRule[], name: string) {
  let value = "";
  for (const rule of rules) {
    if (
      rule.selectorText.split(",").some((selector) => {
        // Pseudo-elements have no DOM nodes. Their companion element selectors
        // are checked separately in the relevant pause/reduced-motion assertions.
        return !selector.includes("::") && element.matches(selector.trim());
      })
    )
      value = rule.style.getPropertyValue(name) || value;
  }
  return value;
}
function loadStyles() {
  const node = document.createElement("style");
  node.textContent = readFileSync("src/styles.css", "utf8");
  document.head.appendChild(node);
  return { node, sheet: node.sheet! };
}

beforeEach(() => {
  current = snapshot([agent("Ada"), agent("Theo", "thinking")]);
  listeners = new Set();
  window.companion = {
    getState: async () => current,
    onState: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    command: vi.fn(async () => undefined),
  };
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style").forEach((node) => node.remove());
  delete window.companion;
  vi.restoreAllMocks();
});

describe("independent motion lifecycle audit", () => {
  it("keeps SVG nodes and animation classes untouched across fresh, unchanged-state snapshots", async () => {
    await show();
    const svg = portraitFor("Ada");
    const original = [svg, ...svg.querySelectorAll("*")];
    const classes = original.map((node) => node.getAttribute("class"));
    const observer = new MutationObserver(() => {});
    observer.observe(svg, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
    try {
      for (let revision = 2; revision < 6; revision++) {
        push(
          snapshot(
            [
              {
                ...agent("Ada"),
                task: `New task text ${revision}`,
                updatedAt: revision,
              },
              agent("Theo", "thinking"),
            ],
            revision,
          ),
        );
        expect(portraitFor("Ada")).toBe(svg);
        expect(
          [svg, ...svg.querySelectorAll("*")].every(
            (node, index) => node === original[index],
          ),
        ).toBe(true);
        expect(svg.querySelectorAll("*")).toHaveLength(original.length - 1);
        expect(original.map((node) => node.getAttribute("class"))).toEqual(
          classes,
        );
        expect(observer.takeRecords()).toHaveLength(0);
      }
    } finally {
      observer.disconnect();
    }
  });

  it("retains keyed portraits and phase classes when another resident enters or leaves", async () => {
    await show();
    const ada = portraitFor("Ada");
    const theo = portraitFor("Theo");
    const before = [ada.getAttribute("class"), theo.getAttribute("class")];
    push(
      snapshot(
        [agent("Aaron", "idle"), agent("Theo", "thinking"), agent("Ada")],
        2,
      ),
    );
    expect(portraitFor("Ada")).toBe(ada);
    expect(portraitFor("Theo")).toBe(theo);
    expect([ada.getAttribute("class"), theo.getAttribute("class")]).toEqual(
      before,
    );
    push(snapshot([agent("Ada"), agent("Theo", "thinking")], 3));
    expect(portraitFor("Ada")).toBe(ada);
    expect(portraitFor("Theo")).toBe(theo);
  });

  it("changes only the activity class when the same resident changes state", async () => {
    await show();
    const svg = portraitFor("Ada");
    const original = [...svg.querySelectorAll("*")];
    const palette = [...svg.classList].find((name) =>
      name.startsWith("palette-"),
    );
    for (const [state, expected] of [
      ["idle", "idle"],
      ["thinking", "thinking"],
      ["waiting", "waiting"],
      ["error", "error"],
      ["completed", "resting"],
      ["done", "resting"],
      ["stale", "static"],
      ["not-a-real-state", "static"],
      ["working", "working"],
    ]) {
      push(snapshot([agent("Ada", state), agent("Theo", "thinking")]));
      expect(portraitFor("Ada")).toBe(svg);
      expect(
        [...svg.querySelectorAll("*")].every(
          (node, index) => node === original[index],
        ),
      ).toBe(true);
      expect(svg.querySelectorAll("*")).toHaveLength(original.length);
      expect(svg.classList.contains(`activity-${expected}`)).toBe(true);
      expect(svg.classList.contains(palette!)).toBe(true);
    }
  });

  it("freezes a selected last-known portrait on disconnect, pause, or minimize state", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: /^Ada,/ }));
    const svg = document.querySelector(".detail-portrait .resident-art")!;
    for (const next of [
      {
        ...current,
        connection: { ...current.connection, status: "offline" as const },
      },
      {
        ...current,
        connection: { ...current.connection, status: "connecting" as const },
      },
      { ...current, visible: false },
      {
        ...current,
        visible: false,
        connection: { ...current.connection, status: "paused" as const },
      },
    ]) {
      push(next);
      expect(document.querySelector(".detail-portrait .resident-art")).toBe(
        svg,
      );
      expect(svg.closest(".companion.is-paused")).toBeTruthy();
    }
    push(snapshot([agent("Ada"), agent("Theo", "thinking")], 9));
    expect(document.querySelector(".detail-portrait .resident-art")).toBe(svg);
    expect(svg.closest(".companion.is-paused")).toBeNull();
  });

  it("pauses and resumes existing nodes on document visibility changes", async () => {
    await show();
    const svg = portraitFor("Ada");
    const hidden = vi.spyOn(document, "hidden", "get");
    hidden.mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(svg.closest(".companion.is-paused")).toBeTruthy();
    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    expect(portraitFor("Ada")).toBe(svg);
    expect(svg.closest(".companion.is-paused")).toBeNull();
  });

  it("makes a stopped selected worker static without removing its inspectable history", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: /^Ada,/ }));
    const svg = document.querySelector(".detail-portrait .resident-art")!;
    push(
      snapshot([
        {
          ...agent("Ada"),
          lifecycle: {
            version: 1,
            eventId: "stop",
            kind: "stop",
            source: "pi:session_shutdown",
            at: "2026-10-12",
          },
        },
      ]),
    );
    expect(document.querySelector(".detail-portrait .resident-art")).toBe(svg);
    expect(svg.classList.contains("activity-static")).toBe(true);
    expect(screen.getByText("Historical")).toBeTruthy();
    expect(screen.getByText("Build Ada")).toBeTruthy();
    push(snapshot([agent("Ada", "offline")]));
    expect(svg.classList.contains("activity-static")).toBe(true);
    expect(screen.getByText("Historical")).toBeTruthy();
  });

  it("keeps visible attention markers for waiting and error with reduced motion", async () => {
    current = snapshot([agent("Waiting", "waiting"), agent("Error", "error")]);
    await show();
    const { sheet } = loadStyles();
    const reduced = rulesOf(sheet, "(prefers-reduced-motion: reduce)");
    const bubbles = [...document.querySelectorAll(".attention-bubble")];
    expect(bubbles).toHaveLength(2);
    expect(bubbles.every((node) => node.textContent?.trim())).toBe(true);
    for (const bubble of bubbles) {
      expect(matchingValue(bubble, reduced, "display")).not.toBe("none");
      expect(matchingValue(bubble, reduced, "animation")).toBe("none");
    }
  });
});

describe("independent CSS and resource audit", () => {
  it("pauses every animated SVG descendant with important CSS and disables motion for reduced-motion users", () => {
    const { container } = render(
      <main className="companion is-paused">
        <AgentPortrait identity="audit" state="working" />
        <AgentPortrait identity="audit-thinking" state="thinking" />
        <AgentPortrait identity="audit-idle" state="idle" />
        <AgentPortrait identity="audit-waiting" state="waiting" />
        <AgentPortrait identity="audit-error" state="error" />
      </main>,
    );
    const { sheet } = loadStyles();
    const rules = rulesOf(sheet);
    const reduced = rulesOf(sheet, "(prefers-reduced-motion: reduce)");
    const animated = [...container.querySelectorAll("svg *")].filter((node) =>
      /\d(?:m?s)\b/.test(matchingValue(node, rules, "animation")),
    );
    expect(animated.length).toBeGreaterThan(4);
    for (const node of animated) {
      expect(matchingValue(node, rules, "animation-play-state")).toBe("paused");
      expect(matchingValue(node, reduced, "animation")).toBe("none");
      expect(matchingValue(node, reduced, "transition")).toBe("none");
    }
    const pause = rules.filter(
      (rule) =>
        rule.style.getPropertyValue("animation-play-state") === "paused",
    );
    expect(
      pause.some(
        (rule) =>
          rule.style.getPropertyPriority("animation-play-state") ===
          "important",
      ),
    ).toBe(true);
    const disabled = reduced.filter(
      (rule) => rule.style.getPropertyValue("animation") === "none",
    );
    expect(
      disabled.some(
        (rule) => rule.style.getPropertyPriority("animation") === "important",
      ),
    ).toBe(true);
  });

  it("draws both animated typing hands over the keyboard but behind the opaque lid, with finger detail", () => {
    const { container } = render(
      <AgentPortrait identity="audit" state="working" />,
    );
    const { sheet } = loadStyles();
    const rules = rulesOf(sheet);
    const laptop = container.querySelector(".laptop")!;
    const deck = container.querySelector(".laptop-deck")!;
    for (const side of ["left", "right"]) {
      const hand = container.querySelector(`.typing-hand-${side}`)!;
      const arm = container.querySelector(`.typing-arm-${side}`)!;
      expect(
        hand.compareDocumentPosition(laptop) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        arm.compareDocumentPosition(laptop) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        deck.compareDocumentPosition(hand) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(hand.querySelector(".skin")).toBeTruthy();
      expect(hand.querySelector(".finger-line")).toBeTruthy();
      expect(matchingValue(hand, rules, "display")).not.toBe("none");
      expect(matchingValue(hand, rules, "animation")).toMatch(
        /resident-type-hand/,
      );
      expect(matchingValue(arm, rules, "animation")).toMatch(
        /resident-type-arm/,
      );
    }
    expect(matchingValue(laptop, rules, "fill")).toMatch(/^#[\da-f]{6}$/i);
  });

  it("selects the chin, raised-hand, and temple poses without duplicate right arms", () => {
    const { container } = render(
      <>
        <AgentPortrait identity="thinking" state="thinking" />
        <AgentPortrait identity="waiting" state="waiting" />
        <AgentPortrait identity="error" state="error" />
      </>,
    );
    const { sheet } = loadStyles();
    const rules = rulesOf(sheet);
    for (const state of ["thinking", "waiting", "error"]) {
      const svg = container.querySelector(`.activity-${state}`)!;
      const gesture = svg.querySelector(`.${state}-arm`)!;
      expect(matchingValue(gesture, rules, "display")).toBe("inline");
      expect(matchingValue(gesture, rules, "animation")).toMatch(
        /resident-(?:chin|request|temple) /,
      );
      for (const deskArm of svg.querySelectorAll(".desk-arm-right"))
        expect(matchingValue(deskArm, rules, "display")).toBe("none");
      for (const other of ["thinking", "waiting", "error"].filter(
        (name) => name !== state,
      ))
        expect(
          matchingValue(svg.querySelector(`.${other}-arm`)!, rules, "display"),
        ).toBe("none");
    }
  });

  it("gives idle and finished residents only low-frequency breathing and blinking", () => {
    const { container } = render(
      <>
        <AgentPortrait identity="idle" state="idle" />
        <AgentPortrait identity="completed" state="completed" />
      </>,
    );
    const { sheet } = loadStyles();
    const rules = rulesOf(sheet);
    for (const svg of container.querySelectorAll("svg")) {
      const animated = [...svg.querySelectorAll("*")]
        .map((node) => matchingValue(node, rules, "animation"))
        .filter((value) => value && value !== "none");
      expect(animated).toHaveLength(2);
      for (const animation of animated) {
        expect(animation).toMatch(/^resident-(?:breathe|blink) /);
        expect(
          Number(animation.match(/ ([\d.]+)s\b/)?.[1]),
        ).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("never animates stale, offline, unknown, or historical data", () => {
    const { container } = render(
      <>
        {["stale", "offline", "constructor", "__proto__", "unexpected"].map(
          (state) => (
            <AgentPortrait key={state} identity={state} state={state} />
          ),
        )}
        <AgentPortrait identity="historical" state="working" historical />
      </>,
    );
    const { sheet } = loadStyles();
    const rules = rulesOf(sheet);
    for (const node of container.querySelectorAll("svg, svg *")) {
      expect(["", "none"]).toContain(matchingValue(node, rules, "animation"));
    }
  });

  it("limits all CSS keyframe work to transforms and opacity", () => {
    const { sheet } = loadStyles();
    const animations = Array.from(sheet.cssRules).filter(
      (rule) => rule.type === CSSRule.KEYFRAMES_RULE,
    ) as CSSKeyframesRule[];
    expect(animations.length).toBeGreaterThan(5);
    for (const animation of animations) {
      for (const frame of Array.from(animation.cssRules) as CSSKeyframeRule[]) {
        const properties = Array.from(
          { length: frame.style.length },
          (_, index) => frame.style[index],
        );
        expect(properties.length).toBeGreaterThan(0);
        for (const property of properties)
          expect(["transform", "opacity"]).toContain(property);
      }
    }
  });

  it("uses no renderer animation clock, timer loop, network fetch, canvas, or 3D runtime", () => {
    const source = readdirSync("src")
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => readFileSync(`src/${name}`, "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /\b(?:requestAnimationFrame|setInterval|setTimeout)\s*\(/,
    );
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/);
    expect(source).not.toMatch(
      /<canvas\b|\.getContext\s*\(|from\s+["'][^"']*(?:three|pixi|phaser)/,
    );
    expect(source).not.toMatch(/\.(?:animate|setAttribute)\s*\(/);
    expect(readFileSync("index.html", "utf8")).toContain("style-src 'self'");
  });
});
