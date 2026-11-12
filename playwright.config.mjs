import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.mjs',
  timeout: 60000, globalTimeout: 600000, expect: {timeout: 15000},
  fullyParallel: false, workers: 1, forbidOnly: !!process.env.CI,
  retries: 0, reporter: [['list'], ['html', {open:'never'}]],
  use: {headless:true, trace:'retain-on-failure', screenshot:'only-on-failure'},
  projects: [{name:'chromium',use:{browserName:'chromium'}}, {name:'firefox',use:{browserName:'firefox'}}]
});
