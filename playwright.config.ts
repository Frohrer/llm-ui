import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Desktop
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile devices
    {
      name: 'mobile-iphone-14',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-iphone-14-pro-max',
      use: { ...devices['iPhone 14 Pro Max'] },
    },
    {
      name: 'mobile-pixel-7',
      use: { ...devices['Pixel 7'] },
    },
    // Tablet
    {
      name: 'tablet-ipad',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});
