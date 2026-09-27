import { defineConfig } from "vite";

// Served from https://toufexis.de/ptochoprodromos/ — not the domain root — so
// built asset URLs must be prefixed with this base path.
export default defineConfig({
  base: "/ptochoprodromos/",
});
