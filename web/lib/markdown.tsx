import type { ReactNode } from "react";

export function renderInline(text: string, key: string | number): ReactNode[] {
  const parts: ReactNode[] = [];
  let rest = text;
  let idx = 0;
  while (rest.length > 0) {
    const bold = rest.match(/\*\*(.+?)\*\*/);
    const code = rest.match(/`([^`]+)`/);
    const first = [bold, code]
      .filter(Boolean)
      .sort((a, b) => (a!.index ?? 0) - (b!.index ?? 0))[0];
    if (!first) { parts.push(<span key={`${key}-${idx}`}>{rest}</span>); break; }
    if (first.index! > 0) parts.push(<span key={`${key}-${idx++}`}>{rest.slice(0, first.index)}</span>);
    if (first === bold)
      parts.push(<strong key={`${key}-${idx++}`} className="font-semibold text-gray-900">{first[1]}</strong>);
    else
      parts.push(<code key={`${key}-${idx++}`} className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">{first[1]}</code>);
    rest = rest.slice(first.index! + first[0].length);
  }
  return parts;
}

export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    const li = line.match(/^[-*]\s(.+)/);
    const hr = /^---+$/.test(line.trim());
    if (h1)      nodes.push(<h1 key={i} className="text-base font-bold text-gray-900 mt-4 mb-1.5 first:mt-0 border-b border-gray-100 pb-1">{renderInline(h1[1], i)}</h1>);
    else if (h2) nodes.push(<h2 key={i} className="text-sm font-semibold text-gray-800 mt-3 mb-1">{renderInline(h2[1], i)}</h2>);
    else if (h3) nodes.push(<h3 key={i} className="text-sm font-medium text-gray-700 mt-2 mb-0.5">{renderInline(h3[1], i)}</h3>);
    else if (li) nodes.push(
      <div key={i} className="flex items-start gap-1.5 text-sm text-gray-700 leading-relaxed ml-2">
        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
        <span>{renderInline(li[1], i)}</span>
      </div>
    );
    else if (hr) nodes.push(<hr key={i} className="border-gray-200 my-2" />);
    else if (!line.trim()) nodes.push(<div key={i} className="h-2" />);
    else nodes.push(<p key={i} className="text-sm text-gray-700 leading-relaxed">{renderInline(line, i)}</p>);
    i++;
  }
  return nodes;
}
