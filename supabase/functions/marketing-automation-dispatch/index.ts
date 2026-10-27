import { withSentry } from "../_shared/sentry.ts";
// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, fetchAllRows, getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";
import { requireAuth } from "../_shared/auth.ts";
import { nonTradingBusinessIds } from "../_shared/subscription.ts";
import { fillMarketingTokens } from "../_shared/marketing-tokens.ts";
import { replaceLegacyMarketingSocialIcons } from "../_shared/marketing-email-html.ts";

import { marketingCalendarDate } from "../_shared/marketing-calendar.ts";
import { confirmMarketingDelivery, reserveMarketingDelivery, finishMarketingDelivery, marketingDeliveryOutcome } from "../_shared/marketing-delivery.ts";

const RAW_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "";
// Refuse to use the Resend developer sandbox even if it's pasted into the env
// — that domain rate-limits hard and routes to spam (U-6 / V-12).
const FROM_EMAIL = RAW_FROM_EMAIL && !/onboarding@resend\.dev|@resend\.dev/i.test(RAW_FROM_EMAIL)
  ? RAW_FROM_EMAIL
  : "BookingTours <noreply@bookingtours.co.za>";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createServiceClient();

function buildCors(req: Request) {
  const allowed = getAdminAppOrigins();
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin, allowed) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
}

Deno.serve(withSentry("marketing-automation-dispatch", async (req: Request) => {
  // V-DISP: browser preflight + POST CORS. Without these the admin "Run
  // dispatch now" button got Failed to fetch from the browser even though
  // the function ran fine. pg_cron / curl callers don't care, but the UI
  // does.
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  let auth;
  try { auth = await requireAuth(req); }
  catch { return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors }); }
  const businessId = auth.isServiceRole || auth.role === "SUPER_ADMIN" ? null : auth.businessId;

  try {
    const results = { welcome_back_enrolled: 0, date_enrolled: 0, processed: 0, sent: 0, delayed: 0, conditions: 0, vouchers: 0, promos: 0, completed: 0, errors: 0 };

    const welcomeBack = await supabase.rpc("enroll_welcome_back_sequences", { p_business_id: businessId, p_limit: 100 });
    if (welcomeBack.error) throw new Error("Welcome-back enrollment failed: " + welcomeBack.error.message);
    results.welcome_back_enrolled = Number(welcomeBack.data || 0);

    // ── 1. Date-field triggers: enroll contacts whose date matches today ──
    const today = new Date();
    const dateAutomations = await fetchAllRows((from, to) => {
      let query = supabase.from("marketing_automations")
        .select("id, business_id, trigger_config, businesses(timezone)")
        .eq("status", "active").eq("trigger_type", "date_field")
        .order("id").range(from, to);
      if (businessId) query = query.eq("business_id", businessId);
      return query;
    });


    // Fix 3b: no new automation enrolments for a paused or suspended operator.
    const pausedForDates = await nonTradingBusinessIds(
      supabase,
      ((dateAutomations || []) as any[]).map((a) => a.business_id),
    );

    for (const auto of (dateAutomations || []) as any[]) {
      if (pausedForDates.has(String(auto.business_id))) continue;
      const field = auto.trigger_config?.field || "date_of_birth";
      // Only actual date columns are eligible; config is operator-controlled.
      if (field !== "date_of_birth" && field !== "anniversary_date") continue;
      const daysBefore = auto.trigger_config?.days_before || 0;

      const zone = auto.businesses?.timezone;
      if (!zone) { results.errors++; continue; }
      let target;
      try { target = marketingCalendarDate(today, zone, daysBefore); }
      catch { results.errors++; continue; }
      const currentYear = marketingCalendarDate(today, zone).year;
      const targetMonth = target.month;
      const targetDay = target.day;

      // Fetch contacts with their date field in one query (avoid N+1)
      const matchingContacts = await fetchAllRows((from, to) => supabase
        .from("marketing_contacts")
        .select("id, " + field)
        .eq("business_id", auto.business_id)
        .eq("status", "active")
        .not(field, "is", null)
        .order("id").range(from, to));

      for (const contact of (matchingContacts || []) as any[]) {
        if (!contact[field]) continue;

        // Check month+day match
        const [, month, day] = String(contact[field]).split("-").map(Number);
        if (month !== targetMonth || day !== targetDay) continue;

        // Check if already enrolled this year (allow annual re-enrollment)
        const { data: existing } = await supabase
          .from("marketing_automation_enrollments")
          .select("id, status, created_at")
          .eq("automation_id", auto.id)
          .eq("contact_id", contact.id)
          .maybeSingle();

        if (existing) {
          // Re-enroll if the last enrollment was from a previous year and is completed/exited
          const enrolledYear = marketingCalendarDate(new Date(existing.created_at), zone).year;
          if (enrolledYear >= currentYear) continue; // Already enrolled this year
          if (existing.status === "active") continue; // Still in progress

          // Reset enrollment for this year
          await supabase.from("marketing_automation_enrollments")
            .update({
              status: "active",
              current_step: 0,
              next_action_at: new Date().toISOString(),
              metadata: {},
              updated_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          await supabase.rpc("increment_automation_counter", {
            p_automation_id: auto.id,
            p_column: "enrolled_count",
            p_amount: 1,
          });
          results.date_enrolled++;
          continue;
        }

        // New enrollment
        await supabase.from("marketing_automation_enrollments").insert({
          automation_id: auto.id,
          contact_id: contact.id,
          business_id: auto.business_id,
          status: "active",
          current_step: 0,
          next_action_at: new Date().toISOString(),
        });
        await supabase.rpc("increment_automation_counter", {
          p_automation_id: auto.id,
          p_column: "enrolled_count",
          p_amount: 1,
        });
        results.date_enrolled++;
      }
    }

    // ── 2. Fetch ready enrollments ──
    // Eligibility precedes the limit, and the 15-minute claim is atomic.
    const { data: enrollments, error: claimError } = await supabase.rpc("claim_marketing_automation_enrollments", {
      p_limit: 100,
      p_business_id: businessId,
    });
    if (claimError) throw claimError;

    if (!enrollments || enrollments.length === 0) {
      return new Response(JSON.stringify({ ok: true, ...results }), { status: 200, headers: cors });
    }

    // Automation steps are marketing sends too, so a paused operator's in-flight
    // enrollments hold rather than continue. next_action_at is left untouched,
    // so they resume from where they stopped when the operator comes back.
    const pausedForRuns = await nonTradingBusinessIds(
      supabase,
      (enrollments as any[]).map((e) => e.business_id),
    );
    if (pausedForRuns.size > 0) {
      console.log("AUTOMATION_DISPATCH_SKIP_NON_TRADING businesses=" + [...pausedForRuns].join(","));
    }

    // ── 3. Process each enrollment ──
    for (const enrollment of enrollments as any[]) {
      if (businessId && enrollment.business_id !== businessId) throw new Error("Enrollment claim returned a foreign business");
      if (pausedForRuns.has(String(enrollment.business_id))) continue;
      try {
        // Load automation
        const { data: automation } = await supabase
          .from("marketing_automations")
          .select("id, status, business_id, trigger_type")
          .eq("id", enrollment.automation_id)
          .eq("business_id", enrollment.business_id)
          .single();

        if (!automation || automation.status !== "active") {
          // Skip paused/archived automations
          continue;
        }

        if (automation.trigger_type === "booking_inactive") {
          const eligible = await supabase.rpc("validate_welcome_back_enrollment", { p_enrollment_id: enrollment.id, p_business_id: enrollment.business_id });
          if (eligible.error) throw new Error("Could not verify welcome-back eligibility");
          if (eligible.data !== true) continue;
        }

        const { data: bizRow } = await supabase.from("businesses").select("business_name, subdomain, booking_site_url").eq("id", enrollment.business_id).maybeSingle();
        const bizName = bizRow?.business_name || "Marketing";
        const bizSiteUrl = String(bizRow?.booking_site_url || (bizRow?.subdomain ? "https://" + bizRow.subdomain + ".booking.bookingtours.co.za" : "")).replace(/\/+$/, "");
        // V-12 fix: send from the verified ROOT domain with the tenant name as
        // the display label. Per-subdomain From requires each tenant's
        // subdomain (e.g. aonyx.bookingtours.co.za) to be added + DNS-verified
        // in Resend, which isn't done per tenant — so until each subdomain is
        // verified, sending from there returns HTTP 403 "domain not verified"
        // and the email never goes out. send-email already follows this
        // pattern; marketing-dispatch and the broadcast path do too now.
        const bizFromEmail = bizName + " <noreply@bookingtours.co.za>";

        // Load steps
        const { data: steps } = await supabase
          .from("marketing_automation_steps")
          .select("id, position, step_type, config")
          .eq("automation_id", enrollment.automation_id)
          .order("position", { ascending: true });

        if (!steps || steps.length === 0) continue;

        // Find current step
        const currentStep = steps.find((s: any) => s.position === enrollment.current_step);
        if (!currentStep) {
          // No more steps — mark completed
          await supabase.from("marketing_automation_enrollments")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", enrollment.id);
          await supabase.rpc("increment_automation_counter", {
            p_automation_id: enrollment.automation_id,
            p_column: "completed_count",
            p_amount: 1,
          });
          results.completed++;
          continue;
        }

        // Load contact
        const { data: contact } = await supabase
          .from("marketing_contacts")
          .select("id, email, first_name, last_name, tags, status")
          .eq("id", enrollment.contact_id)
          .eq("business_id", enrollment.business_id)
          .single();
        if (!contact) continue;

        // A contact can unsubscribe mid-sequence — this used to keep firing
        // every remaining scheduled step regardless. Exit the enrollment
        // (terminal, same as the existing condition-not-met exit path below)
        // instead of re-checking this same row every cron tick forever.
        if (contact.status !== "active") {
          await supabase.from("marketing_automation_enrollments")
            .update({ status: "exited", updated_at: new Date().toISOString() })
            .eq("id", enrollment.id);
          continue;
        }

        const eligibility = await supabase.rpc("marketing_step_eligibility", {
          p_business_id: enrollment.business_id, p_contact_id: contact.id, p_enrollment_id: enrollment.id,
        });
        if (eligibility.error) throw new Error("Marketing eligibility unavailable");
        if (["first_booking_policy_pending", "offer_issuance_unavailable", "domain_event_binding_unavailable"].includes(eligibility.data)) {
          results.delayed++;
          continue;
        }
        if (eligibility.data !== "eligible") {
          await supabase.from("marketing_automation_enrollments").update({ status: "exited", updated_at: new Date().toISOString() })
            .eq("id", enrollment.id).eq("business_id", enrollment.business_id);
          await supabase.from("marketing_automation_logs").insert({ business_id: enrollment.business_id,
            automation_id: enrollment.automation_id, enrollment_id: enrollment.id, contact_id: contact.id,
            step_position: currentStep.position, step_type: currentStep.step_type, action: "excluded",
            metadata: { reason: eligibility.data } });
          continue;
        }
        const metadata = enrollment.metadata || {};

        // Process step
        switch (currentStep.step_type) {
          case "send_email": {
            const config = currentStep.config as any;
            const templateId = config?.template_id;
            if (!templateId) {
              console.error("AUTOMATION_DISPATCH: missing template_id in step config for enrollment " + enrollment.id);
              await supabase.from("marketing_automation_enrollments").update({ status: "exited" }).eq("id", enrollment.id);
              results.errors++;
              break;
            }

            // Load template
            const { data: template } = await supabase
              .from("marketing_templates")
              .select("html_content, subject_line")
              .eq("id", templateId)
              .eq("business_id", enrollment.business_id)
              .single();
            if (!template) {
              console.error("AUTOMATION_DISPATCH: template " + templateId + " not found for enrollment " + enrollment.id);
              await supabase.from("marketing_automation_enrollments").update({ status: "exited" }).eq("id", enrollment.id);
              results.errors++;
              break;
            }

            // Variable replacement — shared map, see _shared/marketing-tokens.ts
            const tokenValues = {
              first_name: contact.first_name,
              last_name: contact.last_name,
              email: contact.email,
              voucher_code: metadata.voucher_code,
              voucher_amount: metadata.voucher_amount,
              promo_code: metadata.promo_code,
              promo_discount: metadata.promo_discount,
              business_name: bizName,
              site_url: bizSiteUrl,
            };
            let html = fillMarketingTokens(template.html_content, tokenValues);
            html = replaceLegacyMarketingSocialIcons(html);
            const subject = fillMarketingTokens(config.subject_override || template.subject_line || "Update", tokenValues);

            // Generate unsubscribe token
            const unsubToken = crypto.randomUUID();
            const { error: unsubError } = await supabase.from("marketing_unsubscribe_tokens").insert({
              business_id: enrollment.business_id,
              contact_id: contact.id,
              token: unsubToken,
              // campaign_id is null for automation-sourced emails (no campaign)
            });
            if (unsubError) throw new Error("Could not create unsubscribe link");
            const unsubscribeUrl = SUPABASE_URL + "/functions/v1/marketing-unsubscribe?token=" + unsubToken;
            html = html.replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);

            // Inject tracking pixel with automation params
            const trackingBaseUrl = SUPABASE_URL + "/functions/v1/marketing-track";
            const openPixelUrl = trackingBaseUrl + "?t=open&k=" + contact.id + "&a=" + enrollment.automation_id + "&e=" + enrollment.id;
            html = html.replace("</body>", '<img src="' + openPixelUrl + '" width="1" height="1" style="display:none" alt="" /></body>');

            // Rewrite links for click tracking
            html = html.replace(/<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/g, function (_match: string, pre: string, href: string, post: string) {
              if (href.includes("marketing-unsubscribe") || href === "#") return _match;
              const trackedUrl = trackingBaseUrl + "?t=click&k=" + contact.id + "&a=" + enrollment.automation_id + "&e=" + enrollment.id + "&url=" + encodeURIComponent(href);
              return '<a ' + pre + 'href="' + trackedUrl + '"' + post + '>';
            });

            const payload = { from: bizFromEmail, to: [contact.email], subject, html,
              headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
            const delivery = await reserveMarketingDelivery(supabase, { businessId: enrollment.business_id,
              contactId: contact.id, enrollmentId: enrollment.id,
              key: "automation/" + enrollment.id + "/" + enrollment.created_at + "/" + currentStep.position, payload });
            if (delivery.reason !== "reserved") {
              await supabase.from("marketing_automation_logs").insert({ business_id: enrollment.business_id,
                automation_id: enrollment.automation_id, enrollment_id: enrollment.id, contact_id: contact.id,
                step_position: currentStep.position, step_type: "send_email", action: "dispatch_held",
                metadata: { reason: delivery.reason } });
              break;
            }
            const finalReason = await confirmMarketingDelivery(supabase, enrollment.business_id, delivery.id!);
            if (finalReason !== "eligible") throw new Error("Dispatch blocked: " + finalReason);
            let res: Response;
            try {
              res = await fetch("https://api.resend.com/emails", {
                method: "POST", signal: AbortSignal.timeout(15000),
                headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json",
                  "Idempotency-Key": "marketing/" + delivery.id },
                body: JSON.stringify(payload),
              });
            } catch {
              await finishMarketingDelivery(supabase, enrollment.business_id, delivery.id!, "reconcile");
              throw new Error("Provider outcome unknown; reconciliation required before any retry");
            }

            // V-17a: capture the actual Resend error body when sending fails
            // so the Step Execution Log can show *why* — previously the only
            // signal was a red "email_failed" chip with no diagnostic.
            const sendBody = await res.json().catch(() => ({} as any));
            const outcome = marketingDeliveryOutcome(res.ok, res.status, sendBody?.id);
            await finishMarketingDelivery(supabase, enrollment.business_id, delivery.id!, outcome, sendBody?.id);
            const logMeta: Record<string, unknown> = { template_id: templateId, subject, from: bizFromEmail };
            if (!res.ok) {
              logMeta.error = sendBody?.message || sendBody?.error || ("HTTP " + res.status);
              logMeta.error_name = sendBody?.name;
              logMeta.status = res.status;
            } else {
              logMeta.resend_id = sendBody?.id;
            }
            await supabase.from("marketing_automation_logs").insert({
              enrollment_id: enrollment.id,
              automation_id: enrollment.automation_id,
              contact_id: contact.id,
              business_id: enrollment.business_id,
              step_position: currentStep.position,
              step_type: "send_email",
              action: outcome === "sent" ? "email_sent" : outcome === "reconcile" ? "reconciliation_required" : "email_failed",
              metadata: logMeta,
            });

            if (outcome === "sent") {
              // Increment usage
              const currentPeriod = new Date().toISOString().slice(0, 7);
              await supabase.rpc("increment_marketing_monthly_usage", {
                p_business_id: enrollment.business_id,
                p_period: currentPeriod,
                p_amount: 1,
              });
              await supabase.rpc("increment_contact_counter", {
                p_contact_id: contact.id,
                p_column: "total_received",
                p_amount: 1,
              });
              // Update last_email_at
              await supabase.from("marketing_contacts")
                .update({ last_email_at: new Date().toISOString() })
                .eq("id", contact.id);

              results.sent++;

              // Only advance to next step if email was actually sent
              const nextStep = steps.find((s: any) => s.position > currentStep.position);
              if (nextStep) {
                await supabase.from("marketing_automation_enrollments")
                  .update({ current_step: nextStep.position, next_action_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                  .eq("id", enrollment.id);
              } else {
                await supabase.from("marketing_automation_enrollments")
                  .update({ status: "completed", updated_at: new Date().toISOString() })
                  .eq("id", enrollment.id);
                await supabase.rpc("increment_automation_counter", {
                  p_automation_id: enrollment.automation_id,
                  p_column: "completed_count",
                  p_amount: 1,
                });
                results.completed++;
              }
            } else {
              console.error("AUTOMATION_SEND_FAIL:", enrollment.id, JSON.stringify(sendBody));
              results.errors++;
              // Do not advance or resend. The durable delivery requires reconciliation or explicit operator recovery.
            }
            break;
          }

          case "delay": {
            const config = currentStep.config as any;
            const duration = config?.duration || 1;
            const unit = config?.unit || "hours";
            let delayMs = duration * 3600000; // default hours
            if (unit === "minutes") delayMs = duration * 60000;
            if (unit === "days") delayMs = duration * 86400000;

            const nextActionAt = new Date(Date.now() + delayMs).toISOString();

            // Find next step and advance with delay
            const nextStep = steps.find((s: any) => s.position > currentStep.position);
            if (nextStep) {
              await supabase.from("marketing_automation_enrollments")
                .update({ current_step: nextStep.position, next_action_at: nextActionAt, updated_at: new Date().toISOString() })
                .eq("id", enrollment.id);
            } else {
              await supabase.from("marketing_automation_enrollments")
                .update({ status: "completed", updated_at: new Date().toISOString() })
                .eq("id", enrollment.id);
              await supabase.rpc("increment_automation_counter", {
                p_automation_id: enrollment.automation_id,
                p_column: "completed_count",
                p_amount: 1,
              });
              results.completed++;
            }

            // Log
            await supabase.from("marketing_automation_logs").insert({
              enrollment_id: enrollment.id,
              automation_id: enrollment.automation_id,
              contact_id: contact.id,
              business_id: enrollment.business_id,
              step_position: currentStep.position,
              step_type: "delay",
              action: "delay_set",
              metadata: { duration, unit, next_action_at: nextActionAt },
            });

            results.delayed++;
            break;
          }

          case "condition": {
            const config = currentStep.config as any;
            const condType = config?.condition_type;
            let conditionMet = false;

            if (condType === "has_tag") {
              conditionMet = (contact.tags || []).includes(config?.value || "");
            } else if (condType === "opened_email") {
              // Check if contact has opens
              const { count } = await supabase
                .from("marketing_events")
                .select("id", { count: "exact", head: true })
                .eq("contact_id", contact.id).eq("business_id", enrollment.business_id)
                .eq("event_type", "open");
              conditionMet = (count || 0) > 0;
            } else if (condType === "clicked_link") {
              const { count } = await supabase
                .from("marketing_events")
                .select("id", { count: "exact", head: true })
                .eq("contact_id", contact.id).eq("business_id", enrollment.business_id)
                .eq("event_type", "click");
              conditionMet = (count || 0) > 0;
            }

            // Branch: yes continues to next step, no exits
            if (conditionMet) {
              const nextStep = steps.find((s: any) => s.position > currentStep.position);
              if (nextStep) {
                await supabase.from("marketing_automation_enrollments")
                  .update({ current_step: nextStep.position, next_action_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                  .eq("id", enrollment.id);
              } else {
                await supabase.from("marketing_automation_enrollments")
                  .update({ status: "completed", updated_at: new Date().toISOString() })
                  .eq("id", enrollment.id);
                await supabase.rpc("increment_automation_counter", {
                  p_automation_id: enrollment.automation_id,
                  p_column: "completed_count",
                  p_amount: 1,
                });
                results.completed++;
              }
            } else {
              // Condition not met — exit enrollment
              await supabase.from("marketing_automation_enrollments")
                .update({ status: "exited", updated_at: new Date().toISOString() })
                .eq("id", enrollment.id);
            }

            // Log
            await supabase.from("marketing_automation_logs").insert({
              enrollment_id: enrollment.id,
              automation_id: enrollment.automation_id,
              contact_id: contact.id,
              business_id: enrollment.business_id,
              step_position: currentStep.position,
              step_type: "condition",
              action: conditionMet ? "condition_yes" : "condition_no",
              metadata: { condition_type: condType, value: config?.value },
            });

            results.conditions++;
            break;
          }

          case "generate_voucher": {
            const approval = await supabase.rpc("marketing_offer_allowed", { p_business_id: enrollment.business_id,
              p_automation_id: enrollment.automation_id, p_step_type: currentStep.step_type, p_config: currentStep.config });
            if (approval.error || approval.data !== true) throw new Error("Voucher issuance is held pending approved limits and supported semantics");
            const config = currentStep.config as any;
            const prefix = config?.code_prefix || "GIFT";
            const amount = Number(config?.amount) || 100;
            const voucherType = config?.voucher_type || "fixed_amount";
            const validDays = Number(config?.valid_days) || 30;

            // Generate code
            const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
            const code = prefix + "-" + randomPart;

            // Insert voucher into the existing vouchers table. V-13a fix:
            // earlier shape used `original_value` and `source` columns that
            // don't exist, so PostgREST silently rejected the row and the
            // BDAY-/AUTO- codes never appeared in /vouchers. Match the
            // canonical shape used by rebook-booking (value / current_balance
            // / type ∈ existing enum), and capture insert errors in the
            // log so future regressions surface in the Step Execution Log.
            const expiresAt = new Date(Date.now() + validDays * 86400000).toISOString();
            const voucherRow: Record<string, unknown> = {
              business_id: enrollment.business_id,
              code,
              type: "MONETARY",
              value: amount,
              current_balance: amount,
              status: "ACTIVE",
              expires_at: expiresAt,
              recipient_email: contact.email || null,
              recipient_name: [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || null,
            };
            const { error: voucherInsertErr } = await supabase.from("vouchers").insert(voucherRow);
            if (voucherInsertErr) {
              console.error("AUTOMATION_VOUCHER_INSERT_ERR:", voucherInsertErr.message);
              throw new Error("Voucher could not be created; sequence has not advanced");
            }

            // Store in enrollment metadata for next email step
            const updatedMetadata = {
              ...metadata,
              voucher_code: code,
              voucher_amount: voucherType === "percentage" ? amount + "%" : "R " + amount,
            };

            // Advance to next step
            const nextStep = steps.find((s: any) => s.position > currentStep.position);
            if (nextStep) {
              await supabase.from("marketing_automation_enrollments")
                .update({
                  current_step: nextStep.position,
                  next_action_at: new Date().toISOString(),
                  metadata: updatedMetadata,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", enrollment.id);
            } else {
              await supabase.from("marketing_automation_enrollments")
                .update({ status: "completed", metadata: updatedMetadata, updated_at: new Date().toISOString() })
                .eq("id", enrollment.id);
              results.completed++;
            }

            // Log — surface insert failure in the Step Execution Log so the
            // operator can tell "voucher created" apart from "voucher attempted
            // but rejected by DB".
            await supabase.from("marketing_automation_logs").insert({
              enrollment_id: enrollment.id,
              automation_id: enrollment.automation_id,
              contact_id: contact.id,
              business_id: enrollment.business_id,
              step_position: currentStep.position,
              step_type: "generate_voucher",
              action: voucherInsertErr ? "voucher_failed" : "voucher_created",
              metadata: voucherInsertErr
                ? { code, amount, voucher_type: voucherType, valid_days: validDays, error: voucherInsertErr.message }
                : { code, amount, voucher_type: voucherType, valid_days: validDays },
            });

            if (voucherInsertErr) results.errors++;
            else results.vouchers++;
            break;
          }

          case "generate_promo": {
            const approval = await supabase.rpc("marketing_offer_allowed", { p_business_id: enrollment.business_id,
              p_automation_id: enrollment.automation_id, p_step_type: currentStep.step_type, p_config: currentStep.config });
            if (approval.error || approval.data !== true) throw new Error("Promo issuance is held pending approved limits");
            const config = currentStep.config as any;
            const prefix = config?.code_prefix || "PROMO";
            const discountType = config?.discount_type || "PERCENT";
            const discountValue = config?.discount_value || 10;
            const validDays = config?.valid_days || 30;
            const maxUses = config?.max_uses || 1;

            // Generate unique code: PREFIX-RANDOM6
            const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
            const code = prefix + "-" + randomPart;

            // Insert into promotions table
            const validUntil = new Date(Date.now() + validDays * 86400000).toISOString();
            const { error: promoError } = await supabase.from("promotions").insert({
              business_id: enrollment.business_id,
              code,
              description: "Auto-generated promo for " + (contact.email || "contact"),
              discount_type: discountType,
              discount_value: discountValue,
              valid_from: new Date().toISOString(),
              valid_until: validUntil,
              max_uses: maxUses,
              active: true,
            });

            if (promoError) throw new Error("Promo code could not be created: " + promoError.message);

            // Store in enrollment metadata for subsequent email steps
            const promoDiscount = discountType === "PERCENT" ? discountValue + "%" : "R" + discountValue;
            const updatedMetadata = {
              ...metadata,
              promo_code: code,
              promo_discount: promoDiscount,
            };

            // Advance to next step
            const nextStep = steps.find((s: any) => s.position > currentStep.position);
            if (nextStep) {
              await supabase.from("marketing_automation_enrollments")
                .update({
                  current_step: nextStep.position,
                  next_action_at: new Date().toISOString(),
                  metadata: updatedMetadata,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", enrollment.id);
            } else {
              await supabase.from("marketing_automation_enrollments")
                .update({ status: "completed", metadata: updatedMetadata, updated_at: new Date().toISOString() })
                .eq("id", enrollment.id);
              results.completed++;
            }

            // Log
            await supabase.from("marketing_automation_logs").insert({
              enrollment_id: enrollment.id,
              automation_id: enrollment.automation_id,
              contact_id: contact.id,
              business_id: enrollment.business_id,
              step_position: currentStep.position,
              step_type: "generate_promo",
              action: "promo_created",
              metadata: { code, discount_type: discountType, discount_value: discountValue, valid_days: validDays, max_uses: maxUses },
            });

            results.promos++;
            break;
          }
        }

        results.processed++;
      } catch (stepErr: any) {
        console.error("ENROLLMENT_PROCESS_ERR:", enrollment.id, stepErr.message);
        results.errors++;
      }
    }

    console.log("AUTOMATION_DISPATCH:", JSON.stringify(results));
    return new Response(JSON.stringify({ ok: true, ...results }), { status: 200, headers: cors });
  } catch (err: any) {
    console.error("AUTOMATION_DISPATCH_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: cors });
  }
}));
