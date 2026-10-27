# MCP continuation release review

4 October 2026. Local preparation is complete. The new connector is not deployed or enabled. The broader PAUSED_BY_USER / FAILED_GATE status is unchanged.

The continuation fixes the ESLint flat-config crash by restricting React overrides to the installed Next configuration's file types. It preserves existing rule levels and CommonJS support. The lockfile updates only the transitive DOMPurify package, from 3.4.15 to 3.4.16; the package manifest is unchanged. The existing dependency-floor test covers the patch. An obsolete help-assistant source-string assertion is replaced with a runtime fixture check: hidden retrieval excerpts and destinations stay filtered, empty filtered retrieval still supports the demo guide, and permitted photo pages remain available. No application business rule changed.

| Check | Result |
| --- | --- |
| Full synthetic regression | 1,988 passed, 1 intentional skip, 123 test files; includes all 48 local PostgreSQL/OAuth/MCP cases |
| Focused continuation tests | 16 passed |
| Whole-repository lint | Zero errors; 259 configured warnings |
| Whole-application TypeScript / production-mode build | Passed with placeholder Supabase configuration and no production email probe |
| Production-only dependency audit | Zero findings |
| Full dependency audit | Seven high build-tool findings from braces; no published patch |

Raw local outputs are under [the private evidence folder](evidence/mcp-release-preparation-20261004/unit-final.log); the [structured record](mcp-release-preparation-20261004.json) records exact boundaries and hashes. Positive operator identity remains injected in fixtures. These results do not verify native hosted sign-in, consent or ChatGPT account linking.

## Live checkpoint and next required input

Read-only inspection on 4 October finds Admin release `dpl_5K9GzkGeVe3ChTZdCZdQWh7acw2n` READY. `HEAD https://admin.bookingtours.co.za/api/mcp/chatgpt` returns 404; the new runtime is absent. The connected BookingTours Supabase project's branch list contains only `main`. The separate active project has not been identified or approved as staging. No branch/project was created or resumed.

The owner selected “Isolated staging with a synthetic business (Recommended)” on 4 October 2026 for the first real connection test. The environment type is settled; its Supabase project reference, authorized tester and synthetic pilot identifier remain pending. This selection does not authorize spending or a production release. Do not place credentials in chat, this document, Git or a public asset. The [implementation handoff](mcp-implementation.md) specifies the server configuration names, restricted TLS gateway credential and exact callback allowlist. No callback or pilot identifier was invented.

Rehearse the new `supabase/agent-mcp.local.sql` against the already-applied foundation in staging, review actual catalog/RLS/ACL/pooler behavior and preserve native callers. Test real native sign-in and consent, external-token bypass denial, refresh and disconnect before an enabled pilot. Copy the callback from the actual ChatGPT connection management page. Verify HTTPS discovery, OAuth and tool selection using [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth) and [connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt). The owner's observed custom-MCP creation flow remains authoritative for their UI.

The unpatched [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) remains an explicit build-input risk for owner review. No major Tailwind migration, Next downgrade, vendored patch or audit suppression is proposed. Operational retention/release approval and Muse's separate onboarding/auth contract remain outstanding.

## Scope and rollback

Only the five continuation configuration/lock/test files and private handoff/evidence documents are installed. No stage, commit, push, migration, deployment, setting change, real business record, payment or message is part of this continuation. Both providers remain closed. Existing source and media are preserved.

For a local rollback, first review later edits, then restore only the continuation files from the captured `before` backups in `/private/tmp/bookingtours-mcp-release-20261004` and reinstall the corresponding lockfile. Preserve all earlier MCP implementation and unrelated work; do not reset to HEAD. A later authorized runtime rollback must disable its environment/database gates and revoke agent grants while retaining ordinary Supabase sessions and required schema.
