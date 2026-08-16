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
  build: {
    // esbuild minify (default) is fast; keep it. Bump the warn limit so the huge
    // dApp chunk (Stellar SDK, ethers, Reown, Allbridge, recharts) doesn't spam
    // the build log.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split the framework core (react + react-dom + scheduler) into its own
        // long-cache chunk. It's a leaf in the module graph — nothing
        // app-specific imports back into it — so it changes far less often than
        // the app code and survives deploys in the browser cache.
        //
        // This build is now the dApp and nothing else (the landing page and the
        // /learn hub moved to the Next.js site), so there's no lightweight route
        // left to keep the heavy SDKs away from. Splitting them out further
        // would only add round trips before the dashboard can render.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (
            /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)
          ) {
            return 'react-core';
          }
        },
      },
    },
  },
})
