import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'

/**
 * Navigation mobile (§ regles UX Phase 1C-UI) — n'est execute que sous le
 * projet Playwright "mobile-chromium" (playwright.config.ts), viewport
 * emulant un telephone, ou la sidebar devient un tiroir declenche par un
 * bouton hamburger (components/shell/sidebar.tsx).
 */
test.describe('Navigation mobile', () => {
  test('le tiroir de navigation s\'ouvre, propose les liens finance, et se ferme', async ({ page }) => {
    await loginAs(page, 'comptable.demo@medfinder.test')
    await page.goto('/direction')

    // Sur mobile, la sidebar desktop est cachee — seul le bouton hamburger est visible.
    await expect(page.getByRole('button', { name: 'Ouvrir le menu' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tresorerie' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
    await expect(page.getByRole('link', { name: 'Tresorerie' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Budget' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Depenses' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'PAPEJ' })).toBeVisible()

    await page.getByRole('link', { name: 'Budget' }).click()
    await expect(page).toHaveURL(/\/budget$/)
    // Le tiroir se referme automatiquement apres navigation (onClick du Link).
    await expect(page.getByRole('link', { name: 'Tresorerie' })).toHaveCount(0)
  })
})
