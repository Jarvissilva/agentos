import { expect, test } from "bun:test";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { providerThemeSequence } from "../src/tui/provider-theme";

test("embedded providers discover the host foreground, background and ANSI accent", async () => {
  const { renderer } = await createTestRenderer({ width: 30, height: 6 });
  let response = "";
  const terminal = new EmbeddedTerminalRenderable(renderer, {
    width: 30,
    height: 6,
    onData: (bytes) => {
      response += new TextDecoder().decode(bytes);
    },
  });
  try {
    renderer.root.add(terminal);
    terminal.write(providerThemeSequence);
    terminal.write("\x1b]10;?\x07\x1b]11;?\x07\x1b]4;4;?\x07");
    expect(response).toContain("10;rgb:e8e8/eeee/f8f8");
    expect(response).toContain("11;rgb:0404/0707/0d0d");
    expect(response).toContain("4;4;rgb:b4b4/cfcf/f1f1");
  } finally {
    renderer.destroy();
  }
});
