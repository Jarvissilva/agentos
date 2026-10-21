import { useEffect, useState } from "react";

/** Advances once per interval while active, and freezes when inactive. */
export function useTicker(intervalMs: number, active = true) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(
      () => setTick((value) => (value + 1) % 1_000_000),
      intervalMs,
    );
    return () => clearInterval(interval);
  }, [active, intervalMs]);
  return tick;
}

function parseHex(value: string) {
  const hex = value.replace("#", "");
  if (hex.length !== 6) return [0, 0, 0] as const;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ] as const;
}

export function mixHex(from: string, to: string, amount: number) {
  const start = parseHex(from);
  const end = parseHex(to);
  const t = Math.max(0, Math.min(1, amount));
  const channel = (index: number) =>
    Math.round(
      (start[index] ?? 0) + ((end[index] ?? 0) - (start[index] ?? 0)) * t,
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
