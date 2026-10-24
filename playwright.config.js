import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./test/e2e', workers:1, timeout:60000,
  use:{baseURL:'http://127.0.0.1:5173', headless:true, launchOptions:{executablePath:process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),args:['--no-sandbox']}},
  webServer:{command:'npm run dev -- --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
});
