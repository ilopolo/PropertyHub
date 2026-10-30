import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: {
    watch: { ignored: ['**/.local/**', '**/.netlify/**'] },
    // Internal planning materials must not be served by the development server.
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/docs/**', '**/assignment/**', '**/references/**', '**/history/**', '**/START_HERE.md', '**/FILE_MANIFEST.sha256', '**/.local/**'] },
  },
  build: {
    rolldownOptions: {
      input: Object.fromEntries(['index.html', 'pages/dashboard.html', 'pages/buildings.html', 'pages/account.html', 'pages/admin.html', 'pages/login.html', 'pages/register.html', 'pages/platform-admin.html', 'pages/organization-admin.html'].map(path => [path, fileURLToPath(new URL(path, import.meta.url))])),
    },
  },
});
