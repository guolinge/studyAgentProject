import { describe, it, expect } from "vitest";
import { extractSvg, lintSvg } from "../src/tools/svg.js";

describe("extractSvg", () => {
  it("extracts svg from a fenced code block", () => {
    const text = "这是图:\n```svg\n<svg viewBox=\"0 0 1 1\"><rect/></svg>\n```\n完成";
    expect(extractSvg(text)).toBe('<svg viewBox="0 0 1 1"><rect/></svg>');
  });

  it("extracts a bare svg with surrounding prose", () => {
    expect(extractSvg("图如下 <svg viewBox=\"0 0 2 2\"><g/></svg> 就这样")).toBe(
      '<svg viewBox="0 0 2 2"><g/></svg>',
    );
  });

  it("throws when no svg present", () => {
    expect(() => extractSvg("这里没有图")).toThrow(/svg/i);
  });
});

describe("lintSvg", () => {
  const clean =
    '<svg viewBox="0 0 100 60"><rect x="1" y="1" width="8" height="8" fill="#eee" stroke="#333"/><text x="4" y="4" font-size="6" fill="#111">A</text></svg>';

  it("passes a clean self-contained svg", () => {
    const r = lintSvg(clean);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("flags a missing viewBox", () => {
    const r = lintSvg("<svg><rect/></svg>");
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/viewBox/i);
  });

  it("flags class usage (not self-contained)", () => {
    const r = lintSvg('<svg viewBox="0 0 1 1"><rect class="box"/></svg>');
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/class/i);
  });

  it("flags unsupported elements", () => {
    for (const el of ["pattern", "mask", "clipPath", "foreignObject"]) {
      const r = lintSvg(`<svg viewBox="0 0 1 1"><${el}></${el}></svg>`);
      expect(r.ok).toBe(false);
      expect(r.issues.join().toLowerCase()).toContain(el.toLowerCase());
    }
  });

  it("flags non-shadow filter but allows feDropShadow", () => {
    const blur = '<svg viewBox="0 0 1 1"><filter><feGaussianBlur/></filter></svg>';
    expect(lintSvg(blur).ok).toBe(false);
    const shadow = '<svg viewBox="0 0 1 1"><filter><feDropShadow/></filter><rect/></svg>';
    expect(lintSvg(shadow).ok).toBe(true);
  });
});
