import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "BookingTours <noreply@bookingtours.co.za>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createServiceClient();

Deno.serve(async (_req: Request) => {
  try {
    const results = { date_enrolled: 0, processed: 0, sent: 0, delayed: 0, conditions: 0, vouchers: 0, promos: 0, completed: 0, errors: 0 };

    // ── 1. Date-field triggers: enroll contacts whose date matches today ──
    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();

    const { data: dateAutomations } = await supabase
      .from("marketing_automations")
      .select("id, business_id, trigger_config")
      .eq("status", "active")
      .eq("trigger_type", "date_field");

    const currentYear = today.getFullYear();

    for (const auto of (dateAutomations || []) as any[]) {
      const field = auto.trigger_config?.field || "date_of_birth";
      const daysBefore = auto.trigger_config?.days_before || 0;

      // Calculate target date (today + days_before offset)
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysBefore);
      const targetMonth = targetDate.getMonth() + 1;
      const targetDay = targetDate.getDate();

      // Fetch contacts with their date field in one query (avoid N+1)
      const { data: matchingContacts } = await supabase
        .from("marketing_contacts")
        .select("id, " + field)
        .eq("business_id", auto.business_id)
        .eq("status", "active")
        .not(field, "is", null);

      for (const contact of (matchingContacts || []) as any[]) {
        if (!contact[field]) continue;

        // Check month+day match
        const contactDate = new Date(contact[field]);
        if (contactDate.getMonth() + 1 !== targetMonth || contactDate.getDate() !== targetDay) continue;

        // Check if already enrolled this year (allow annual re-enrollment)
        const { data: existing } = await supabase
          .from("marketing_automation_enrollments")
          .select("id, status, created_at")
          .eq("automation_id", auto.id)
          .eq("contact_id", contact.id)
          .maybeSingle();

        if (existing) {
          // Re-enroll if the last enrollment was from a previous year and is completed/exited
          const enrolledYear = new Date(existing.created_at).getFullYear();
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
    const { data: enrollments } = await supabase
      .from("marketing_automation_enrollments")
      .select("id, automation_id, contact_id, business_id, current_step, metadata")
      .eq("status", "active")
      .lte("next_action_at", new Date().toISOString())
      .order("next_action_at", { ascending: true })
      .limit(100);

    if (!enrollments || enrollments.length === 0) {
      return jsonRes({ ok: true, ...results }, 200);
    }

    // ── 3. Process each enrollment ──
    for (const enrollment of enrollments as any[]) {
      try {
        // Load automation
        const { data: automation } = await supabase
          .from("marketing_automations")
          .select("id, status, business_id")
          .eq("id", enrollment.automation_id)
          .single();

        if (!automation || automation.status !== "active") {
          // Skip paused/archived automations
          continue;
        }

        const { data: bizRow } = await supabase.from("businesses").select("business_name, subdomain").eq("id", enrollment.business_id).maybeSingle();
        const bizName = bizRow?.business_name || "Marketing";
        const bizFromEmail = bizRow?.subdomain
          ? bizName + " <noreply@" + bizRow.subdomain + ".bookingtours.co.za>"
          : FROM_EMAIL;

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
          .select("id, email, first_name, last_name, tags")
          .eq("id", enrollment.contact_id)
          .single();
        if (!contact) continue;

        const metadata = enrollment.metadata || {};

        // Process step
        switch (currentStep.step_type) {
          case "send_email": {
            const config = currentStep.config as any;
            const templateId = config?.template_id;
            if (!templateId) {
              console.error("AUTOMATION_DISPATCH: missing template_id in step config for enrollment " + enrollment.id);
              await supabase.from("marketing_automation_enrollments").update({ status: "failed" }).eq("id", enrollment.id);
              results.errors++;
              break;
            }

            // Load template
            const { data: template } = await supabase
              .from("marketing_templates")
              .select("html_content, subject_line")
              .eq("id", templateId)
              .single();
            if (!template) {
              console.error("AUTOMATION_DISPATCH: template " + templateId + " not found for enrollment " + enrollment.id);
              await supabase.from("marketing_automation_enrollments").update({ status: "failed" }).eq("id", enrollment.id);
              results.errors++;
              break;
            }

            // Variable replacement
            let html = template.html_content
              .replace(/\{first_name\}/g, contact.first_name || "there")
              .replace(/\{last_name\}/g, contact.last_name || "")
              .replace(/\{email\}/g, contact.email || "")
              .replace(/\{voucher_code\}/g, metadata.voucher_code || "")
              .replace(/\{voucher_amount\}/g, metadata.voucher_amount || "")
              .replace(/\{promo_code\}/g, metadata.promo_code || "")
              .replace(/\{promo_discount\}/g, metadata.promo_discount || "");

            const subject = (config.subject_override || template.subject_line || "Update")
              .replace(/\{first_name\}/g, contact.first_name || "there")
              .replace(/\{voucher_code\}/g, metadata.voucher_code || "")
              .replace(/\{voucher_amount\}/g, metadata.voucher_amount || "")
              .replace(/\{promo_code\}/g, metadata.promo_code || "")
              .replace(/\{promo_discount\}/g, metadata.promo_discount || "");

            // Generate unsubscribe token
            const unsubToken = crypto.randomUUID();
            await supabase.from("marketing_unsubscribe_tokens").insert({
              business_id: enrollment.business_id,
              contact_id: contact.id,
              token: unsubToken,
              // campaign_id is null for automation-sourced emails (no campaign)
            });
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

            // Send via Resend
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + RESEND_API_KEY,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: bizFromEmail,
                to: [contact.email],
                subject,
                html,
              }),
            });

            // Log the attempt
            await supabase.from("marketing_automation_logs").insert({
              enrollment_id: enrollment.id,
              automation_id: enrollment.automation_id,
              contact_id: contact.id,
              business_id: enrollment.business_id,
              step_position: currentStep.position,
              step_type: "send_email",
              action: res.ok ? "email_sent" : "email_failed",
              metadata: { template_id: templateId, subject },
            });

            if (res.ok) {
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
              console.error("AUTOMATION_SEND_FAIL:", enrollment.id, await res.text());
              results.errors++;
              // Email failed — do NOT advance. Enrollment stays on current step for retry on next dispatch cycle.
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
                .eq("contact_id", contact.id)
                .eq("event_type", "open");
              conditionMet = (count || 0) > 0;
            } else if (condType === "clicked_link") {
              const { count } = await supabase
                .from("marketing_events")
                .select("id", { count: "exact", head: true })
                .eq("contact_id", contact.id)
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
            const config = currentStep.config as any;
            const prefix = config?.code_prefix || "GIFT";
            const amount = config?.amount || 100;
            const voucherType = config?.voucher_type || "fixed_amount";
            const validDays = config?.valid_days || 30;

            // Generate code
            const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
            const code = prefix + "-" + randomPart;

            // Insert voucher into existing vouchers table
            const expiresAt = new Date(Date.now() + validDays * 86400000).toISOString();
            await supabase.from("vouchers").insert({
              business_id: enrollment.business_id,
              code,
              type: voucherType === "percentage" ? "PERCENTAGE" : "FIXED",
              original_value: amount,
              current_balance: amount,
              status: "ACTIVE",
              expires_at: expiresAt,
              source: "automation",
            });

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

            // Log
            await supabase.from("marketing_automation_logs").insert({
              enrollment_id: enrollment.id,
              automation_id: enrollment.automation_id,
              contact_id: contact.id,
              business_id: enrollment.business_id,
              step_position: currentStep.position,
              step_type: "generate_voucher",
              action: "voucher_created",
              metadata: { code, amount, voucher_type: voucherType, valid_days: validDays },
            });

            results.vouchers++;
            break;
          }

          case "generate_promo": {
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
            await supabase.from("promotions").insert({
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
    return jsonRes({ ok: true, ...results }, 200);
  } catch (err: any) {
    console.error("AUTOMATION_DISPATCH_ERROR:", err);
    return jsonRes({ error: err.message || "Internal error" }, 500);
  }
});

function jsonRes(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
