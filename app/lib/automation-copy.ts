// Plain-language copy for marketing automations: turns the step/trigger data
// model into sentences an operator can read without knowing the taxonomy.
// Pure functions only, no Supabase/DOM access, so they render identically on
// the editor, the automations list, and the template gallery preview.

export type AutomationStep = { step_type: string; config: any };
export type AutomationLike = { trigger_type: string; trigger_config: any };
export type TemplateRef = { name: string } | undefined;

function pluralize(n: number, unit: string): string {
  return n + " " + unit + (n === 1 ? "" : "s");
}

// unit is "minutes" | "hours" | "days" from the delay step config; singularize
// for n === 1 ("1 day", not "1 days").
function delayUnitLabel(n: number, unit: string): string {
  const singular = unit.replace(/s$/, "");
  return pluralize(n, singular);
}

function emailDisplayName(config: any, getTemplate?: (templateId: string) => TemplateRef): string {
  const tpl = config?.template_id ? getTemplate?.(config.template_id) : undefined;
  if (tpl?.name) return tpl.name;
  if (config?.subject_override) return config.subject_override;
  return "an email";
}

/**
 * One human sentence describing what a workflow step does. `index` and
 * `allSteps` give it just enough context to say "Immediately" (nothing
 * delayed before it) versus continuing after a wait, and to name the email a
 * condition step is checking against.
 */
export function stepSentence(
  step: AutomationStep,
  index: number,
  allSteps: AutomationStep[],
  getTemplate?: (templateId: string) => TemplateRef,
): string {
  const config = step.config || {};
  const prev = index > 0 ? allSteps[index - 1] : undefined;

  switch (step.step_type) {
    case "send_email": {
      const name = emailDisplayName(config, getTemplate);
      const immediate = !prev || prev.step_type !== "delay";
      return immediate ? `Immediately: send "${name}"` : `Send "${name}"`;
    }
    case "delay": {
      const duration = Number(config.duration) > 0 ? Number(config.duration) : 1;
      const unit = config.unit || "days";
      return "Wait " + delayUnitLabel(duration, unit);
    }
    case "condition": {
      const conditionType = config.condition_type || "has_tag";
      if (conditionType === "opened_email") {
        return "If they opened the previous email: continue, otherwise: stop";
      }
      if (conditionType === "clicked_link") {
        return "If they clicked a link in the previous email: continue, otherwise: stop";
      }
      const tag = String(config.value || "").trim();
      return tag
        ? `If they have the tag "${tag}": continue, otherwise: stop`
        : "If they have the tag: continue, otherwise: stop";
    }
    case "generate_voucher": {
      const prefix = String(config.code_prefix || "AUTO").toUpperCase();
      const validDays = Number(config.valid_days) > 0 ? Number(config.valid_days) : 30;
      const amountLabel = config.voucher_type === "fixed_amount"
        ? "R" + (Number(config.amount) || 0)
        : (Number(config.amount) || 0) + "%";
      return `Create a unique ${amountLabel} voucher (${prefix}-, valid ${validDays} days)`;
    }
    case "generate_promo": {
      const prefix = String(config.code_prefix || "PROMO").toUpperCase();
      const validDays = Number(config.valid_days) > 0 ? Number(config.valid_days) : 30;
      const maxUses = Number(config.max_uses) > 0 ? Number(config.max_uses) : 1;
      const amountLabel = config.discount_type === "FLAT"
        ? "R" + (Number(config.discount_value) || 0)
        : (Number(config.discount_value) || 0) + "%";
      return `Create a unique ${amountLabel} promo code (${prefix}-, valid ${validDays} days, ${pluralize(maxUses, "use")})`;
    }
    default:
      return "Unknown step";
  }
}

const DATE_FIELD_LABELS: Record<string, string> = {
  date_of_birth: "birthday",
};

/** Plain-English restatement of what fires an automation. */
export function triggerSentence(a: AutomationLike): string {
  const config = a.trigger_config || {};
  switch (a.trigger_type) {
    case "contact_added":
      return "Runs when someone new joins your contact list.";
    case "tag_added": {
      const tag = String(config.tag || "").trim();
      return tag ? `Runs when a contact gets tagged "${tag}".` : "Runs when a contact gets a tag (choose which one below).";
    }
    case "post_booking":
      return "Runs right after a booking is made.";
    case "date_field": {
      const fieldLabel = DATE_FIELD_LABELS[config.field] || "date";
      const daysBefore = Number(config.days_before) || 0;
      return daysBefore > 0
        ? `Runs ${pluralize(daysBefore, "day")} before each contact's ${fieldLabel}.`
        : `Runs on each contact's ${fieldLabel}.`;
    }
    case "manual":
      return "Runs only when you manually enroll contacts (below).";
    default:
      return "Runs on a custom trigger.";
  }
}

// Approximate total wait time across all delay steps, in whole days, for the
// list page's at-a-glance flow summary. Mixed units are converted to days
// and summed; this is a rough "over N days" figure, not a scheduling value.
function totalDelayDays(steps: AutomationStep[]): number {
  let minutes = 0;
  for (const s of steps) {
    if (s.step_type !== "delay") continue;
    const duration = Number(s.config?.duration) || 0;
    const unit = s.config?.unit || "days";
    minutes += unit === "minutes" ? duration : unit === "hours" ? duration * 60 : duration * 1440;
  }
  return Math.round(minutes / 1440);
}

/** Tiny "3 emails over 7 days, 1 voucher" summary for the automations list. */
export function flowSummary(steps: AutomationStep[]): string {
  if (steps.length === 0) return "No steps yet";
  const emails = steps.filter((s) => s.step_type === "send_email").length;
  const vouchers = steps.filter((s) => s.step_type === "generate_voucher").length;
  const promos = steps.filter((s) => s.step_type === "generate_promo").length;
  const days = totalDelayDays(steps);

  const parts: string[] = [];
  if (emails > 0) parts.push(pluralize(emails, "email") + (days > 0 ? " over " + pluralize(days, "day") : ""));
  if (vouchers > 0) parts.push(pluralize(vouchers, "voucher"));
  if (promos > 0) parts.push(pluralize(promos, "promo code"));
  return parts.length > 0 ? parts.join(", ") : pluralize(steps.length, "step");
}

/**
 * Same activation-readiness checks the editor already ran on click, factored
 * out so the activation checklist can render live "done/todo" state instead
 * of only surfacing problems after the operator tries to activate.
 */
export function validateAutomation(automation: AutomationLike, steps: AutomationStep[]): string[] {
  const issues: string[] = [];
  if (steps.length === 0) {
    issues.push("Add at least one step before activating.");
    return issues;
  }
  steps.forEach((s, i) => {
    const label = "Step " + (i + 1);
    if (s.step_type === "send_email") {
      if (!s.config?.template_id) issues.push(label + ": Send Email has no template selected");
    } else if (s.step_type === "delay") {
      const dur = Number(s.config?.duration);
      if (!Number.isFinite(dur) || dur <= 0) issues.push(label + ": Delay duration must be > 0");
    } else if (s.step_type === "generate_voucher") {
      if (!Number(s.config?.amount)) issues.push(label + ": Voucher amount must be > 0");
      if (!String(s.config?.code_prefix || "").trim()) issues.push(label + ": Voucher code prefix is required");
    } else if (s.step_type === "generate_promo") {
      if (!Number(s.config?.discount_value)) issues.push(label + ": Promo discount value must be > 0");
      if (!String(s.config?.code_prefix || "").trim()) issues.push(label + ": Promo code prefix is required");
    }
  });
  if (automation.trigger_type === "tag_added" && !String(automation.trigger_config?.tag || "").trim()) {
    issues.push("Trigger: tag_added requires a tag value in trigger_config");
  }
  return issues;
}
