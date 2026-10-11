import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "../src/types";
const scene = vi.hoisted(() => ({
  props: {} as any,
  sessions: [] as Session[],
}));
vi.mock("../src/Office", () => ({
  default: (props: any) => {
    scene.props = props;
    return (
      <button onClick={() => props.onFacility("meeting")}>
        Scene meeting sign
      </button>
    );
  },
}));
vi.mock("../src/useOfficeData", () => ({
  useOfficeData: () => ({
    snapshot: { sessions: scene.sessions, updatedAt: 0 },
    connection: "connected",
    lifecycleEvents: [],
    lifecycleEpoch: 0,
  }),
}));
import App from "../src/App";
import { isolatedOfficeId, visualAgentId } from "../src/projectProjection";
beforeEach(() => {
  scene.sessions = [];
});
afterEach(cleanup);
describe("workplace integration with scene mocked", () => {
  it("opens repeatedly from the toolbar and Escape preserves a selected/followed resident", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Explore demo", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: "Open agent roster" }));
    await user.click(screen.getByRole("button", { name: /Nova/ }));
    await user.click(
      screen.getByRole("button", { name: "Follow", exact: true }),
    );
    const opener = screen.getByRole("button", {
      name: "Open workplace overview",
    });
    for (let count = 0; count < 3; count++) {
      await user.click(opener);
      expect(screen.getByRole("dialog", { name: "Reception" })).toBeDefined();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(scene.props.selected).toBe("web-ui");
      expect(scene.props.follow).toBe("web-ui");
    }
  });
  it("scene signs reach project briefs and can focus a project outside the four-section overview", async () => {
    const user = userEvent.setup();
    scene.sessions = Array.from({ length: 6 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${index}`,
      agents: [
        { id: `agent-${index}`, name: `Agent ${index}`, state: "working" },
      ],
    }));
    render(<App />);
    expect(scene.props.sessions).toHaveLength(4);
    const reset = scene.props.reset;
    await user.click(
      screen.getByRole("button", { name: "Scene meeting sign" }),
    );
    expect(screen.getByRole("dialog", { name: "Meeting room" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Focus Project 5" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scene.props.sessions).toHaveLength(1);
    expect(scene.props.sessions[0].id).toBe(isolatedOfficeId("project-5"));
    expect(scene.props.reset).toBeGreaterThan(reset);
    await user.click(
      screen.getByRole("button", { name: "Open workplace overview" }),
    );
    await user.click(screen.getByRole("button", { name: /Break room/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Resident" }),
      visualAgentId("project-0", "agent-0"),
    );
    await user.click(screen.getByRole("button", { name: "Take a break" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scene.props.selected).toBe(visualAgentId("project-0", "agent-0"));
    expect(scene.props.sessions[0].id).toBe(isolatedOfficeId("project-0"));
    expect(scene.props.command).toMatchObject({
      id: visualAgentId("project-0", "agent-0"),
      type: "walk",
    });
    expect(
      scene.sessions.every((session) => session.agents[0].state === "working"),
    ).toBe(true);
  });
  it("operations selects the real resident and reception opens the existing roster", async () => {
    const user = userEvent.setup();
    scene.sessions = [
      {
        id: "one",
        name: "Delivery",
        agents: [
          {
            id: "a",
            name: "Aster",
            state: "error",
            logs: [{ time: 1000, level: "error", message: "Reported issue" }],
          },
        ],
      },
    ];
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Open workplace overview" }),
    );
    await user.click(screen.getByRole("button", { name: /Operations/ }));
    await user.click(
      screen.getByRole("button", { name: "Inspect Aster · Delivery" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scene.props.selected).toBe(visualAgentId("one", "a"));
    expect(
      screen.getByRole("region", { name: "Selected agent" }),
    ).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Open workplace overview" }),
    );
    await user.click(screen.getByRole("button", { name: "Browse agents" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search agents" }),
    ).toBeDefined();
  });
});
