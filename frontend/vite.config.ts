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
    // (already code-split) dashboard chunk doesn't spam the build log.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split ONLY the true framework core (react + react-dom + scheduler) into a
        // stable long-cache chunk. This is safe because it's a leaf in the module
        // graph — nothing app-specific imports back into it — so forcing it eager
        // does NOT drag heavy dApp SDKs (Stellar, ethers, Reown, Allbridge, recharts)
        // into the critical path. Those stay in the lazy DashboardApp chunk.
        //
        // IMPORTANT: do NOT add react-router or framer-motion here — they sit
        // "above" the heavy SDKs in the graph, so pinning them eager pulls the
        // whole dApp into the landing bundle (measured: react-vendor jumped to
        // 2.3MB). Let Rollup keep them in their natural per-entry chunks.
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
