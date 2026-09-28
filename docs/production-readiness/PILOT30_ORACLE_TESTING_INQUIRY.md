# OCI Always Free pilot testing inquiry

Status: **INACTIVE DRAFT — NOT SENT** (28 September 2026). OCI signup is blocked because the owner has no credit card for verification. Retain this only if OCI later becomes available. It asks Oracle to clarify permitted customer-application qualification before the [BT30 pilot proposal](PILOT30_PROFILE_PROPOSAL.md) is run there. It contains no credentials or customer data.

**Subject:** Clarification of application qualification on OCI Always Free A1

We plan to run our own Node/Next.js booking application behind Nginx on one Always Free `VM.Standard.A1.Flex` instance (2 OCPUs, 12 GB) in our home region. Before testing, please confirm whether external application load testing is permitted: 30 synthetic authenticated users, ramping 5 → 15 → 30; three application actions/second for 60 minutes; a five-minute six-actions/second spike; and a 24-hour soak with eight hours at three actions/second. We will document HTTP request fan-out, stay within resource and bandwidth limits, monitor health, and stop on resource or error thresholds. No denial-of-service simulation or testing of OCI APIs, Console, underlying services or other tenants is planned.

Your [Cloud Security Testing policy](https://www.oracle.com/corporate/security-practices/testing/cloud/) contains a load-testing restriction. Does it cover this customer-application rehearsal, and is notification or written permission required? Separately, for bounded authentication, authorization, tenant-isolation and private-file checks against our application, does the five-business-day notification procedure apply? Please identify the required form/process and any Always Free-specific restrictions.
