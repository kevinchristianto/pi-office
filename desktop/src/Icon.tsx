export function Icon({
  name,
}: {
  name:
    "open" | "pin" | "menu" | "close" | "expand" | "back" | "leaf" | "history";
}) {
  const paths = {
    open: (
      <>
        <path d="M10 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5" />
        <path d="M12 3h5v5M17 3l-8 8" />
      </>
    ),
    pin: (
      <>
        <path d="m12 3 5 5-3 1-3 4-2-2-4 4M9 11 6 8l4-2 2-3" />
      </>
    ),
    menu: (
      <>
        <circle cx="4" cy="10" r="1" />
        <circle cx="10" cy="10" r="1" />
        <circle cx="16" cy="10" r="1" />
      </>
    ),
    close: <path d="m5 5 10 10M15 5 5 15" />,
    expand: (
      <>
        <path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
      </>
    ),
    back: <path d="m11 4-6 6 6 6M5 10h11" />,
    leaf: (
      <>
        <path d="M16 3C6 2 2 8 6 13c5 5 11-1 10-10Z" />
        <path d="M4 17 12 8" />
      </>
    ),
    history: (
      <>
        <path d="M3 9a7 7 0 1 1 2 6M3 4v5h5M10 6v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
