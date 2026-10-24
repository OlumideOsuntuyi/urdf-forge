import { describe, expect, it } from "vitest";
import { evaluate, parseExpression } from "../src/ui/controls";
import { fuzzyScore } from "../src/commands/registry";

describe("number field expressions", () => {
  it("evaluates arithmetic without eval", () => {
    expect(parseExpression("1+2*3")).toBe(7);
    expect(parseExpression("(1+2)*3")).toBe(9);
    expect(parseExpression("-pi/2")).toBeCloseTo(-Math.PI / 2);
    expect(parseExpression("1e-3")).toBe(0.001);
    expect(parseExpression("2*(3")).toBeNull();
    expect(parseExpression("alert(1)")).toBeNull();
  });

  it("converts length units to metres", () => {
    expect(evaluate("25mm", "m")).toBeCloseTo(0.025);
    expect(evaluate("1.5in", "m")).toBeCloseTo(0.0381);
    expect(evaluate("2 cm", "m")).toBeCloseTo(0.02);
  });

  it("reads angles in degrees, or radians when marked", () => {
    expect(evaluate("90", "deg")).toBe(90);
    expect(evaluate("90deg", "deg")).toBe(90);
    expect(evaluate("pi/2 rad", "deg")).toBeCloseTo(90);
  });
});

describe("command palette matching", () => {
  it("prefers substring and word-start matches", () => {
    const hull = fuzzyScore("hull", "Collision: convex hull");
    const scattered = fuzzyScore("hull", "Show help for all");
    expect(hull).toBeGreaterThan(scattered);
    expect(fuzzyScore("xyz", "Export package")).toBe(-1);
  });
});
