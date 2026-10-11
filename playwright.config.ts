import { defineConfig } from "@playwright/test";
const viewerUrl = process.env.VIEWER_URL || "http://127.0.0.1:5173";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: viewerUrl,
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: process.env.VIEWER_URL ? "npm start" : "npm run dev",
    url: viewerUrl,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
