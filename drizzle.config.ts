import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/storage/schema.ts",
  out: "./src/lib/storage/migrations",
});
