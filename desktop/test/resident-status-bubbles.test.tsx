import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AgentPortrait } from "../src/AgentPortrait";
import { residentStatus } from "../src/residentMotion";

const statuses = [
  ["working", "Working"],
  ["thinking", "Thinking"],
  ["waiting", "Needs input"],
  ["error", "Error"],
  ["idle", "Idle"],
  ["done", "Completed"],
  ["completed", "Completed"],
  ["offline", "Offline"],
  ["stale", "Last known"],
  ["unknown", "Unknown"],
  ["", "Unknown"],
  ["__proto__", "Unknown"],
  ["working activity-error", "Unknown"],
] as const;

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style").forEach((node) => node.remove());
});

describe("literal, bounded speech-bubble status", () => {
  it.each(statuses)(
    "labels %s as %s without invented dialogue",
    (state, label) => {
      const { container, rerender } = render(
        <AgentPortrait identity="status" state={state} />,
      );
      const svg = container.querySelector("svg")!;
      const bubble = svg.querySelector(".resident-status-bubble")!;
      const text = bubble.querySelector("text")!;
      expect(residentStatus(state)).toBe(label);
      expect(text.textContent).toBe(label);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(
        bubble.querySelectorAll("[role], [aria-label], [aria-live], title"),
      ).toHaveLength(0);
      if (label.length > 8) expect(text.getAttribute("textLength")).toBe("70");
      // Same nodes across disconnect/reconnect; neither transport loss nor history
      // gets a live action label or an animated activity class.
      rerender(
        <AgentPortrait identity="status" state={state} connected={false} />,
      );
      expect(svg.querySelector(".resident-status-bubble")).toBe(bubble);
      expect(text.textContent).toBe("Last known");
      expect(svg.classList.contains("activity-static")).toBe(true);
      rerender(<AgentPortrait identity="status" state={state} historical />);
      expect(text.textContent).toBe("Historical");
      expect(svg.classList.contains("activity-static")).toBe(true);
      rerender(
        <AgentPortrait
          identity="status"
          state={state}
          historical
          connected={false}
        />,
      );
      expect(text.textContent).toBe("Historical");
      rerender(<AgentPortrait identity="status" state={state} />);
      expect(text.textContent).toBe(label);
    },
  );

  it("keeps the surface, text box and speech tail within its own portrait", () => {
    const { container } = render(
      <AgentPortrait identity="bounds" state="waiting" />,
    );
    const svg = container.querySelector("svg")!;
    const [vx, vy, width, height] = svg
      .getAttribute("viewBox")!
      .split(" ")
      .map(Number);
    const rect = svg.querySelector(".resident-status-surface")!;
    const [x, y, w, h] = ["x", "y", "width", "height"].map((name) =>
      Number(rect.getAttribute(name)),
    );
    expect(x - 0.5).toBeGreaterThanOrEqual(vx);
    expect(x + w + 0.5).toBeLessThanOrEqual(vx + width);
    expect(y - 0.5).toBeGreaterThanOrEqual(vy);
    expect(y + h + 0.5).toBeLessThan(5);
    expect(4.5).toBeLessThan(vy + height); // tail's stroked tip
    expect(
      Number(svg.querySelector("text")!.getAttribute("textLength")),
    ).toBeLessThan(w - 10);
    // A full 8-resident compact dock has ~45px per portrait: the bubble's
    // bounded 70-unit label consumes only 37.5px, within that column.
    expect(70 * (45 / width)).toBeLessThan(40);
    expect(13 * (45 / width)).toBeGreaterThanOrEqual(6.9);
  });
});

describe("expressive motion contracts", () => {
  function styles() {
    const style = document.createElement("style");
    style.textContent = ["src/styles.css", "src/resident-animations.css"]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    document.head.appendChild(style);
    return Array.from(style.sheet!.cssRules);
  }
  it("retains absolute user-space pivots despite above-head viewBox padding", () => {
    const rules = styles().filter(
      (r) => r.type === CSSRule.STYLE_RULE,
    ) as CSSStyleRule[];
    // CSSWG #4662 explicitly keeps view-box's reference origin at user (0,0),
    // not at min-x/min-y. Pixel pivots are unchanged by negative viewBox padding.
    // https://github.com/w3c/csswg-drafts/issues/4662
    for (const rule of rules) {
      const origin = rule.style.getPropertyValue("transform-origin");
      if (
        origin &&
        /resident|typing|thinking-arm|waiting-|error-arm|thought-bubbles/.test(
          rule.selectorText,
        )
      )
        expect(origin).toMatch(/^\d+(?:\.\d+)?px \d+(?:\.\d+)?px$/);
    }
    expect(
      rules
        .find((r) => r.selectorText === ".resident-art g")!
        .style.getPropertyValue("transform-box"),
    ).toBe("view-box");
  });
  it("provides clearly larger working, thinking, waiting and error pose changes", () => {
    const frames = new Map(
      styles()
        .filter((r) => r.type === CSSRule.KEYFRAMES_RULE)
        .map((r) => [(r as CSSKeyframesRule).name, r as CSSKeyframesRule]),
    );
    const travel = (name: string) => {
      const values = Array.from(frames.get(name)!.cssRules).flatMap((r) =>
        [
          ...(r as CSSKeyframeRule).style
            .getPropertyValue("transform")
            .matchAll(/rotate\((-?[\d.]+)deg\)/g),
        ].map((match) => Number(match[1])),
      );
      return Math.max(...values) - Math.min(...values);
    };
    expect(travel("resident-work-look")).toBeGreaterThanOrEqual(8);
    expect(travel("resident-type-arm-left-expressive")).toBeGreaterThanOrEqual(
      8,
    );
    expect(travel("resident-ponder-expressive")).toBeGreaterThanOrEqual(10);
    expect(travel("resident-chin-expressive")).toBeGreaterThanOrEqual(19);
    expect(travel("resident-request-expressive")).toBeGreaterThanOrEqual(21);
    expect(travel("resident-request-palm-expressive")).toBeGreaterThanOrEqual(
      29,
    );
    expect(travel("resident-concern-expressive")).toBeGreaterThanOrEqual(12);
  });
  it("leaves captions and furniture stationary and preserves transform/opacity-only keyframes", () => {
    const rules = styles();
    for (const rule of rules) {
      if (rule.type === CSSRule.STYLE_RULE) {
        const style = rule as CSSStyleRule;
        if (/resident-status|laptop|desk\b|chair\b/.test(style.selectorText))
          expect(style.style.getPropertyValue("animation")).toBe("");
      }
      if (rule.type === CSSRule.KEYFRAMES_RULE)
        for (const frame of Array.from(
          (rule as CSSKeyframesRule).cssRules,
        ) as CSSKeyframeRule[])
          for (let i = 0; i < frame.style.length; i++)
            expect(["transform", "opacity"]).toContain(frame.style[i]);
    }
    expect(readFileSync("src/resident-animations.css", "utf8")).toContain(
      ".resident-art.activity-static *",
    );
    expect(readFileSync("src/resident-animations.css", "utf8")).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
  });
});
