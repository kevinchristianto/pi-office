import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import "./room-selector.css";

export type RoomOption = {
  value: string;
  label: string;
  description?: string;
};

type RoomSelectorProps = {
  value: string;
  options: RoomOption[];
  onChange: (value: string) => void;
};

const roomColors = ["#aec5a1", "#d6ba82", "#a7bec3", "#c7a7a0"];
function roomColor(value: string) {
  if (value === "all") return "#e4dbad";
  let hash = 0;
  for (const character of value)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return roomColors[(hash >>> 0) % roomColors.length];
}

/** A single-select listbox. Keyboard handling stays inside the open control. */
export default function RoomSelector({
  value,
  options,
  onChange,
}: RoomSelectorProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const tabbing = useRef(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const selected = options.find((option) => option.value === value);
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === activeValue),
  );
  const activeId = options.length ? `${id}-option-${activeIndex}` : undefined;
  const label =
    selected?.label ??
    (options.length ? "Choose a project" : "No projects available");

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function choose(option: RoomOption) {
    close();
    if (option.value !== value) onChange(option.value);
  }

  useEffect(() => {
    if (!open) return;
    listbox.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        // A clicked input/button can still receive focus through its default action.
        setOpen(false);
        restoreTimer.current = setTimeout(() => {
          if (document.activeElement === document.body) {
            trigger.current?.focus({ preventScroll: true });
          }
        }, 0);
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open]);

  useEffect(
    () => () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (open && !options.length) setOpen(false);
    if (open && activeId) {
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [open, activeId, options.length]);

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
        if (options[activeIndex]) choose(options[activeIndex]);
        break;
      case "Escape":
        close();
        break;
      case "Tab":
        // Wait for the browser to move focus, then dismiss from onBlur.
        tabbing.current = true;
        return;
      default:
        // In particular, do not capture WASD or Tab. Tab follows the page order.
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (options[nextIndex]) setActiveValue(options[nextIndex].value);
  }

  return (
    <div
      className={`room-selector${open ? " is-open" : ""}`}
      ref={root}
      onBlur={(event) => {
        if (
          tabbing.current ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          tabbing.current = false;
          close(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="room-selector-trigger"
        aria-label="Choose session room"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-describedby={`${id}-selection`}
        disabled={!options.length}
        title={label}
        onClick={() => {
          if (open) close();
          else {
            setActiveValue(selected?.value ?? options[0]?.value ?? null);
            setOpen(true);
          }
        }}
      >
        <span
          className="room-selector-swatch"
          style={{ backgroundColor: roomColor(value) }}
          aria-hidden="true"
        />
        <span className="room-selector-caption" aria-hidden="true">
          PROJECT
        </span>
        <span className="room-selector-value" id={`${id}-selection`}>
          {label}
        </span>
        <ChevronDown
          className="room-selector-chevron"
          size={13}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="room-selector-menu">
          <div className="room-selector-heading" aria-hidden="true">
            PROJECT SECTIONS
          </div>
          <div
            ref={listbox}
            id={`${id}-listbox`}
            className="room-selector-listbox"
            role="listbox"
            aria-label="Session rooms"
            aria-activedescendant={activeId}
            tabIndex={-1}
            onKeyDown={handleKeys}
          >
            {options.map((option, index) => (
              <div
                id={`${id}-option-${index}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                aria-label={option.label}
                aria-describedby={
                  option.description ? `${id}-description-${index}` : undefined
                }
                className={`room-selector-option${index === activeIndex ? " is-active" : ""}`}
                title={option.label}
                onPointerMove={() => setActiveValue(option.value)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span
                  className="room-selector-swatch"
                  style={{ backgroundColor: roomColor(option.value) }}
                  aria-hidden="true"
                />
                <span className="room-selector-copy">
                  <span className="room-selector-option-label">
                    {option.label}
                  </span>
                  {option.description && (
                    <span
                      className="room-selector-description"
                      id={`${id}-description-${index}`}
                    >
                      {option.description}
                    </span>
                  )}
                </span>
                {option.value === value && (
                  <Check
                    className="room-selector-check"
                    size={14}
                    aria-hidden="true"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
