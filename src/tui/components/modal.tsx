import type { ReactNode } from "react";
import { colors } from "../theme";
export function ModalSurface({
  backdrop,
  children,
  width,
  height,
  framed = true,
}: {
  backdrop: ReactNode;
  children: ReactNode;
  width: number;
  height: number;
  framed?: boolean;
}) {
  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center">
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={0}
      >
        {backdrop}
      </box>
      <box
        width={width}
        height={height}
        zIndex={2}
        border={framed}
        borderStyle="rounded"
        borderColor={colors.lineBright}
        backgroundColor={framed ? colors.bgRaised : undefined}
        flexDirection="column"
        overflow="hidden"
      >
        {children}
      </box>
    </box>
  );
}
