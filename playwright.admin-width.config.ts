import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["admin-page-width.spec.ts", "tour-settings.spec.ts", "modal-viewport.spec.ts", "edit-booking-qty.spec.ts", "refund-cancel.spec.ts", "invoices-status.spec.ts", "refunds-awaiting.spec.ts", "broadcasts-departure.spec.ts", "rebook-price-preview.spec.ts", "mark-paid-dialog.spec.ts", "booking-page-actions.spec.ts", "ai-prompt-clear.spec.ts", "hero-subtitle-hint.spec.ts", "payment-hold-label.spec.ts", "reports-reconcile.spec.ts", "held-departure-header.spec.ts", "help-panel-stays-open.spec.ts"], workers: 1,
  timeout: 90_000, expect: { timeout: 15_000 }, reporter: "list",
  webServer: {
    command: "node tests/helpers/operator-preview.mjs",
    env: { OPERATOR_PREVIEW_LAYOUT_EDITOR: "1", OPERATOR_PREVIEW_PORT: "3190" },
    url: "http://127.0.0.1:3190", reuseExistingServer: false, timeout: 120_000,
  },
  use: { baseURL: "http://127.0.0.1:3190", timezoneId: "Africa/Johannesburg" },
});
