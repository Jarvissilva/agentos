import { useTerminalDimensions } from "@opentui/react";
import { useMemo } from "react";
import { colors } from "../theme";
import { mixHex, useTicker } from "./motion";

const TICK_MS = 66;
const DEG = Math.PI / 180;

interface Segment {
  color: string;
  id: number;
  text: string;
}

interface GlobeFrame {
  coreColor: string;
  coreLeft: number;
  coreTop: number;
  rows: { id: number; segments: Segment[] }[];
}

interface GlobeLayout {
  cols: number;
  left: number;
  rows: number;
  top: number;
}

interface GlobeProps {
  active?: boolean;
  dimmed?: boolean;
  insetBottom?: number;
  insetTop?: number;
}

const glowPalette = [
  colors.globeDeep,
  colors.globeBack,
  colors.globeMid,
  colors.globeLine,
  colors.globeHot,
] as const;

const dimPalette = [
  colors.globeDeep,
  colors.globeDeep,
  colors.globeBack,
  colors.globeMid,
  colors.globeLine,
] as const;

function layoutGlobe(
  width: number,
  height: number,
  insetTop: number,
  insetBottom: number,
): GlobeLayout | null {
  const available = height - insetTop - insetBottom - 1;
  if (available < 6 || width < 32) return null;
  const rows = Math.min(24, available, Math.floor((width - 8) / 2.2));
  if (rows < 6) return null;
  const cols = Math.max(18, Math.round(rows * 2.2));
  return {
    cols,
    left: Math.max(0, Math.floor((width - cols) / 2)),
    rows,
    top: insetTop + Math.max(0, Math.floor((available - rows) / 2)),
  };
}

function glyphFor(kind: number) {
  if (kind <= 0) return "█";
  if (kind >= 3) return "+";
  if (kind >= 2) return "•";
  return "·";
}

function renderGlobe(
  cols: number,
  rows: number,
  tick: number,
  dimmed: boolean,
): GlobeFrame {
  const cx = cols / 2;
  const cy = rows / 2;
  const ry = Math.max(2.4, rows * 0.38);
  const rx = ry * 2;
  const levels = new Uint8Array(cols * rows);
  const glyphs = new Uint8Array(cols * rows);
  const yaw = tick * 0.013;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const tilt = 0.26;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const scanLat = Math.sin(tick * 0.028) * 62;
  const shift = dimmed ? 1 : 0;
  const palette = dimmed ? dimPalette : glowPalette;
  const detail = rows >= 20 ? 4 : rows >= 12 ? 3 : 5;
  const spiralStep = rows >= 20 ? 0.0035 : 0.0025;

  const plot = (x: number, y: number, level: number, kind = 1) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= cols || py >= rows) return;
    const value = Math.max(1, Math.min(5, level - shift));
    const index = py * cols + px;
    const current = levels[index] ?? 0;
    if (value > current) {
      levels[index] = value;
      glyphs[index] = kind;
    } else if (value === current && kind > (glyphs[index] ?? 0)) {
      glyphs[index] = kind;
    }
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = (col + 0.5 - cx) / rx;
      const ny = (row + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) plot(col, row, 1, 0);
    }
  }

  const project = (
    lat: number,
    lon: number,
    scale: number,
    cosRotation: number,
    sinRotation: number,
  ) => {
    const phi = lat * DEG;
    const cosLat = Math.cos(phi);
    const sinLat = Math.sin(phi);
    const lambda = lon * DEG;
    const sinLon = Math.sin(lambda);
    const cosLon = Math.cos(lambda);
    const sx = cosLat * (sinLon * cosRotation + cosLon * sinRotation);
    const sz = cosLat * (cosLon * cosRotation - sinLon * sinRotation);
    const sy = sinLat;
    return {
      x: cx + rx * scale * sx,
      y: cy - ry * scale * (sy * cosTilt - sz * sinTilt),
      z: sy * sinTilt + sz * cosTilt,
    };
  };

  const sphere = (lat: number, lon: number, boost = 0) => {
    const point = project(lat, lon, 1, cosYaw, sinYaw);
    let level = point.z > 0.5 ? 3 : point.z > -0.2 ? 2 : 1;
    if (Math.abs(lat - scanLat) < 7) level += 1;
    plot(point.x, point.y, level + boost);
  };

  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = 0; lon < 360; lon += detail) sphere(lat, lon);
  }
  for (let lon = 0; lon < 360; lon += 60) {
    for (let lat = -90; lat <= 90; lat += detail) sphere(lat, lon);
  }

  for (let t = 0; t <= 1; t += spiralStep) {
    const point = project(-80 + 160 * t, t * 2.5 * 360, 1, cosYaw, sinYaw);
    const pulse = Math.sin(t * 22 - tick * 0.2) > 0.65;
    plot(
      point.x,
      point.y,
      (point.z > 0 ? 4 : 2) + (pulse ? 1 : 0),
      pulse ? 3 : 2,
    );
  }

  for (let angle = 0; angle < 360; angle += 1.5) {
    const theta = angle * DEG;
    plot(
      cx + rx * Math.cos(theta),
      cy - ry * Math.sin(theta),
      Math.sin(angle * DEG * 2 - tick * 0.08) > 0.86 ? 5 : 4,
      2,
    );
  }

  const ring = (
    lat: number,
    scale: number,
    rotation: number,
    speed: number,
  ) => {
    const cosRotation = Math.cos(rotation);
    const sinRotation = Math.sin(rotation);
    for (let lon = 0; lon < 360; lon += 2) {
      const point = project(lat, lon, scale, cosRotation, sinRotation);
      const pulse = Math.sin(lon * DEG * 2 + tick * speed);
      plot(point.x, point.y, (point.z > 0 ? 3 : 1) + (pulse > 0.78 ? 1 : 0));
    }
  };
  ring(24, 1.2, tick * 0.006, 0.12);
  ring(-34, 1.32, -tick * 0.0045 + 1.7, -0.09);

  const frameRows: { id: number; segments: Segment[] }[] = [];
  const emptyColor = colors.bg;
  for (let row = 0; row < rows; row++) {
    const segments: Segment[] = [];
    let text = "";
    let color: string = emptyColor;
    for (let col = 0; col < cols; col++) {
      const level = levels[row * cols + col] ?? 0;
      const cellColor: string = level
        ? (palette[level - 1] ?? colors.globeDeep)
        : emptyColor;
      if (cellColor !== color) {
        if (text) segments.push({ color, id: segments.length, text });
        text = "";
        color = cellColor;
      }
      text += level ? glyphFor(glyphs[row * cols + col] ?? 1) : " ";
    }
    if (text) segments.push({ color, id: segments.length, text });
    frameRows.push({ id: row, segments });
  }

  const pulse = 0.5 + 0.5 * Math.sin(tick * 0.09);
  return {
    coreColor: dimmed
      ? colors.globeMid
      : mixHex(colors.globeLine, colors.globeHot, pulse),
    coreLeft: Math.floor(cx),
    coreTop: Math.floor(cy),
    rows: frameRows,
  };
}

export function Globe({
  active = true,
  dimmed = false,
  insetTop = 4,
  insetBottom = 10,
}: GlobeProps = {}) {
  const { width, height } = useTerminalDimensions();
  const tick = useTicker(TICK_MS, active);
  const layout = useMemo(
    () => layoutGlobe(width, height, insetTop, insetBottom),
    [height, insetBottom, insetTop, width],
  );
  const frame = useMemo(
    () => (layout ? renderGlobe(layout.cols, layout.rows, tick, dimmed) : null),
    [dimmed, layout, tick],
  );
  if (!layout || !frame) return null;
  return (
    <box
      position="absolute"
      top={layout.top}
      left={layout.left}
      width={layout.cols}
      height={layout.rows}
      flexDirection="column"
      zIndex={1}
    >
      {frame.rows.map((row) => (
        <text key={row.id} wrapMode="none">
          {row.segments.map((segment) => (
            <span key={segment.id} fg={segment.color}>
              {segment.text}
            </span>
          ))}
        </text>
      ))}
      <box
        position="absolute"
        top={frame.coreTop}
        left={frame.coreLeft}
        width={1}
        height={1}
        alignItems="center"
        justifyContent="center"
      >
        <text fg={frame.coreColor}>◇</text>
      </box>
    </box>
  );
}
