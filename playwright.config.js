import { defineConfig, devices } from "@playwright/test";

/**
 * KubeShop - Testes de navegador (Playwright)
 *
 * Testam a loja já em execução (local ou na nuvem).
 * O endereço vem da variável BASE_URL:
 *
 *   npm run test:browser                              -> http://localhost:8080
 *   BASE_URL=http://IP_PUBLICO npm run test:browser   -> ambiente na nuvem
 *
 * Antes da primeira execução: npm ci && npm run browser:install
 */
export default defineConfig({
  testDir: "./test/browser",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:8080",
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
