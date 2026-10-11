import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "../src/types";

const scene = vi.hoisted(() => ({
  props: {} as any,
  sessions: [] as Session[],
}));
vi.mock("../src/Office", () => ({
  default: (props: any) => {
    scene.props = props;
    return <div data-testid="scene-placeholder" />;
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
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: any) => <div>{children}</div>,
}));

import App from "../src/App";
import AgentBubble from "../src/AgentBubble";
import { consumeVisualCommand } from "../src/lifecycleWalking";
import { projectOffices } from "../src/projectProjection";

beforeEach(() => {
  scene.sessions = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function selectNova() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Explore demo", exact: true }),
  );
  await user.click(screen.getByRole("button", { name: "Open agent roster" }));
  await user.click(screen.getByRole("button", { name: /Nova/ }));
  return user;
}

describe("pre-publication frontend interaction audit", () => {
  it("reopens the roster without leaving an overlapping detail panel above it", async () => {
    render(<App />);
    const user = await selectNova();
    await user.click(
      screen.getByRole("button", { name: "Inspect", exact: true }),
    );
    expect(screen.getByText("AGENT DETAILS")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open agent roster" }));
    expect(screen.getByRole("textbox", { name: "Search agents" })).toBeTruthy();
    expect(screen.queryByText("AGENT DETAILS")).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Search agents" })).toBeNull();
    expect(screen.getByRole("region", { name: "Selected agent" })).toBeTruthy();
  });

  it("opening Inspect closes the roster so Escape dismisses the visible panel", async () => {
    render(<App />);
    const user = await selectNova();
    await user.click(screen.getByRole("button", { name: "Open agent roster" }));
    await user.click(
      screen.getByRole("button", { name: "Inspect", exact: true }),
    );
    expect(screen.getByText("AGENT DETAILS")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Search agents" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("AGENT DETAILS")).toBeNull();
  });

  it("keeps repeated visual commands unique even when the wall clock is unchanged", async () => {
    render(<App />);
    await selectNova();
    vi.spyOn(Date, "now").mockReturnValue(5000);
    const reservations = new Map<string, string>();
    const consume = () => {
      const command = scene.props.command;
      return consumeVisualCommand(
        reservations,
        command.id,
        `${command.id}:${command.type}:${command.serial}`,
      );
    };
    for (let repeat = 0; repeat < 3; repeat++) {
      fireEvent.click(
        screen.getByRole("button", { name: "Wave", exact: true }),
      );
      expect(consume()).toBe(true);
    }
    const priorSerial = scene.props.command.serial;
    fireEvent.click(
      screen.getByRole("button", { name: "Open workplace overview" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Break room/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Resident" }), {
      target: { value: "web-ui" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wave hello" }));
    expect(scene.props.command.serial).toBeGreaterThan(priorSerial);
    expect(consume()).toBe(true);
    const beforeModeChange = scene.props.command.serial;
    fireEvent.click(screen.getByRole("button", { name: "Live", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "Explore demo", exact: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open agent roster" }));
    fireEvent.click(screen.getByRole("button", { name: /Nova/ }));
    fireEvent.click(screen.getByRole("button", { name: "Wave", exact: true }));
    expect(scene.props.command.serial).toBeGreaterThan(beforeModeChange);
    expect(consume()).toBe(true);
  });

  it("keeps keyboard focus inside the guide after focus is lost or moved outside", async () => {
    const user = userEvent.setup();
    render(<App />);
    const opener = screen.getByRole("button", { name: "Open guide" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Office guide" });
    const close = within(dialog).getByRole("button", { name: "Close guide" });
    act(() => close.blur());
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    act(() =>
      screen.getByRole("button", { name: "Open workplace overview" }).focus(),
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("pre-publication reported-data audit", () => {
  it("uses each projected resident's reported source model in the bubble, with an agent override", () => {
    const [office] = projectOffices([
      {
        id: "left",
        name: "Left session",
        cwd: "/work/shared",
        model: "source-left-model",
        agents: [{ id: "main", name: "Left agent", state: "working" }],
      },
      {
        id: "right",
        name: "Right session",
        cwd: "/work/shared",
        model: "source-right-model",
        agents: [{ id: "main", name: "Right agent", state: "working" }],
      },
    ]);
    const props = {
      selected: false,
      hovered: true,
      mode: "compact" as const,
      onSelect: () => {},
      onHover: () => {},
    };
    const mounted = render(<AgentBubble {...props} agent={office.agents[0]} />);
    expect(screen.getByText("source-left-model")).toBeTruthy();
    mounted.rerender(<AgentBubble {...props} agent={office.agents[1]} />);
    expect(screen.getByText("source-right-model")).toBeTruthy();
    expect(screen.queryByText("source-left-model")).toBeNull();
    mounted.rerender(
      <AgentBubble
        {...props}
        agent={{ ...office.agents[1], model: "agent-model" }}
      />,
    );
    expect(screen.getByText("agent-model")).toBeTruthy();
    expect(screen.queryByText("source-right-model")).toBeNull();
  });
});
