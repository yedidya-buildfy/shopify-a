import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      // Proxy project previews to sandbox URLs
      '/preview': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => {
          console.log('Proxying preview request:', path);
          return path.replace(/^\/preview/, '/api/preview');
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})