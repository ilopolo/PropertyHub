import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: {
    // Internal planning materials must not be served by the development server.
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/docs/**', '**/assignment/**', '**/references/**', '**/history/**', '**/START_HERE.md', '**/FILE_MANIFEST.sha256', '**/.local/**'] },
  },
  build: {
    rolldownOptions: {
      input: Object.fromEntries(['index.html', 'pages/dashboard.html', 'pages/buildings.html'].map(path => [path, fileURLToPath(new URL(path, import.meta.url))])),
    },
  },
});
