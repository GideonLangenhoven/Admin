# SEC-10-NEXT-RUNTIME-01 independent acceptance review

**APPROVE_TASK — no blocking findings in the frozen dependency patch. This is not release qualification.**

Reviewed 2026-09-21 at HEAD `75b0b05d97741b012a7fcdfedcd6cf146cbbe9fa`. All nine supplied hashes matched, including the three owned patch files. The companion `booking` symlink was excluded. No application, authorization, customer-data, branding, media, export, or database source changed.

The manifest and lock consistently pin Next/tooling 16.3.3, PostCSS 8.5.23, and Sharp 0.35.4. Changes are limited to their dependency closure: Next/SWC packages, Sharp native/libvips packages, emnapi, semver, and PostCSS/nanoid; obsolete nested PostCSS is removed. XLSX and other direct dependencies are unchanged. Registry URLs remain npmjs.org. Independently checked all 17 locally installed changed entries against the installed lock and SHA-512-verified their cached tarballs. Thirty other changed entries were not cached, primarily optional platform packages; supplied script-disabled clean-install evidence covers lock reproducibility. Logged install arguments contain neither forced upgrades nor audit-fix operations.

Maintainer advisories confirm the chosen floors: [Next Windows RCE](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Next AVIF RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [PostCSS](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp), and [Sharp/libheif](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).

Independent checks passed: focused test 3/3, deduplicated runtime tree, whitespace check, and synthetic in-memory Next image processing to JPEG/PNG/WebP. Installed Sharp uses libheif 1.23.2. AVIF inputs retain their original bytes under Next's upstream security bypass; current application Next image callers use unoptimized logos. No media removal or export dependency change was found.

Reviewed the actual controlled build log: compile, TypeScript, 88/88 pages, optimization, and traces passed. Its recorded command was `/usr/bin/env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=https://build-validation.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-build-placeholder /opt/homebrew/bin/npm run build`. No `.env*` files exist. The inspected prebuild hook contacts the provider only with production/force; neither was supplied, and the log confirms it skipped. No credential/provider execution was needed. Build and broad gates were inspected, not independently repeated.

Audit evidence confirms 20→16 findings, critical 1→0, high 9→6. Residual high brace-expansion, browserslist, fast-uri, js-yaml, ws, and unchanged XLSX remain unaccepted release risks. Latest companion-release unit log reports 1112 passed, 6 failed, 1 skipped across three failing files; that gate remains failed.

Requested review routing: GPT-6 Astra/xhigh. Observed routing: `gpt-6-astra`/`xhigh`, from local `turn_context` metadata relayed by the root agent; not backend attestation. Review made no source edits, commits, deployments, provider calls, or production mutations. Supporting evidence is in this directory.
