# Isolated HTTPS connector test deployment

Prepared for the existing `GideonLangenhoven/Admin` application and the owner-approved synthetic pilot. Publication is pending approval.

| Setting | Proposed value |
| --- | --- |
| Hosting account | Jerry's projects, Vercel Hobby |
| New test hosting project | `bookingtours-connector-test-gwwn` |
| Proposed HTTPS origin | `https://bookingtours-connector-test-gwwn.vercel.app` (not live or reserved) |
| Supabase project | `gwwnkihblioayklptdab` |
| Test business | BookingTours Connector Test |
| Test data | Two tours, four departures, three fictional bookings |
| Application source | Frozen snapshot of the verified Admin test app |
| ChatGPT and Muse | Disabled during publication and HTTPS verification |
| Credentials | Existing test-project API keys and restricted, certificate-verified gateway login; server-only values stored as encrypted hosting variables |

The candidate's optimized build, TypeScript and 95-page generation pass. The browser artifacts were checked for the server API key, gateway password and test-owner password. Native sign-in and test-business context are independently verified; the owner also confirmed manual sign-in. See [build verification](connector-staging-https-build-verification.json), [native sign-in verification](connector-staging-native-signin-verification.json) and [hosted database verification](connector-staging-hosted-readonly-verification.json).

Use a dedicated hosting project so the live Admin project and its environments do not receive test credentials or hosting changes. The checked account is already on Hobby; this proposal does not purchase a plan, domain or database resource.

Vercel's first deployment in a new project uses its Production environment. Establish that test project's initial deployment with a credential-free disabled placeholder, then publish the real Admin candidate using Preview settings and assign only the new test project's HTTPS alias. The normal application's `npm run build` and prebuild check remain in place; Preview does not invoke the production email-service probe, and this test project has no external email/payment service configured.

The new test project's Vercel-login overlay must allow the public OAuth/MCP endpoints to be reachable by ChatGPT. BookingTours' own native sign-in, authorization, rate limits and database restrictions remain enforced. Configure this only on the new test project; do not change the live project's protection.

After publication, independently check HTTPS/certificate validity, the compiled test-project endpoint, native login, denied direct/generic access, and disabled discovery/MCP routes. Stop if the deployment links to a different project or exposes a server credential. Keep both providers disabled until the exact ChatGPT callback is verified, the scoped test pilot is authorized and the required consent/tool/revocation checks are completed. Muse still requires its own verified adapter contract.

This approval would publish only the isolated test application and store its test credentials with Vercel. It does not authorize a live customer rollout, provider activation or public-directory submission. The owner's connector setup guide requires explicit approval before deploying code or changing account configuration.
