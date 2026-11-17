import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base, so the build runs from any folder or Pages path.
export default defineConfig({
  plugins: [react()],
  base: './',
})
