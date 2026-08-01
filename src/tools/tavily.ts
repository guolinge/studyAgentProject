// Tavily 联网搜索:走公司网关的透明代理路径 /tavily/api-server/search
// (与原厂商 API 100% 兼容;不是 /v1/chat/completions)

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResult {
  answer: string;
  results: TavilyResult[];
}

export interface SearchOpts {
  base: string; // 网关 base,如 https://llm-proxy.futuoa.com
  maxResults?: number;
}

/** 纯函数:构造 Tavily search 的请求 url 与 body(JSON 字符串) */
export function buildSearchRequest(query: string, opts: SearchOpts): { url: string; body: string } {
  const base = opts.base.replace(/\/+$/, "");
  const url = `${base}/tavily/api-server/search`;
  const body = JSON.stringify({
    query,
    max_results: opts.maxResults ?? 5,
    include_answer: true,
  });
  return { url, body };
}

// 注入型 HTTP 执行器:给定 url/headers/body,返回响应体字符串
export type HttpPost = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<string>;

/** 默认执行器:Node 原生 fetch */
export const defaultHttpPost: HttpPost = async (url, headers, body) => {
  const resp = await fetch(url, { method: "POST", headers, body });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Tavily 请求失败(HTTP ${resp.status}):${text.slice(0, 200)}`);
  return text;
};

export interface TavilyDeps {
  base: string;
  apiKey: string;
  httpPost?: HttpPost;
  maxResults?: number;
}

/** 调 Tavily 搜索,返回结构化 { answer, results } */
export async function tavilySearch(query: string, deps: TavilyDeps): Promise<TavilySearchResult> {
  const httpPost = deps.httpPost ?? defaultHttpPost;
  const { url, body } = buildSearchRequest(query, { base: deps.base, maxResults: deps.maxResults });
  const headers = {
    Authorization: `Bearer ${deps.apiKey}`,
    "Content-Type": "application/json",
  };
  const raw = await httpPost(url, headers, body);
  const parsed = JSON.parse(raw) as { answer?: string; results?: TavilyResult[] };
  return {
    answer: parsed.answer ?? "",
    results: (parsed.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
      score: r.score ?? 0,
    })),
  };
}

/** 纯函数:把搜索结果拼成给下游 agent 的一段中文上下文 */
export function formatSearchContext(result: TavilySearchResult): string {
  const lines: string[] = ["【联网搜索结果(供参考,注意时效性)】"];
  if (result.answer) lines.push(`\n摘要:${result.answer}`);
  if (result.results.length) {
    lines.push("\n来源:");
    result.results.forEach((r, i) => {
      lines.push(`${i + 1}. [${r.title}](${r.url})\n   ${r.content.slice(0, 300)}`);
    });
  }
  return lines.join("\n");
}
