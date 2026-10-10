import { test, expect } from "@playwright/test";
async function demo(page: any) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
}
async function select(page: any, name = "Nova") {
  await page.getByRole("button", { name: "Open agent roster" }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
}
test("immersive scene loads original assets with no external requests and uncluttered HUD", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4317") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await demo(page);
  await expect(page.getByText("Your agents", { exact: true })).toHaveCount(0);
  await expect(page.getByText("AGENT DETAILS")).toHaveCount(0);
  await expect(page.getByText("Opening the office…")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.getByText("The 3D office couldn't open.")).toHaveCount(0);
  expect(external).toEqual([]);
  await page.screenshot({ path: "screenshots/immersive-office.png" });
});
test("selection, visual movement, follow cancellation and details repeatedly work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page);
  await select(page);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Inspect" }).click();
    await page.getByRole("button", { name: /Activity 3/ }).click();
    await expect(
      page.getByText("Observing edit · src/settings.tsx"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close agent details" }).click();
    await page.getByRole("button", { name: "Wave", exact: true }).click();
  }
  await page.getByRole("button", { name: "Take a walk" }).click();
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unfollow", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Return agent to desk" }).click();
  await page.getByRole("button", { name: "Reset camera" }).click();
  const label = page.locator(".bubble-trigger").first();
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(43);
  expect(box!.width).toBeLessThanOrEqual(191);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "screenshots/immersive-agent-selected.png" });
});
test("room switching, modal interruptions and mobile controls stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  await page.getByRole("button", { name: "Choose session room" }).click();
  await page.getByRole("option", { name: /API migration/ }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Open guide" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await select(page, "Orion");
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByText("AGENT DETAILS")).toBeVisible();
  await page.getByRole("button", { name: "Close agent details" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "screenshots/immersive-mobile.png" });
});

test("camera toolbar and focused keyboard input interrupt follow without losing selection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await demo(page);
  await select(page);
  const canvas = page.getByLabel("Office camera", { exact: true });
  await expect(canvas).toHaveAttribute("tabindex", "0");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  }
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unfollow", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Follow", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("region", { name: "Selected agent" }),
  ).toBeVisible();
  await canvas.press("+");
  await canvas.press("-");
  await canvas.press("Home");
  await page.getByRole("button", { name: "Open guide" }).click();
  await expect(
    page.getByRole("dialog", { name: "Office guide" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open guide" })).toBeFocused();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "screenshots/office-camera-controls.png" });
});

test.describe("touch camera controls", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test("focus, zoom and fit remain reachable on a touch viewport", async ({
    page,
  }) => {
    await demo(page);
    await select(page, "Orion");
    await page.getByRole("button", { name: "Focus", exact: true }).tap();
    await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
    await page.getByRole("button", { name: "Zoom out", exact: true }).tap();
    await page.getByRole("button", { name: "Reset camera", exact: true }).tap();
    await expect(
      page.getByRole("region", { name: "Selected agent" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "screenshots/office-touch-controls.png" });
  });
});
