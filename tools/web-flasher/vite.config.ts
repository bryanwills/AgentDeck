import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// design/tokens.css lives outside this app's root, so dev-server fs access has
// to be widened for it. tokens.css is the ONLY place hex literals may live
// (DESIGN.md §10 rule 1), which is why it is imported rather than copied.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { fs: { allow: [repoRoot] } },
  build: { target: "es2022" },
});
