import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AgentPortrait } from "../src/AgentPortrait";

// Independent numerical audit of the shipped SVG and CSS, not a jsdom visual
// assertion. Paint order gives a time-independent occlusion guarantee; the
// sampler checks that animation still describes connected, bounded limbs and
// usable keyboard contact. Native Chromium rasterization remains a separate QA.
type Point = [number, number];
type Matrix = [number, number, number, number, number, number];
type Props = Record<string, string>;
type Operation = { name: string; values: number[] };
type Frame = { phase: number; transform: Operation[] };
const identity: Matrix = [1, 0, 0, 1, 0, 0];
let rules: CSSStyleRule[];
let keyframes: Map<string, Frame[]>;

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function point(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function numbers(value: string): number[] {
  return (value.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
}
function operations(value: string): Operation[] {
  if (!value || value === "none") return [];
  const result = [...value.matchAll(/(\w+)\(([^)]*)\)/g)].map((match) => ({
    name: match[1],
    values: numbers(match[2]),
  }));
  for (const op of result)
    if (
      ![
        "translate",
        "translateX",
        "translateY",
        "rotate",
        "scale",
        "scaleX",
        "scaleY",
      ].includes(op.name)
    )
      throw new Error(`Unsupported audit transform: ${op.name}`);
  return result;
}
function matrix(ops: Operation[]): Matrix {
  return ops.reduce((m, { name, values: v }) => {
    let next: Matrix;
    if (name === "rotate") {
      const a = (v[0] * Math.PI) / 180;
      next = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
    } else if (name.startsWith("scale")) {
      next = [
        name === "scaleY" ? 1 : v[0],
        0,
        0,
        name === "scaleX" ? 1 : (v[1] ?? v[0]),
        0,
        0,
      ];
    } else {
      next = [
        1,
        0,
        0,
        1,
        name === "translateY" ? 0 : v[0],
        name === "translateY" ? v[0] : v[1] || 0,
      ];
    }
    return multiply(m, next);
  }, identity);
}
function computed(element: Element): Props {
  const props: Props = {};
  for (const rule of rules)
    if (
      rule.selectorText
        .split(",")
        .some((s) => !s.includes("::") && element.matches(s.trim()))
    )
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style[i];
        props[name] = rule.style.getPropertyValue(name).trim();
      }
  return props;
}
function ease(progress: number, timing: string): number {
  if (timing === "linear") return progress;
  const curve: Record<string, number[]> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  if (!curve[timing]) throw new Error(`Unsupported audit easing: ${timing}`);
  const [x1, y1, x2, y2] = curve[timing];
  const bezier = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0,
    high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (bezier(mid, x1, x2) < progress) low = mid;
    else high = mid;
  }
  return bezier((low + high) / 2, y1, y2);
}
function localMatrix(props: Props, time: number): Matrix {
  let ops = operations(props.transform || "none");
  const animation = props.animation || "";
  if (animation && animation !== "none") {
    const [name, durationText, timing = "ease"] = animation.split(/\s+/);
    const frames = keyframes.get(name);
    if (frames?.length) {
      const duration = parseFloat(durationText);
      const delay = parseFloat(props["animation-delay"] || "0");
      const phase = ((((time - delay) / duration) % 1) + 1) % 1;
      const rightIndex = frames.findIndex((frame) => frame.phase >= phase);
      const right = frames[Math.max(1, rightIndex)];
      const left = frames[Math.max(0, rightIndex - 1)];
      const fraction = ease(
        (phase - left.phase) / (right.phase - left.phase),
        timing,
      );
      if (left.transform.length !== right.transform.length)
        throw new Error(`Audit requires compatible transforms: ${name}`);
      ops = left.transform.map((op, i) => {
        const next = right.transform[i];
        if (op.name !== next.name)
          throw new Error(
            `Audit requires matching transform functions: ${name}`,
          );
        return {
          name: op.name,
          values: op.values.map(
            (value, n) => value + (next.values[n] - value) * fraction,
          ),
        };
      });
    }
  }
  const [ox = 0, oy = 0] = numbers(props["transform-origin"] || "0 0");
  return multiply(multiply([1, 0, 0, 1, ox, oy], matrix(ops)), [
    1,
    0,
    0,
    1,
    -ox,
    -oy,
  ]);
}
function sampler(svg: Element) {
  const props = new Map(
    [svg, ...svg.querySelectorAll("*")].map((element) => [
      element,
      computed(element),
    ]),
  );
  return {
    props,
    visible: (element: Element) => {
      for (let el: Element | null = element; el; el = el.parentElement)
        if (props.get(el)?.display === "none") return false;
      return true;
    },
    matrix: (element: Element, time: number): Matrix => {
      let m = identity;
      for (
        let el: Element | null = element;
        el && el !== svg.parentElement;
        el = el.parentElement
      )
        m = multiply(localMatrix(props.get(el) || {}, time), m);
      return m;
    },
  };
}

// Sample absolute SVG outline commands, retaining curve extrema closely enough
// for the generous physical safety bounds below. Unsupported geometry fails.
function pathPoints(path: Element): Point[] {
  const tokens = path.getAttribute("d")!.match(/[a-zA-Z]|-?\d*\.?\d+/g)!;
  const points: Point[] = [];
  let cursor: Point = [0, 0],
    start: Point = [0, 0],
    command = "",
    i = 0;
  const take = (): Point => [Number(tokens[i++]), Number(tokens[i++])];
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    if (command === "Z") {
      points.push(start);
      cursor = start;
      continue;
    }
    if (command === "M" || command === "L") {
      cursor = take();
      points.push(cursor);
      if (command === "M") {
        start = cursor;
        command = "L";
      }
    } else if (command === "H" || command === "V") {
      cursor =
        command === "H"
          ? [Number(tokens[i++]), cursor[1]]
          : [cursor[0], Number(tokens[i++])];
      points.push(cursor);
    } else if (command === "Q" || command === "C") {
      const a = cursor,
        b = take(),
        c = take(),
        d = command === "C" ? take() : null;
      for (let n = 1; n <= 32; n++) {
        const t = n / 32,
          u = 1 - t;
        points.push(
          d
            ? [
                u ** 3 * a[0] +
                  3 * u ** 2 * t * b[0] +
                  3 * u * t ** 2 * c[0] +
                  t ** 3 * d[0],
                u ** 3 * a[1] +
                  3 * u ** 2 * t * b[1] +
                  3 * u * t ** 2 * c[1] +
                  t ** 3 * d[1],
              ]
            : [
                u * u * a[0] + 2 * u * t * b[0] + t * t * c[0],
                u * u * a[1] + 2 * u * t * b[1] + t * t * c[1],
              ],
        );
      }
      cursor = d || c;
    } else throw new Error(`Unsupported audit path command: ${command}`);
  }
  return points;
}
function ellipsePoints(element: Element): Point[] {
  const cx = Number(element.getAttribute("cx")),
    cy = Number(element.getAttribute("cy"));
  const rx = Number(element.getAttribute("rx") || element.getAttribute("r"));
  const ry = Number(element.getAttribute("ry") || element.getAttribute("r"));
  return Array.from({ length: 64 }, (_, i) => [
    cx + rx * Math.cos((i * Math.PI) / 32),
    cy + ry * Math.sin((i * Math.PI) / 32),
  ]);
}
function bounds(points: Point[]) {
  return {
    left: Math.min(...points.map((p) => p[0])),
    right: Math.max(...points.map((p) => p[0])),
    top: Math.min(...points.map((p) => p[1])),
    bottom: Math.max(...points.map((p) => p[1])),
  };
}
function inverse(m: Matrix): Matrix {
  const determinant = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / determinant,
    -m[1] / determinant,
    -m[2] / determinant,
    m[0] / determinant,
    (m[2] * m[5] - m[3] * m[4]) / determinant,
    (m[1] * m[4] - m[0] * m[5]) / determinant,
  ];
}
function inside([x, y]: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      result = !result;
  }
  return result;
}
function after(before: Element, later: Element) {
  expect(
    before.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}
function portrait(state: string) {
  return render(
    <AgentPortrait identity="occlusion-audit" state={state} />,
  ).container.querySelector("svg")!;
}

beforeEach(() => {
  const style = document.createElement("style");
  style.textContent = ["src/styles.css", "src/resident-animations.css"]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  document.head.appendChild(style);
  rules = [...style.sheet!.cssRules].filter(
    (rule) => rule.type === CSSRule.STYLE_RULE,
  ) as CSSStyleRule[];
  keyframes = new Map(
    [...style.sheet!.cssRules]
      .filter((rule) => rule.type === CSSRule.KEYFRAMES_RULE)
      .map((rule) => {
        const animation = rule as CSSKeyframesRule;
        const frames = [...animation.cssRules]
          .flatMap((rule) => {
            const frame = rule as CSSKeyframeRule;
            if (!frame.style.getPropertyValue("transform")) return [];
            return frame.keyText.split(",").map((key) => ({
              phase:
                key.trim() === "from"
                  ? 0
                  : key.trim() === "to"
                    ? 1
                    : parseFloat(key) / 100,
              transform: operations(frame.style.getPropertyValue("transform")),
            }));
          })
          .sort((a, b) => a.phase - b.phase);
        return [animation.name, frames];
      }),
  );
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style").forEach((style) => style.remove());
});

describe("independent laptop physical-geometry audit", () => {
  it.each([
    "working",
    "thinking",
    "waiting",
    "error",
    "idle",
    "completed",
    "offline",
  ])("keeps every %s limb behind one stationary opaque lid", (state) => {
    const svg = portrait(state);
    const lid = svg.querySelector(".laptop")!;
    const deck = svg.querySelector(".laptop-deck")!;
    expect(lid).toBeTruthy();
    expect(deck).toBeTruthy();
    const sample = sampler(svg);
    after(deck, lid);
    for (const limb of svg.querySelectorAll(
      ".arm, .typing-hand-left, .typing-hand-right, .thinking-arm, .waiting-arm, .error-arm",
    ))
      after(limb, lid);
    // A foreground fill, not a transparent stroke or animated mask, is what
    // guarantees actual occlusion throughout every animation cycle.
    const fill = sample.props.get(lid)!.fill;
    expect(fill).toMatch(/^#[\da-f]{6}$/i);
    for (
      let node: Element | null = lid;
      node && node !== svg.parentElement;
      node = node.parentElement
    ) {
      const props = sample.props.get(node)!;
      expect([undefined, "1"]).toContain(props.opacity);
      expect([undefined, "1"]).toContain(props["fill-opacity"]);
      expect([undefined, "none"]).toContain(props.animation);
      expect([undefined, "none"]).toContain(props.transform);
      expect([undefined, "none"]).toContain(props.mask);
      expect([undefined, "none"]).toContain(props.filter);
    }
    for (const hand of svg.querySelectorAll(
      ".typing-hand-left, .typing-hand-right",
    ))
      after(deck, hand);
  });

  it("keeps both working wrists joined to their forearms and close to the rear keyboard over 1,001 phases", () => {
    const svg = portrait("working"),
      sample = sampler(svg);
    const deck = svg.querySelector(".laptop-deck")!;
    const deckOutline = pathPoints(deck),
      keyboard = bounds(deckOutline);
    const lidOutline = pathPoints(
      svg.querySelector(".laptop-lid .laptop-edge")!,
    );
    for (const side of ["left", "right"]) {
      const arm = svg.querySelector(`.typing-arm-${side} .arm`)!;
      const hand = svg.querySelector(`.typing-hand-${side} .skin`)!;
      const fingers = svg.querySelector(
        `.typing-fingers-${side} .finger-line`,
      )!;
      const wrist = pathPoints(arm).at(-1)!;
      const center: Point = [
        Number(hand.getAttribute("cx")),
        Number(hand.getAttribute("cy")),
      ];
      const outline = ellipsePoints(hand);
      const rx = Number(hand.getAttribute("rx")),
        ry = Number(hand.getAttribute("ry"));
      const interior: Point[] = [];
      for (let x = -8; x <= 8; x++)
        for (let y = -8; y <= 8; y++)
          if (x * x + y * y <= 64)
            interior.push([center[0] + (x * rx) / 8, center[1] + (y * ry) / 8]);
      let minBottom = Infinity,
        maxBottom = -Infinity,
        maxNormalizedWrist = 0;
      for (let phase = 0; phase <= 1000; phase++) {
        // Sample 1,001 distinct phases of both synchronized typing hands, with
        // both exact lift extrema and two complete nested finger-tap cycles.
        const t = (phase * 0.56) / 1000;
        const handMatrix = sample.matrix(hand, t);
        const box = bounds(outline.map((p) => point(handMatrix, p)));
        const wristInPalm = point(
          inverse(handMatrix),
          point(sample.matrix(arm, t), wrist),
        );
        const normalizedWrist =
          ((wristInPalm[0] - center[0]) / rx) ** 2 +
          ((wristInPalm[1] - center[1]) / ry) ** 2;
        minBottom = Math.min(minBottom, box.bottom);
        maxBottom = Math.max(maxBottom, box.bottom);
        maxNormalizedWrist = Math.max(maxNormalizedWrist, normalizedWrist);
        expect(box.left).toBeGreaterThanOrEqual(keyboard.left - 0.5);
        expect(box.right).toBeLessThanOrEqual(keyboard.right + 0.5);
        expect(box.top).toBeGreaterThanOrEqual(keyboard.top - 1.5);
        expect(box.bottom).toBeGreaterThanOrEqual(keyboard.top - 1.5);
        expect(box.bottom).toBeLessThanOrEqual(keyboard.bottom + 1);
        const visible = interior
          .map((p) => point(handMatrix, p))
          .filter((p) => !inside(p, lidOutline));
        expect(visible.length / interior.length).toBeGreaterThan(0.15);
        // The visible part must genuinely sit over the keyboard deck, rather
        // than merely being painted somewhere outside the lid silhouette.
        expect(
          visible.filter((p) => inside(p, deckOutline)).length /
            interior.length,
        ).toBeGreaterThan(0.1);
        const fingerMatrix = sample.matrix(fingers, t);
        const visibleFingerEnds = pathPoints(fingers)
          .map((p) => point(fingerMatrix, p))
          .filter((p) => !inside(p, lidOutline));
        expect(visibleFingerEnds.length).toBeGreaterThanOrEqual(2);
      }
      expect(maxNormalizedWrist).toBeLessThanOrEqual(1);
      expect(maxBottom).toBeGreaterThanOrEqual(keyboard.top);
      expect(maxBottom - minBottom).toBeGreaterThan(0.15);
    }
  });

  it("contains a filled Apple body and separate leaf entirely on the foreground lid", () => {
    const svg = portrait("working");
    const lid = svg.querySelector(".laptop")!;
    const mark = svg.querySelector(
      '.laptop-lid .laptop-mark[aria-label="Apple logo"]',
    )!;
    expect(mark).toBeTruthy();
    after(lid, mark);
    expect(computed(mark).fill).toMatch(/^#[\da-f]{6}$/i);
    for (const selector of [".apple-body", ".apple-leaf"]) {
      const shape = mark.querySelector(selector)!;
      expect(shape).toBeTruthy();
      expect(pathPoints(shape).every((p) => inside(p, pathPoints(lid)))).toBe(
        true,
      );
    }
  });

  it.each([
    ["working", 2.8],
    ["thinking", 3.8],
    ["waiting", 3.2],
    ["error", 4.6],
  ] as const)(
    "keeps %s pose inside its portrait with exactly two visible forearms across a full cycle",
    (state, duration) => {
      const svg = portrait(state),
        sample = sampler(svg);
      const arms = [...svg.querySelectorAll(".arm")].filter(
        (node) =>
          !node.classList.contains("raised-fingers") && sample.visible(node),
      );
      expect(arms).toHaveLength(2);
      const moving = [
        ...svg.querySelectorAll(
          ".arm, .typing-hand-left .skin, .typing-hand-right .skin, .resident-gesture .skin, .thought-bubbles circle, .resident-head path, .resident-head ellipse",
        ),
      ].filter(sample.visible);
      const geometry = moving.map((element) => ({
        element,
        points:
          element.tagName.toLowerCase() === "path"
            ? pathPoints(element)
            : ellipsePoints(element),
        pad: Number(sample.props.get(element)?.["stroke-width"] || 0) / 2,
      }));
      for (let phase = 0; phase <= 1000; phase++) {
        const time = (duration * phase) / 1000;
        for (const { element, points, pad } of geometry) {
          const m = sample.matrix(element, time),
            b = bounds(points.map((p) => point(m, p)));
          expect(b.left - pad).toBeGreaterThanOrEqual(0);
          expect(b.right + pad).toBeLessThanOrEqual(84);
          expect(b.top - pad).toBeGreaterThanOrEqual(0);
          if (element.closest(".resident-head"))
            expect(b.top - pad).toBeGreaterThan(4.5); // fixed speech-tail clearance
          expect(b.bottom + pad).toBeLessThanOrEqual(82);
        }
      }
      if (state !== "working") {
        const gesture = svg.querySelector(`.${state}-arm`)!;
        expect(sample.visible(gesture)).toBe(true);
        for (const duplicate of svg.querySelectorAll(".desk-arm-right"))
          expect(sample.visible(duplicate)).toBe(false);
      }
    },
  );
});
