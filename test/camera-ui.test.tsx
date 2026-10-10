import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "../src/types";
const capture = vi.hoisted(() => ({
  props: {} as any,
  sessions: [] as Session[],
}));
vi.mock("../src/Office", () => ({
  default: (props: any) => {
    capture.props = props;
    return <canvas data-testid="office-canvas" />;
  },
}));
vi.mock("../src/useOfficeData", () => ({
  useOfficeData: () => ({
    snapshot: { sessions: capture.sessions, updatedAt: 0 },
    connection: "connected",
  }),
}));
import App from "../src/App";
beforeEach(() => {
  capture.sessions = [];
});
afterEach(cleanup);
async function chooseNova() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Explore demo", exact: true }),
  );
  await user.click(screen.getByRole("button", { name: "Open agent roster" }));
  await user.click(screen.getByRole("button", { name: /Nova/ }));
  return user;
}

describe("camera controls UI", () => {
  it("distinguishes a one-time Focus from Follow and uses fresh repeatable commands", async () => {
    render(<App />);
    const user = await chooseNova();
    const taskStates = capture.props.sessions.flatMap((s: Session) =>
      s.agents.map((a) => a.state),
    );
    await user.click(
      screen.getByRole("button", { name: "Focus", exact: true }),
    );
    const first = capture.props.cameraAction;
    expect(first.type).toBe("focus");
    expect(first.id).toBe("web-ui");
    expect(capture.props.follow).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Focus", exact: true }),
    );
    expect(capture.props.cameraAction.serial).toBeGreaterThan(first.serial);
    await user.click(
      screen.getByRole("button", { name: "Follow", exact: true }),
    );
    expect(capture.props.follow).toBe("web-ui");
    expect(
      screen
        .getByRole("button", { name: "Unfollow" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(
      screen.getByRole("button", { name: "Zoom in", exact: true }),
    );
    expect(capture.props.follow).toBeNull();
    expect(capture.props.cameraAction.type).toBe("zoom-in");
    await user.click(
      screen.getByRole("button", { name: "Zoom out", exact: true }),
    );
    expect(capture.props.cameraAction.type).toBe("zoom-out");
    expect(
      capture.props.sessions.flatMap((s: Session) =>
        s.agents.map((a) => a.state),
      ),
    ).toEqual(taskStates);
    expect(capture.props.command).toBeNull();
  });
  it("deliberate data and room changes reset framing; selection alone does not", async () => {
    render(<App />);
    const user = userEvent.setup();
    const initialReset = capture.props.reset;
    await user.click(
      screen.getByRole("button", { name: "Explore demo", exact: true }),
    );
    expect(capture.props.reset).toBeGreaterThan(initialReset);
    const demoReset = capture.props.reset;
    await user.click(screen.getByRole("button", { name: "Open agent roster" }));
    await user.click(screen.getByRole("button", { name: /Nova/ }));
    expect(capture.props.reset).toBe(demoReset);
    await user.click(
      screen.getByRole("button", { name: "Choose session room" }),
    );
    await user.click(screen.getByRole("option", { name: /API migration/ }));
    expect(capture.props.reset).toBeGreaterThan(demoReset);
    const roomReset = capture.props.reset;
    await user.click(
      screen.getByRole("button", { name: "Choose session room" }),
    );
    await user.click(screen.getByRole("option", { name: /Whole office/ }));
    expect(capture.props.reset).toBeGreaterThan(roomReset);
    const allReset = capture.props.reset;
    await user.click(screen.getByRole("button", { name: "Reset camera" }));
    expect(capture.props.reset).toBe(allReset + 1);
  });
  it("preserves framing on incoming live snapshots and clears removed selections", async () => {
    capture.sessions = [
      {
        id: "work",
        name: "Work",
        agents: [{ id: "live-agent", name: "Aster", state: "working" }],
      },
    ];
    const mounted = render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open agent roster" }));
    await user.click(screen.getByRole("button", { name: /Aster/ }));
    await user.click(
      screen.getByRole("button", { name: "Follow", exact: true }),
    );
    const before = capture.props.reset;
    capture.sessions = [
      ...capture.sessions,
      { id: "new", name: "New project", agents: [] },
    ];
    mounted.rerender(<App />);
    expect(capture.props.reset).toBe(before);
    expect(capture.props.follow).toBe("live-agent");
    capture.sessions = [{ id: "new", name: "New project", agents: [] }];
    mounted.rerender(<App />);
    expect(capture.props.reset).toBe(before);
    expect(capture.props.follow).toBeNull();
    expect(screen.queryByRole("region", { name: "Selected agent" })).toBeNull();
  });
  it("keeps zoom and fit discoverable and explains scoped keyboard plus touch controls", async () => {
    render(<App />);
    expect(screen.getByRole("group", { name: "Camera controls" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(document.getElementById("camera-instructions")?.textContent).toMatch(
      /Click or Tab/,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open guide" }));
    expect(screen.getByText("Two-finger drag · Pan")).toBeTruthy();
    expect(screen.getByText("Home · Fit office")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open guide" })).toBe(
      document.activeElement,
    );
  });
});
