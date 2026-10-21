import { colors } from "../theme";
import type { HintItem } from "../types";
export function Hints({ items }: { items: HintItem[] }) {
  return (
    <box width="100%" alignItems="center" justifyContent="center">
      <text wrapMode="none">
        {items.map((item, index) => (
          <span key={item.key}>
            <span bg={colors.chip} fg={colors.textSoft}>
              {` ${item.key} `}
            </span>
            <span fg={colors.muted}>{` ${item.label}`}</span>
            {index < items.length - 1 ? (
              <span fg={colors.faint}>{"   "}</span>
            ) : null}
          </span>
        ))}
      </text>
    </box>
  );
}
