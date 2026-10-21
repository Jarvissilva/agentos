import { BRAND } from "../constants";
import { colors } from "../theme";
import { mixHex, useTicker } from "./motion";

const logoShades = ["#7e9dc0", "#5c799a", "#3d5775", "#293b50", "#1a2637"];

export function Logo() {
  return (
    <box flexDirection="column" alignItems="center">
      <text fg={logoShades[0]}>{"    ╱╲   "}</text>
      <text fg={logoShades[1]}>{"  ╱    ╲ "}</text>
      <text>
        <span fg={logoShades[2]}>{"╱   "}</span>
        <span fg={colors.accentBright}>◇</span>
        <span fg={logoShades[2]}>{"   ╲"}</span>
      </text>
      <text fg={logoShades[3]}>{"  ╲    ╱ "}</text>
      <text fg={logoShades[4]}>{"    ╲╱   "}</text>
    </box>
  );
}

export function Wordmark({ active = true }: { active?: boolean } = {}) {
  const tick = useTicker(120, active);
  const pulse = 0.5 + 0.5 * Math.sin(tick * 0.09);
  return (
    <box flexDirection="column" alignItems="center">
      <text>
        <span fg={mixHex(colors.accentDim, colors.accentBright, pulse)}>
          {"◇ "}
        </span>
        <span fg={colors.accentBright}>
          <b>{BRAND}</b>
        </span>
      </text>
      <text fg={colors.muted}>Your local agent workspace</text>
    </box>
  );
}
