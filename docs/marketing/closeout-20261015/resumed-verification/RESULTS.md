# Resumed verification

**PARTIAL / BLOCKED. Candidate remains unapplied; release is not authorized by this task.**

The original temporary validation environment was no longer available. The reconstruction helper created `/private/tmp/bookingtours-marketing-closeout-h9zi3axu/full-app` from the current shared sources, applied the saved patch only in that copy, and matched all 24 candidate SHA-256 hashes. [Source inventory](source-snapshot.json) records 1,581 copied files before patching; [shared drift](shared-drift.json) records 20 concurrent differences from the original baseline. Original snapshot results and this reconstruction are distinct evidence.

Commands run:

```sh
python3 docs/marketing/closeout-20261015/prepare-candidate.py
python3 docs/marketing/closeout-20261015/reproduce-builds.py /private/tmp/bookingtours-marketing-closeout-h9zi3axu/full-app /Users/gideonlangenhoven/dev/capekayak/docs/marketing/closeout-20261015/resumed-verification

# In the isolated candidate directory:
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' ./node_modules/.bin/vitest run tests/unit/marketing*.test.ts tests/unit/automation-copy.test.ts tests/unit/message-job-boundaries.test.ts tests/unit/campaign-audience.test.ts
```

- Reconstruction/hash checks: **PASSED**. Shared candidate paths retained their baseline hashes.
- Focused tests: **PASSED**, 13 files and 180 tests; exit 0. [Log](focused-unit.log).
- Admin repeat production build: **PASSED**, exit 0, including TypeScript and page generation. [Log](admin-build.log).
- Booking repeat production build: **PASSED**, exit 0, including TypeScript and page generation. [Log](booking-build.log).
- Both builds used synthetic configuration, a local font fixture and OS network denial. These results verify compilation of this reconstructed snapshot; they do not verify production font appearance, authentication, providers, full-schema behavior or release readiness. Build warnings include existing Sentry configuration deprecations, missing cache/auth tokens and the booking middleware convention deprecation.
- Patch applicability and existing diff whitespace check: **PASSED** again after reconstruction. Final shared baseline and candidate hash recheck: **PASSED**, all 24 paths.

Initial execution could not install the nested OS sandbox (`sandbox_apply: Operation not permitted`); the same local-only verification was rerun with approval and the network-denial boundary retained. No dependency installation, live account/configuration access, deployment, migration, send, payment or contact import occurred in this follow-up. Complete-schema, rollback, policy, provider, attribution and accessibility blockers in the [main report](../REPORT.md) remain.
