import { describe, it, expect } from "vitest";
import { stepSentence, triggerSentence, flowSummary, validateAutomation } from "../../app/lib/automation-copy";

describe("stepSentence", () => {
  it("marks the first send_email step as immediate and names the template", () => {
    const steps = [{ step_type: "send_email", config: { template_id: "t1" } }];
    const getTemplate = (id: string) => (id === "t1" ? { name: "Welcome, The Story" } : undefined);
    expect(stepSentence(steps[0], 0, steps, getTemplate)).toBe('Immediately: send "Welcome, The Story"');
  });

  it("drops the immediate prefix for a send_email right after a delay", () => {
    const steps = [
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: { subject_override: "Our Most Popular Tours" } },
    ];
    expect(stepSentence(steps[1], 1, steps)).toBe('Send "Our Most Popular Tours"');
  });

  it("still says immediate for a send_email after a non-delay step", () => {
    const steps = [
      { step_type: "condition", config: { condition_type: "has_tag", value: "vip" } },
      { step_type: "send_email", config: { subject_override: "VIP Offer" } },
    ];
    expect(stepSentence(steps[1], 1, steps)).toBe('Immediately: send "VIP Offer"');
  });

  it("falls back to a generic label when a send_email step has no template or subject", () => {
    const steps = [{ step_type: "send_email", config: {} }];
    expect(stepSentence(steps[0], 0, steps)).toBe('Immediately: send "an email"');
  });

  it("pluralizes delay units correctly", () => {
    expect(stepSentence({ step_type: "delay", config: { duration: 1, unit: "days" } }, 0, [])).toBe("Wait 1 day");
    expect(stepSentence({ step_type: "delay", config: { duration: 3, unit: "days" } }, 0, [])).toBe("Wait 3 days");
    expect(stepSentence({ step_type: "delay", config: { duration: 1, unit: "hours" } }, 0, [])).toBe("Wait 1 hour");
  });

  it("describes an opened_email condition in plain language", () => {
    const step = { step_type: "condition", config: { condition_type: "opened_email" } };
    expect(stepSentence(step, 0, [step])).toBe("If they opened the previous email: continue, otherwise: stop");
  });

  it("names the tag for a has_tag condition", () => {
    const step = { step_type: "condition", config: { condition_type: "has_tag", value: "vip" } };
    expect(stepSentence(step, 0, [step])).toBe('If they have the tag "vip": continue, otherwise: stop');
  });

  it("describes a percentage voucher step", () => {
    const step = { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "welcome", valid_days: 30 } };
    expect(stepSentence(step, 0, [step])).toBe("Create a unique 10% voucher (WELCOME-, valid 30 days)");
  });

  it("describes a fixed-amount voucher step", () => {
    const step = { step_type: "generate_voucher", config: { voucher_type: "fixed_amount", amount: 100, code_prefix: "refer", valid_days: 90 } };
    expect(stepSentence(step, 0, [step])).toBe("Create a unique R100 voucher (REFER-, valid 90 days)");
  });

  it("describes a promo code step with use limit", () => {
    const step = { step_type: "generate_promo", config: { discount_type: "PERCENT", discount_value: 10, code_prefix: "promo", valid_days: 30, max_uses: 1 } };
    expect(stepSentence(step, 0, [step])).toBe("Create a unique 10% promo code (PROMO-, valid 30 days, 1 use)");
  });
});

describe("triggerSentence", () => {
  it("describes contact_added", () => {
    expect(triggerSentence({ trigger_type: "contact_added", trigger_config: {} })).toBe(
      "Runs when someone new joins your contact list.",
    );
  });

  it("names the tag for tag_added", () => {
    expect(triggerSentence({ trigger_type: "tag_added", trigger_config: { tag: "vip" } })).toBe(
      'Runs when a contact gets tagged "vip".',
    );
  });

  it("handles date_field with days_before", () => {
    expect(triggerSentence({ trigger_type: "date_field", trigger_config: { field: "date_of_birth", days_before: 3 } })).toBe(
      "Runs 3 days before each contact's birthday.",
    );
    expect(triggerSentence({ trigger_type: "date_field", trigger_config: { field: "date_of_birth", days_before: 0 } })).toBe(
      "Runs on each contact's birthday.",
    );
  });
});

describe("flowSummary", () => {
  it("summarizes emails, delay days, and a voucher", () => {
    const steps = [
      { step_type: "send_email", config: {} },
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: {} },
      { step_type: "delay", config: { duration: 4, unit: "days" } },
      { step_type: "generate_voucher", config: {} },
      { step_type: "send_email", config: {} },
    ];
    expect(flowSummary(steps)).toBe("3 emails over 7 days, 1 voucher");
  });

  it("handles no steps", () => {
    expect(flowSummary([])).toBe("No steps yet");
  });
});

describe("validateAutomation", () => {
  it("requires at least one step", () => {
    expect(validateAutomation({ trigger_type: "manual", trigger_config: {} }, [])).toEqual([
      "Add at least one step before activating.",
    ]);
  });

  it("flags a send_email step with no template", () => {
    const issues = validateAutomation({ trigger_type: "manual", trigger_config: {} }, [
      { step_type: "send_email", config: {} },
    ]);
    expect(issues).toContain("Step 1: Send Email has no template selected");
  });

  it("flags a tag_added trigger with no tag", () => {
    const issues = validateAutomation({ trigger_type: "tag_added", trigger_config: {} }, [
      { step_type: "send_email", config: { template_id: "t1" } },
    ]);
    expect(issues).toContain("Trigger: tag_added requires a tag value in trigger_config");
  });

  it("passes a fully configured automation", () => {
    const issues = validateAutomation({ trigger_type: "tag_added", trigger_config: { tag: "vip" } }, [
      { step_type: "send_email", config: { template_id: "t1" } },
    ]);
    expect(issues).toEqual([]);
  });
});
