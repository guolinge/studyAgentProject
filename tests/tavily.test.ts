import { describe, it, expect, vi } from "vitest";
import {
  buildSearchRequest,
  tavilySearch,
  formatSearchContext,
  type HttpPost,
} from "../src/tools/tavily.js";

describe("buildSearchRequest", () => {
  it("targets the tavily transparent-proxy search path with expected body", () => {
    const { url, body } = buildSearchRequest("pnpm 原理", {
      base: "https://llm-proxy.futuoa.com",
      maxResults: 3,
    });
    expect(url).toBe("https://llm-proxy.futuoa.com/tavily/api-server/search");
    const parsed = JSON.parse(body);
    expect(parsed.query).toBe("pnpm 原理");
    expect(parsed.max_results).toBe(3);
    expect(parsed.include_answer).toBe(true);
  });

  it("trims trailing slash on base", () => {
    const { url } = buildSearchRequest("x", { base: "https://host/" });
    expect(url).toBe("https://host/tavily/api-server/search");
  });
});

const sample = JSON.stringify({
  answer: "pnpm 用内容寻址存储共享依赖",
  results: [
    { url: "https://pnpm.io", title: "pnpm 官网", content: "工作原理…", score: 0.9 },
    { url: "https://github.com/pnpm/pnpm", title: "GitHub", content: "更多…", score: 0.8 },
  ],
});

describe("tavilySearch", () => {
  it("parses answer and results, and sends auth header to the right url", async () => {
    const httpPost: HttpPost = vi.fn().mockResolvedValue(sample);
    const r = await tavilySearch("pnpm", { base: "https://llm-proxy.futuoa.com", apiKey: "K", httpPost });
    expect(r.answer).toContain("内容寻址");
    expect(r.results).toHaveLength(2);
    expect(r.results[0].url).toBe("https://pnpm.io");

    const [url, headers] = (httpPost as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/tavily/api-server/search");
    expect(headers.Authorization).toBe("Bearer K");
  });

  it("propagates httpPost errors (so caller can degrade gracefully)", async () => {
    const httpPost: HttpPost = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      tavilySearch("x", { base: "B", apiKey: "K", httpPost }),
    ).rejects.toThrow(/network down/);
  });
});

describe("formatSearchContext", () => {
  it("renders the answer and a source list with titles and urls", () => {
    const ctx = formatSearchContext({
      answer: "摘要文本",
      results: [
        { url: "https://a.com", title: "标题A", content: "c", score: 1 },
        { url: "https://b.com", title: "标题B", content: "c", score: 0.5 },
      ],
    });
    expect(ctx).toContain("摘要文本");
    expect(ctx).toContain("标题A");
    expect(ctx).toContain("https://a.com");
    expect(ctx).toContain("标题B");
  });
});

import { buildExtractRequest, tavilyExtract } from "../src/tools/tavily.js";

describe("buildExtractRequest", () => {
  it("targets the tavily extract path with urls in body", () => {
    const { url, body } = buildExtractRequest("https://pnpm.io", {
      base: "https://llm-proxy.futuoa.com",
    });
    expect(url).toBe("https://llm-proxy.futuoa.com/tavily/api-server/extract");
    const parsed = JSON.parse(body);
    expect(parsed.urls).toEqual(["https://pnpm.io"]);
  });

  it("trims trailing slash on base", () => {
    const { url } = buildExtractRequest("https://a.com", { base: "https://host/" });
    expect(url).toBe("https://host/tavily/api-server/extract");
  });
});

const extractSample = JSON.stringify({
  results: [
    { url: "https://pnpm.io", raw_content: "pnpm 全文内容……很长的正文……" },
  ],
  failed_results: [],
});

describe("tavilyExtract", () => {
  it("returns the raw_content of the first result and sends auth header", async () => {
    const httpPost: HttpPost = vi.fn().mockResolvedValue(extractSample);
    const text = await tavilyExtract("https://pnpm.io", {
      base: "https://llm-proxy.futuoa.com", apiKey: "K", httpPost,
    });
    expect(text).toContain("pnpm 全文内容");
    const [callUrl, headers] = (httpPost as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callUrl).toContain("/tavily/api-server/extract");
    expect(headers.Authorization).toBe("Bearer K");
  });

  it("returns a readable message when extraction yields no content", async () => {
    const httpPost: HttpPost = vi.fn().mockResolvedValue(
      JSON.stringify({ results: [], failed_results: [{ url: "https://x.com" }] }),
    );
    const text = await tavilyExtract("https://x.com", { base: "B", apiKey: "K", httpPost });
    expect(text).toContain("未能提取");
  });
});
