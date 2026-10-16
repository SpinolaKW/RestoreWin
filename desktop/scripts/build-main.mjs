import { build } from "esbuild";

await build({
  entryPoints: { main: "src/main/main.ts", preload: "src/main/preload.ts" },
  outdir: "build",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  sourcemap: false,
});
