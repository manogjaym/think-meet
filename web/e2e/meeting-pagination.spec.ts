import { test, expect, type Locator, type Page } from "@playwright/test"

// This suite exercises local source components without accounts or a LiveKit server.
// Run with PAGINATION_BASE_URL=http://127.0.0.1:8443 npx playwright test e2e/meeting-pagination.spec.ts
test.use({
  baseURL: process.env.PAGINATION_BASE_URL || "http://127.0.0.1:8443",
})
test.skip(
  !process.env.PAGINATION_BASE_URL,
  "Requires PAGINATION_BASE_URL pointing to a local Vite development server",
)

const fixtureHtml = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module" src="/@vite/client"></script>
<script type="module" src="/e2e/fixtures/meeting-pagination.tsx"></script>
</body></html>`

test.beforeEach(async ({ page }) => {
  await page.route("**/__pagination_test", (route) =>
    route.fulfill({ contentType: "text/html", body: fixtureHtml }),
  )
  await page.goto("/__pagination_test")
  await expect(page.locator(".video-grid .video-tile")).toHaveCount(9)
})

async function ids(tiles: Locator) {
  return tiles.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-participant")!),
  )
}

async function visitPages(page: Page, tiles: Locator) {
  const pages: string[][] = []
  const next = page.getByRole("button", {
    name: "다음 참가자 페이지",
    exact: true,
  })
  for (let index = 0; index < 30; index++) {
    pages.push(await ids(tiles))
    if (!(await next.count()) || (await next.isDisabled())) return pages
    const previous = pages.at(-1)!
    await next.click()
    await expect.poll(() => ids(tiles)).not.toEqual(previous)
  }
  throw new Error("Pagination never reached its final page")
}

async function expectInsideViewport(page: Page, elements: Locator) {
  const viewport = page.viewportSize()!
  for (const element of await elements.all()) {
    const bounds = await element.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(-1)
    expect(bounds!.y).toBeGreaterThanOrEqual(-1)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
  }
}

async function expectInsideContainer(container: Locator, elements: Locator) {
  await expect
    .poll(
      async () => {
        const outer = await container.boundingBox()
        const inner = await elements.evaluateAll((nodes) =>
          nodes.map((node) => {
            const bounds = node.getBoundingClientRect()
            return {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            }
          }),
        )
        return Boolean(
          outer &&
            inner.length &&
            inner.every(
              (bounds) =>
                bounds.width > 0 &&
                bounds.height > 0 &&
                bounds.x >= outer.x - 1 &&
                bounds.y >= outer.y - 1 &&
                bounds.x + bounds.width <= outer.x + outer.width + 1 &&
                bounds.y + bounds.height <= outer.y + outer.height + 1,
            ),
        )
      },
      {
        message:
          "Every participant tile and pager must fit inside its own gallery",
      },
    )
    .toBe(true)
}

test("all 25 participants appear exactly once across grid pages", async ({
  page,
}, testInfo) => {
  const tiles = page.locator(".video-grid .video-tile")
  await page.screenshot({ path: testInfo.outputPath("desktop-grid.png") })
  await expect(
    page.getByRole("button", { name: "이전 참가자 페이지", exact: true }),
  ).toBeDisabled()
  const pages = await visitPages(page, tiles)
  expect(pages.map((items) => items.length)).toEqual([9, 9, 7])
  expect(pages.flat()).toEqual(
    Array.from({ length: 25 }, (_, index) => `participant-${index}`),
  )
  await expect(
    page.getByRole("button", { name: "다음 참가자 페이지", exact: true }),
  ).toBeDisabled()
  await page
    .getByRole("button", { name: "이전 참가자 페이지", exact: true })
    .click()
  await expect.poll(() => ids(tiles)).toEqual(pages[1])
})

test("leaving participants clamp the current page and an empty room stays valid", async ({
  page,
}) => {
  const tiles = page.locator(".video-grid .video-tile")
  await visitPages(page, tiles)
  await page.getByRole("button", { name: "참가자 7명", exact: true }).click()
  await expect(tiles).toHaveCount(7)
  await expect
    .poll(() => ids(tiles))
    .toEqual(Array.from({ length: 7 }, (_, index) => `participant-${index}`))
  await expect(
    page.getByRole("navigation", { name: "참가자 영상 페이지", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("button", { name: "참가자 0명", exact: true }).click()
  await expect(tiles).toHaveCount(0)
  await expect(
    page.getByRole("navigation", { name: "참가자 영상 페이지", exact: true }),
  ).toHaveCount(0)
})

test("mobile pages keep four readable tiles and controls inside the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const tiles = page.locator(".video-grid .video-tile")
  await expect(tiles).toHaveCount(4)
  await expectInsideViewport(page, tiles)
  await expectInsideViewport(
    page,
    page.locator(".participant-pagination button"),
  )
  await page.screenshot({ path: testInfo.outputPath("mobile-grid.png") })
  const pages = await visitPages(page, tiles)
  expect(pages.map((items) => items.length)).toEqual([4, 4, 4, 4, 4, 4, 1])
  expect(new Set(pages.flat()).size).toBe(25)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect.poll(() => tiles.count()).toBeGreaterThan(0)
  await expect.poll(() => tiles.count()).toBeLessThanOrEqual(9)
  await expectInsideViewport(
    page,
    page.locator(".participant-pagination button"),
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test("speaker view keeps the featured participant on every page", async ({
  page,
}) => {
  await page.getByRole("button", { name: "보기 전환", exact: true }).click()
  const tiles = page.locator(".video-grid .video-tile")
  await expect(tiles).toHaveCount(4)
  const pages = await visitPages(page, tiles)
  expect(pages).toHaveLength(8)
  expect(pages.every((items) => items[0] === "participant-0")).toBe(true)
  expect(pages.flatMap((items) => items.slice(1))).toEqual(
    Array.from({ length: 24 }, (_, index) => `participant-${index + 1}`),
  )
  await expectInsideViewport(page, tiles)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(tiles).toHaveCount(4)
  await expect.poll(() => ids(tiles.first())).toEqual(["participant-0"])
  await expectInsideContainer(
    page.locator(".participant-gallery"),
    tiles.or(page.locator(".participant-pagination")),
  )
  await expectInsideViewport(
    page,
    page.locator(".participant-pagination button"),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("button", { name: "보기 전환", exact: true }).click()
  await expect(tiles).toHaveCount(9)
})

test("screen sharing paginates students and remains usable on mobile", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "공유 전환", exact: true }).click()
  const tiles = page.locator(".shared-participants .video-tile")
  await expect.poll(() => tiles.count()).toBeGreaterThan(0)
  await expect.poll(() => tiles.count()).toBeLessThanOrEqual(4)
  const gallery = page.locator(".shared-participant-gallery")
  const galleryContents = tiles.or(gallery.locator(".participant-pagination"))
  await expectInsideContainer(gallery, galleryContents)
  await page.screenshot({ path: testInfo.outputPath("desktop-sharing.png") })
  const pages = await visitPages(page, tiles)
  expect(pages.flat()).toEqual(
    Array.from({ length: 24 }, (_, index) => `participant-${index + 1}`),
  )
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => tiles.count()).toBeGreaterThan(0)
    await expectInsideContainer(gallery, galleryContents)
    await expectInsideViewport(page, galleryContents)
    await page.screenshot({
      path: testInfo.outputPath(
        `sharing-${viewport.width}x${viewport.height}.png`,
      ),
    })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => tiles.count()).toBeGreaterThan(0)
  await expect.poll(() => tiles.count()).toBeLessThanOrEqual(3)
  await expectInsideViewport(page, tiles)
  await expectInsideContainer(gallery, galleryContents)
  await expectInsideViewport(
    page,
    page.locator(".participant-pagination button"),
  )
  await page.screenshot({ path: testInfo.outputPath("mobile-sharing.png") })
})

test("two participants follow the gallery aspect ratio in both layouts", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "참가자 2명", exact: true }).click()
  const tiles = page.locator(".video-grid .video-tile")
  const pager = page.getByRole("navigation", {
    name: "참가자 영상 페이지",
    exact: true,
  })
  await expect(tiles).toHaveCount(2)
  await expect(pager).toHaveCount(0)
  for (const layout of ["grid", "speaker"]) {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 600, height: 1000 },
      { width: 600, height: 400 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(tiles).toHaveCount(2)
      await expect(pager).toHaveCount(0)
      await expect.poll(async () => {
        const gallery = await page.locator(".participant-gallery").boundingBox()
        const first = await tiles.nth(0).boundingBox()
        const second = await tiles.nth(1).boundingBox()
        const grid = await page.locator(".video-grid").boundingBox()
        if (!gallery || !first || !second || !grid) return false
        const stacked = gallery.width <= Math.max(1, gallery.height - 52)
        return stacked
          ? Math.abs(first.x - second.x) < 1 &&
              second.y >= first.y + first.height &&
              Math.abs(second.y + second.height - grid.y - grid.height) < 1
          : Math.abs(first.y - second.y) < 1 &&
              second.x >= first.x + first.width &&
              Math.abs(second.x + second.width - grid.x - grid.width) < 1
      }).toBe(true)
      await expectInsideContainer(page.locator(".participant-gallery"), tiles)
      await page.screenshot({ path: testInfo.outputPath(`${layout}-${viewport.width}x${viewport.height}.png`) })
    }
    await page.getByRole("button", { name: "보기 전환", exact: true }).click()
  }
})

test("the attendee sidebar still lists and searches the full roster", async ({
  page,
}) => {
  await page.getByRole("button", { name: "목록 전환", exact: true }).click()
  await expect(page.locator(".person-row")).toHaveCount(25)
  await expect
    .poll(() => page.locator(".video-grid .video-tile").count())
    .toBeLessThan(25)
  await page
    .getByRole("textbox", { name: "참석자 찾기", exact: true })
    .fill("참가자 25")
  await expect(page.locator(".person-row")).toHaveCount(1)
  await expect(page.locator(".person-row")).toContainText("참가자 25")
})
