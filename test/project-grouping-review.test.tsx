import React from "react";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent, AgentLifecycleMarker, Session } from "../src/types";
import { residentModel } from "../src/appearance";

const world = vi.hoisted(() => ({ props: {} as any, lifecycle: {} as any }));
// Mount the actual App, data/SSE gate, project projection and resident hook.
// Only WebGL presentation is replaced in this component integration suite.
vi.mock("../src/Office", async () => {
  const { useResidentLifecycle } = await import("../src/useResidentLifecycle");
  return {
    default: (props: any) => {
      world.props = props;
      world.lifecycle = useResidentLifecycle({
        sessions: props.sessions,
        selected: props.selected,
        events: props.lifecycleEvents,
        epoch: props.lifecycleEpoch,
        enabled: props.lifecycleEnabled,
        reduced: false,
        connection: props.connection,
      });
      return <div data-testid="project-scene" />;
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
  publish(data: unknown) {
    this.listeners.snapshot?.({ data: JSON.stringify(data) });
  }
}
let revision: number;
const project = (root: string) => ({
  id: `project:${createHash("sha256").update(`linux\0${root}`).digest("hex")}`,
  root,
  name: root.split("/").at(-1)!,
  kind: "git" as const,
  platform: "linux",
});
const person = (id: string, name = id, state = "working"): Agent => ({
  id,
  name,
  state,
  task: `Task for ${name}`,
  logs: [],
});
function session(
  id: string,
  root: string,
  agents: Agent[],
  extra: any = {},
): Session {
  return {
    id,
    name: `Session ${id}`,
    cwd: root,
    project: project(root),
    agents,
    ...extra,
  } as Session;
}
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
      streamId: "project-review",
      revision: ++revision,
      sessions,
      updatedAt: Date.now(),
    }),
  );
}
async function open(sessions: Session[]) {
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("project-scene")).toBeTruthy());
  publish(sessions);
  await waitFor(() => expect(screen.getByText("LOCAL · LIVE")).toBeTruthy());
}
async function choose(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open agent roster" }));
  await user.click(screen.getByRole("button", { name: new RegExp(name) }));
  return user;
}
const residents = () => world.lifecycle.residents as any[];
const displayed = (name: string) =>
  world.props.sessions
    .flatMap((s: Session) => s.agents)
    .find((a: Agent) => a.name === name);

beforeEach(() => {
  revision = 0;
  world.props = {};
  world.lifecycle = {};
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

describe("independent actual-App project grouping review", () => {
  it("combines distinct live/history sessions and children at one canonical Git worktree, keeping a same-name clone separate", async () => {
    const root = "/work/client/app";
    const source = [
      session("retired", root, [person("old:main", "Old root", "offline")]),
      session(
        "first",
        `${root}/src`,
        [person("first:main", "First root"), person("first:child", "Scout")],
        { project: project(root) },
      ),
      session("second", root, [person("second:main", "Second root")]),
      session("clone", "/other/client/app", [
        person("clone:main", "Clone root"),
      ]),
    ];
    const before = JSON.stringify(source);
    await open(source);
    expect(world.props.sessions).toHaveLength(2);
    const office = world.props.sessions.find((s: Session) => s.cwd === root);
    expect(office.sourceSessions).toHaveLength(3);
    expect(office.agents.map((a: Agent) => a.name).sort()).toEqual([
      "First root",
      "Old root",
      "Scout",
      "Second root",
    ]);
    expect(world.props.sessions.map((s: Session) => s.id)[0]).not.toBe(
      world.props.sessions[1].id,
    );
    expect(JSON.stringify(source)).toBe(before);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Choose project office" }),
    );
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("does not let stale projects push a live project outside the first-four overview", async () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      session(`old-${i}`, `/archive/p${i}`, [
        person(`old-${i}:main`, `History ${i}`, "offline"),
      ]),
    );
    await open([
      ...history,
      session("current", "/work/current", [
        person("current:main", "Current work"),
      ]),
    ]);
    expect(world.props.sessions).toHaveLength(4);
    expect(displayed("Current work")).toBeTruthy();
    expect(
      residents().some((entry) => entry.agent.name === "Current work"),
    ).toBe(true);
    const shownNames = new Set(
      world.props.sessions.flatMap((s: Session) => s.agents.map((a) => a.name)),
    );
    const hiddenName = history
      .flatMap((s) => s.agents)
      .find((a) => !shownNames.has(a.name))!.name;
    const user = await choose(hiddenName);
    expect(world.props.sessions).toHaveLength(1);
    expect(
      screen.getByRole("region", { name: "Selected agent" }).textContent,
    ).toContain(hiddenName);
    await user.click(
      screen.getByRole("button", { name: "Follow", exact: true }),
    );
    expect(world.props.follow).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Follow",
          exact: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(residents().some((entry) => entry.agent.name === hiddenName)).toBe(
      false,
    );
  });

  it("keeps live roots and children in the six visible desks while historical residents stay individually inspectable", async () => {
    const root = "/work/large";
    const history = Array.from({ length: 8 }, (_, i) =>
      session(`old-${i}`, root, [
        person(`old-${i}:main`, `History ${i}`, "offline"),
      ]),
    );
    const active = session("now", root, [
      person("now:main", "Current root"),
      person("now:child", "Current child", "thinking"),
    ]);
    await open([...history, active]);
    expect(world.props.sessions).toHaveLength(1);
    expect(world.props.sessions[0].agents).toHaveLength(10);
    expect(residents()).toHaveLength(2);
    expect(residents().map((entry) => entry.agent.name)).toEqual(
      expect.arrayContaining(["Current root", "Current child"]),
    );
    const user = await choose("History 7");
    expect(residents().some((entry) => entry.agent.name === "History 7")).toBe(
      false,
    );
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByText("Task for History 7")).toBeTruthy();
  });

  it("isolates unknown paths and permits legacy grouping only for the same normalized absolute cwd", async () => {
    await open([
      session("legacy-a", "/work/exact/", [person("a")], {
        project: undefined,
      }),
      session("legacy-b", "/work/exact", [person("b")], { project: undefined }),
      session("unknown-a", "/work/exact", [person("c")], { project: null }),
      session("unknown-b", "/work/exact", [person("d")], { project: null }),
    ]);
    expect(world.props.sessions).toHaveLength(3);
    expect(
      world.props.sessions
        .find((s: Session) => s.agents.length === 2)
        ?.agents.map((a: Agent) => a.name),
    ).toEqual(["a", "b"]);
  });

  it("keeps an unresolved transport session isolated when its raw ID equals a resolved project's display ID", async () => {
    const root = "/review/collision";
    await open([
      session("known", root, [person("known-agent", "Known person")]),
      session(
        project(root).id,
        "/review/unknown",
        [person("unknown-agent", "Unknown person")],
        { project: null },
      ),
    ]);
    expect(world.props.sessions).toHaveLength(2);
    expect(new Set(world.props.sessions.map((s: Session) => s.id)).size).toBe(
      2,
    );
    expect(new Set(residents().map((entry) => entry.roomId)).size).toBe(2);
  });

  it("selects and follows colliding raw IDs independently and preserves each source's model/workspace in Inspect", async () => {
    const root = "/work/shared";
    const source = [
      session("left", `${root}/frontend`, [person("main", "Left person")], {
        model: "model-left",
        project: project(root),
      }),
      session("right", `${root}/backend`, [person("main", "Right person")], {
        model: "model-right",
        project: project(root),
      }),
    ];
    await open(source);
    const left = displayed("Left person"),
      right = displayed("Right person");
    expect(left.id).not.toBe(right.id);
    expect(left.source.agentId).toBe("main");
    expect(right.source.agentId).toBe("main");
    expect(residentModel(left.source.agentId)).toBe(residentModel("main"));
    for (const [name, agent, model, cwd] of [
      ["Left person", left, "model-left", `${root}/frontend`],
      ["Right person", right, "model-right", `${root}/backend`],
    ] as const) {
      const user = await choose(name);
      expect(world.props.selected).toBe(agent.id);
      await user.click(
        screen.getByRole("button", { name: "Focus", exact: true }),
      );
      expect(world.props.cameraAction.id).toBe(agent.id);
      await user.click(
        screen.getByRole("button", { name: "Follow", exact: true }),
      );
      expect(world.props.follow).toBe(agent.id);
      await user.click(screen.getByRole("button", { name: "Inspect" }));
      const details = screen.getByText("AGENT DETAILS").closest("aside")!;
      expect(within(details).getByText(model)).toBeTruthy();
      expect(within(details).getByText(cwd)).toBeTruthy();
      await user.click(
        screen.getByRole("button", { name: "Close agent details" }),
      );
    }
  });

  it("keeps raw lifecycle attribution across grouping and retains one removed session's exit without moving its sibling", async () => {
    const root = "/work/lifecycle";
    const left = session("left", root, [person("main", "Left person")]);
    const right = session("right", root, [person("main", "Right person")]);
    await open([left, right]);
    expect(residents().every((entry) => !entry.transition)).toBe(true);
    const leftVisual = displayed("Left person").id;
    const rightVisual = displayed("Right person").id;
    publish([
      left,
      {
        ...right,
        agents: [
          { ...right.agents[0], lifecycle: marker("start", "right-start") },
        ],
      },
    ]);
    expect(world.props.lifecycleEvents.at(-1)).toMatchObject({
      sessionId: "right",
      agentId: "main",
    });
    expect(
      residents().find((entry) => entry.agent.id === rightVisual)?.transition
        ?.direction,
    ).toBe("arriving");
    expect(
      residents().find((entry) => entry.agent.id === leftVisual)?.transition,
    ).toBeUndefined();
    publish([
      {
        ...left,
        agents: [{ ...left.agents[0], lifecycle: marker("stop", "left-stop") }],
      },
      right,
    ]);
    const exiting = residents().find((entry) => entry.agent.id === leftVisual);
    expect(exiting?.transition?.direction).toBe("exiting");
    const room = exiting.roomId;
    publish([right]);
    expect(
      residents().find((entry) => entry.agent.id === leftVisual)?.transition
        ?.direction,
    ).toBe("exiting");
    expect(
      residents().find((entry) => entry.agent.id === rightVisual)?.roomId,
    ).toBe(room);
    act(() => world.lifecycle.complete(exiting.key, "left-stop", "exiting"));
    expect(residents().some((entry) => entry.agent.id === leftVisual)).toBe(
      false,
    );
  });

  it("retains the latest stopped actor fields when live prioritization pushes its departure outside the six-desk window", async () => {
    const root = "/review/full-room";
    const existing = Array.from({ length: 6 }, (_, i) =>
      session(`session-${i}`, root, [person(`person-${i}`, `Person ${i}`)]),
    );
    await open(existing);
    const original = residents().find(
      (entry) => entry.agent.name === "Person 0",
    )!;
    const stopped = {
      ...existing[0],
      agents: [
        {
          ...existing[0].agents[0],
          state: "offline",
          task: "Finished shutdown",
          tool: null,
          lifecycle: marker("stop", "stop-full-room"),
        },
      ],
    };
    const newcomer = session("newcomer", root, [
      {
        ...person("new-person", "New person"),
        lifecycle: marker("start", "new-full-room"),
      },
    ]);
    publish([stopped, ...existing.slice(1), newcomer]);
    expect(displayed("Person 0").state).toBe("offline");
    const exiting = residents().find(
      (entry) => entry.agent.name === "Person 0",
    )!;
    expect(exiting.transition?.direction).toBe("exiting");
    expect(exiting.deskIndex).toBe(original.deskIndex);
    expect(exiting.agent.state).toBe("offline");
    expect(exiting.agent.task).toBe("Finished shutdown");
    expect(exiting.agent.source.historical).toBe(true);
    publish([
      {
        ...stopped,
        agents: [
          {
            ...stopped.agents[0],
            task: "Final observed details",
            outputTokens: 42,
          },
        ],
      },
      ...existing.slice(1),
      newcomer,
    ]);
    const refreshed = residents().find(
      (entry) => entry.agent.name === "Person 0",
    )!;
    expect(refreshed.transition).toEqual(exiting.transition);
    expect(refreshed.deskIndex).toBe(original.deskIndex);
    expect(refreshed.agent.task).toBe("Final observed details");
    expect(refreshed.agent.outputTokens).toBe(42);
  });

  it("keeps physical room order and the confirmed departure when one project's last live root stops", async () => {
    const source = [
      session("first-project", "/review/alpha", [
        { ...person("first-root", "First root"), role: "orchestrator" },
      ]),
      session("second-project", "/review/beta", [
        { ...person("second-root", "Second root"), role: "orchestrator" },
      ]),
    ];
    await open(source);
    const firstRoom = world.props.sessions[0];
    const retiringId = firstRoom.sourceSessions[0].id;
    const retiringAgentId = firstRoom.agents[0].id;
    const roomOrder = world.props.sessions.map((s: Session) => s.id);
    const scope = world.lifecycle.scope;
    publish(
      source.map((s) =>
        s.id !== retiringId
          ? s
          : {
              ...s,
              connected: false,
              connectionState: "offline",
              agents: [
                {
                  ...s.agents[0],
                  state: "offline",
                  lifecycle: {
                    ...marker("stop", "last-root-stop"),
                    source: "pi:session_shutdown",
                  },
                },
              ],
            },
      ),
    );
    expect(world.props.sessions.map((s: Session) => s.id)).toEqual(roomOrder);
    expect(world.lifecycle.scope).toBe(scope);
    const departure = residents().find(
      (entry) => entry.agent.id === retiringAgentId,
    )!;
    expect(departure.roomId).toBe(firstRoom.id);
    expect(departure.agent.state).toBe("offline");
    expect(departure.transition?.direction).toBe("exiting");
    expect(departure.transition?.token).toBe("last-root-stop");
    expect(residents().filter((entry) => entry.transition)).toHaveLength(1);
  });

  it("filtering and reconnecting a grouped project never invent or replay lifecycle motion", async () => {
    const a = session("first", "/work/a", [person("a", "Person A")]);
    const sibling = session("second", "/work/a", [person("b", "Person B")]);
    const c = session("third", "/work/c", [person("c", "Person C")]);
    await open([a, sibling, c]);
    publish([
      a,
      {
        ...sibling,
        agents: [
          { ...sibling.agents[0], lifecycle: marker("start", "b-start") },
        ],
      },
      c,
    ]);
    expect(residents().some((entry) => entry.transition)).toBe(true);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Choose project office" }),
    );
    const target = screen
      .getAllByRole("option")
      .find((option) => option.textContent?.startsWith("c"))!;
    await user.click(target);
    expect(residents().every((entry) => !entry.transition)).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "Choose project office" }),
    );
    await user.click(screen.getByRole("option", { name: /Whole office/ }));
    expect(residents().every((entry) => !entry.transition)).toBe(true);
    act(() => FakeEvents.current.onerror?.());
    act(() => FakeEvents.current.onopen?.());
    publish([
      a,
      {
        ...sibling,
        agents: [
          { ...sibling.agents[0], lifecycle: marker("start", "b-reconnect") },
        ],
      },
      c,
    ]);
    expect(residents().every((entry) => !entry.transition)).toBe(true);
    expect(world.props.lifecycleEvents).toEqual([]);
  });
});
