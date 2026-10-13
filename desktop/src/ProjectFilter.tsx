import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface ProjectOption {
  value: string;
  label: string;
  description?: string;
}

/** A select-only listbox. Project identities, rather than row positions, own selection. */
export function ProjectFilter({
  value,
  options,
  open,
  onOpenChange,
  onChange,
}: {
  value: string;
  options: ProjectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const [activeValue, setActiveValue] = useState(value);
  const [maxHeight, setMaxHeight] = useState<number>();
  const search = useRef({ text: "", at: 0 });
  const tabbing = useRef(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = options.find((option) => option.value === value);
  const active =
    options.find((option) => option.value === activeValue) ??
    selected ??
    options[0];
  const activeIndex = options.findIndex(
    (option) => option.value === active?.value,
  );
  const optionId = (optionValue: string) =>
    `${id}-${encodeURIComponent(JSON.stringify(optionValue))}`;

  function close(restoreFocus = true) {
    onOpenChange(false);
    search.current = { text: "", at: 0 };
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function show(next = selected ?? options[0]) {
    if (!next) return;
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    setActiveValue(next.value);
    search.current = { text: "", at: 0 };
    onOpenChange(true);
  }
  function choose(option: ProjectOption) {
    close();
    if (option.value !== value) onChange(option.value);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const popup = listbox.current;
    const boundary = root.current?.closest(".companion");
    const updateHeight = () => {
      if (!popup) return;
      const bottom = Math.min(
        window.innerHeight,
        boundary?.getBoundingClientRect().bottom || window.innerHeight,
      );
      setMaxHeight(
        Math.max(
          0,
          Math.min(236, bottom - popup.getBoundingClientRect().top - 10),
        ),
      );
    };
    updateHeight();
    popup?.focus({ preventScroll: true });
    window.addEventListener("resize", updateHeight);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateHeight);
    if (boundary) observer?.observe(boundary);
    const content = root.current?.closest(".office-content");
    if (content) observer?.observe(content);
    return () => {
      window.removeEventListener("resize", updateHeight);
      observer?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!options.length) {
      onOpenChange(false);
      return;
    }
    if (active) {
      if (active.value !== activeValue) {
        setActiveValue(active.value);
        search.current = { text: "", at: 0 };
      }
      // Reordering, renaming and replacing snapshots must not change the active project.
      const option = document.getElementById(optionId(active.value));
      option?.scrollIntoView?.({ block: "nearest" });
    }
  }, [
    open,
    active?.value,
    activeValue,
    activeIndex,
    options.length,
    id,
    onOpenChange,
  ]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        onOpenChange(false);
        trigger.current?.focus({ preventScroll: true });
        // A blank-area mousedown may subsequently blur the trigger. Restore only
        // an otherwise lost focus; never steal it from the next control or popup.
        if (restoreTimer.current) clearTimeout(restoreTimer.current);
        restoreTimer.current = setTimeout(() => {
          restoreTimer.current = null;
          if (document.activeElement === document.body)
            trigger.current?.focus({ preventScroll: true });
        }, 0);
      }
    };
    const deactivate = () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", deactivate);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", deactivate);
    };
  }, [open, onOpenChange]);

  useEffect(
    () => () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    },
    [],
  );

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    let nextIndex = activeIndex;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(options.length - 1, activeIndex + 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(0, activeIndex - 1);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = options.length - 1;
        break;
      case "Enter":
      case " ":
        if (active) choose(active);
        break;
      case "Escape":
        close();
        break;
      case "Tab":
        // Keep the listbox mounted until the browser moves focus; onBlur dismisses it.
        tabbing.current = true;
        return;
      default: {
        if (
          event.key.length !== 1 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const now = Date.now();
        const letter = event.key.toLocaleLowerCase();
        const previous =
          now - search.current.at < 700 ? search.current.text : "";
        const text = previous + letter;
        search.current = { text, at: now };
        const query = [...text].every((character) => character === letter)
          ? letter
          : text;
        const from = query.length === 1 ? activeIndex + 1 : activeIndex;
        for (let offset = 0; offset < options.length; offset += 1) {
          const index = (Math.max(0, from) + offset) % options.length;
          if (options[index].label.toLocaleLowerCase().startsWith(query)) {
            nextIndex = index;
            break;
          }
        }
      }
    }
    event.preventDefault();
    event.stopPropagation();
    if (options[nextIndex]) setActiveValue(options[nextIndex].value);
  }

  return (
    <div
      ref={root}
      className={`project-filter${open ? " is-open" : ""}`}
      onBlur={(event) => {
        if (
          open &&
          (tabbing.current ||
            !event.currentTarget.contains(event.relatedTarget))
        ) {
          tabbing.current = false;
          close(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="project-filter-trigger"
        aria-label="Filter by project"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-describedby={`${id}-selection`}
        disabled={!options.length}
        title={selected?.label ?? "Choose a project"}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (
            !["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (open && (event.key === "Enter" || event.key === " ")) close();
          else
            show(
              event.key === "End"
                ? options.at(-1)
                : event.key === "Home"
                  ? options[0]
                  : (selected ?? options[0]),
            );
        }}
      >
        <span id={`${id}-selection`} className="project-filter-value">
          {selected?.label ?? "Choose a project"}
        </span>
        <svg
          className="project-filter-chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m3 4.5 3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && options.length > 0 && (
        <div
          ref={listbox}
          id={`${id}-listbox`}
          className="project-filter-listbox dropdown-surface"
          role="listbox"
          aria-label="Projects"
          aria-activedescendant={active ? optionId(active.value) : undefined}
          tabIndex={-1}
          style={maxHeight === undefined ? undefined : { maxHeight }}
          onKeyDown={handleKeys}
        >
          {options.map((option) => (
            <div
              key={option.value}
              id={optionId(option.value)}
              role="option"
              aria-label={option.label}
              aria-selected={option.value === value}
              aria-describedby={
                option.description
                  ? `${optionId(option.value)}-description`
                  : undefined
              }
              className={`project-filter-option${option.value === active?.value ? " is-active" : ""}`}
              title={
                option.description
                  ? `${option.label}\n${option.description}`
                  : option.label
              }
              onPointerMove={() => setActiveValue(option.value)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span className="project-filter-copy">
                <span className="project-filter-name">{option.label}</span>
                {option.description && (
                  <span
                    className="project-filter-description"
                    id={`${optionId(option.value)}-description`}
                  >
                    {option.description}
                  </span>
                )}
              </span>
              <span className="project-filter-check" aria-hidden="true">
                {option.value === value ? "✓" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
