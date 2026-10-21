const logoShades = ["#7e9dc0", "#5c799a", "#3d5775", "#293b50", "#1a2637"];

import { colors } from "../theme";
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

export function Wordmark() {
  return (
    <box flexDirection="column" alignItems="center">
      <text fg={colors.accentBright}>
        <b>agentos</b>
      </text>
      <text fg={colors.muted}>Your local agent workspace</text>
    </box>
  );
}
