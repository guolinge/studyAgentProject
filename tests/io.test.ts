import { describe, it, expect } from "vitest";
import { normalizeReply } from "../src/io.js";

describe("normalizeReply", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeReply("  加代码  ")).toBe("加代码");
  });

  it("treats blank / whitespace-only input as empty (= pass)", () => {
    expect(normalizeReply("")).toBe("");
    expect(normalizeReply("   ")).toBe("");
    expect(normalizeReply("\n\t ")).toBe("");
  });
});
