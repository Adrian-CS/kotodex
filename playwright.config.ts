import { defineConfig, devices } from "@playwright/test";

// Pruebas de extremo a extremo de la PWA, con los diccionarios de test-dicts/ (los genera
// scripts/make-test-dicts.py, ver e2e/preparar.ts). Sin servidor de Anki: se simula con page.route.
const PUERTO = 5199;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/preparar.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    ...devices["iPhone 13"],
    // WebKit sería lo más parecido al iPhone, pero el CI y el contenedor traen Chromium: se usa
    // con el tamaño y el toque del iPhone.
    browserName: "chromium",
    defaultBrowserType: "chromium",
    locale: "es-ES",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --port ${PUERTO} --strictPort`,
    url: `http://localhost:${PUERTO}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
