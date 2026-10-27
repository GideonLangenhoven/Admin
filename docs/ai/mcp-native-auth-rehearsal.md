# BookingTours local native Auth rehearsal — 4 October 2026

The actual `operatorIdentity` function passed seven security checks against official local Supabase Auth, with a synthetic email/password account. Auth was not mocked and no operator identity callback was injected. The account was deleted. Application runtime code was unchanged.

## Evidence and limits

The saved application test is `tests/unit/agent-native-auth.test.ts`. It uses the installed Supabase client (2.102.1) and Vitest (4.1.11), on Node 22.23.3. The official Supabase CLI 2.119.0 was downloaded into a temporary folder and its release-asset and published checksums matched. It uses Supabase's **experimental native local runtime**, not a production deployment. The globally installed CLI was not upgraded.

Verified: real native sign-in; missing login credentials; an opaque fixture agent token rejected both as operator identity and by the native Auth API; forged signature rejection; missing public-key configuration failing closed; exclusion of account fields/JWTs/development keys from application console logs; previously valid native JWT rejected after identity deletion. This does not test native JWT expiry or browser/MFA/session behavior. Expiry and agent-grant lifecycle cases remain covered by the earlier synthetic PostgreSQL/OAuth suite, not this native Auth test.

The saved native test plus the existing shared-read/runtime suites passed **161 tests**. The native test without its explicit opt-in skipped all seven cases. Focused TypeScript and lint checks passed. No build or full-suite rerun was needed for this test/documentation-only increment; the earlier recorded build/full-regression results retain their original evidence boundaries and known audit/lint failures.

The Docker-based attempt published ports on wildcard addresses despite the intended network option. Its practice services were stopped. An empty probe confirmed the unwanted default binding and was removed. The official native alternative was then started, with every newly observed listener bound to loopback and no application migrations, seeds, business schema, bookings, payment integrations, messaging services or customer data loaded.

Only a labelled synthetic Auth identity was created/deleted. The local service key was used only to manage that fixture; the application function used the public key and native `auth.getUser`. Development keys and private startup/status output stay in access-restricted temporary files and were not copied into the repository or sent to providers.

## Repeat the bounded test

This environment lives at `/private/tmp/bookingtours-mcp-practice-20261004`. It is unlinked to any hosted project. Its `native/` directory contains the local config and startup script; `runtime/` contains the official runtime state; `bin/supabase` is the temporary checksum-verified CLI. Private status/startup files contain development secrets: do not publish them.

After verifying the local startup report and isolation, from the application repository run:

```sh
AGENT_NATIVE_AUTH_TEST_STATUS=/private/tmp/bookingtours-mcp-practice-20261004/native/status.private.json \
  ./node_modules/.bin/vitest run tests/unit/agent-native-auth.test.ts
./node_modules/.bin/tsc --noEmit -p tests/tsconfig.agent-mcp.json
./node_modules/.bin/eslint tests/unit/agent-native-auth.test.ts --max-warnings=0
```

The opt-in test accepts only the labelled temporary path, loopback Auth/database URLs at the specified practice ports, and a setup report stating no remote link or application schema. An ordinary unit run skips the native cases and never loads a private status file or creates an account. The `/private/tmp` practice artifacts are temporary and must be re-prepared if removed. No production credential is required or permitted.

To stop only this practice runtime, use the scoped official CLI:

```sh
SUPABASE_HOME=/private/tmp/bookingtours-mcp-practice-20261004/runtime \
SUPABASE_EXPERIMENTAL_STACK=1 \
  /private/tmp/bookingtours-mcp-practice-20261004/bin/supabase stack stop \
  --workdir /private/tmp/bookingtours-mcp-practice-20261004/native --stack practice-login
```

This is a local Auth rehearsal, not the public MCP Server URL. Do not expose its database/Auth ports to ChatGPT or Muse.

## Remaining gates

Still unverified: real application schema/RLS/ACL and restricted TLS gateway; canonical business data through native Auth and that gateway; browser sign-in/MFA/business selection/consent/denial/disconnection; every deployed REST/RPC/Edge/Admin bypass boundary; isolated hosted staging; actual HTTPS Inspector/ChatGPT connection/tool selection; operating ownership and the scoped release decision. The wider readiness verdict remains `PAUSED_BY_USER` / `FAILED_GATE`.

Muse's separately checked connector guidelines permit read-only information/reporting outcomes but do not establish BookingTours' precise transport, client-registration or authentication contract. Protocol/client documentation and test/review access remain required. The Muse route remains closed. No ChatGPT credential or adapter is evidence of Muse compatibility.

[Supabase native-runtime documentation](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes), [official CLI release](https://github.com/supabase/cli/releases/tag/v2.119.0), [Muse connector guidelines](https://muse.ai/platform/docs). Detailed commands, file changes and sanitized results are in [the verification record](mcp-native-auth-verification-20261004.json).
