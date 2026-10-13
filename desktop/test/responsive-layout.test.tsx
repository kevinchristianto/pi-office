import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { initialState } from "../src/useCompanion";
import type { CompanionState } from "../src/types";
import type { Session } from "../../src/types";

const css = readFileSync("src/styles.css", "utf8");
const baseCSS = css.split("@media (min-width: 540px)")[0];
const roomyCSS = css.split("@media (min-width: 540px)")[1];
const rule = (selector: string, source = baseCSS) => {
  const start = source.indexOf(`${selector} {`);
  expect(start, `Missing CSS contract: ${selector}`).toBeGreaterThanOrEqual(0);
  return source.slice(start).split("}")[0];
};

function session(id: string, count: number): Session {
  return {
    id,
    name: `${id} session`,
    cwd: `/projects/${id}`,
    connectionState: "live",
    agents: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      name: `${id} agent ${index}`,
      state: "working",
      task: `Build ${id} task ${index}`,
    })),
  };
}

async function show(sessions: Session[]) {
  let state: CompanionState = {
    ...initialState,
    connection: { status: "live", lastSuccessAt: 1, error: null },
    snapshot: { updatedAt: 1, revision: 1, sessions },
  };
  let listener: (state: CompanionState) => void = () => {};
  const command = vi.fn(async () => undefined);
  window.companion = {
    getState: async () => state,
    command,
    onState(callback) {
      listener = callback;
      return () => {};
    },
  };
  const view = render(<App />);
  await screen.findByLabelText("Current agents");
  return {
    ...view,
    command,
    push(update: Partial<CompanionState>) {
      state = { ...state, ...update };
      act(() => listener(state));
    },
  };
}

afterEach(() => {
  cleanup();
  delete window.companion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("responsive companion layout contracts", () => {
  // jsdom cannot measure CSS Grid or hit testing. These assertions verify the
  // declared layout constraints and DOM behavior, never simulated pixel layouts.
  it("uses readable auto-fit columns and scrollable content-sized rows at minimum, wide and tall sizes", () => {
    const dock = rule(".agent-dock");
    expect(dock).toContain("display: grid");
    expect(dock).toContain("repeat(auto-fit, minmax(88px, 1fr))");
    expect(dock).toContain("grid-auto-rows: max-content");
    expect(dock).toContain("align-content: start");
    expect(dock).toContain("overflow-y: auto");
    expect(dock).toContain("overflow-x: hidden");
    expect(dock).toContain("min-height: 0");
    expect(dock).toContain("scrollbar-gutter: stable");
    expect(rule(".agent-dock", roomyCSS)).toContain(
      "repeat(auto-fit, minmax(104px, 1fr))",
    );
    expect(css).not.toMatch(/roster-[78]|repeat\(8,/);
    expect(rule(".resident-art")).toContain("width: 72px");
    expect(rule(".resident-art")).toContain("height: 90px");
    expect(rule(".resident-art")).toContain("flex-shrink: 0");
    expect(rule(".resident-art", roomyCSS)).toContain("height: 104px");
    expect(rule(".resident")).toContain("max-width: 128px");
    expect(rule(".resident-state")).toContain("font-size: 9px");
  });

  it("reserves a minimum-size first-row budget and does not impose an inaccessible CSS minimum on tiny work areas", () => {
    expect(rule(".companion")).toContain("min-width: 0");
    expect(rule(".companion")).toContain("min-height: 0");
    expect(rule(".companion")).toContain("height: calc(100% - 12px)");
    expect(rule(".titlebar")).toContain("height: 42px");
    expect(rule(".office-heading")).toContain("padding: 2px 18px 0");
    expect(rule("h1")).toContain("font-size: 17px");
    expect(rule(".office-summary")).toContain("margin: 2px 0 0");
    expect(rule(".agent-dock")).toContain("padding: 4px 13px");
    expect(rule(".footer")).toContain("min-height: 34px");
    // A one-line heading/summary and first tile fit the declared 260px budget.
    // This is arithmetic over design constants, not a browser rendering claim.
    const heading = 2 + 17 * 1.22 + 2 + 10 * 1.25;
    const firstTile = 4 + 90 + 14 + 12;
    expect(12 + 2 + 42 + heading + 8 + firstTile + 34).toBeLessThanOrEqual(256);
    expect(rule(".office-content")).toContain("min-height: 0");
    expect(rule(".options-panel")).toContain("overflow-y: auto");
  });

  it.each([
    [440, 260],
    [1200, 300],
    [460, 900],
    [1360, 880],
    [320, 200],
  ])(
    "keeps 40 residents and footer actions reachable at a %i×%i viewport without remounting on resize",
    async (width, height) => {
      vi.stubGlobal("innerWidth", width);
      vi.stubGlobal("innerHeight", height);
      await show([session("garden", 40)]);
      const dock = screen.getByLabelText("Current agents");
      const residents = within(dock).getAllByRole("button");
      expect(residents).toHaveLength(40);
      const portrait = residents[0].querySelector(".resident-art");
      fireEvent(window, new Event("resize"));
      expect(within(dock).getAllByRole("button")[0]).toBe(residents[0]);
      expect(residents[0].querySelector(".resident-art")).toBe(portrait);
      expect(
        document.querySelector(".footer")?.closest(".agent-dock"),
      ).toBeNull();
      fireEvent.click(
        within(dock).getByRole("button", {
          name: "garden agent 39, Working, garden",
        }),
      );
      expect(
        screen.getByRole("region", { name: "Details for garden agent 39" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Back to office"));
      fireEvent.click(
        screen.getByRole("button", { name: "View all 40 current agents" }),
      );
      expect(document.querySelectorAll(".resident-list-item")).toHaveLength(40);
    },
  );

  it("bounds expensive artwork at 64, explains the limit, and lets the complete large roster open details", async () => {
    await show([session("garden", 50), session("studio", 50)]);
    const dock = screen.getByLabelText("Current agents");
    expect(within(dock).getAllByRole("button")).toHaveLength(64);
    expect(dock.querySelectorAll(".resident-art")).toHaveLength(64);
    expect(screen.getByText(/Showing 64 of 100/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "View all 100 current agents" }),
    );
    const list = screen.getByRole("region", { name: "All current agents" });
    expect(list.querySelectorAll(".resident-list-item")).toHaveLength(100);
    expect(list.querySelectorAll(".resident-art")).toHaveLength(0);
    fireEvent.click(
      within(list).getByRole("button", { name: /studio agent 49/ }),
    );
    expect(screen.getByText("Build studio task 49")).toBeTruthy();
  });

  it("pauses offscreen SVG animation from intersection events and disconnects on navigation", async () => {
    let notify!: IntersectionObserverCallback;
    let settings: IntersectionObserverInit | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class Observer {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        notify = callback;
        settings = options;
      }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    await show([session("garden", 12)]);
    const dock = screen.getByLabelText("Current agents");
    const residents = within(dock).getAllByRole("button");
    expect(settings?.root).toBe(dock);
    expect(observe).toHaveBeenCalledTimes(12);
    await waitFor(() =>
      expect(
        residents.every(
          (resident) => resident.getAttribute("data-in-viewport") === "false",
        ),
      ).toBe(true),
    );
    act(() =>
      notify(
        [
          { target: residents[0], isIntersecting: true },
          { target: residents[11], isIntersecting: false },
        ] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(residents[0].getAttribute("data-in-viewport")).toBe("true");
    expect(residents[11].getAttribute("data-in-viewport")).toBe("false");
    expect(rule('.resident[data-in-viewport="false"] *')).toContain(
      "animation-play-state: paused !important",
    );
    const previousNotify = notify;
    fireEvent.click(residents[0]);
    expect(disconnect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Back to office"));
    const remounted = within(
      screen.getByLabelText("Current agents"),
    ).getAllByRole("button")[0];
    act(() =>
      previousNotify(
        [
          { target: residents[0], isIntersecting: true },
        ] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(remounted.getAttribute("data-in-viewport")).toBe("false");
  });

  it("contains long names, project paths and task text without dropping the full details", async () => {
    const long = "LongUnbrokenAgentName".repeat(12);
    const task = "Build\n" + "unbrokentask".repeat(100);
    const data = session("garden", 1);
    data.agents[0] = { ...data.agents[0], name: long, task };
    await show([data]);
    const resident = screen.getByRole("button", {
      name: `${long}, Working, garden`,
    });
    expect(resident.title).toContain(long);
    fireEvent.click(resident);
    expect(screen.getByRole("heading", { name: long }).textContent).toBe(long);
    expect(document.querySelector(".detail-task")?.textContent).toBe(task);
    expect(rule(".resident-name")).toContain("text-overflow: ellipsis");
    expect(rule(".detail-name-row")).toContain("flex-wrap: wrap");
    expect(rule(".detail-copy h2")).toContain("overflow-wrap: anywhere");
    expect(rule(".detail-meta dd")).toContain("min-width: 0");
    expect(rule(".detail-task")).toContain("overflow-wrap: anywhere");
    expect(rule(".resident-detail")).toContain("overflow-y: auto");
  });

  it("keeps click targets out of drag regions and reserves the corner for the resize handle", async () => {
    const { push } = await show([session("garden", 12)]);
    const handle = document.querySelector<HTMLButtonElement>(".resize-handle")!;
    expect(handle.disabled).toBe(false);
    expect(handle.parentElement).toBe(document.querySelector(".companion"));
    push({ locked: true });
    expect(handle.disabled).toBe(true);
    push({ locked: false, visible: false });
    expect(handle.disabled).toBe(true);
    expect(rule(".agent-dock")).toContain("-webkit-app-region: no-drag");
    expect(rule(".resident")).toContain("-webkit-app-region: no-drag");
    expect(rule(".dropdown-surface")).toContain("-webkit-app-region: no-drag");
    expect(rule(".options-panel")).toContain("z-index: 40");
    expect(rule(".project-filter-listbox")).toContain("z-index: 40");
    expect(rule(".footer")).toContain("flex-shrink: 0");
    expect(rule(".footer")).toContain("padding: 0 36px 0 17px");
    expect(rule(".footer", roomyCSS)).toContain("padding: 0 36px 0 25px");
    expect(rule(".icon-button")).toContain("height: 27px");
    expect(rule(".options-panel button")).toContain("min-height: 29px");
  });
});
