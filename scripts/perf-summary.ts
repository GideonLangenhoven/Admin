#!/usr/bin/env npx ts-node
/**
 * Reads Lighthouse JSON reports from a directory and prints a markdown summary table.
 * Usage: npx ts-node scripts/perf-summary.ts docs/perf/baseline-2026-05-05
 */
import * as fs from "fs";
import * as path from "path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npx ts-node scripts/perf-summary.ts <dir>");
  process.exit(1);
}

const absDir = path.resolve(dir);
const files = fs.readdirSync(absDir).filter(f => f.endsWith(".json"));

if (files.length === 0) {
  console.error(`No JSON files found in ${absDir}`);
  process.exit(1);
}

interface LighthouseReport {
  categories: Record<string, { score: number }>;
  audits: Record<string, { numericValue?: number }>;
}

const rows: string[] = [];
rows.push("| Route | Performance | Accessibility | Best Practices | SEO | LCP (ms) | TBT (ms) | CLS |");
rows.push("|-------|-------------|---------------|----------------|-----|----------|----------|-----|");

for (const file of files.sort()) {
  const raw = fs.readFileSync(path.join(absDir, file), "utf8");
  const report: LighthouseReport = JSON.parse(raw);
  const cats = report.categories;
  const audits = report.audits;

  const perf = Math.round((cats.performance?.score ?? 0) * 100);
  const a11y = Math.round((cats.accessibility?.score ?? 0) * 100);
  const bp = Math.round((cats["best-practices"]?.score ?? 0) * 100);
  const seo = Math.round((cats.seo?.score ?? 0) * 100);
  const lcp = Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0);
  const tbt = Math.round(audits["total-blocking-time"]?.numericValue ?? 0);
  const cls = (audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3);

  const name = file.replace(".json", "").replace(/-/g, " ");
  rows.push(`| ${name} | ${perf} | ${a11y} | ${bp} | ${seo} | ${lcp} | ${tbt} | ${cls} |`);
}

const output = `# Lighthouse Performance Summary\n\nGenerated: ${new Date().toISOString().split("T")[0]}\n\n${rows.join("\n")}\n`;

console.log(output);

const summaryPath = path.join(absDir, "SUMMARY.md");
fs.writeFileSync(summaryPath, output);
console.log(`\nWritten to ${summaryPath}`);
