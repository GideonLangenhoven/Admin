# Assisted migration / import reconciliation template

Prepared only; no new import pipeline or production import was executed. Audit and reuse existing imports before proposing a replacement. Obtain separate approval for any staging or production import.

Source system/version: ___ · export date/time/timezone: ___ · operator/tenant: ___ · staging target: ___ · reviewer: ___

| Check | Source | Staged result | Difference / rejected rows / decision |
|---|---|---|---|
| Contact rows | | | |
| Unique safe identifiers | | | |
| Ambiguous shared contacts / duplicates | | | |
| Future booking references | | | |
| Participants per exact departure | | | |
| Capacity used / held / available | | | |
| Cancelled / expired / moved history | | | |
| Total / received / due by currency | | | |
| Opening balances and payment evidence | | | |
| Waiver records and signer/participant evidence | | | |
| Permission source / collecting operator / notice version | | | |
| Suppressed / unsubscribed / bounced contacts | | | |
| Rejected rows with reason | | | |
| Date/zone boundary samples | | | |

Map source identifiers, statuses and fields explicitly. Preserve provenance/suppressions; review shared addresses/numbers before merging. Missing evidence remains unknown: a CSV cannot establish permission, historical payment, guest identity or waiver validity. Do not count an association as received cash. Use synthetic/sample data first; review rejected rows, duplicates, capacity and balances before any production import.

Agree a cutover source of truth and freeze/reconciliation window. Do not run two live inventories without verified synchronization. Document rollback boundaries and external actions that cannot be undone. A staging reconciliation is review evidence, not approval to import production data.
