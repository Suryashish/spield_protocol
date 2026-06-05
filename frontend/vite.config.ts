import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from "path"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),
        tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // @stellar/stellar-sdk pulls in node-style polyfills (buffer, readable-stream)
  // that reference `global`. Map it to `globalThis` so they work in the browser.
  // `process` is shimmed in index.html (see the inline bootstrap there).
  define: {
    global: 'globalThis',
  },
})
