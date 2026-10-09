import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const world = vi.hoisted(() => ({ props: {} as any }));
vi.mock("../src/Office", () => ({
  default: (props: any) => {
    world.props = props;
    return <div data-testid="scene-placeholder" />;
  },
}));
import App from "../src/App";
class FakeEvents {
  static current: FakeEvents;
  listeners: Record<string, Function> = {};
  onopen?: () => void;
  onerror?: () => void;
  constructor() {
    FakeEvents.current = this;
  }
  addEventListener(n: string, f: Function) {
    this.listeners[n] = f;
  }
  close() {}
  publish(data: unknown) {
    this.listeners.snapshot?.({ data: JSON.stringify(data) });
  }
}
beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEvents);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ sessions: [], updatedAt: Date.now() }),
      }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function demoAndSelect(name = "Nova") {
  const u = userEvent.setup();
  await u.click(
    screen.getByRole("button", { name: "Explore demo", exact: true }),
  );
  await u.click(screen.getByRole("button", { name: "Open agent roster" }));
  await u.click(screen.getByRole("button", { name: new RegExp(name) }));
  return u;
}
describe("immersive office controls with WebGL mocked", () => {
  it("starts uncluttered; keeps demo and live distinct", async () => {
    const u = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText("LOCAL · LIVE")).toBeTruthy());
    expect(screen.queryByText("Your agents")).toBeNull();
    expect(screen.queryByText("AGENT DETAILS")).toBeNull();
    await demoAndSelect();
    expect(screen.getByRole("region", { name: "Selected agent" })).toBeTruthy();
    expect(screen.queryByText("AGENT DETAILS")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Live", exact: true }));
    expect(screen.queryByRole("region", { name: "Selected agent" })).toBeNull();
    expect(world.props.sessions).toHaveLength(0);
  });
  it("repeated inspect/activity/dismiss and roster search work", async () => {
    render(<App />);
    const u = await demoAndSelect();
    for (let i = 0; i < 3; i++) {
      await u.click(screen.getByRole("button", { name: "Inspect" }));
      expect(screen.getByText("AGENT DETAILS")).toBeTruthy();
      await u.click(screen.getByRole("button", { name: /Activity 3/ }));
      expect(
        screen.getByText("Observing edit · src/settings.tsx"),
      ).toBeTruthy();
      await u.click(
        screen.getByRole("button", { name: "Close agent details" }),
      );
    }
    await u.click(screen.getByRole("button", { name: "Open agent roster" }));
    await u.type(
      screen.getByRole("textbox", { name: "Search agents" }),
      "nomatch",
    );
    expect(screen.getByText("No matching agents.")).toBeTruthy();
    await u.clear(screen.getByRole("textbox", { name: "Search agents" }));
    await u.click(screen.getByRole("button", { name: /Atlas/ }));
    expect(screen.getByRole("button", { name: "Inspect" })).toBeTruthy();
  });
  it("visual commands preserve real task state, follow cancels and rooms switch", async () => {
    render(<App />);
    const u = await demoAndSelect();
    const original = world.props.sessions[0].agents[1].state;
    await u.click(screen.getByRole("button", { name: "Wave" }));
    expect(world.props.command.type).toBe("wave");
    await u.click(screen.getByRole("button", { name: "Take a walk" }));
    expect(world.props.command.type).toBe("walk");
    expect(world.props.sessions[0].agents[1].state).toBe(original);
    await u.click(screen.getByRole("button", { name: "Follow", exact: true }));
    expect(world.props.follow).toBe("web-ui");
    await u.keyboard("{Escape}");
    expect(world.props.follow).toBeNull();
    await u.click(screen.getByRole("button", { name: "Return agent to desk" }));
    expect(world.props.command.type).toBe("return");
    await u.selectOptions(
      screen.getByRole("combobox", { name: "Choose session room" }),
      "demo-api",
    );
    expect(world.props.sessions).toHaveLength(1);
    expect(world.props.sessions[0].id).toBe("demo-api");
    expect(screen.queryByRole("region", { name: "Selected agent" })).toBeNull();
  });
  it("guide can be interrupted repeatedly and selection closes with Escape", async () => {
    const u = userEvent.setup();
    render(<App />);
    for (let i = 0; i < 3; i++) {
      await u.click(screen.getByRole("button", { name: "Open guide" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
      await u.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    await demoAndSelect();
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Selected agent" })).toBeNull();
  });
  it("live events retain unavailable metrics and show bridge loss", async () => {
    render(<App />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByText("LOCAL · LIVE")).toBeTruthy());
    act(() =>
      FakeEvents.current.publish({
        sessions: [
          {
            id: "s",
            name: "Test room",
            agents: [
              {
                id: "s:main",
                name: "Live agent",
                state: "working",
                task: "Synthetic task",
                logs: [],
              },
            ],
          },
        ],
        updatedAt: Date.now(),
      }),
    );
    await u.click(screen.getByRole("button", { name: "Open agent roster" }));
    await u.click(screen.getByRole("button", { name: /Live agent/ }));
    await u.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getAllByText("Not reported").length).toBeGreaterThanOrEqual(
      4,
    );
    act(() => FakeEvents.current.onerror?.());
    expect(screen.getByText("OFFLINE")).toBeTruthy();
  });
});
