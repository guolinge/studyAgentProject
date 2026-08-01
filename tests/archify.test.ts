import { describe, it, expect, vi } from "vitest";
import {
  buildValidateArgs,
  buildRenderArgs,
  archifyValidate,
  archifyRender,
  extractSvg,
} from "../src/tools/archify.js";

const BIN = "/path/archify.mjs";

describe("buildValidateArgs / buildRenderArgs", () => {
  it("validate args include type, json path and --json", () => {
    expect(buildValidateArgs(BIN, "workflow", "in.json")).toEqual([
      BIN,
      "validate",
      "workflow",
      "in.json",
      "--json",
    ]);
  });

  it("render args include the output path", () => {
    expect(buildRenderArgs(BIN, "sequence", "in.json", "out.html")).toEqual([
      BIN,
      "render",
      "sequence",
      "in.json",
      "out.html",
    ]);
  });
});

describe("archifyValidate", () => {
  it("parses ok=true and runs via node", async () => {
    const runner = vi.fn().mockResolvedValue(
      JSON.stringify({ ok: true, checks: [{ name: "single_svg", ok: true, details: [] }] }),
    );
    const r = await archifyValidate(BIN, "workflow", "in.json", runner);
    expect(r.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith("node", buildValidateArgs(BIN, "workflow", "in.json"));
  });

  it("collects failing checks into diagnostics", async () => {
    const runner = vi.fn().mockResolvedValue(
      JSON.stringify({
        ok: false,
        checks: [
          { name: "single_svg", ok: true, details: [] },
          { name: "finite_svg", ok: false, details: ["NaN in path d"] },
        ],
      }),
    );
    const r = await archifyValidate(BIN, "workflow", "in.json", runner);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toContain("finite_svg");
    expect(r.diagnostics).toContain("NaN in path d");
  });
});

describe("archifyRender", () => {
  it("returns the output path after running render", async () => {
    const runner = vi.fn().mockResolvedValue("");
    const out = await archifyRender(BIN, "workflow", "in.json", "/tmp/o.html", runner);
    expect(out).toBe("/tmp/o.html");
    expect(runner).toHaveBeenCalledWith("node", buildRenderArgs(BIN, "workflow", "in.json", "/tmp/o.html"));
  });
});

describe("extractSvg", () => {
  it("extracts the first <svg> block from HTML", () => {
    const html = "<html><body><svg viewBox='0 0 1 1'><rect/></svg></body></html>";
    expect(extractSvg(html)).toBe("<svg viewBox='0 0 1 1'><rect/></svg>");
  });

  it("throws a clear error when there is no svg", () => {
    expect(() => extractSvg("<html></html>")).toThrow(/svg/i);
  });
});
