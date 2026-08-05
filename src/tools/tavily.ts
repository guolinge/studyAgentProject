/**
 * tools/tavily.ts — Tavily 联网搜索
 *
 * 公司网关对 Tavily 做了透明代理:
 *   POST {ANTHROPIC_BASE_URL}/tavily/api-server/search
 *
 * 这个路径与 Tavily 原厂 API 100% 兼容,直接传标准 Tavily 请求体即可。
 * 注意:不是 /v1/chat/completions(那是 LLM 接口);搜索走单独路径。
 * Authorization 头使用 AI Key(Bearer),与调用 LLM 的 Key 相同。
 *
 * HttpPost 接口注入让测试无需真实网络。
 */

export interface TavilyResult {
  title: string;
  url: string;
  content: string; // 页面摘要(约 300 字)
  score: number;   // 相关性分数 0~1
}

export interface TavilySearchResult {
  answer: string;        // Tavily 的 AI 摘要(include_answer=true 时有值)
  results: TavilyResult[];
}

export interface SearchOpts {
  base: string;       // 网关 base URL,如 https://llm-proxy.example.com
  maxResults?: number; // 最多返回多少条结果,默认 5
}

/**
 * 纯函数:构造 Tavily search 的请求 URL 与 body。
 * 抽成纯函数便于单测 URL 拼接逻辑,不依赖网络。
 *
 * include_answer: true 让 Tavily 额外返回一段 AI 合成摘要,
 * 作为 agent 输入的"摘要"部分(补充各条结果的片段信息)。
 */
export function buildSearchRequest(query: string, opts: SearchOpts): { url: string; body: string } {
  // 去掉末尾多余的斜杠,避免拼出 //tavily/...
  const base = opts.base.replace(/\/+$/, "");
  const url = `${base}/tavily/api-server/search`;
  const body = JSON.stringify({
    query,
    max_results: opts.maxResults ?? 5,
    include_answer: true,
  });
  return { url, body };
}

/**
 * 注入型 HTTP 执行器接口。
 * 默认实现用 Node 原生 fetch;测试时注入 fake 避免真实网络调用。
 */
export type HttpPost = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<string>;

/** 默认执行器:Node 原生 fetch(Node 18+ 内置) */
export const defaultHttpPost: HttpPost = async (url, headers, body) => {
  const resp = await fetch(url, { method: "POST", headers, body });
  const text = await resp.text();
  // 非 2xx 时 throw,让调用方能捕获并降级(orchestrator 里搜索失败不阻断流水线)
  if (!resp.ok) throw new Error(`Tavily 请求失败(HTTP ${resp.status}):${text.slice(0, 200)}`);
  return text;
};

export interface TavilyDeps {
  base: string;
  apiKey: string;
  httpPost?: HttpPost;   // 不传则用 defaultHttpPost
  maxResults?: number;
}

/**
 * 调 Tavily 搜索,返回结构化结果。
 * 对每个字段做 ?? "" 防御,避免 API 变动时 null 下穿导致后续 agent 出错。
 */
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

/**
 * 把搜索结果格式化成一段中文上下文,供下游 agent(内容组织/内容生成)引用。
 *
 * 格式:
 *   【联网搜索结果(供参考,注意时效性)】
 *   摘要:...
 *   来源:
 *   1. [标题](url)
 *      摘要前 300 字...
 */
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

/**
 * 纯函数:构造 Tavily extract 的请求 URL 与 body。
 * extract 与 search 同属透明代理,路径为 /tavily/api-server/extract。
 * body.urls 传数组;这里一次只取一个 URL。
 */
export function buildExtractRequest(pageUrl: string, opts: { base: string }): { url: string; body: string } {
  const base = opts.base.replace(/\/+$/, "");
  const url = `${base}/tavily/api-server/extract`;
  const body = JSON.stringify({ urls: [pageUrl] });
  return { url, body };
}

/**
 * 读取单个网页正文全文。
 * 成功返回 results[0].raw_content;无内容时返回可读提示(不 throw,
 * 让 agent 能据此换一篇再读,而不是整轮失败)。
 */
export async function tavilyExtract(pageUrl: string, deps: TavilyDeps): Promise<string> {
  const httpPost = deps.httpPost ?? defaultHttpPost;
  const { url, body } = buildExtractRequest(pageUrl, { base: deps.base });
  const headers = {
    Authorization: `Bearer ${deps.apiKey}`,
    "Content-Type": "application/json",
  };
  const raw = await httpPost(url, headers, body);
  const parsed = JSON.parse(raw) as { results?: Array<{ url?: string; raw_content?: string }> };
  const content = parsed.results?.[0]?.raw_content ?? "";
  if (!content.trim()) return `（未能提取 ${pageUrl} 的正文）`;
  return content;
}
