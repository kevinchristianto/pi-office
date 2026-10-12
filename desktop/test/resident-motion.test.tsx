import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentPortrait } from "../src/AgentPortrait";
import { paletteFor } from "../src/model";
import { residentActivity } from "../src/residentMotion";

afterEach(cleanup);

const bridgeActivities = [
  ["working", "working"],
  ["thinking", "thinking"],
  ["idle", "idle"],
  ["waiting", "waiting"],
  ["error", "error"],
  ["done", "resting"],
  ["completed", "resting"],
  ["offline", "static"],
  ["stale", "static"],
  ["unknown", "static"],
  ["", "static"],
  ["constructor", "static"],
  ["__proto__", "static"],
  ["toString", "static"],
] as const;

describe("pure resident activity projection", () => {
  it.each(bridgeActivities)("maps bridge state %s to %s", (state, activity) => {
    expect(residentActivity(state)).toBe(activity);
    expect(residentActivity(state, false)).toBe(activity);
  });

  it.each(bridgeActivities)("historical %s is always static", (state) => {
    expect(residentActivity(state, true)).toBe("static");
  });

  it("is deterministic and does not interpret unknown text as a CSS class", () => {
    expect(residentActivity("working activity-error")).toBe("static");
    expect(residentActivity("WORKING")).toBe("static");
    expect(residentActivity(" waiting ")).toBe("static");
  });
});

describe("stable articulated portrait", () => {
  it("preserves the SVG and every pose node across repeated snapshots and state changes", () => {
    const props = {
      identity: 'directory:"/garden"/session:ada',
      state: "working",
    };
    const { container, rerender } = render(<AgentPortrait {...props} />);
    const root = container.querySelector("svg")!;
    const parts = [...root.querySelectorAll("*")];
    const classes = root.getAttribute("class");

    for (let i = 0; i < 5; i++) rerender(<AgentPortrait {...{ ...props }} />);
    expect(container.querySelector("svg")).toBe(root);
    expect(root.getAttribute("class")).toBe(classes);
    parts.forEach((part, index) =>
      expect(root.querySelectorAll("*")[index]).toBe(part),
    );

    for (const [state, activity] of bridgeActivities) {
      rerender(<AgentPortrait {...props} state={state} />);
      expect(container.querySelector("svg")).toBe(root);
      expect(root.classList.contains(`activity-${activity}`)).toBe(true);
      expect(
        root.classList.contains(`palette-${paletteFor(props.identity)}`),
      ).toBe(true);
      expect(root.querySelectorAll("*").length).toBe(parts.length);
      parts.forEach((part, index) =>
        expect(root.querySelectorAll("*")[index]).toBe(part),
      );
    }

    rerender(<AgentPortrait {...props} historical />);
    expect(root.classList.contains("activity-static")).toBe(true);
    parts.forEach((part, index) =>
      expect(root.querySelectorAll("*")[index]).toBe(part),
    );
  });

  it("contains separately articulated face, shoulders, arms, fingers and state gestures", () => {
    const { container } = render(
      <AgentPortrait identity="Ada" state="working" />,
    );
    for (const name of [
      "resident-torso",
      "resident-head",
      "resident-eyes",
      "resident-smile",
      "resident-concern",
      "resident-brows",
      "typing-arm-left",
      "typing-arm-right",
      "typing-hand-left",
      "typing-hand-right",
      "typing-fingers-left",
      "typing-fingers-right",
      "thinking-arm",
      "waiting-arm",
      "waiting-hand",
      "error-arm",
      "thought-bubbles",
    ])
      expect(container.querySelectorAll(`.${name}`)).toHaveLength(1);
    expect(container.querySelectorAll(".thought-bubbles circle")).toHaveLength(
      3,
    );
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("occludes every moving hand and forearm with the foreground laptop lid", () => {
    const { container } = render(
      <AgentPortrait identity="Ada" state="working" />,
    );
    const lid = container.querySelector(".laptop-lid")!;
    const deck = container.querySelector(".laptop-deck")!;
    for (const name of [
      "typing-arm-left",
      "typing-arm-right",
      "typing-hand-left",
      "typing-hand-right",
      "thinking-arm",
      "waiting-arm",
      "error-arm",
    ]) {
      const part = container.querySelector(`.${name}`)!;
      expect(
        deck.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        part.compareDocumentPosition(lid) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(lid.contains(container.querySelector(".laptop"))).toBe(true);
    expect(lid.querySelectorAll(".apple-body, .apple-leaf")).toHaveLength(2);
    expect(container.querySelectorAll("clipPath, [id]")).toHaveLength(0);
  });
});
