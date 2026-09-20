// Build release commits using a separate index; preserve the user's HEAD/index.
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
const target=process.argv[2];assert(["admin","booking"].includes(target));
const cwd=target==="booking"?process.cwd()+"/booking":process.cwd();
const git=(args,options={})=>execFileSync("git",args,{cwd,encoding:"utf8",...options}).trim();
const branch="refs/heads/release/first-five-2026-09-13";
const base=git(["rev-parse",branch]);
const before=git(["status","--porcelain=v1"]);
const temp=mkdtempSync("/private/tmp/capekayak-platform-release-");
const env={...process.env,GIT_INDEX_FILE:temp+"/index"};
const files=target==="booking"?[
"app/components/ThemeProvider.tsx","instrumentation-client.ts","sentry.server.config.ts","sentry.edge.config.ts","next.config.ts",
]:[
".github/workflows/ci.yml",
"app/api/admin/update/route.ts","app/api/billing/pause/route.ts","app/api/billing/resume/route.ts","app/api/billing/seats/route.ts",
"app/api/credentials/route.ts","app/api/platform-invoices/generate/route.ts","app/api/platform-invoices/list/route.ts","app/api/platform-invoices/mark-paid/route.ts","app/api/platform-invoices/send/route.ts","app/api/platform-invoices/void/route.ts",
"app/api/super-admin/business/route.ts","app/api/super-admin/operations/route.ts",
"app/billing/page.tsx","app/inbox/components/BotStatusBanner.tsx","app/lib/admin-auth.ts","app/lib/api-auth.ts","app/lib/platform-invoice-preview.ts",
"app/notifications/page.tsx","app/privacy/data-requests/page.tsx","app/super-admin/page.tsx",
"components/BusinessContext.tsx","components/PlatformOperations.tsx","components/WaFailureWatcher.tsx",
"instrumentation-client.ts","sentry.server.config.ts","sentry.edge.config.ts","next.config.ts",
"supabase/functions/_shared/sentry.ts","supabase/functions/_shared/tenant.ts",
"supabase/functions/admin-reply/index.ts","supabase/functions/create-checkout/index.ts","supabase/functions/cron-tasks/index.ts",
"supabase/functions/generate-invite-token/index.ts","supabase/functions/marketing-automation-dispatch/index.ts","supabase/functions/onboarding-wizard/index.ts",
"supabase/functions/platform-bank-details/index.ts","supabase/functions/platform-invoice-checkout/index.ts","supabase/functions/platform-invoice-webhook/index.ts",
"supabase/functions/process-refund/index.ts","supabase/functions/send-whatsapp-text/index.ts","supabase/functions/super-admin-onboard/index.ts",
"supabase/migrations/20260913100000_platform_admin_controls.sql",
"tests/helpers/source-handler.ts","tests/unit/billing-seats.test.ts","tests/unit/trading-gate.test.ts","tests/unit/platform-admin-controls.test.ts","tests/unit/rollout-pagination.test.ts","tests/unit/message-job-boundaries.test.ts",
"tests/unit/yoco-credential-settings.test.ts","tests/unit/booking-success-access.test.ts",
"tests/tenant-isolation/platform-admin.sql","scripts/release-platform-check.mjs","scripts/release-monitoring.mjs",
"tests/tenant-isolation/live.mjs","supabase/security-baseline.json",
"tests/tenant-isolation/rollout.mjs","tests/fixtures/rollout-platform.sql",
"docs/admin-help/super-admin.md","docs/qa/FIRST_FIVE_CLIENTS_2026-09-13.md",
"docs/qa/SUPER_ADMIN_CLOSEOUT_2026-09-13.md","docs/qa/FIRST_FIVE_RELEASE_2026-09-12.md",
"docs/qa/ROLLOUT_REMEDIATION_2026-09-06.md","docs/qa/ROLLOUT_REVIEW_2026-09-06.md",
];
git(["read-tree",base],{env});
for(const path of files) {
 const sha=git(["hash-object","-w","--stdin"],{input:readFileSync(cwd+"/"+path)});
 git(["update-index","--add","--cacheinfo","100644",sha,path],{env});
}
const tree=git(["write-tree"],{env});
const commit=git(["commit-tree",tree,"-p",base],{input:"fix: close platform admin controls and production monitoring gaps\n"});
assert(git(["status","--porcelain=v1"])===before,"User worktree changed during packaging");
git(["update-ref",branch,commit,base]);
console.log(JSON.stringify({target,base,commit,files:files.length,temporaryIndex:temp+"/index",worktreePreserved:true}));
