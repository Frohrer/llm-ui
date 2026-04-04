import { test, expect } from '@playwright/test';

test.describe('Mobile responsiveness', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to home — the app may redirect to /auth if not logged in,
    // so we also handle that case gracefully.
    await page.goto('/', { waitUntil: 'networkidle' });
  });

  test('home page renders without horizontal overflow', async ({ page }) => {
    // The page should never be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()!.width;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1); // 1px tolerance
  });

  test('chat input is visible and usable', async ({ page }) => {
    const textarea = page.locator('textarea[placeholder="Ask anything"]');
    // If we're on the auth page, skip this test
    if (await textarea.count() === 0) {
      test.skip();
      return;
    }
    await expect(textarea).toBeVisible();
    // Textarea should be at least 36px tall (touch friendly)
    const box = await textarea.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });

  test('hamburger menu button is tappable', async ({ page }) => {
    // The menu button (hamburger) should be present in chat view
    const menuBtn = page.locator('button:has(svg.lucide-menu)').first();
    if (await menuBtn.count() === 0) {
      test.skip();
      return;
    }
    await expect(menuBtn).toBeVisible();
    const box = await menuBtn.boundingBox();
    // Should be at least 36px for comfortable tapping
    expect(box!.width).toBeGreaterThanOrEqual(36);
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });

  test('top bar does not overflow on narrow viewport', async ({ page }) => {
    // Check that the top bar fits within the viewport
    const topBar = page.locator('.flex.items-center.justify-between.px-4.py-3').first();
    if (await topBar.count() === 0) {
      test.skip();
      return;
    }
    const box = await topBar.boundingBox();
    const viewportWidth = page.viewportSize()!.width;
    expect(box!.width).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test('model selector is visible and not clipped', async ({ page }) => {
    const selector = page.locator('[role="combobox"]').first();
    if (await selector.count() === 0) {
      test.skip();
      return;
    }
    await expect(selector).toBeVisible();
    const box = await selector.boundingBox();
    const viewportWidth = page.viewportSize()!.width;
    // Should be fully within viewport
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test('no elements cause horizontal scroll', async ({ page }) => {
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test('sidebar sheet opens on menu tap', async ({ page }) => {
    const menuBtn = page.locator('button:has(svg.lucide-menu)').first();
    if (await menuBtn.count() === 0) {
      test.skip();
      return;
    }
    await menuBtn.click();
    // Wait for sheet to appear
    const sheet = page.locator('[role="dialog"]').first();
    await expect(sheet).toBeVisible({ timeout: 3000 });
  });

  test('message bubbles do not overflow viewport width', async ({ page }) => {
    // This test checks that if there are any messages, they stay within bounds
    const messages = page.locator('.mb-4, .md\\:mb-6');
    const count = await messages.count();
    if (count === 0) {
      test.skip();
      return;
    }
    const viewportWidth = page.viewportSize()!.width;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await messages.nth(i).boundingBox();
      if (box) {
        expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 2);
      }
    }
  });
});

test.describe('Mobile navigation pages', () => {
  test('stats page renders without overflow', async ({ page }) => {
    await page.goto('/stats', { waitUntil: 'networkidle' });
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test('custom tools page renders without overflow', async ({ page }) => {
    await page.goto('/custom-tools', { waitUntil: 'networkidle' });
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test('voice chat page renders without overflow', async ({ page }) => {
    await page.goto('/voice-chat', { waitUntil: 'networkidle' });
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test('404 page renders without overflow', async ({ page }) => {
    await page.goto('/nonexistent-page', { waitUntil: 'networkidle' });
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });
});
