#!/usr/bin/env node
/**
 * Landing Page Generator
 *
 * Reads business data (JSON) + template (HTML) → outputs a static site.
 *
 * Usage:
 *   node landing-pages/generator/build.mjs --data business.json --template adventure --out landing-pages/output/my-site
 *
 * Or from super admin:
 *   Exports business data as JSON, picks template, runs this script.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Parse args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf("--" + name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

const dataPath = getArg("data");
const templateName = getArg("template") || "adventure";
const outDir = getArg("out") || join(ROOT, "output", "site");

if (!dataPath) {
  console.error("Usage: node build.mjs --data business.json [--template adventure|luxury|safari|modern] [--out ./output/site]");
  process.exit(1);
}

// Load data
const data = JSON.parse(readFileSync(dataPath, "utf8"));

// Load template
const templatePath = join(ROOT, "templates", templateName + ".html");
if (!existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  console.error("Available: adventure, luxury, safari, modern");
  process.exit(1);
}
let html = readFileSync(templatePath, "utf8");

// Simple Handlebars-like replacement
// {{variable}} → data.variable
// {{#if variable}}...{{else}}...{{/if}} → conditional
// {{#each tours}}...{{/each}} → loop
// {{../variable}} → parent context in loops

function render(template, ctx, parent = {}) {
  let result = template;

  // {{#each array}}...{{/each}}
  result = result.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const arr = ctx[key] || [];
    return arr.map((item) => render(body, item, ctx)).join("\n");
  });

  // {{#if variable}}...{{else}}...{{/if}}
  result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_, key, ifBody, elseBody) => {
    return ctx[key] ? render(ifBody, ctx, parent) : (elseBody ? render(elseBody, ctx, parent) : "");
  });

  // {{../variable}} → parent context
  result = result.replace(/\{\{\.\.\/([\w.]+)\}\}/g, (_, key) => String(parent[key] ?? ctx[key] ?? ""));

  // {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => String(ctx[key] ?? ""));

  return result;
}

// Prepare context
const context = {
  business_name: data.business_name || data.name || "Business",
  tagline: data.business_tagline || "",
  logo_url: data.logo_url || "",
  hero_eyebrow: data.hero_eyebrow || "",
  hero_title: data.hero_title || data.business_name || "Welcome",
  hero_subtitle: data.hero_subtitle || data.business_tagline || "",
  hero_image: data.hero_image || "",
  color_main: data.color_main || "#1a3c34",
  color_secondary: data.color_secondary || "#132833",
  color_cta: data.color_cta || "#ca6c2f",
  color_bg: data.color_bg || "#f5f5f5",
  color_nav: data.color_nav || "#ffffff",
  color_hover: data.color_hover || "#48cfad",
  booking_url: data.booking_url || data.booking_site_url || "#",
  directions: data.directions || "",
  what_to_bring: data.what_to_bring || "",
  what_to_wear: data.what_to_wear || "",
  footer_line_one: data.footer_line_one || `Thanks for choosing ${data.business_name || "us"}.`,
  footer_line_two: data.footer_line_two || "",
  currency: data.currency || "R",
  year: new Date().getFullYear().toString(),
  tours: (data.tours || []).map((t) => ({
    name: t.name || "Tour",
    description: t.description || "",
    duration_minutes: t.duration_minutes || "90",
    default_capacity: t.default_capacity || "10",
    base_price_per_person: t.base_price_per_person || "0",
    image_url: t.image_url || "",
  })),
};

// Render
const output = render(html, context);

// Write
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), output, "utf8");

// Copy firebase.json for deployment
if (existsSync(join(ROOT, "firebase.json"))) {
  writeFileSync(join(outDir, "firebase.json"), readFileSync(join(ROOT, "firebase.json"), "utf8"));
}

console.log(`✓ Landing page generated: ${outDir}/index.html`);
console.log(`  Template: ${templateName}`);
console.log(`  Business: ${context.business_name}`);
console.log(`  Tours: ${context.tours.length}`);
console.log(`  Booking URL: ${context.booking_url}`);
console.log(`\nTo deploy:`);
console.log(`  cd ${outDir}`);
console.log(`  firebase deploy --only hosting:${data.subdomain || "site-name"}`);
