import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser', workers:1, timeout:60000,
  use:{baseURL:'http://127.0.0.1:5000',headless:true,channel:process.env.CI ? undefined : 'msedge'},
  webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:5000',reuseExistingServer:!process.env.CI}
});
