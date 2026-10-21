import { useTerminalDimensions } from "@opentui/react";
import { useMemo } from "react";
import { colors } from "../theme";

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

function starfield(width: number, height: number) {
  const next = random(width * 7919 + height * 104729 + 17);
  const stars: { x: number; y: number; char: string; color: string }[] = [];
  const count = Math.max(14, Math.min(34, Math.round((width * height) / 150)));
  const center = width / 2;
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 10) {
    attempts++;
    const x = 1 + Math.floor(next() * Math.max(1, width - 2));
    const y = 1 + Math.floor(next() * Math.max(1, height - 12));
    const clearBand =
      Math.abs(x - center) < width * 0.36 && y >= 4 && y <= height - 13;
    if (clearBand) continue;
    const bright = next();
    stars.push({
      x,
      y,
      char: bright > 0.88 ? "+" : bright > 0.55 ? "·" : "˙",
      color:
        bright > 0.88
          ? colors.starBright
          : bright > 0.55
            ? colors.star
            : colors.faint,
    });
    placed++;
  }
  return stars;
}

interface Segment {
  id: number;
  text: string;
  color: string;
}

function planetRows(width: number, height: number) {
  const rows: { y: number; segments: Segment[] }[] = [];
  let segmentId = 0;
  const dome = Math.max(3, Math.min(5, Math.floor(height / 7)));
  const top = Math.max(2, height - dome - 3);
  const center = width / 2;
  for (let y = 0; y < height; y++) {
    const chars: string[] = [];
    const colorsAt: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const offset = (x - center + 0.5) / center;
      const edge = top + Math.round(dome * offset * offset);
      let char = " ";
      let color: string | null = null;
      if (y >= edge) {
        if (y === edge) {
          char = "▄";
          color = colors.rim;
        } else if (y === edge + 1) {
          char = "█";
          color = colors.rimSoft;
        } else if (y === edge + 2) {
          char = "█";
          color = colors.planet;
        } else {
          char = "█";
          color = y >= height - 2 ? "#06101a" : "#091624";
        }
      } else if (y === edge - 1 && x % 3 === 0) {
        char = "·";
        color = colors.atmosphere;
      }
      chars.push(char);
      colorsAt.push(color);
    }
    const segments: Segment[] = [];
    let text = "";
    let current: string | null = null;
    for (let x = 0; x < width; x++) {
      const color = colorsAt[x] ?? null;
      if (color !== current && text) {
        segments.push({
          id: segmentId++,
          text,
          color: current ?? colors.bg,
        });
        text = "";
      }
      current = color;
      text += chars[x] ?? " ";
    }
    if (text)
      segments.push({
        id: segmentId++,
        text,
        color: current ?? colors.bg,
      });
    rows.push({ y, segments });
  }
  return rows;
}

export function Backdrop() {
  const { width, height } = useTerminalDimensions();
  const stars = useMemo(() => starfield(width, height), [width, height]);
  const planet = useMemo(() => planetRows(width, height), [width, height]);
  const grid = useMemo(() => {
    const rows: { y: number; line: string }[] = [];
    if (height < 22) return rows;
    const center = width / 2;
    for (let y = 8; y < height - 12; y += 3) {
      let line = "";
      for (let x = 0; x < width; x++)
        line += x % 9 === 4 && Math.abs(x - center) >= width * 0.36 ? "·" : " ";
      rows.push({ y, line });
    }
    return rows;
  }, [width, height]);

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
      {grid.map((row) => (
        <text
          key={`grid-${row.y}`}
          position="absolute"
          top={row.y}
          left={0}
          fg={colors.grid}
          wrapMode="none"
        >
          {row.line}
        </text>
      ))}
      {stars.map((star) => (
        <text
          key={`star-${star.x}-${star.y}-${star.char}`}
          position="absolute"
          top={star.y}
          left={star.x}
          fg={star.color}
        >
          {star.char}
        </text>
      ))}
      {planet.map((row) => (
        <box
          key={`planet-${row.y}`}
          position="absolute"
          top={row.y}
          left={0}
          width={width}
          height={1}
        >
          <text wrapMode="none">
            {row.segments.map((segment) => (
              <span key={segment.id} fg={segment.color}>
                {segment.text}
              </span>
            ))}
          </text>
        </box>
      ))}
    </box>
  );
}
