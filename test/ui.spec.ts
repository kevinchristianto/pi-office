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
  const label = page.locator(".desk-label").first();
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(28);
  expect(box!.width).toBeLessThanOrEqual(157);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "screenshots/immersive-agent-selected.png" });
});
test("room switching, modal interruptions and mobile controls stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  await page
    .getByRole("combobox", { name: "Choose session room" })
    .selectOption("demo-api");
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
