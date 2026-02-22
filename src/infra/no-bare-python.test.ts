import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");

const SCAN_DIRS = ["scripts", "src", "docs", "skills"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".next",
]);

const SKIP_FILE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".zip",
  ".pdf",
]);

function shouldScanFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext && SKIP_FILE_EXT.has(ext)) {
    return false;
  }
  return true;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      out.push(...(await walk(path.join(dir, entry.name))));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (!shouldScanFile(fullPath)) {
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

function isBarePythonInvocation(line: string): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) {
    return false;
  }

  // Shebangs.
  const t = trimmed.trimStart();
  if (t === "#!/usr/bin/env python" || t.startsWith("#!/usr/bin/env python ")) {
    return true;
  }

  // If the line already uses python3, it's fine.
  if (trimmed.includes("python3")) {
    return false;
  }

  // Only flag likely shell command invocations (avoid prose like "python REPL").
  // Matches:
  //   python <args>
  //   $ python <args>
  //   ... | python <args>
  //   ... && python <args>
  //   ... ; python <args>
  //   uv run python <args>
  const patterns: RegExp[] = [
    /^\s*\$?\s*python\s+\S+/, // line-start command
    /\|\s*python\s+\S+/, // pipeline
    /&&\s*python\s+\S+/, // && chain
    /;\s*python\s+\S+/, // ; chain
    /\buv\s+run\s+python\s+\S+/, // uv run
  ];

  return patterns.some((re) => re.test(trimmed));
}

describe("repo hygiene", () => {
  test("does not contain bare 'python' invocations (use python3)", async () => {
    const offenders: { file: string; lineNo: number; line: string }[] = [];

    for (const relDir of SCAN_DIRS) {
      const absDir = path.join(REPO_ROOT, relDir);
      const files = await walk(absDir);
      for (const file of files) {
        const text = await fs.readFile(file, "utf8").catch(() => "");
        if (!text) {
          continue;
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (isAllowedContext(line)) {
            continue;
          }
          if (isBarePythonInvocation(line)) {
            offenders.push({ file: path.relative(REPO_ROOT, file), lineNo: i + 1, line });
          }
        }
      }
    }

    const message = offenders
      .map((o) => `${o.file}:${o.lineNo}: ${o.line}`)
      .join("\n");

    expect(offenders, message).toHaveLength(0);
  });
});
