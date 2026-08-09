import { expect, it } from "vitest";

it("proves that a failing assertion exits non-zero", () => {
  expect("red probe").toBe("green probe");
});
