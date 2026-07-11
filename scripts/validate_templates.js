import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "public", "landing-pages", "templates");

const TEMPLATES = [
  "sea_kayak",
  "polar",
  "desert",
  "alpine",
  "safari",
  "aerial",
  "jungle",
  "nordic",
  "dive",
  "wine_cycling"
];

const REQUIRED_PLACEHOLDERS_V1 = [
  "{{business_name}}",
  "{{tagline}}",
  "{{logo_url}}",
  "{{hero_eyebrow}}",
  "{{hero_title}}",
  "{{hero_subtitle}}",
  "{{hero_image}}",
  "{{booking_url}}",
  "{{#if has_tours}}",
  "{{#each tours}}",
  "{{#if has_reviews}}",
  "{{#each reviews}}"
];

const REQUIRED_PLACEHOLDERS_V2 = [
  ...REQUIRED_PLACEHOLDERS_V1,
  "{{chat_embed}}",
  "has_chat"
];

const FORBIDDEN_STRINGS = [
  "★★★★★",
  "trusted by",
  "award-winning",
  "best choice"
];

function validate() {
  console.log("🔍 Starting Landing Page Templates Validation...\n");
  let failed = false;

  for (const name of TEMPLATES) {
    const filename = `${name}.html`;
    const filepath = join(TEMPLATES_DIR, filename);

    try {
      const content = readFileSync(filepath, "utf8");
      
      // Auto-detect version
      const isV2 = content.includes("chat_embed") || content.includes("has_chat") || name === "sea_kayak";
      console.log(`Checking ${filename} [V${isV2 ? "2" : "1"}]...`);

      // 1. Signature Comment Check
      if (!content.includes("<!-- pack:") || !content.includes("signature:")) {
        console.error(`  ❌ Error: Missing signature comment (<!-- pack: ${name} · signature: ... -->)`);
        failed = true;
      }

      // 2. Required Placeholders Check
      const required = isV2 ? REQUIRED_PLACEHOLDERS_V2 : REQUIRED_PLACEHOLDERS_V1;
      for (const placeholder of required) {
        if (!content.includes(placeholder)) {
          console.error(`  ❌ Error: Missing required Handlebars token "${placeholder}"`);
          failed = true;
        }
      }

      // 3. CSS Variables Check
      if (!content.includes("{{color_main}}") || !content.includes("{{color_cta}}")) {
        console.error(`  ❌ Error: Missing color bindings ({{color_main}} or {{color_cta}}) in CSS custom properties`);
        failed = true;
      }

      // 4. Forbidden Fabricated Content Check
      for (const forbidden of FORBIDDEN_STRINGS) {
        if (content.toLowerCase().includes(forbidden)) {
          console.error(`  ❌ Error: Found forbidden fabricated content string "${forbidden}"`);
          failed = true;
        }
      }

      // 5. HTML Structure Check
      if (!content.includes("<!DOCTYPE html>") || !content.includes("</html>")) {
        console.error(`  ❌ Error: Invalid HTML structure`);
        failed = true;
      }

    } catch (err) {
      console.error(`  ❌ Error: Failed to read file ${filename}: ${err.message}`);
      failed = true;
    }
  }

  if (failed) {
    console.log("\n❌ Validation FAILED. Please correct the errors above.");
    process.exit(1);
  } else {
    console.log("\n✅ All templates validated successfully!");
  }
}

validate();
