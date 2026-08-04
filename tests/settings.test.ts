import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings } from "../src/settingsStore.js";

let tmpDir: string;
let p: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "settings-test-"));
  p = path.join(tmpDir, "settings.json");
});
afterEach(() => { rmSync(tmpDir, { recursive: true }); });

describe("settingsStore", () => {
  it("文件不存在时返回默认值", () => {
    const s = loadSettings(p);
    expect(s.theme).toBe("indigo");
    expect(s.gate1Enabled).toBe(true);
    expect(s.maxReviewRetries).toBe(2);
    expect(s.anthropicApiKey).toBe("");
  });

  it("解析已有配置文件", () => {
    writeFileSync(p, JSON.stringify({ theme: "rose", gate1Enabled: false, anthropicApiKey: "sk-abc" }));
    const s = loadSettings(p);
    expect(s.theme).toBe("rose");
    expect(s.gate1Enabled).toBe(false);
    expect(s.anthropicApiKey).toBe("sk-abc");
  });

  it("合并部分更新并持久化", () => {
    const s1 = saveSettings({ theme: "sky" }, p);
    expect(s1.theme).toBe("sky");
    expect(s1.gate1Enabled).toBe(true);   // 默认值保留
    const s2 = loadSettings(p);
    expect(s2.theme).toBe("sky");          // 已写入磁盘
  });

  it("非法值抛出异常", () => {
    expect(() => saveSettings({ theme: "purple" as never }, p)).toThrow();
  });
});
