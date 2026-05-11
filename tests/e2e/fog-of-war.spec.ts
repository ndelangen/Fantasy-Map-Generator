import { expect, test } from "@playwright/test";

test.describe("Fog of war layer", () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();

    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto("/?seed=test-seed-fow&width=1280&height=720");

    await page.waitForFunction(() => (window as unknown as { mapId?: unknown }).mapId !== undefined, {
      timeout: 60000,
    });

    await page.waitForFunction(
      () => typeof (window as unknown as { buildFogMattePathD?: unknown }).buildFogMattePathD === "function",
      { timeout: 60000 },
    );

    await page.waitForTimeout(500);
  });

  test("toggleFogOfWar shows and hides #fogOfWar", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { showOptions: () => void }).showOptions());

    await page.evaluate(() => {
      const w = window as unknown as {
        pack: { fogOfWarPolygons: unknown[]; fogOfWarMode: string };
        drawFogOfWar: () => void;
      };
      w.pack.fogOfWarMode = "revealed";
      w.pack.fogOfWarPolygons = [];
    });

    let disp = await page.evaluate(() => getComputedStyle(document.getElementById("fogOfWar")!).display);
    expect(disp).toBe("none");

    await page.locator("#toggleFogOfWar").click();
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById("fogOfWar")!).display !== "none",
      { timeout: 5000 },
    );

    await page.locator("#toggleFogOfWar").click();
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById("fogOfWar")!).display === "none",
      { timeout: 5000 },
    );
  });

  test("drawFogOfWar renders texture rect when pack has obscured polygon", async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as {
        layerIsOn: (id: string) => boolean;
        toggleFogOfWar: (ev?: Event) => void;
        pack: {
          fogOfWarPolygons: Array<{ id: string; rings: [number, number][][] }>;
          fogOfWarMode: string;
        };
        drawFogOfWar: () => void;
      };
      if (!w.layerIsOn("toggleFogOfWar")) w.toggleFogOfWar();
      w.pack.fogOfWarMode = "obscured";
      w.pack.fogOfWarPolygons = [
        {
          id: "p1",
          rings: [
            [
              [100, 100],
              [400, 120],
              [380, 400],
            ],
          ],
        },
      ];
      w.drawFogOfWar();
    });

    await expect(page.locator("#fogOfWarBody rect")).toHaveCount(1);
    const fill = await page.locator("#fogOfWarBody rect").getAttribute("fill");
    expect(fill).toContain("url(#fogOfWarPatternTile)");
    await expect(page.locator("#fogOfWarHit path")).toHaveCount(1);
  });
});
