import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.{ts,tsx,js}'],
        setupFiles: ['test/setup.ts'],
        testTimeout: 20000,
    },
})
