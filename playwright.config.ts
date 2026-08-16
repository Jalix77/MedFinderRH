import { defineConfig, devices } from '@playwright/test'

/**
 * E2E Phase 1C-UI. Ne demarre PAS le serveur automatiquement (webServer) :
 * le serveur dev doit deja tourner avec les variables d'environnement du
 * projet cible (local si Docker est sain, sinon le projet cloud dedie —
 * voir docs/phase-1c-closing-report.md pour l'etat actuel de Docker local).
 * Demarrer manuellement (`npm run dev`) avant `npx playwright test`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // les comptes de demo sont partages entre tests — eviter les collisions d'etat
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 45000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile-nav\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile-nav\.spec\.ts/,
    },
  ],
})
