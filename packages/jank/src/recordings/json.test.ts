import { expect, it } from "vitest";
import { parseJsonData } from "./json.ts";

it("does not disguise unexpected reader failures as malformed user files", () => {
  expect(() =>
    parseJsonData("{}", () => {
      throw new Error("Reader failed");
    }),
  ).toThrow("Reader failed");
});
