import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  optimizeDeps: { exclude: ['playwright-core'] },
  resolve: { tsconfigPaths: true },
  ssr: { external: ['playwright-core'] },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})

export default config
