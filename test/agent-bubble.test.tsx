import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const captured = vi.hoisted(() => ({ props: {} as any }));
vi.mock("@react-three/drei", () => ({
  Html: (props: any) => {
    captured.props = props;
    return <div>{props.children}</div>;
  },
}));
import AgentBubble from "../src/AgentBubble";
import {
  activityLine,
  bubbleMode,
  freshness,
  presentation,
} from "../src/agentPresentation";
const agent = {
  id: "a",
  name: "Nova",
  state: "working",
  task: "Review the settings flow",
  tool: "read",
  model: "example-model",
  updatedAt: Date.now(),
};
afterEach(cleanup);
describe("useful fixed-size agent bubbles", () => {
  it("shows reported activity and leaves camera scaling undefined", () => {
    render(
      <AgentBubble
        agent={agent}
        selected={false}
        hovered={false}
        mode="compact"
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    expect(screen.getByText("read")).toBeTruthy();
    expect(captured.props.distanceFactor).toBeUndefined();
    expect(captured.props.transform).toBeUndefined();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("hover and keyboard focus disclose task, tool, model and freshness; Escape dismisses", async () => {
    const u = userEvent.setup();
    render(
      <AgentBubble
        agent={agent}
        selected={false}
        hovered={false}
        mode="compact"
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    await u.tab();
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(screen.getByText(agent.task)).toBeTruthy();
    expect(screen.getByText(agent.model)).toBeTruthy();
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("outside click dismisses and repeat focus reopens", async () => {
    const u = userEvent.setup();
    render(
      <>
        <AgentBubble
          agent={agent}
          selected={false}
          hovered={false}
          mode="compact"
          onSelect={() => {}}
          onHover={() => {}}
        />
        <button>Outside</button>
      </>,
    );
    for (let i = 0; i < 3; i++) {
      await u.click(screen.getByRole("button", { name: /Nova: Working/ }));
      expect(screen.getByRole("tooltip")).toBeTruthy();
      await u.click(screen.getByText("Outside"));
      expect(screen.queryByRole("tooltip")).toBeNull();
    }
  });
  it("touch/click selects once; unavailable fields stay honest; visual action is marked", async () => {
    const u = userEvent.setup(),
      select = vi.fn();
    render(
      <AgentBubble
        agent={{ id: "x", name: "Pi", state: "idle" }}
        selected={false}
        hovered={true}
        mode="compact"
        onSelect={select}
        onHover={() => {}}
        visual="Taking a stroll"
      />,
    );
    expect(screen.getByText("No task reported")).toBeTruthy();
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
    expect(screen.getByText("Taking a stroll · animation only")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: /Pi: Idle/ }));
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("hides far/offscreen bubbles and uses small markers at overview distances", () => {
    expect(bubbleMode(60, false, true)).toBe("hidden");
    expect(bubbleMode(40, false, true)).toBe("dot");
    expect(bubbleMode(20, false, true)).toBe("compact");
    expect(bubbleMode(60, true, true)).toBe("detail");
    expect(bubbleMode(10, true, false)).toBe("hidden");
    render(
      <AgentBubble
        agent={agent}
        selected={false}
        hovered={false}
        mode="hidden"
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("never invents missing work or freshness and chooses distinct state clips", () => {
    expect(activityLine({ id: "x", name: "Pi", state: "idle" })).toBe(
      "No active work reported",
    );
    expect(freshness(undefined)).toBe("Not reported");
    expect(freshness("invalid")).toBe("Not reported");
    expect(freshness(1000, 62000)).toBe("1m ago");
    const clips = [
      "working",
      "thinking",
      "waiting",
      "idle",
      "error",
      "done",
      "offline",
    ].map((state) => presentation({ id: "a", name: "Pi", state }).clip);
    expect(new Set(clips).size).toBe(7);
    expect(activityLine({ ...agent, state: "offline" })).toBe(
      "No recent connection",
    );
  });
  it("reduced motion is exposed without hiding useful state", () => {
    const { container } = render(
      <AgentBubble
        agent={agent}
        selected={false}
        hovered={false}
        mode="compact"
        onSelect={() => {}}
        onHover={() => {}}
        reduced
      />,
    );
    expect(container.querySelector(".agent-bubble.reduced")).not.toBeNull();
    expect(screen.getByText("Working")).toBeTruthy();
  });
});
