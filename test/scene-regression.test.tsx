import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PerspectiveCamera, Vector3 } from "three";
import { fitOfficeCamera } from "../src/camera";
const capture = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock("@react-three/drei", () => ({
  Html: (props: any) => {
    capture.props = props;
    return <div data-testid="html-anchor">{props.children}</div>;
  },
}));
import AgentLabel from "../src/AgentLabel";
afterEach(cleanup);
describe("office label and camera regression", () => {
  it("does not multiply labels by orthographic zoom and bounds long names", () => {
    render(
      <AgentLabel
        name={"Pi ".repeat(100)}
        state="working"
        color="#ffffff"
        selected={false}
        dim={false}
      />,
    );
    expect(capture.props.distanceFactor).toBeUndefined();
    expect(capture.props.transform).toBeUndefined();
    const label = screen.getByTestId("html-anchor")
      .firstElementChild as HTMLElement;
    expect(label.style.maxWidth).toBe("156px");
    expect(label.style.height).toBe("27px");
    expect(label.style.fontSize).toBe("10px");
    expect(label.querySelector(".desk-label-name")).not.toBeNull();
    for (const zoom of [0.5, 12, 56, 115]) {
      // This is Drei's actual non-transform Html scale expression.
      const factor = capture.props.distanceFactor as number | undefined;
      const scale = factor === undefined ? 1 : zoom * factor;
      expect(scale).toBe(1);
    }
  });
  for (const [width, height] of [
    [1200, 700],
    [700, 600],
    [358, 260],
    [220, 360],
  ]) {
    for (const count of [1, 2, 4]) {
      it(`fits every room corner at ${width}x${height}, rooms ${count}`, () => {
        const fit = fitOfficeCamera(width, height, count);
        const camera = new PerspectiveCamera(fit.fov, width / height, 0.1, 250);
        camera.position.set(...fit.position);
        camera.lookAt(...fit.target);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        expect(Number.isFinite(fit.distance) && fit.distance > 0).toBe(true);
        for (const x of [-6.2, (count - 1) * 14 + 6.2])
          for (const y of [-0.4, 3.2])
            for (const z of [-5.2, 5.2]) {
              const projected = new Vector3(x, y, z).project(camera);
              expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.86001);
              expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.78001);
            }
      });
    }
  }
});
