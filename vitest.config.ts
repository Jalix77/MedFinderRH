import { defineConfig } from 'vitest/config'
import path from 'node:path'
import fs from 'node:fs'

// Charge .env.local (Node >= 20.6) pour les tests d'integration, comme le
// ferait Next.js pour l'application. Fichier gitignore, jamais de secret
// commite (voir .env.example) — les valeurs sont les cles de demo fixes
// generees par `supabase start` en local.
const envLocalPath = path.resolve(__dirname, '.env.local')
if (fs.existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath)
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    globalSetup: ['tests/global-setup.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
