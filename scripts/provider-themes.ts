import { configureProviderThemes } from "../src/tui/provider-theme";

for (const file of configureProviderThemes())
  console.log(`Theme configured: ${file}`);
