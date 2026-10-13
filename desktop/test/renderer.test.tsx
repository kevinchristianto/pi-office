import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { App } from "../src/App";
import { initialState, useCompanion } from "../src/useCompanion";
import { projectResidents } from "../src/model";
import type { CompanionAPI, CompanionState } from "../src/types";
import type { Agent, Session } from "../../src/types";

const agent = (id: string, changes: Partial<Agent> = {}): Agent => ({
  id,
  name: id,
  state: "working",
  task: `Build ${id}`,
  ...changes,
});
const session = (
  id: string,
  agents: Agent[],
  changes: Partial<Session> = {},
): Session => ({
  id,
  name: `${id} session`,
  agents,
  cwd: `/projects/${id}`,
  connectionState: "live",
  ...changes,
});
const live = (sessions: Session[]): CompanionState => ({
  ...initialState,
  connection: { status: "live", lastSuccessAt: 1234, error: null },
  snapshot: { updatedAt: 1234, revision: 1, sessions },
});
let current: CompanionState;
let listeners: Set<(state: CompanionState) => void>;
let command: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;
function push(next: CompanionState) {
  current = next;
  act(() => {
    for (const listener of listeners) listener(next);
  });
}
async function show(next: CompanionState) {
  current = next;
  const rendered = render(<App />);
  await waitFor(() => expect(screen.queryByText("Connecting")).toBeNull());
  return rendered;
}

beforeEach(() => {
  listeners = new Set();
  current = live([
    session("garden", [agent("Ada"), agent("Theo", { state: "waiting" })]),
  ]);
  unsubscribe = vi.fn();
  command = vi.fn(async () => undefined);
  window.companion = {
    getState: vi.fn(async () => current),
    onState(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
        unsubscribe();
      };
    },
    command,
  };
});
afterEach(() => {
  cleanup();
  delete window.companion;
  vi.restoreAllMocks();
});

describe("companion renderer", () => {
  it.each([
    "working",
    "thinking",
    "idle",
    "waiting",
    "completed",
    "error",
    "offline",
    "stale",
  ])("displays the bridge state %s", async (state) => {
    await show(live([session("garden", [agent("Ada", { state })])]));
    if (state === "offline") {
      fireEvent.click(screen.getByText("1 history"));
      fireEvent.click(screen.getByRole("button", { name: /Ada garden/ }));
    } else fireEvent.click(screen.getByRole("button", { name: /^Ada,/ }));
    expect(screen.queryByText("Unknown state")).toBeNull();
    if (state === "completed")
      expect(screen.getByText("Task finished")).toBeTruthy();
  });
  it.each(["__proto__", "constructor"])(
    "renders unknown state %s as safe text",
    async (state) => {
      await show(live([session("garden", [agent("Ada", { state })])]));
      expect(
        screen.getByRole("button", { name: "Ada, Unknown state, garden" }),
      ).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: "Ada, Unknown state, garden" }),
      );
      expect(screen.getByText("Unknown state")).toBeTruthy();
    },
  );
  it("shows current residents and attention without historical desk occupants", async () => {
    await show(
      live([
        session("garden", [
          agent("Ada"),
          agent("Theo", { state: "waiting" }),
          agent("Err", { state: "error" }),
          agent("Old", { state: "offline" }),
          agent("Stopped", {
            lifecycle: {
              version: 1,
              eventId: "stop",
              kind: "stop",
              source: "pi:session_shutdown",
              at: "2026-01-01",
            },
          }),
        ]),
      ]),
    );
    expect(
      screen.getByText("3 current · 1 busy · 2 needs attention"),
    ).toBeTruthy();
    const dock = screen.getByLabelText("Current agents");
    expect(within(dock).getAllByRole("button")).toHaveLength(3);
    expect(within(dock).queryByText("Old")).toBeNull();
    expect(screen.getByText("2 history")).toBeTruthy();
    expect(dock.querySelectorAll(".attention-bubble")).toHaveLength(0);
    expect(
      [...dock.querySelectorAll(".resident-status-text")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Working", "Error", "Needs input"]);
  });
  it("opens read-only task and project details, closes with Escape and restores focus", async () => {
    await show(current);
    fireEvent.click(
      screen.getByRole("button", { name: "Ada, Working, garden" }),
    );
    const details = screen.getByRole("region", { name: "Details for Ada" });
    expect(within(details).getByText("Build Ada")).toBeTruthy();
    expect(within(details).getByText("garden session")).toBeTruthy();
    expect(within(details).getByText("read-only")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Back to office"),
    );
    fireEvent.keyDown(screen.getByLabelText("Back to office"), {
      key: "Escape",
    });
    expect(
      screen.queryByRole("region", { name: "Details for Ada" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Ada, Working, garden" }),
    );
    expect(command).not.toHaveBeenCalled();
  });
  it("retains distinct identities for equal raw agent IDs in different sessions", async () => {
    await show(
      live([
        session("one", [agent("main", { name: "First", task: "First task" })], {
          cwd: "/shared",
        }),
        session(
          "two",
          [agent("main", { name: "Second", task: "Second task" })],
          { cwd: "/shared" },
        ),
      ]),
    );
    const keys = [...document.querySelectorAll("[data-resident-key]")].map(
      (node) => node.getAttribute("data-resident-key"),
    );
    expect(new Set(keys).size).toBe(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Second, Working, shared" }),
    );
    expect(screen.getByText("Second task")).toBeTruthy();
    push(
      live([
        session(
          "two",
          [agent("main", { name: "Second", task: "Updated task" })],
          { cwd: "/shared" },
        ),
      ]),
    );
    expect(screen.getByText("Updated task")).toBeTruthy();
    expect(screen.queryByText("First task")).toBeNull();
  });
  it("keeps stopped details inspectable as history and clears a disappeared selection", async () => {
    await show(current);
    fireEvent.click(
      screen.getByRole("button", { name: "Ada, Working, garden" }),
    );
    push(live([session("garden", [agent("Ada", { state: "offline" })])]));
    expect(
      screen.getByText("Historical", { selector: ".state-tag" }),
    ).toBeTruthy();
    expect(screen.getByText("Last state")).toBeTruthy();
    push(live([]));
    expect(
      screen.queryByRole("region", { name: "Details for Ada" }),
    ).toBeNull();
    expect(
      screen.getByText("That agent is no longer in the latest snapshot."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Companion options"),
    );
  });
  it("opens history separately and supports repeated navigation without live desk ghosts", async () => {
    await show(
      live([
        session("garden", [
          agent("Ada"),
          agent("Old", { state: "offline", task: "Old task" }),
        ]),
      ]),
    );
    fireEvent.click(screen.getByText("1 history"));
    expect(screen.getByRole("region", { name: "Agent history" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Old garden/ }));
    expect(screen.getByText("Old task")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Back to agents"));
    expect(screen.getByRole("region", { name: "Agent history" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Back to office"));
    expect(
      within(screen.getByLabelText("Current agents")).getAllByRole("button"),
    ).toHaveLength(1);
  });
  it("renders more than eight residents without squeezing and keeps the list shortcut", async () => {
    await show(
      live([
        session(
          "garden",
          Array.from({ length: 13 }, (_, i) => agent(`Agent ${i}`)),
        ),
      ]),
    );
    expect(
      within(screen.getByLabelText("Current agents")).getAllByRole("button"),
    ).toHaveLength(13);
    expect(screen.getByText("All 13")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "View all 13 current agents" }),
    );
    const list = screen.getByRole("region", { name: "All current agents" });
    expect(list.querySelectorAll(".resident-list-item")).toHaveLength(13);
    expect(list.querySelectorAll(".resident-art")).toHaveLength(0);
  });
  it("filters projects and recovers when the selected project disappears", async () => {
    await show(
      live([session("one", [agent("Ada")]), session("two", [agent("Bob")])]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter by project" }));
    fireEvent.click(screen.getByRole("option", { name: "two" }));
    expect(
      screen.queryByRole("button", { name: "Ada, Working, one" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Bob, Working, two" }),
    ).toBeTruthy();
    push(live([session("one", [agent("Ada")])]));
    expect(
      screen.getByRole("button", { name: "Ada, Working, one" }),
    ).toBeTruthy();
  });
  it("hides live desks when offline and explains how to reuse the existing bridge", async () => {
    await show({
      ...current,
      connection: {
        status: "offline",
        lastSuccessAt: 1234,
        error: "Bridge unavailable",
      },
    });
    expect(screen.queryByLabelText("Current agents")).toBeNull();
    expect(screen.getByText("Bridge offline")).toBeTruthy();
    expect(screen.getByText(/Run START-OFFICE.cmd or npm start/)).toBeTruthy();
    expect(document.querySelector(".companion.is-paused")).toBeTruthy();
    push({
      ...current,
      connection: { status: "live", lastSuccessAt: 4567, error: null },
    });
    expect(screen.getByLabelText("Current agents")).toBeTruthy();
  });
  it("sends only allowlisted window commands and uses pushed state for toggles", async () => {
    await show(current);
    fireEvent.click(screen.getByLabelText("Always on top"));
    expect(command).toHaveBeenLastCalledWith("toggle-top");
    expect(
      screen.getByLabelText("Always on top").getAttribute("aria-pressed"),
    ).toBe("false");
    push({ ...current, alwaysOnTop: true });
    expect(
      screen.getByLabelText("Always on top").getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByLabelText("Open full 3D office"));
    expect(command).toHaveBeenLastCalledWith("open-office");
    const options = () =>
      fireEvent.click(screen.getByLabelText("Companion options"));
    options();
    fireEvent.click(screen.getByText("Click-through lock"));
    expect(command).toHaveBeenLastCalledWith("lock");
    push({ ...current, locked: true });
    expect(document.querySelector(".companion.is-locked")).toBeTruthy();
    options();
    fireEvent.click(screen.getByText("Unlock click-through"));
    expect(command).toHaveBeenLastCalledWith("restore");
    options();
    fireEvent.click(screen.getByText("Compact size"));
    expect(command).toHaveBeenLastCalledWith("compact");
    options();
    fireEvent.click(screen.getByText("Roomy size"));
    expect(command).toHaveBeenLastCalledWith("roomy");
    options();
    fireEvent.click(screen.getByText("Hide companion"));
    expect(command).toHaveBeenLastCalledWith("hide");
    push({
      ...current,
      visible: false,
      connection: { ...current.connection, status: "paused" },
    });
    expect(document.querySelector(".companion.is-paused")).toBeTruthy();
    push({
      ...current,
      visible: true,
      connection: { ...current.connection, status: "live" },
    });
    expect(document.querySelector(".companion.is-paused")).toBeNull();
    options();
    fireEvent.click(screen.getByText("Quit companion"));
    expect(command).toHaveBeenLastCalledWith("quit");
  });
  it("disables click-through without recovery shortcut, dismisses options and handles failures", async () => {
    await show({ ...current, shortcutAvailable: false });
    fireEvent.click(screen.getByLabelText("Companion options"));
    expect(screen.getByText(/Global shortcut unavailable/)).toBeTruthy();
    const lock = screen.getByRole("button", {
      name: "Click-through lock",
    }) as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    fireEvent.click(lock);
    expect(command).not.toHaveBeenCalled();
    fireEvent.keyDown(lock, { key: "Escape" });
    expect(screen.queryByText("Click-through lock")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Companion options"),
    );
    fireEvent.click(screen.getByLabelText("Companion options"));
    fireEvent.pointerDown(screen.getByText("A good day to build."));
    expect(screen.queryByText("Click-through lock")).toBeNull();
    command.mockRejectedValueOnce(new Error("IPC unavailable"));
    fireEvent.click(screen.getByLabelText("Always on top"));
    await screen.findByText("Couldn't change always-on-top. Try again.");
    fireEvent.click(screen.getByLabelText("Dismiss notice"));
    expect(
      screen.queryByText("Couldn't change always-on-top. Try again."),
    ).toBeNull();
  });
  it("pauses animation on visibility changes and cleans up subscriptions", async () => {
    const rendered = await show(current);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(document.querySelector(".companion.is-paused")).toBeTruthy();
    rendered.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
  it("has no polling, renderer network permissions, unsafe inline CSP or 3D imports", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("style-src 'self'");
    expect(html).not.toContain("unsafe-inline");
    const source = [
      "App.tsx",
      "AgentPortrait.tsx",
      "useCompanion.ts",
      "model.ts",
    ]
      .map((name) => readFileSync(`src/${name}`, "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /requestAnimationFrame|setInterval|fetch\(|from ["'][^"']*three/,
    );
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("animation-play-state: paused");
  });
});

describe("companion state lifecycle", () => {
  it("does not overwrite a pushed state with a slow initial response", async () => {
    let resolve!: (state: CompanionState) => void;
    window.companion!.getState = () =>
      new Promise((done) => {
        resolve = done;
      });
    const hook = renderHook(() => useCompanion());
    push({ ...current, alwaysOnTop: true });
    await act(async () => resolve({ ...current, alwaysOnTop: false }));
    expect(hook.result.current.state.alwaysOnTop).toBe(true);
  });
  it("handles unavailable desktop APIs and rejected initial state", async () => {
    delete window.companion;
    const first = renderHook(() => useCompanion());
    expect(first.result.current.state.connection.status).toBe("offline");
    first.unmount();
    window.companion = {
      getState: () => Promise.reject(new Error("Closed")),
      onState: () => () => {},
      command,
    } as CompanionAPI;
    const second = renderHook(() => useCompanion());
    await waitFor(() =>
      expect(second.result.current.state.connection.status).toBe("offline"),
    );
  });
  it("does not mutate snapshots and excludes offline sources in shared projects", () => {
    const snapshot = live([
      session("one", [agent("same")], { cwd: "/shared" }),
      session("two", [agent("same")], {
        cwd: "/shared",
        connectionState: "offline",
      }),
    ]).snapshot!;
    const before = JSON.stringify(snapshot);
    const result = projectResidents(snapshot);
    expect(result.offices).toHaveLength(1);
    expect(
      result.residents.filter((resident) => !resident.historical),
    ).toHaveLength(1);
    expect(new Set(result.residents.map((resident) => resident.key)).size).toBe(
      2,
    );
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

it("offers explicit connection setup for a packaged empty owned office", async () => {
  await show({ ...live([]), bridge: { mode: "owned", error: null } });
  expect(
    screen.getByText("Choose Connect Pi from the options menu"),
  ).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Companion options"));
  fireEvent.click(screen.getByRole("button", { name: "Connect Pi…" }));
  expect(command).toHaveBeenLastCalledWith("connect-pi");
});

it("renders a packaged bridge startup error as plain text", async () => {
  await show({
    ...initialState,
    connection: {
      status: "offline",
      lastSuccessAt: null,
      error: "Port occupied",
    },
    bridge: { mode: "error", error: "Port occupied <script>" },
  });
  expect(screen.getByRole("alert").textContent).toBe("Port occupied <script>");
  expect(document.querySelector("script")).toBeNull();
});
