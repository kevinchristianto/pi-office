import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ProjectFilter, type ProjectOption } from "../src/ProjectFilter";
import { App } from "../src/App";
import { initialState } from "../src/useCompanion";
import type { CompanionState } from "../src/types";
import type { Session } from "../../src/types";

const projects: ProjectOption[] = [
  { value: "all", label: "All projects" },
  { value: "garden", label: "Garden", description: "/work/garden" },
  { value: "studio", label: "Studio", description: "/work/studio" },
  { value: "workshop", label: "Workshop", description: "/work/workshop" },
];

function Harness({
  options = projects,
  onChange = vi.fn(),
}: {
  options?: ProjectOption[];
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState("all");
  const [open, setOpen] = useState(false);
  return (
    <main className="companion">
      <button>Before</button>
      <ProjectFilter
        value={value}
        options={options}
        open={open}
        onOpenChange={setOpen}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button>After</button>
      <p>Outside</p>
    </main>
  );
}
const trigger = () => screen.getByRole("button", { name: "Filter by project" });
const listbox = () => screen.getByRole("listbox", { name: "Projects" });
const active = () =>
  document.getElementById(listbox().getAttribute("aria-activedescendant")!);
const key = (value: string) => fireEvent.keyDown(listbox(), { key: value });

afterEach(() => {
  cleanup();
  delete window.companion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("styled project dropdown", () => {
  it("replaces the native select with a labelled button and selected listbox option", () => {
    render(<Harness />);
    expect(document.querySelector("select")).toBeNull();
    expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-controls")).toBe(listbox().id);
    expect(document.activeElement).toBe(listbox());
    expect(active()).toBe(screen.getByRole("option", { name: "All projects" }));
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "Garden" })
        .getAttribute("aria-describedby"),
    ).toBeTruthy();
  });

  it.each(["ArrowDown", "ArrowUp", "Home", "Enter", " "])(
    "opens from the trigger with %j",
    (openingKey) => {
      render(<Harness />);
      trigger().focus();
      fireEvent.keyDown(trigger(), { key: openingKey });
      expect(document.activeElement).toBe(listbox());
      expect(active()?.getAttribute("aria-label")).toBe("All projects");
    },
  );

  it("supports Arrow/Home/End navigation without committing until Enter or Space", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: "End" });
    expect(active()?.getAttribute("aria-label")).toBe("Workshop");
    key("Home");
    key("ArrowUp");
    expect(active()?.getAttribute("aria-label")).toBe("All projects");
    key("ArrowDown");
    expect(active()?.getAttribute("aria-label")).toBe("Garden");
    expect(onChange).not.toHaveBeenCalled();
    key("Enter");
    expect(onChange).toHaveBeenLastCalledWith("garden");
    expect(document.activeElement).toBe(trigger());
    fireEvent.click(trigger());
    expect(active()?.getAttribute("aria-label")).toBe("Garden");
    key("End");
    key("ArrowDown");
    expect(active()?.getAttribute("aria-label")).toBe("Workshop");
    key(" ");
    expect(onChange).toHaveBeenLastCalledWith("workshop");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("dismisses Escape without changing the selection or propagating to the office", () => {
    const onChange = vi.fn();
    const parentEscape = vi.fn();
    render(
      <div onKeyDown={parentEscape}>
        <Harness onChange={onChange} />
      </div>,
    );
    fireEvent.click(trigger());
    key("End");
    key("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(onChange).not.toHaveBeenCalled();
    expect(parentEscape).not.toHaveBeenCalled();
    fireEvent.click(trigger());
    expect(active()?.getAttribute("aria-label")).toBe("All projects");
  });

  it("supports repeated click, close/reopen and idempotent reselection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    for (let i = 0; i < 8; i += 1) {
      await user.click(trigger());
      expect(screen.getAllByRole("listbox")).toHaveLength(1);
      await user.click(trigger());
      expect(screen.queryByRole("listbox")).toBeNull();
    }
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "Garden" }));
    expect(document.activeElement).toBe(trigger());
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "Garden" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(trigger().textContent).toContain("Garden");
  });

  it("closes on Tab and Shift+Tab without trapping or losing keyboard focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.tab();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "After" }),
    );
    await user.click(trigger());
    await user.tab({ shift: true });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Before" }),
    );
  });

  it("returns focus on blank-area dismissal but respects an outside control's focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.click(screen.getByText("Outside"));
    expect(document.activeElement).toBe(trigger());
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "After" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "After" }),
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("supports typeahead, preserves identity across reorder/rename, and recovers removed rows", () => {
    const rendered = render(<Harness />);
    fireEvent.click(trigger());
    key("s");
    const oldStudio = active();
    expect(oldStudio?.getAttribute("aria-label")).toBe("Studio");
    rendered.rerender(
      <Harness
        options={[projects[0], projects[2], projects[1], projects[3]].map(
          (option) =>
            option.value === "studio"
              ? { ...option, label: "Studio renamed" }
              : option,
        )}
      />,
    );
    expect(active()).toBe(oldStudio);
    expect(active()?.getAttribute("aria-label")).toBe("Studio renamed");
    rendered.rerender(
      <Harness options={[projects[0], projects[1], projects[3]]} />,
    );
    expect(active()?.getAttribute("aria-label")).toBe("All projects");
    rendered.rerender(<Harness options={projects} />);
    expect(active()?.getAttribute("aria-label")).toBe("All projects");
    key("g");
    key("a");
    expect(active()?.getAttribute("aria-label")).toBe("Garden");
  });

  it("uses total, collision-safe DOM IDs for hostile and truncated Unicode project identities", () => {
    const oddIds = [
      "\ud800",
      "\ud801",
      "\ufffd",
      "\\ud800",
      "🪴".repeat(120).slice(0, 239),
      "all",
    ];
    render(
      <Harness
        options={oddIds.map((value, index) => ({
          value,
          label: `Project ${index}`,
        }))}
      />,
    );
    fireEvent.click(trigger());
    const rows = screen.getAllByRole("option");
    expect(new Set(rows.map((row) => row.id)).size).toBe(oddIds.length);
    key("Home");
    expect(active()).toBe(rows[0]);
    key("Enter");
    fireEvent.click(trigger());
    expect(active()?.getAttribute("aria-label")).toBe("Project 0");
    expect(active()?.getAttribute("aria-selected")).toBe("true");
  });

  it("does not let a dismissed popup's delayed focus restoration steal a newer selection", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    fireEvent.pointerDown(screen.getByText("Outside"));
    fireEvent.click(trigger());
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(document.activeElement).toBe(listbox());
    key("End");
    key("Enter");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on window deactivation and removes global listeners on unmount", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const rendered = render(<Harness />);
    fireEvent.click(trigger());
    fireEvent(window, new Event("blur"));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger());
    rendered.unmount();
    expect(
      remove.mock.calls.filter(([name]) => name === "pointerdown"),
    ).toHaveLength(2);
  });

  it.each([
    { width: 440, height: 260, popupTop: 104, bottom: 254, expected: 140 },
    { width: 640, height: 380, popupTop: 132, bottom: 372, expected: 230 },
    { width: 1200, height: 300, popupTop: 104, bottom: 294, expected: 180 },
    { width: 460, height: 900, popupTop: 104, bottom: 894, expected: 236 },
    { width: 1360, height: 880, popupTop: 132, bottom: 872, expected: 236 },
    { width: 320, height: 200, popupTop: 104, bottom: 194, expected: 80 },
  ])(
    "bounds 80 projects inside $width×$height and recalculates after resizing",
    ({ width, height, popupTop, bottom, expected }) => {
      vi.stubGlobal("innerHeight", height);
      vi.stubGlobal("innerWidth", width);
      let boundaryBottom = bottom;
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        return {
          top: this.classList.contains("project-filter-listbox") ? popupTop : 6,
          bottom: this.classList.contains("companion")
            ? boundaryBottom
            : popupTop + 500,
          left: 0,
          right: width,
          width,
          height: 500,
          x: 0,
          y: 0,
          toJSON() {},
        };
      });
      render(
        <Harness
          options={[
            projects[0],
            ...Array.from({ length: 80 }, (_, i) => ({
              value: `project-${i}`,
              label: `Project ${i}: ${"long label ".repeat(8)}`,
            })),
          ]}
        />,
      );
      fireEvent.click(trigger());
      expect(screen.getAllByRole("option")).toHaveLength(81);
      expect(listbox().style.maxHeight).toBe(`${expected}px`);
      expect(
        popupTop + Number.parseInt(listbox().style.maxHeight),
      ).toBeLessThanOrEqual(bottom - 10);
      key("End");
      expect(active()?.getAttribute("aria-label")).toMatch(/^Project 79:/);
      boundaryBottom -= 20;
      fireEvent(window, new Event("resize"));
      expect(listbox().style.maxHeight).toBe(
        `${Math.min(236, boundaryBottom - popupTop - 10)}px`,
      );
      key("Enter");
      expect(trigger().textContent).toMatch(/^Project 79:/);
    },
  );

  it("shares the dock palette, bounds overflow, truncates labels and excludes popup hit areas from dragging", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const block = (selector: string) =>
      css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    expect(block(".dropdown-surface")).toContain("background: #fffdf5");
    expect(block(".dropdown-surface")).toContain("-webkit-app-region: no-drag");
    expect(block(".project-filter")).toContain("-webkit-app-region: no-drag");
    expect(block(".project-filter-option")).toContain(
      "-webkit-app-region: no-drag",
    );
    expect(block(".project-filter-listbox")).toContain("overflow-y: auto");
    expect(block(".project-filter-listbox")).toContain("calc(100vw - 52px)");
    expect(block(".project-filter-value")).toContain("text-overflow: ellipsis");
    expect(block('.project-filter-option[aria-selected="true"]')).toContain(
      "background: #e8ecdd",
    );
    expect(block(".options-panel")).toContain("max-height: calc(100% - 51px)");
    expect(css).toContain("max-height: calc(100% - 59px)");
    expect(css).not.toContain(".project-filter select");
  });
});

const session = (id: string): Session => ({
  id,
  name: `${id} session`,
  cwd: `/work/${id}`,
  connectionState: "live",
  agents: [
    {
      id: id + "-agent",
      name: `${id} agent`,
      state: "working",
      task: `Build ${id}`,
    },
  ],
});
async function showApp(shortcutAvailable = true) {
  let state: CompanionState = {
    ...initialState,
    shortcutAvailable,
    connection: { status: "live", lastSuccessAt: 1234, error: null },
    snapshot: {
      updatedAt: 1234,
      revision: 1,
      sessions: [session("garden"), session("studio")],
    },
  };
  let listener: (value: CompanionState) => void = () => {};
  const command = vi.fn(async () => undefined);
  window.companion = {
    getState: async () => state,
    onState(callback) {
      listener = callback;
      return () => {};
    },
    command,
  };
  render(<App />);
  await screen.findByRole("button", { name: "Filter by project" });
  return {
    command,
    push(sessions: Session[]) {
      state = {
        ...state,
        snapshot: { updatedAt: 5678, revision: 2, sessions },
      };
      act(() => listener(state));
    },
  };
}

describe("companion dropdown integration", () => {
  it("shows just one popup at a time and keeps resident DOM identities across open/close", async () => {
    const user = userEvent.setup();
    await showApp();
    const resident = screen.getByRole("button", {
      name: "garden agent, Working, garden",
    });
    const options = screen.getByRole("button", { name: "Companion options" });
    await user.click(trigger());
    await user.click(options);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Window options" })).toBeTruthy();
    await user.click(trigger());
    expect(screen.queryByRole("dialog", { name: "Window options" })).toBeNull();
    expect(listbox()).toBeTruthy();
    key("Escape");
    expect(
      screen.getByRole("button", { name: "garden agent, Working, garden" }),
    ).toBe(resident);
  });

  it.each(["pointer", "keyboard"])(
    "clears a failed-action overlay before reopening options with %s",
    async (input) => {
      const user = userEvent.setup();
      const { command } = await showApp();
      const options = screen.getByRole("button", { name: "Companion options" });
      command.mockRejectedValueOnce(new Error("IPC unavailable"));
      await user.click(options);
      await user.click(screen.getByRole("button", { name: /Compact size/ }));
      await screen.findByText("Couldn't change the window size. Try again.");
      if (input === "pointer") await user.click(options);
      else fireEvent.keyDown(options, { key: "ArrowDown" });
      expect(document.querySelector(".notice")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Click-through lock" }),
      );
      await user.click(screen.getByRole("button", { name: "Connect Pi…" }));
      expect(command).toHaveBeenNthCalledWith(1, "compact");
      expect(command).toHaveBeenNthCalledWith(2, "connect-pi");
      expect(document.activeElement).toBe(options);
      expect(
        screen.queryByRole("dialog", { name: "Window options" }),
      ).toBeNull();
    },
  );

  it.each(["pointer", "keyboard"])(
    "clears a failed-action overlay before opening projects with %s",
    async (input) => {
      const user = userEvent.setup();
      const { command } = await showApp();
      command.mockRejectedValueOnce(new Error("IPC unavailable"));
      await user.click(screen.getByRole("button", { name: "Always on top" }));
      await screen.findByText("Couldn't change always-on-top. Try again.");
      if (input === "pointer") await user.click(trigger());
      else fireEvent.keyDown(trigger(), { key: "ArrowDown" });
      expect(document.querySelector(".notice")).toBeNull();
      expect(document.activeElement).toBe(listbox());
      await user.click(screen.getByRole("option", { name: "studio" }));
      expect(trigger().textContent).toContain("studio");
      expect(document.activeElement).toBe(trigger());
      expect(screen.queryByRole("listbox")).toBeNull();
    },
  );

  it("prevents an older pending rejection from covering a newly opened popup", async () => {
    const user = userEvent.setup();
    const { command } = await showApp();
    let reject!: (error: Error) => void;
    command.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Always on top" }));
    await user.click(trigger());
    await act(async () => reject(new Error("IPC unavailable")));
    expect(document.querySelector(".notice")).toBeNull();
    expect(document.activeElement).toBe(listbox());
    key("Escape");
    expect(document.activeElement).toBe(trigger());
  });

  it("preserves selected project through snapshots and recovers focus when its control disappears", async () => {
    const { push } = await showApp();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "studio" }));
    push([session("studio"), session("garden")]);
    expect(trigger().textContent).toContain("studio");
    expect(
      screen.queryByRole("button", { name: "garden agent, Working, garden" }),
    ).toBeNull();
    fireEvent.click(trigger());
    push([session("garden")]);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "garden agent, Working, garden" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Companion options" }),
    );
  });

  it("navigates options with Arrow/Home/End, skips disabled lock and restores trigger focus after action", async () => {
    const { command } = await showApp(false);
    const options = screen.getByRole("button", { name: "Companion options" });
    fireEvent.keyDown(options, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Compact size/ }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Quit companion" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Compact size/ }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Quit companion" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(options);
    fireEvent.keyDown(options, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Quit companion" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Roomy size/ }));
    expect(command).toHaveBeenCalledExactlyOnceWith("roomy");
    expect(document.activeElement).toBe(options);
    expect(screen.queryByRole("dialog", { name: "Window options" })).toBeNull();
  });

  it("keeps native Tab order inside the non-modal options dialog and dismisses at the boundary", async () => {
    const user = userEvent.setup();
    await showApp();
    const options = screen.getByRole("button", { name: "Companion options" });
    await user.click(options);
    const buttons = within(
      screen.getByRole("dialog", { name: "Window options" }),
    ).getAllByRole("button");
    for (const button of buttons.slice(1)) {
      await user.tab();
      expect(document.activeElement).toBe(button);
      expect(
        screen.getByRole("dialog", { name: "Window options" }),
      ).toBeTruthy();
    }
    await user.tab();
    expect(screen.queryByRole("dialog", { name: "Window options" })).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses options on Shift+Tab, outside click and deactivation, and reopens cleanly", async () => {
    const user = userEvent.setup();
    await showApp();
    const options = screen.getByRole("button", { name: "Companion options" });
    await user.click(options);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(options);
    expect(screen.queryByRole("dialog", { name: "Window options" })).toBeNull();
    await user.click(options);
    await user.click(screen.getByText("A good day to build."));
    expect(document.activeElement).toBe(options);
    expect(screen.queryByRole("dialog", { name: "Window options" })).toBeNull();
    await user.click(options);
    fireEvent(window, new Event("blur"));
    expect(screen.queryByRole("dialog", { name: "Window options" })).toBeNull();
    await user.click(options);
    expect(
      within(
        screen.getByRole("dialog", { name: "Window options" }),
      ).getAllByRole("button"),
    ).toHaveLength(6);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Click-through lock" }),
      ),
    );
  });
});
