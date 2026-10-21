import { useTerminalDimensions } from "@opentui/react";
import { useMemo } from "react";
import { colors } from "../theme";
import { useTicker } from "./motion";

const STAR_TICK_MS = 140;

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

interface Star {
  char: string;
  id: number;
  phase: number;
  speed: number;
  x: number;
  y: number;
}

function starfield(width: number, height: number) {
  const next = random(width * 7919 + height * 104729 + 17);
  const stars: Star[] = [];
  const count = Math.max(16, Math.min(42, Math.round((width * height) / 170)));
  const minY = 4;
  const maxY = height - 12;
  if (maxY <= minY) return stars;
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 12) {
    attempts++;
    const x = 2 + Math.floor(next() * Math.max(1, width - 4));
    const y = minY + Math.floor(next() * Math.max(1, maxY - minY));
    const bright = next();
    stars.push({
      char: bright > 0.9 ? "+" : bright > 0.58 ? "·" : "˙",
      id: placed,
      phase: next() * Math.PI * 2,
      speed: 0.06 + next() * 0.22,
      x,
      y,
    });
    placed++;
  }
  return stars;
}

interface BackdropProps {
  active?: boolean;
  dimmed?: boolean;
}

export function Backdrop({
  active = true,
  dimmed = false,
}: BackdropProps = {}) {
  const { width, height } = useTerminalDimensions();
  const tick = useTicker(STAR_TICK_MS, active);
  const stars = useMemo(() => starfield(width, height), [height, width]);
  const palette = dimmed
    ? [colors.faint, colors.faint, colors.star, colors.starBright]
    : [colors.faint, colors.star, colors.starBright, colors.accent];
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={0}
      backgroundColor={colors.bg}
      overflow="hidden"
    >
      {stars.map((star) => {
        const wave = Math.sin(tick * star.speed + star.phase);
        const level = wave > 0.85 ? 3 : wave > 0.15 ? 2 : wave > -0.35 ? 1 : 0;
        return (
          <text
            key={star.id}
            position="absolute"
            top={star.y}
            left={star.x}
            fg={palette[level] ?? colors.faint}
          >
            {star.char}
          </text>
        );
      })}
    </box>
  );
}
