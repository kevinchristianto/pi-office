export const stateColor = (state: string) =>
  ({
    working: "#80cfa4",
    thinking: "#b5a4e3",
    waiting: "#e1bd7d",
    completed: "#8ab9b4",
    done: "#8ab9b4",
    idle: "#abbab6",
    error: "#e48f82",
    stale: "#dfb16a",
    offline: "#83918d",
  })[state] || "#abbab6";
