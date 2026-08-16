import type { Page } from '@playwright/test'

export const DEMO_PASSWORD = 'DemoPass#2026'

/** Connexion via le formulaire reel (pas d'appel API direct) — E2E veut dire E2E. */
export async function loginAs(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mot de passe').fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  // Le projet cloud partage peut etre sous charge (nombreux tests
  // d'integration paralleles) — laisser une marge genereuse plutot que de
  // confondre une lenteur reseau avec un echec d'authentification reel.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
}
