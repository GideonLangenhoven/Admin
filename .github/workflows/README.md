# CI / CD Workflows

| Workflow | File | Trigger | Jobs | Timeout |
|----------|------|---------|------|---------|
| **CI** | `ci.yml` | PR to `main`, push to `main` | Lint + Typecheck → Smoke E2E | 5 min / 10 min |
| **E2E on main** | `e2e-on-main.yml` | Push to `main` | Happy-path booking (Yoco test mode) | 10 min |

## Required GitHub Secrets

| Secret | Description | Example |
|--------|-------------|---------|
| `BASE_URL` | Customer-facing booking site URL | `https://aonyx.booking.bookingtours.co.za` |
| `ADMIN_URL` | Admin dashboard URL | `https://aonyx.admin.bookingtours.co.za` |
| `ADMIN_EMAIL` | Admin login email (for happy-path test) | — |
| `ADMIN_PASSWORD` | Admin login password (for happy-path test) | — |

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are only needed by the post-merge happy-path workflow. The smoke suite uses only `BASE_URL` and `ADMIN_URL`.

## How It Works

**On every PR:**
1. Lint + TypeScript typecheck must pass (blocks merge)
2. Playwright smoke tests run against the deployed site (blocks merge)

**On every merge to main:**
1. CI runs again (lint + smoke)
2. Full happy-path E2E runs: customer books a tour via Yoco test card → verifies booking appears as PAID in admin

## Local Testing

```bash
npm run test:e2e:smoke    # smoke tests
npm run test:e2e:happy    # happy-path (needs ADMIN_EMAIL + ADMIN_PASSWORD)
npm run test:e2e          # all tests
npm run test:e2e:headed   # headed mode for debugging
```
