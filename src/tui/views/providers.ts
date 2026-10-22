import type { Command, ResourceContext, ResourceView, Row } from "../lib/types";
import { colors } from "../theme";
export function providersView(context: ResourceContext): ResourceView {
  const { providers } = context;

  const providerRows: Row[] = providers.map((provider) => ({
    id: provider.id,
    name: provider.id,
    meta: provider.interactive
      ? "ready"
      : provider.installed
        ? "detected"
        : "missing",
    glyph: provider.interactive ? "●" : provider.installed ? "○" : "·",
    glyphColor: provider.interactive
      ? colors.success
      : provider.installed
        ? colors.warning
        : colors.dim,
    description:
      provider.reason ??
      provider.version ??
      (provider.interactive
        ? "Native interactive sessions supported"
        : "Not ready for interactive sessions"),
    body: () => JSON.stringify(provider, null, 2),
  }));

  const sectionCommands: Command[] = [];

  return {
    navigation: {
      name: "providers",
      description: "Detected native CLIs",
      group: "navigate",
      run: () => {
        context.openSection("providers");
      },
    },
    copy: {
      title: "Providers",
      noun: "provider",
      glyph: "◇",
      empty: "No providers detected",
      hint: "Install codex, opencode, or agy, then run /refresh",
    },
    rows: providerRows,
    commands: () => [],
    sectionCommands,
    creation: sectionCommands.find((command) =>
      command.name.startsWith("new "),
    ),
  };
}

export function selectSessionProvider({
  app,
  providers,
  openPicker,
  setPreferredProvider,
}: ResourceContext) {
  openPicker(
    "Choose session provider",
    (id) => {
      const provider = providers.find((provider) => provider.id === id);
      if (!provider?.interactive) throw new Error("Provider is unavailable");
      app.setPreferredProvider(provider.id);
      setPreferredProvider(provider.id);
    },
    true,
  );
}
