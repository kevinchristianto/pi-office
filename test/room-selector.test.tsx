import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoomSelector, { type RoomOption } from "../src/RoomSelector";

const options: RoomOption[] = [
  {
    value: "all",
    label: "Whole office",
    description: "Every connected session",
  },
  { value: "web", label: "Web project", description: "3 agents" },
  { value: "api", label: "API project", description: "2 agents" },
];

function Example({
  onChange = () => {},
}: {
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState("all");
  return (
    <>
      <RoomSelector
        value={value}
        options={options}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">Next control</button>
      <div>Office backdrop</div>
    </>
  );
}

function trigger() {
  return screen.getByRole("button", { name: "Choose session room" });
}

function activeOption() {
  return document.getElementById(
    screen.getByRole("listbox").getAttribute("aria-activedescendant")!,
  );
}

afterEach(() => cleanup());

describe("custom session room selector", () => {
  it("exposes its selected room and opens an accessible, focused listbox", async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().textContent).toContain("Whole office");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(trigger());
    const listbox = screen.getByRole("listbox", { name: "Session rooms" });
    expect(document.activeElement).toBe(listbox);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(listbox.id);
    expect(activeOption()).toBe(
      screen.getByRole("option", { name: "Whole office" }),
    );
    expect(
      screen
        .getByRole("option", { name: "Whole office" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "Web project" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("selects with the pointer, returns focus, and reopens with the selection active", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);
    for (const label of ["Web project", "API project", "Whole office"]) {
      await user.click(trigger());
      await user.click(screen.getByRole("option", { name: label }));
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(trigger().textContent).toContain(label);
      await user.click(trigger());
      expect(activeOption()?.textContent).toContain(label);
      await user.click(trigger());
      expect(screen.queryByRole("listbox")).toBeNull();
    }
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([
      "web",
      "api",
      "all",
    ]);
  });

  it("supports arrows, Home and End without selecting until Enter or Space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);
    trigger().focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    expect(activeOption()?.getAttribute("aria-label")).toBe("Web project");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{End}{ArrowDown}");
    expect(activeOption()?.getAttribute("aria-label")).toBe("API project");
    await user.keyboard("{Home}{ArrowUp}");
    expect(activeOption()?.getAttribute("aria-label")).toBe("Whole office");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("web");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await user.keyboard(" ");
    expect(activeOption()?.getAttribute("aria-label")).toBe("Web project");
    await user.keyboard("{ArrowDown} ");
    expect(onChange).toHaveBeenLastCalledWith("api");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("Escape cancels repeatedly and does not reach the scene Escape listener", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const sceneKeys = vi.fn();
    window.addEventListener("keydown", sceneKeys);
    try {
      render(<Example onChange={onChange} />);
      for (let count = 0; count < 3; count++) {
        await user.click(trigger());
        await user.keyboard("{ArrowDown}{Escape}");
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(document.activeElement).toBe(trigger());
        expect(trigger().textContent).toContain("Whole office");
      }
      expect(onChange).not.toHaveBeenCalled();
      expect(sceneKeys).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", sceneKeys);
    }
  });

  it("dismisses outside and respects focus on the clicked control", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);
    await user.click(trigger());
    await user.click(screen.getByText("Office backdrop"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await user.click(trigger());
    const nextControl = screen.getByRole("button", { name: "Next control" });
    await user.click(nextControl);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(nextControl);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Tab dismisses and continues through the page instead of trapping focus", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(trigger());
    await user.tab();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Next control" }),
    );
    await user.click(trigger());
    await user.tab({ shift: true });
    // The trigger immediately precedes the listbox in the tab order.
    expect(document.activeElement).toBe(trigger());
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("leaves closed arrows and global WASD keys unhandled", async () => {
    const user = userEvent.setup();
    const sceneKeys: { key: string; prevented: boolean }[] = [];
    const receive = (event: KeyboardEvent) =>
      sceneKeys.push({ key: event.key, prevented: event.defaultPrevented });
    window.addEventListener("keydown", receive);
    try {
      render(<Example />);
      trigger().focus();
      await user.keyboard("{ArrowDown}{ArrowUp}{Home}{End}wasd");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(sceneKeys.map(({ key }) => key)).toEqual([
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
        "w",
        "a",
        "s",
        "d",
      ]);
      expect(sceneKeys.every(({ prevented }) => !prevented)).toBe(true);
      sceneKeys.length = 0;
      await user.click(trigger());
      await user.keyboard("wasd");
      expect(sceneKeys.map(({ key }) => key)).toEqual(["w", "a", "s", "d"]);
      expect(sceneKeys.every(({ prevented }) => !prevented)).toBe(true);
      expect(activeOption()?.getAttribute("aria-label")).toBe("Whole office");
    } finally {
      window.removeEventListener("keydown", receive);
    }
  });

  it("keeps long room names complete in accessible labels and hover titles", async () => {
    const user = userEvent.setup();
    const longLabel =
      "My exceptionally long project name / packages / a very important session";
    render(
      <RoomSelector
        value="long"
        options={[
          {
            value: "long",
            label: longLabel,
            description: "An equally detailed room description",
          },
        ]}
        onChange={() => {}}
      />,
    );
    expect(trigger().title).toBe(longLabel);
    expect(trigger().querySelector(".room-selector-value")?.textContent).toBe(
      longLabel,
    );
    await user.click(trigger());
    const option = screen.getByRole("option", { name: longLabel });
    expect(option.title).toBe(longLabel);
    expect(
      document.getElementById(option.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("An equally detailed room description");
    expect(
      option.querySelector(".room-selector-option-label")?.textContent,
    ).toBe(longLabel);
  });

  it("handles rooms being removed while open and an empty collection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <RoomSelector value="all" options={options} onChange={onChange} />,
    );
    await user.click(trigger());
    await user.keyboard("{End}");
    rerender(
      <RoomSelector
        value="all"
        options={options.slice(0, 2)}
        onChange={onChange}
      />,
    );
    expect(activeOption()?.getAttribute("aria-label")).toBe("Whole office");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("web");
    await user.click(trigger());
    rerender(<RoomSelector value="all" options={[]} onChange={onChange} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
    expect(trigger().textContent).toContain("No projects available");
  });
});
