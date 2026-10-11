import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const styles = ["styles.css", "workplace-panel.css", "room-selector.css"]
  .map((file) => readFileSync(resolve("src", file), "utf8"))
  .join("\n");
let fixture: HTMLDivElement | undefined;
let stylesheet: HTMLStyleElement | undefined;

function mount(markup: string) {
  stylesheet = document.createElement("style");
  stylesheet.textContent = styles;
  document.head.append(stylesheet);
  fixture = document.createElement("div");
  fixture.innerHTML = markup;
  document.body.append(fixture);
  return fixture;
}
function luminance(rgb: string) {
  const values = rgb
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

afterEach(() => {
  fixture?.remove();
  stylesheet?.remove();
});

describe("frontend stylesheet cascade audit (no browser layout rendering)", () => {
  it("keeps workplace summary numbers legible against their light cards", () => {
    const root = mount(
      '<section class="workplace-panel"><dl class="workplace-stats"><div><dt>Projects</dt><dd>24</dd></div></dl></section>',
    );
    const card = root.querySelector("dl > div")!;
    const number = root.querySelector("dd")!;
    const text = luminance(getComputedStyle(number).color);
    const background = luminance(getComputedStyle(card).backgroundColor);
    const ratio =
      (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("bounds the guide on short desktop windows as well as narrow mobile screens", () => {
    const root = mount('<section class="guide-panel">Guide content</section>');
    const guide = getComputedStyle(root.querySelector("section")!);
    expect(guide.maxHeight).toBe("calc(100dvh - 40px)");
    expect(guide.overflow).toBe("auto");
  });
});
