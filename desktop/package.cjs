"use strict";
// Build a portable preview, never an installer or an auto-start registration.
(async () => {
  const { packager } = await import("@electron/packager");
  const output = await packager({
    dir: __dirname,
    name: "Pi-Office-Companion",
    platform: "win32",
    arch: "x64",
    out: require("node:path").join(__dirname, "release"),
    overwrite: true,
    asar: true,
    prune: true,
    ...(process.env.electron_config_cache
      ? { download: { cacheRoot: process.env.electron_config_cache } }
      : {}),
    ignore: [
      /^\/(src|test|release|node_modules)(\/|$)/,
      /^\/(vite\.config\.ts|vitest\.config\.ts|tsconfig\.json|package\.cjs|index\.html|\.gitignore)$/,
    ],
  });
  console.log(output.join("\n"));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
