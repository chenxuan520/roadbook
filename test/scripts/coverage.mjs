import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import v8toIstanbul from 'v8-to-istanbul';
import istanbulCoverage from 'istanbul-lib-coverage';
import istanbulReport from 'istanbul-lib-report';
import istanbulReports from 'istanbul-reports';

const { createCoverageMap } = istanbulCoverage;
const { createContext } = istanbulReport;
const reports = istanbulReports;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(testDir, '..');
const v8Dir = path.resolve(testDir, 'test-results', 'js-coverage');
const outDir = path.resolve(testDir, 'test-results', 'coverage');

function urlToLocalPath(urlStr) {
  try {
    const u = new URL(urlStr);
    // 只处理站内静态资源
    if (!u.pathname.startsWith('/static/')) return null;
    return path.resolve(repoRoot, u.pathname.replace(/^\//, ''));
  } catch {
    // 可能是 file path 或其他格式
    if (typeof urlStr === 'string' && urlStr.includes('/static/')) {
      const idx = urlStr.indexOf('/static/');
      return path.resolve(repoRoot, urlStr.slice(idx + 1));
    }
    return null;
  }
}

async function listJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

async function main() {
  const files = await listJsonFiles(v8Dir);
  if (files.length === 0) {
    console.error(`[coverage] 未找到 V8 覆盖率原始数据：${v8Dir}`);
    console.error('[coverage] 先运行: npm run test:local:coverage');
    process.exitCode = 2;
    return;
  }

  const coverageMap = createCoverageMap({});
  const cache = new Map(); // filePath -> v8-to-istanbul instance

  for (const p of files) {
    const raw = await fs.readFile(p, 'utf-8');
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch {
      continue;
    }

    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      const url = entry && entry.url;
      const functions = entry && entry.functions;
      if (!url || !Array.isArray(functions)) continue;

      const filePath = urlToLocalPath(url);
      if (!filePath) continue;

      try {
        // 跳过不存在的文件（例如 query string 或 runtime 注入脚本）
        await fs.stat(filePath);
      } catch {
        continue;
      }

      let converter = cache.get(filePath);
      if (!converter) {
        converter = v8toIstanbul(filePath, 0, { source: null });
        await converter.load();
        cache.set(filePath, converter);
      }

      // v8-to-istanbul 会累加应用 coverage，因此需要每次 apply 前 clone 一个实例
      // 否则不同测试文件会相互污染。
      const fresh = v8toIstanbul(filePath, 0, { source: null });
      await fresh.load();
      fresh.applyCoverage(functions);
      coverageMap.merge(fresh.toIstanbul());
    }
  }

  await fs.mkdir(outDir, { recursive: true });

  const context = createContext({
    dir: outDir,
    coverageMap
  });

  reports.create('text-summary').execute(context);
  reports.create('json-summary').execute(context);
  reports.create('html').execute(context);

  console.log(`[coverage] HTML 报告：${outDir}/index.html`);
  console.log(`[coverage] JSON 汇总：${outDir}/coverage-summary.json`);
}

await main();
