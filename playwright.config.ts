import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  testMatch: "ui.spec.ts",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4317",
    viewport: { width: 1600, height: 1000 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [
        "--no-sandbox",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  reporter: "list",
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4317/api/health",
    reuseExistingServer: true,
    timeout: 10000,
  },
});
