import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.NMAP_API_URL || 'http://127.0.0.1:8090'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@xyflow/') || id.includes('/node_modules/@reactflow/')) {
            return 'reactflow';
          }
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react';
          }
          if (id.includes('/node_modules/fast-xml-parser/') || id.includes('/node_modules/@xmldom/')) {
            return 'xml-parser';
          }
        },
      },
    },
  },
})
