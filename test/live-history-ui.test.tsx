import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentLifecycleMarker, Session } from "../src/types";
import { projectOffices, visualAgentId } from "../src/projectProjection";
import WorkplacePanel from "../src/WorkplacePanel";

const scene = vi.hoisted(() => ({ props: {} as any, lifecycle: {} as any }));
vi.mock("../src/Office", async () => {
  const { useResidentLifecycle } = await import("../src/useResidentLifecycle");
  return {
    default: (props: any) => {
      scene.props = props;
      scene.lifecycle = useResidentLifecycle({
        sessions: props.sessions,
        selected: props.selected,
        events: props.lifecycleEvents,
        epoch: props.lifecycleEpoch,
        enabled: props.lifecycleEnabled,
        reduced: false,
        connection: props.connection,
      });
      return <div data-testid="history-scene" />;
    },
  };
});
import App from "../src/App";

class FakeEvents {
  static current: FakeEvents;
  listeners: Record<string, (event: { data: string }) => void> = {};
  onopen?: () => void;
  onerror?: () => void;
  constructor() {
    FakeEvents.current = this;
  }
  addEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners[name] = listener;
  }
  close() {}
  publish(snapshot: unknown) {
    this.listeners.snapshot?.({ data: JSON.stringify(snapshot) });
  }
}
let revision = 0;
const person = (
  id: string,
  state = "working",
  extra: Partial<Agent> = {},
): Agent => ({
  id,
  name: id,
  state,
  task: `Task for ${id}`,
  ...extra,
});
const session = (
  id: string,
  agents: Agent[],
  extra: Partial<Session> = {},
): Session => ({
  id,
  name: id,
  cwd: "/work/shared",
  agents,
  ...extra,
});
const marker = (
  kind: "start" | "stop",
  eventId: string,
): AgentLifecycleMarker => ({
  version: 1,
  kind,
  eventId,
  source: "pi-subagents:child-status",
  at: new Date().toISOString(),
});
function publish(sessions: Session[]) {
  act(() =>
    FakeEvents.current.publish({
      streamId: "history-ui",
      revision: ++revision,
      sessions,
      updatedAt: Date.now(),
    }),
  );
}
async function open(sessions: Session[]) {
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("history-scene")).toBeTruthy());
  publish(sessions);
}
async function choose(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open agent roster" }));
  const roster = screen.getByText("CURRENT & HISTORY").closest("aside")!;
  await user.click(
    within(roster).getByRole("button", { name: new RegExp(name) }),
  );
  return user;
}
const residents = () => scene.lifecycle.residents as any[];
const isDisabled = (name: string) =>
  (screen.getByRole("button", { name, exact: true }) as HTMLButtonElement)
    .disabled;

beforeEach(() => {
  revision = 0;
  scene.props = {};
  scene.lifecycle = {};
  vi.stubGlobal("EventSource", FakeEvents);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [], updatedAt: Date.now() }),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("live office and inspectable history UI", () => {
  it("keeps offline and explicitly stopped initial observations inspectable without any desk or physical action", async () => {
    await open([
      session("offline-source", [person("Offline child", "working")], {
        connectionState: "offline",
      }),
      session("live-source", [
        person("Current child"),
        person("Stopped child", "idle", {
          lifecycle: marker("stop", "old-stop"),
        }),
      ]),
    ]);
    expect(residents().map((entry) => entry.agent.name)).toEqual([
      "Current child",
    ]);
    expect(
      screen.getByRole("button", { name: "Open agent roster" }).textContent,
    ).toBe("1 current");
    for (const name of ["Offline child", "Stopped child"]) {
      const user = await choose(name);
      expect(scene.props.selected).toBeNull();
      for (const action of [
        "Focus",
        "Follow",
        "Wave",
        "Take a walk",
        "Return agent to desk",
      ])
        expect(isDisabled(action)).toBe(true);
      expect(isDisabled("Inspect")).toBe(false);
      await user.click(
        screen.getByRole("button", { name: "Follow", exact: true }),
      );
      await user.click(
        screen.getByRole("button", { name: "Wave", exact: true }),
      );
      expect(scene.props.follow).toBeNull();
      expect(scene.props.command).toBeNull();
      await user.click(
        screen.getByRole("button", { name: "Inspect", exact: true }),
      );
      expect(screen.getByText(`Task for ${name}`)).toBeTruthy();
      expect(screen.getByText("Historical observation")).toBeTruthy();
      expect(screen.getByText("LAST REPORTED TASK")).toBeTruthy();
      expect(residents().map((entry) => entry.agent.name)).toEqual([
        "Current child",
      ]);
    }
  });

  it("preserves stale grace then clears physical controls at offline timeout while retaining the open details", async () => {
    const live = session("source", [person("Aster")]);
    await open([live]);
    const user = await choose("Aster");
    await user.click(
      screen.getByRole("button", { name: "Follow", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: "Wave", exact: true }));
    await user.click(
      screen.getByRole("button", { name: "Inspect", exact: true }),
    );
    publish([
      {
        ...live,
        connected: false,
        connectionState: "stale",
        agents: [person("Aster", "stale")],
      },
    ]);
    expect(residents()).toHaveLength(1);
    expect(scene.props.follow).toBe(visualAgentId("source", "Aster"));
    expect(isDisabled("Wave")).toBe(false);
    publish([
      {
        ...live,
        connected: false,
        connectionState: "offline",
        agents: [person("Aster", "offline")],
      },
    ]);
    expect(residents()).toHaveLength(0);
    expect(scene.props.follow).toBeNull();
    expect(scene.props.command).toBeNull();
    expect(scene.props.selected).toBeNull();
    expect(screen.getByText("AGENT DETAILS")).toBeTruthy();
    expect(screen.getByText("Task for Aster")).toBeTruthy();
    expect(screen.getByText("Historical observation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop following/ })).toBeNull();
    expect(isDisabled("Follow")).toBe(true);
    expect(scene.props.lifecycleEvents).toEqual([]);
  });

  it("keeps history absent on reconnect, then permits a genuinely fresh start without reviving an old gesture", async () => {
    const old = session(
      "source",
      [person("Aster", "offline", { lifecycle: marker("stop", "old-stop") })],
      { connectionState: "offline" },
    );
    await open([old]);
    await choose("Aster");
    act(() => FakeEvents.current.onerror?.());
    act(() => FakeEvents.current.onopen?.());
    publish([old]);
    expect(residents()).toHaveLength(0);
    expect(scene.props.lifecycleEvents).toEqual([]);
    const renewed = session(
      "source",
      [
        person("Aster", "working", {
          lifecycle: marker("start", "fresh-start"),
        }),
      ],
      { connectionState: "live" },
    );
    publish([renewed]);
    expect(residents()).toHaveLength(1);
    expect(residents()[0].transition?.direction).toBe("arriving");
    expect(scene.props.selected).toBe(visualAgentId("source", "Aster"));
    expect(scene.props.follow).toBeNull();
    expect(scene.props.command).toBeNull();
    expect(isDisabled("Follow")).toBe(false);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Follow", exact: true }),
    );
    expect(scene.props.follow).toBe(visualAgentId("source", "Aster"));
  });

  it("retains all-historical projects in the chooser with zero current counts and an explicit empty-office path to history", async () => {
    await open([session("retired", [person("Old root", "offline")])]);
    expect(residents()).toHaveLength(0);
    expect(screen.getByText("This office is quiet.")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Choose project office" }),
    );
    const projectOption = screen.getByRole("option", { name: "shared" });
    expect(projectOption.textContent).toContain(
      "0 current · 1 historical · 1 session",
    );
    await user.click(projectOption);
    expect(scene.props.sessions).toHaveLength(1);
    expect(residents()).toHaveLength(0);
    await user.click(
      screen.getByRole("button", { name: "Browse agent history" }),
    );
    expect(screen.getByRole("textbox", { name: "Search agents" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Old root/ }));
    expect(
      screen.getByRole("region", { name: "Selected agent" }).textContent,
    ).toContain("Historical");
  });

  it("counts grouped current/history separately and leaves historical break-room gestures disabled while inspection works", async () => {
    const sessions = projectOffices([
      session("current", [person("Current root")]),
      session("retired", [person("Old root", "working")], {
        connectionState: "offline",
      }),
    ]);
    const onVisualCommand = vi.fn(),
      onSelect = vi.fn(),
      onClose = vi.fn();
    render(
      <WorkplacePanel
        sessions={sessions}
        mode="live"
        connection="connected"
        facility="reception"
        onClose={onClose}
        onSelect={onSelect}
        onFocusSession={vi.fn()}
        onOpenRoster={vi.fn()}
        onVisualCommand={onVisualCommand}
      />,
    );
    const summary = screen.getByLabelText("Office summary");
    const counts = Object.fromEntries(
      Array.from(summary.querySelectorAll("div")).map((item) => [
        item.querySelector("dt")?.textContent,
        item.querySelector("dd")?.textContent,
      ]),
    );
    expect(counts).toMatchObject({
      Projects: "1",
      "Current agents": "1",
      "Working / thinking": "1",
    });
    expect(
      screen.getByText(
        "1 historical observation remains available in the agent roster.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open project shared" }).textContent,
    ).toContain("1 current · 1 historical · 2 sessions");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Break room/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Resident" }),
      visualAgentId("retired", "Old root"),
    );
    for (const label of ["Take a break", "Wave hello", "Return to desk"]) {
      expect(isDisabled(label)).toBe(true);
      await user.click(screen.getByRole("button", { name: label }));
    }
    expect(onVisualCommand).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Inspect historical agent" }),
    );
    expect(onSelect).toHaveBeenCalledWith(visualAgentId("retired", "Old root"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
