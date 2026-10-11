import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkplacePanel, {
  type WorkplacePanelProps,
} from "../src/WorkplacePanel";
import type { Session } from "../src/types";
const sessions: Session[] = [
  {
    id: "web",
    name: "Web project",
    cwd: "/work/web",
    agents: [
      {
        id: "nova",
        name: "Nova",
        state: "working",
        task: "Build the settings",
        tool: "Edit settings",
        logs: [
          { time: 2000, level: "tool", message: "Updated settings" },
          { time: 1000, level: "info", message: "Read settings" },
        ],
      },
      {
        id: "iris",
        name: "Iris",
        state: "error",
        task: "Check types",
        logs: [{ time: 3000, level: "error", message: "Types need review" }],
      },
    ],
  },
  {
    id: "api",
    name: "API project",
    agents: [
      { id: "fern", name: "Fern", state: "waiting", task: "Review API" },
      { id: "echo", name: "Echo", state: "offline" },
    ],
  },
];
function props(
  overrides: Partial<WorkplacePanelProps> = {},
): WorkplacePanelProps {
  return {
    sessions,
    mode: "live",
    connection: "connected",
    facility: "reception",
    onClose: vi.fn(),
    onSelect: vi.fn(),
    onFocusSession: vi.fn(),
    onOpenRoster: vi.fn(),
    ...overrides,
  };
}
function Example({ options = {} }: { options?: Partial<WorkplacePanelProps> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open workplace</button>
      <button>Background control</button>
      {open && (
        <WorkplacePanel
          {...props(options)}
          onClose={() => {
            options.onClose?.();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
afterEach(cleanup);
describe("shared workplace panel", () => {
  it("opens an explicitly named modal with truthful directory counts and focus", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Open workplace" }));
    const dialog = screen.getByRole("dialog", { name: "Reception" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close workplace" }),
    );
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("Pi is reporting");
    const counts = Array.from(dialog.querySelectorAll("dl > div")).map(
      (item) => [
        item.querySelector("dt")?.textContent,
        item.querySelector("dd")?.textContent,
      ],
    );
    expect(counts).toEqual([
      ["Projects", "2"],
      ["Current agents", "3"],
      ["Working / thinking", "1"],
      ["Review states", "3"],
    ]);
    expect(screen.getByText("Live observations")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Open project Web project" }),
    ).toBeDefined();
  });
  it("traps focus, dismisses repeatedly with Escape, and restores the opener", async () => {
    const user = userEvent.setup();
    const sceneKeys = vi.fn();
    window.addEventListener("keydown", sceneKeys);
    try {
      render(<Example />);
      const opener = screen.getByRole("button", { name: "Open workplace" });
      for (let repeat = 0; repeat < 3; repeat++) {
        await user.click(opener);
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Open project API project" }),
        );
        await user.tab();
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Close workplace" }),
        );
        screen.getByRole("button", { name: "Background control" }).focus();
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Close workplace" }),
        );
        sceneKeys.mockClear();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(opener);
        expect(sceneKeys).not.toHaveBeenCalled();
      }
      await user.keyboard("a");
      expect(sceneKeys).toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", sceneKeys);
    }
  });
  it("dismisses on its backdrop without dismissing from clicks inside", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Example options={{ onClose }} />);
    await user.click(screen.getByRole("button", { name: "Open workplace" }));
    await user.click(screen.getByRole("heading", { name: "Reception" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector(".workplace-backdrop")!);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Open workplace" }),
    );
  });
  it("navigates all four facilities and honors a newer facility selection", async () => {
    const user = userEvent.setup();
    const options = props();
    const { rerender } = render(<WorkplacePanel {...options} />);
    const nav = screen.getByRole("navigation", { name: "Shared facilities" });
    for (const label of [
      "Meeting room",
      "Operations",
      "Break room",
      "Reception",
    ]) {
      const button = within(nav).getByRole("button", {
        name: new RegExp(label),
      });
      await user.click(button);
      expect(screen.getByRole("dialog", { name: label })).toBeDefined();
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(
        within(nav)
          .getAllByRole("button")
          .filter((item) => item.getAttribute("aria-pressed") === "true"),
      ).toHaveLength(1);
    }
    rerender(<WorkplacePanel {...options} facility="operations" />);
    expect(screen.getByRole("dialog", { name: "Operations" })).toBeDefined();
  });
  it("opens directory projects, project briefs, or roster only on explicit clicks", async () => {
    const user = userEvent.setup();
    const options = props();
    const { rerender } = render(<WorkplacePanel {...options} />);
    expect(options.onFocusSession).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Open project API project" }),
    );
    expect(options.onFocusSession).toHaveBeenLastCalledWith("api");
    expect(options.onClose).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Browse agents" }));
    expect(options.onOpenRoster).toHaveBeenCalledOnce();
    rerender(<WorkplacePanel {...options} facility="meeting" />);
    expect(screen.getByText("Edit settings")).toBeDefined();
    expect(screen.getByText("/work/web")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Focus Web project" }));
    expect(options.onFocusSession).toHaveBeenLastCalledWith("web");
    expect(options.onSelect).not.toHaveBeenCalled();
  });
  it("sorts actual activity newest-first without mutating reports and exposes attention states", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(sessions);
    const options = props({ facility: "operations" });
    render(<WorkplacePanel {...options} />);
    const list = screen.getByRole("list", { name: "Reported activity" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("p")?.textContent),
    ).toEqual(["Types need review", "Updated settings", "Read settings"]);
    expect(
      screen.getByRole("button", { name: "Inspect Iris · Web project" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Inspect Fern · API project" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Inspect Echo · API project" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Inspect Nova · Web project" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", {
        name: "Inspect activity from Nova: Updated settings",
      }),
    );
    expect(options.onSelect).toHaveBeenCalledWith("nova");
    expect(options.onClose).toHaveBeenCalledOnce();
    expect(JSON.stringify(sessions)).toBe(before);
  });
  it("bounds activity to 80 entries and keeps invalid times honest", () => {
    const entries = Array.from({ length: 85 }, (_, index) => ({
      time: index * 1000,
      level: "info",
      message: `Event ${index}`,
    }));
    const many = [
      {
        id: "many",
        name: "Large project",
        agents: [{ id: "one", name: "One", state: "idle", logs: entries }],
      },
    ];
    const options = props({ sessions: many, facility: "operations" });
    const { rerender } = render(<WorkplacePanel {...options} />);
    const list = screen.getByRole("list", { name: "Reported activity" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(80);
    expect(
      within(list).getAllByRole("listitem")[0].querySelector("p")?.textContent,
    ).toBe("Event 84");
    expect(screen.getByText("80 of 85 entries")).toBeDefined();
    expect(screen.queryByText("Event 0")).toBeNull();
    rerender(
      <WorkplacePanel
        {...options}
        sessions={[
          {
            id: "invalid",
            name: "No clock",
            agents: [
              {
                id: "one",
                name: "One",
                state: "idle",
                logs: [
                  { time: "unknown", level: "info", message: "Untimed report" },
                  { time: 0, level: "info", message: "Epoch report" },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("Time not reported")).toBeDefined();
    expect(screen.getByText("Untimed report")).toBeDefined();
    expect(document.querySelector("time")?.dateTime).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(
      within(screen.getByRole("list", { name: "Reported activity" }))
        .getAllByRole("listitem")[0]
        .querySelector("p")?.textContent,
    ).toBe("Epoch report");
  });
  it("reports disconnected and empty states without invented activity", async () => {
    const user = userEvent.setup();
    const options = props({ sessions: [], connection: "disconnected" });
    render(<WorkplacePanel {...options} />);
    expect(screen.getByText("Disconnected · last received data")).toBeDefined();
    expect(screen.getByText(/No projects reported yet/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: /Operations/ }));
    expect(screen.getByText("No attention states reported.")).toBeDefined();
    expect(screen.getByText("No activity reported yet.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /Break room/ }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Take a break" })).toBeNull();
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(options.onFocusSession).not.toHaveBeenCalled();
  });
  it("uses sample labels in demo and routes break-room gestures as visual commands", async () => {
    const user = userEvent.setup();
    const onVisualCommand = vi.fn();
    const options = props({
      facility: "breakroom",
      mode: "demo",
      onVisualCommand,
    });
    render(<WorkplacePanel {...options} />);
    expect(screen.getByText("Demo data")).toBeDefined();
    expect(screen.getByText("Sample data · demo office")).toBeDefined();
    expect(
      screen.getByText("Visual interactions only. Pi continues independently."),
    ).toBeDefined();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Resident" }),
      "fern",
    );
    for (const [label, command] of [
      ["Take a break", "walk"],
      ["Wave hello", "wave"],
      ["Return to desk", "return"],
    ]) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(onVisualCommand).toHaveBeenLastCalledWith("fern", command);
    }
    expect(onVisualCommand).toHaveBeenCalledTimes(3);
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(sessions[1].agents[0].state).toBe("waiting");
  });
  it("recovers from a selected resident disappearing and supports read-only integration", async () => {
    const user = userEvent.setup();
    const options = props({ facility: "breakroom" });
    const { rerender } = render(<WorkplacePanel {...options} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Resident" }),
      "echo",
    );
    rerender(<WorkplacePanel {...options} sessions={sessions.slice(0, 1)} />);
    expect(
      (screen.getByRole("combobox", { name: "Resident" }) as HTMLSelectElement)
        .value,
    ).toBe("nova");
    await user.click(
      screen.getByRole("button", { name: "Open resident controls" }),
    );
    expect(options.onSelect).toHaveBeenCalledWith("nova");
    rerender(<WorkplacePanel {...options} sessions={[]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("retains long names in accessible actions and offers projects beyond the scene cap", async () => {
    const user = userEvent.setup();
    const longName =
      "Very long project name / packages / " + "workstation ".repeat(20);
    const options = props({
      sessions: Array.from({ length: 6 }, (_, index) => ({
        id: `project-${index}`,
        name: index === 5 ? longName : `Project ${index}`,
        agents: [],
      })),
    });
    render(<WorkplacePanel {...options} />);
    expect(
      screen.getByText(/overview displays four project sections/),
    ).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: `Open project ${longName}`.trim() }),
    );
    expect(options.onFocusSession).toHaveBeenCalledWith("project-5");
  });
});
