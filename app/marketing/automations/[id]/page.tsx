"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { confirmAction, notify } from "../../../lib/app-notify";
import { useBusinessContext } from "../../../../components/BusinessContext";
import { ArrowLeft, Plus, Trash, CaretUp, CaretDown, MagnifyingGlass, Play, Pause } from "@phosphor-icons/react";

interface Step {
  id?: string;
  position: number;
  step_type: string;
  config: any;
}

interface Automation {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: any;
  status: string;
}

interface Template {
  id: string;
  name: string;
  subject_line: string;
}

interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface Enrollment {
  id: string;
  contact_id: string;
  current_step: number;
  status: string;
  next_action_at: string | null;
  created_at: string;
  updated_at: string | null;
  marketing_contacts?: { email: string; first_name: string | null; last_name: string | null } | null;
}

interface AutomationLog {
  id: string;
  enrollment_id: string;
  contact_id: string;
  step_position: number;
  step_type: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  marketing_contacts?: { email: string; first_name: string | null } | null;
}

const stepTypeInfo: Record<string, { label: string }> = {
  send_email: { label: "Send Email" },
  delay: { label: "Delay" },
  condition: { label: "Condition" },
  generate_voucher: { label: "Generate Voucher" },
  generate_promo: { label: "Generate Promo" },
};

export default function AutomationBuilderPage() {
  const { businessId } = useBusinessContext();
  const params = useParams();
  const router = useRouter();
  const automationId = params?.id as string;

  const [automation, setAutomation] = useState<Automation | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Manual enrollment state
  const [enrollSearch, setEnrollSearch] = useState("");
  const [enrollResults, setEnrollResults] = useState<Contact[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  // Enrollments list state (V-2)
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrolledTotal, setEnrolledTotal] = useState(0);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);
  // V-17: per-step audit log so operators can reconstruct exactly which
  // step ran for which contact and what happened (email sent/failed,
  // voucher code issued, condition outcome).
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  useEffect(() => {
    if (businessId && automationId) {
      loadAutomation();
      loadTemplates();
      loadEnrollments();
      loadLogs();
    }
  }, [businessId, automationId]);

  async function loadLogs() {
    setLogsLoading(true);
    const { data, error } = await supabase
      .from("marketing_automation_logs")
      .select("id, enrollment_id, contact_id, step_position, step_type, action, metadata, created_at, marketing_contacts(email, first_name)")
      .eq("automation_id", automationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.warn("loadLogs failed:", error.message);
      // RLS missing on logs would surface here; surface to the operator
      // rather than silently rendering "no logs".
      notify({ title: "Could not load logs", message: error.message, tone: "error" });
      setLogsLoading(false);
      return;
    }
    const rows = ((data || []) as any[]).map((r) => ({
      ...r,
      marketing_contacts: Array.isArray(r.marketing_contacts) ? r.marketing_contacts[0] || null : r.marketing_contacts,
    })) as AutomationLog[];
    setLogs(rows);
    setLogsLoading(false);
  }

  async function runDispatchNow() {
    // V-10 / V-12: give operators a manual way to fire the dispatch
    // function on demand. Without it the only way to verify a date_field
    // trigger or kick a stalled enrollment is to wait for the cron.
    setDispatching(true);
    try {
      const res = await supabase.functions.invoke("marketing-automation-dispatch", { body: {} });
      const data = res.data as any;
      if (res.error || data?.error) {
        notify({ title: "Dispatch failed", message: res.error?.message || data?.error || "Unknown error", tone: "error", duration: 8000 });
      } else {
        const sent = data?.sent || 0;
        const processed = data?.processed || 0;
        const errors = data?.errors || 0;
        notify({
          title: "Dispatch run",
          message: "Processed " + processed + " step" + (processed === 1 ? "" : "s") + " · " + sent + " email" + (sent === 1 ? "" : "s") + " sent" + (errors > 0 ? " · " + errors + " error" + (errors === 1 ? "" : "s") : "") + ". Refresh logs to see detail.",
          tone: errors > 0 ? "warning" : "success",
          duration: 5500,
        });
        await loadEnrollments();
        await loadLogs();
      }
    } catch (e: unknown) {
      notify({ title: "Dispatch failed", message: (e as Error)?.message || String(e), tone: "error" });
    } finally {
      setDispatching(false);
    }
  }

  async function loadEnrollments() {
    setEnrollmentsLoading(true);
    // Columns confirmed via information_schema: id, automation_id, contact_id,
    // business_id, current_step, status, next_action_at, metadata, created_at,
    // updated_at. No enrolled_at / completed_at columns — completion is
    // derived from status. Previously the query referenced enrolled_at and
    // failed silently with an empty result (V-2b).
    const { data, count, error } = await supabase
      .from("marketing_automation_enrollments")
      .select("id, contact_id, current_step, status, next_action_at, created_at, updated_at, marketing_contacts(email, first_name, last_name)", { count: "exact" })
      .eq("automation_id", automationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.warn("loadEnrollments failed:", error.message);
      notify({ title: "Could not load enrollments", message: error.message, tone: "error" });
      setEnrollmentsLoading(false);
      return;
    }
    const rows = ((data || []) as any[]).map((r) => ({
      ...r,
      marketing_contacts: Array.isArray(r.marketing_contacts) ? r.marketing_contacts[0] || null : r.marketing_contacts,
    })) as Enrollment[];
    setEnrollments(rows);
    setEnrolledTotal(count || 0);
    setCompletedTotal(rows.filter((r) => r.status === "completed").length);
    setEnrollmentsLoading(false);
  }

  async function loadAutomation() {
    setLoading(true);
    const { data: autoData } = await supabase
      .from("marketing_automations")
      .select("id, name, description, trigger_type, trigger_config, status")
      .eq("id", automationId)
      .single();

    if (!autoData) {
      notify({ message: "Automation not found.", tone: "error" });
      router.push("/marketing/automations");
      return;
    }
    setAutomation(autoData as Automation);

    const { data: stepData } = await supabase
      .from("marketing_automation_steps")
      .select("id, position, step_type, config")
      .eq("automation_id", automationId)
      .order("position", { ascending: true });
    setSteps((stepData as Step[]) || []);
    setLoading(false);
  }

  async function loadTemplates() {
    const { data } = await supabase
      .from("marketing_templates")
      .select("id, name, subject_line")
      .eq("business_id", businessId)
      .order("name");
    setTemplates((data as Template[]) || []);
  }

  async function saveAutomation() {
    if (!automation) return;
    if (!String(automation.name || "").trim()) {
      notify({ title: "Name required", message: "Give the automation a descriptive name before saving.", tone: "warning" });
      return;
    }
    setSaving(true);

    // Save automation metadata
    const { error: autoErr } = await supabase
      .from("marketing_automations")
      .update({
        name: automation.name.trim(),
        description: automation.description,
        trigger_type: automation.trigger_type,
        trigger_config: automation.trigger_config,
        updated_at: new Date().toISOString(),
      })
      .eq("id", automationId);

    if (autoErr) {
      notify({ message: autoErr.message, tone: "error" });
      setSaving(false);
      return;
    }

    // Delete existing steps and re-insert
    await supabase.from("marketing_automation_steps").delete().eq("automation_id", automationId);

    if (steps.length > 0) {
      const stepRows = steps.map((s, i) => ({
        automation_id: automationId,
        position: i,
        step_type: s.step_type,
        config: s.config,
      }));
      const { error: stepErr } = await supabase.from("marketing_automation_steps").insert(stepRows);
      if (stepErr) {
        notify({ message: stepErr.message, tone: "error" });
        setSaving(false);
        return;
      }
    }

    notify({ message: "Automation saved.", tone: "success" });
    setSaving(false);
  }

  async function archiveAutomation() {
    if (!automation) return;
    if (!await confirmAction({
      title: "Archive automation",
      message: "Archive \"" + (automation.name || "this automation") + "\"? It will stop firing for new triggers and be hidden from the active list. Enrollment history is preserved and you can unarchive later.",
      tone: "warning",
      confirmLabel: "Archive",
    })) return;
    const { error } = await supabase
      .from("marketing_automations")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", automationId);
    if (error) { notify({ message: error.message, tone: "error" }); return; }
    notify({ message: "Automation archived.", tone: "success" });
    router.push("/marketing/automations");
  }

  async function unarchiveAutomation() {
    if (!automation) return;
    const { error } = await supabase
      .from("marketing_automations")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", automationId);
    if (error) { notify({ message: error.message, tone: "error" }); return; }
    setAutomation({ ...automation, status: "draft" });
    notify({ message: "Automation unarchived (set to draft).", tone: "success" });
  }

  async function deleteAutomation() {
    if (!automation) return;
    if (!await confirmAction({
      title: "Delete automation",
      message: "Delete \"" + (automation.name || "this automation") + "\" permanently? Enrollment history and analytics will be destroyed. If you might want this back later, Archive instead.",
      tone: "warning",
      confirmLabel: "Delete permanently",
    })) return;
    const { error } = await supabase.from("marketing_automations").delete().eq("id", automationId);
    if (error) { notify({ message: error.message, tone: "error" }); return; }
    notify({ message: "Automation deleted.", tone: "success" });
    router.push("/marketing/automations");
  }

  async function toggleAutomationStatus() {
    if (!automation) return;
    const newStatus = automation.status === "active" ? "paused" : "active";

    // V-1: Pre-activation validation — block before flipping status to active
    // if the automation isn't actually runnable. Without this the operator
    // sees "Active" and waits for emails that can't ever fire.
    if (newStatus === "active") {
      if (steps.length === 0) {
        notify({ title: "Cannot activate", message: "Add at least one step before activating.", tone: "warning" });
        return;
      }
      const issues: string[] = [];
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
      if (issues.length > 0) {
        notify({
          title: "Cannot activate — fix " + issues.length + " issue" + (issues.length === 1 ? "" : "s"),
          message: issues.slice(0, 4).join(" · ") + (issues.length > 4 ? " · …" : ""),
          tone: "warning",
          duration: 8000,
        });
        return;
      }
    }

    // Save first, then toggle
    await saveAutomation();

    const { error } = await supabase
      .from("marketing_automations")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", automationId);

    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    setAutomation({ ...automation!, status: newStatus });
    notify({ message: newStatus === "active" ? "Automation activated." : "Automation paused.", tone: "success" });
  }

  function addStep(index: number, type: string) {
    const newStep: Step = {
      position: index,
      step_type: type,
      config: type === "delay" ? { duration: 1, unit: "days" } :
              type === "condition" ? { condition_type: "has_tag", value: "" } :
              type === "generate_voucher" ? { voucher_type: "percentage", amount: 10, code_prefix: "AUTO", valid_days: 30 } :
              type === "generate_promo" ? { discount_type: "PERCENT", discount_value: 10, code_prefix: "PROMO", valid_days: 30, max_uses: 1 } :
              { template_id: "", subject_override: "" },
    };
    const updated = [...steps];
    updated.splice(index, 0, newStep);
    // Re-index positions
    setSteps(updated.map((s, i) => ({ ...s, position: i })));
  }

  function removeStep(index: number) {
    const updated = steps.filter((_, i) => i !== index);
    setSteps(updated.map((s, i) => ({ ...s, position: i })));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const updated = [...steps];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setSteps(updated.map((s, i) => ({ ...s, position: i })));
  }

  function updateStepConfig(index: number, config: any) {
    setSteps(steps.map((s, i) => (i === index ? { ...s, config } : s)));
  }

  // Manual enrollment
  async function searchContacts() {
    if (!enrollSearch.trim()) return;
    const { data } = await supabase
      .from("marketing_contacts")
      .select("id, email, first_name, last_name")
      .eq("business_id", businessId)
      .eq("status", "active")
      .ilike("email", "%" + enrollSearch + "%")
      .limit(10);
    setEnrollResults((data as Contact[]) || []);
  }

  async function enrollContact(contactId: string) {
    setEnrolling(true);
    // Check if already enrolled
    const { data: existing } = await supabase
      .from("marketing_automation_enrollments")
      .select("id, status")
      .eq("automation_id", automationId)
      .eq("contact_id", contactId)
      .maybeSingle();

    if (existing) {
      if (existing.status === "active") {
        notify({ message: "Contact is already enrolled.", tone: "warning" });
      } else {
        // Re-activate completed/exited enrollment
        await supabase.from("marketing_automation_enrollments")
          .update({ status: "active", current_step: 0, next_action_at: new Date().toISOString(), metadata: {}, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        await supabase.rpc("increment_automation_counter", {
          p_automation_id: automationId,
          p_column: "enrolled_count",
          p_amount: 1,
        });
        notify({ message: "Contact re-enrolled.", tone: "success" });
      }
      setEnrolling(false);
      setEnrollSearch("");
      setEnrollResults([]);
      return;
    }

    const { error } = await supabase.from("marketing_automation_enrollments").insert({
      automation_id: automationId,
      contact_id: contactId,
      business_id: businessId,
      status: "active",
      next_action_at: new Date().toISOString(),
    });
    if (error) {
      notify({ message: error.message, tone: "error" });
      setEnrolling(false);
      return;
    }
    await supabase.rpc("increment_automation_counter", {
      p_automation_id: automationId,
      p_column: "enrolled_count",
      p_amount: 1,
    });
    notify({ message: "Contact enrolled.", tone: "success" });
    setEnrolling(false);
    setEnrollSearch("");
    setEnrollResults([]);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!automation) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <button
        onClick={() => router.push("/marketing/automations")}
        className="flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--ck-text-muted)" }}
      >
        <ArrowLeft size={14} /> Back to automations
      </button>

      {/* Automation metadata */}
      <div
        className="rounded-xl border p-5 space-y-4"
        style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
              Automation Name
            </label>
            <input
              value={automation.name}
              onChange={(e) => setAutomation({ ...automation!, name: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
              Description (optional)
            </label>
            <input
              value={automation.description || ""}
              onChange={(e) => setAutomation({ ...automation!, description: e.target.value || null })}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
              placeholder="What does this automation do?"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
              Trigger Type
            </label>
            <select
              value={automation.trigger_type}
              onChange={(e) => setAutomation({ ...automation!, trigger_type: e.target.value, trigger_config: {} })}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
            >
              <option value="contact_added">Contact Added</option>
              <option value="tag_added">Tag Added</option>
              <option value="post_booking">Post Booking</option>
              <option value="date_field">Date Field</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          {/* Dynamic trigger config */}
          {automation.trigger_type === "tag_added" && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                Tag Name
              </label>
              <input
                value={automation.trigger_config?.tag || ""}
                onChange={(e) =>
                  setAutomation({
                    ...automation!,
                    trigger_config: { ...automation!.trigger_config, tag: e.target.value },
                  })
                }
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                placeholder="e.g. vip"
              />
            </div>
          )}

          {automation.trigger_type === "date_field" && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                  Date Field
                </label>
                <select
                  value={automation.trigger_config?.field || "date_of_birth"}
                  onChange={(e) =>
                    setAutomation({
                      ...automation!,
                      trigger_config: { ...automation!.trigger_config, field: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                >
                  <option value="date_of_birth">Date of Birth</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                  Days Before
                </label>
                <input
                  type="number"
                  min={0}
                  value={automation.trigger_config?.days_before ?? 0}
                  onChange={(e) =>
                    setAutomation({
                      ...automation!,
                      trigger_config: { ...automation!.trigger_config, days_before: parseInt(e.target.value) || 0 },
                    })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                />
              </div>
            </>
          )}
        </div>

        {/* Status + Save */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={saveAutomation}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--ck-accent)" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {automation.status !== "archived" && (
            <button
              onClick={toggleAutomationStatus}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                automation.status === "active" ? "bg-yellow-500" : "bg-emerald-600"
              }`}
            >
              {automation.status === "active" ? (
                <><Pause size={14} /> Pause</>
              ) : (
                <><Play size={14} /> Activate</>
              )}
            </button>
          )}
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              automation.status === "active"
                ? "bg-emerald-100 text-emerald-700"
                : automation.status === "paused"
                ? "bg-yellow-100 text-yellow-700"
                : automation.status === "archived"
                ? "bg-red-100 text-red-600"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {automation.status}
          </span>
          {/* V-6: Archive + Delete on the detail page — operators were stuck
              with paused / abandoned automations because the list-page
              Actions column wasn't discoverable on narrow viewports. */}
          <div className="ml-auto flex items-center gap-2">
            {automation.status === "active" && (
              <button
                onClick={runDispatchNow}
                disabled={dispatching}
                className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ borderColor: "var(--ck-border)", color: "var(--ck-accent)" }}
                title="Manually fire the dispatch worker — useful for date_field triggers and stalled enrollments"
              >
                {dispatching ? "Dispatching…" : "Run dispatch now"}
              </button>
            )}
            {automation.status === "archived" ? (
              <button
                onClick={unarchiveAutomation}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
                title="Restore to draft"
              >
                Unarchive
              </button>
            ) : (
              <button
                onClick={archiveAutomation}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--ck-border)", color: "var(--ck-text-muted)" }}
                title="Hide from active list, preserve history"
              >
                Archive
              </button>
            )}
            <button
              onClick={deleteAutomation}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100"
              title="Delete permanently"
            >
              <Trash size={14} /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* Step builder */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>
          Workflow Steps
        </h2>

        {/* Trigger card */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium"
            style={{ borderColor: "var(--ck-accent)", background: "var(--ck-surface)", color: "var(--ck-accent)" }}
          >
            Trigger: {automation.trigger_type.replace(/_/g, " ")}
          </div>
        </div>

        {/* Add step button at start */}
        <AddStepButton onAdd={(type) => addStep(0, type)} />

        {/* Steps */}
        {steps.map((step, idx) => {
          const info = stepTypeInfo[step.step_type] || stepTypeInfo.send_email;
          return (
            <div key={step.id ?? `step-${idx}`}>
              {/* Connecting line */}
              <div className="flex items-center pl-6 mb-2">
                <div className="w-px h-4" style={{ background: "var(--ck-border)" }} />
              </div>

              <div
                className="rounded-xl border p-4 space-y-3"
                style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white"
                      style={{ background: "var(--ck-accent)" }}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>
                      {info.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 rounded border disabled:opacity-30"
                      style={{ borderColor: "var(--ck-border)" }}
                    >
                      <CaretUp size={14} />
                    </button>
                    <button
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                      className="p-1 rounded border disabled:opacity-30"
                      style={{ borderColor: "var(--ck-border)" }}
                    >
                      <CaretDown size={14} />
                    </button>
                    <button
                      onClick={() => removeStep(idx)}
                      className="p-1 text-red-500 hover:text-red-700"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>

                {/* Step config */}
                {step.step_type === "send_email" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Template
                      </label>
                      <select
                        value={step.config.template_id || ""}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, template_id: e.target.value })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      >
                        <option value="">Select template...</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} — {t.subject_line}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Subject Override (optional)
                      </label>
                      <input
                        value={step.config.subject_override || ""}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, subject_override: e.target.value })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                        placeholder="Leave empty to use template subject"
                      />
                    </div>
                  </div>
                )}

                {step.step_type === "delay" && (
                  <div className="flex gap-3 items-end">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Duration
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={step.config.duration ?? 1}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, duration: parseInt(e.target.value) || 1 })}
                        className="w-24 rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Unit
                      </label>
                      <select
                        value={step.config.unit || "days"}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, unit: e.target.value })}
                        className="rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  </div>
                )}

                {step.step_type === "condition" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Condition
                      </label>
                      <select
                        value={step.config.condition_type || "has_tag"}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, condition_type: e.target.value })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      >
                        <option value="opened_email">Opened Email</option>
                        <option value="clicked_link">Clicked Link</option>
                        <option value="has_tag">Has Tag</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Value
                      </label>
                      <input
                        value={step.config.value || ""}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, value: e.target.value })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                        placeholder={step.config.condition_type === "has_tag" ? "tag name" : "identifier"}
                      />
                    </div>
                    <p className="text-xs sm:col-span-2" style={{ color: "var(--ck-text-muted)" }}>
                      If true, the contact continues to the next step. If false, the contact exits the automation.
                    </p>
                  </div>
                )}

                {step.step_type === "generate_voucher" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Voucher Type
                      </label>
                      <select
                        value={step.config.voucher_type || "percentage"}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, voucher_type: e.target.value })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      >
                        <option value="percentage">Percentage</option>
                        <option value="fixed_amount">Fixed Amount</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Amount
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={step.config.amount ?? 10}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, amount: parseInt(e.target.value) || 0 })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Code Prefix
                      </label>
                      <input
                        value={step.config.code_prefix || ""}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, code_prefix: e.target.value.toUpperCase() })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                        placeholder="AUTO"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Valid Days
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={step.config.valid_days ?? 30}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, valid_days: parseInt(e.target.value) || 30 })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      />
                    </div>
                  </div>
                )}

                {step.step_type === "generate_promo" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Discount Type
                      </label>
                      <select
                        value={step.config.discount_type || "PERCENT"}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, discount_type: e.target.value })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      >
                        <option value="PERCENT">Percentage (%)</option>
                        <option value="FLAT">Fixed Amount (R)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Discount Value
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={step.config.discount_value ?? 10}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, discount_value: parseInt(e.target.value) || 0 })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Code Prefix
                      </label>
                      <input
                        value={step.config.code_prefix || ""}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, code_prefix: e.target.value.toUpperCase() })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                        placeholder="PROMO"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Valid Days
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={step.config.valid_days ?? 30}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, valid_days: parseInt(e.target.value) || 30 })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                        Max Uses Per Code
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={step.config.max_uses ?? 1}
                        onChange={(e) => updateStepConfig(idx, { ...step.config, max_uses: parseInt(e.target.value) || 1 })}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Add step button between steps */}
              <AddStepButton onAdd={(type) => addStep(idx + 1, type)} />
            </div>
          );
        })}

        {steps.length === 0 && (
          <p className="text-xs pl-2" style={{ color: "var(--ck-text-muted)" }}>
            No steps yet. Click + to add your first workflow step.
          </p>
        )}

        {/* Template variables hint */}
        <div className="rounded-lg border px-4 py-3 mt-2" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Available template variables:</p>
          <p className="text-xs font-mono" style={{ color: "var(--ck-text)" }}>
            {"{first_name}"} {"{last_name}"} {"{email}"} {"{voucher_code}"} {"{voucher_amount}"} {"{promo_code}"} {"{promo_discount}"}
          </p>
        </div>
      </div>

      {/* Manual enrollment */}
      {automation.trigger_type === "manual" && (
        <div
          className="rounded-xl border p-5 space-y-3"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
        >
          <h3 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>
            Manual Enrollment
          </h3>
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
            Search for contacts and enroll them into this automation.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
              <input
                value={enrollSearch}
                onChange={(e) => setEnrollSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchContacts()}
                placeholder="Search by email..."
                className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
                style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
              />
            </div>
            <button
              onClick={searchContacts}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
            >
              Search
            </button>
          </div>
          {enrollResults.length > 0 && (
            <div className="space-y-1">
              {enrollResults.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                  style={{ borderColor: "var(--ck-border)" }}
                >
                  <span className="text-sm" style={{ color: "var(--ck-text)" }}>
                    {c.email} {c.first_name ? `(${c.first_name} ${c.last_name || ""})` : ""}
                  </span>
                  <button
                    onClick={() => enrollContact(c.id)}
                    disabled={enrolling}
                    className="rounded-lg px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--ck-accent)" }}
                  >
                    Enroll
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* V-2: Enrollments panel — gives operators visibility into who has been
          enrolled, where they are in the workflow, and when the next action
          fires. Previously the only signal was the row-level Enrolled
          counter; failures were invisible. */}
      <div
        className="rounded-xl border p-5 space-y-3"
        style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Recent enrollments</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>
              {enrolledTotal} total · {completedTotal} completed
            </p>
          </div>
          <button
            onClick={loadEnrollments}
            disabled={enrollmentsLoading}
            className="rounded-lg border px-3 py-1 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
          >
            {enrollmentsLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {enrollments.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-xs" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text-muted)" }}>
            No enrollments yet. When the trigger fires for a matching contact, they will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--ck-border)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "var(--ck-bg)" }}>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Contact</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Step</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Next action</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Enrolled</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => {
                  const c = e.marketing_contacts;
                  const next = e.next_action_at ? new Date(e.next_action_at) : null;
                  const enrolled = new Date(e.created_at);
                  return (
                    <tr key={e.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                      <td className="px-3 py-2" style={{ color: "var(--ck-text)" }}>
                        {c?.email || e.contact_id.slice(0, 8)}
                        {c?.first_name ? <span className="ml-1.5 text-[11px]" style={{ color: "var(--ck-text-muted)" }}>({c.first_name}{c.last_name ? " " + c.last_name : ""})</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{
                          background: e.status === "active" ? "rgba(59,130,246,0.1)" : e.status === "completed" ? "rgba(16,185,129,0.1)" : e.status === "paused" ? "rgba(234,179,8,0.1)" : "rgba(107,114,128,0.1)",
                          color: e.status === "active" ? "#2563eb" : e.status === "completed" ? "#059669" : e.status === "paused" ? "#ca8a04" : "#6b7280",
                        }}>{e.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--ck-text)" }}>{e.current_step + 1}/{steps.length}</td>
                      <td className="px-3 py-2 text-right" style={{ color: "var(--ck-text-muted)" }}>
                        {e.status === "completed" ? "—" : next ? next.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right" style={{ color: "var(--ck-text-muted)" }}>
                        {enrolled.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* V-17: Step execution audit log. Without this the operator has no
          way to answer "did this customer actually get the voucher email?"
          short of asking the customer to check their inbox. The dispatcher
          already writes one row per step it tries to execute — we just
          need to render them. */}
      <div
        className="rounded-xl border p-5 space-y-3"
        style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Step execution log</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>
              Latest 200 events from the automation dispatcher. New events appear after each cron run or manual dispatch.
            </p>
          </div>
          <button
            onClick={loadLogs}
            disabled={logsLoading}
            className="rounded-lg border px-3 py-1 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
          >
            {logsLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {logs.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-xs" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text-muted)" }}>
            No events yet. Activate the automation and trigger an enrollment — the dispatcher will populate this log on its next run.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--ck-border)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "var(--ck-bg)" }}>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>When</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Contact</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Step</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Type</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Outcome</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const c = log.marketing_contacts;
                  const when = new Date(log.created_at);
                  const isFailure = /fail|error|skipped/i.test(log.action);
                  const isSuccess = /sent|generated|completed|advanced/i.test(log.action);
                  const meta = log.metadata as Record<string, unknown> | null;
                  const detailBits: string[] = [];
                  if (meta) {
                    // Failures lead with the error so it's not buried behind the subject.
                    if (meta.error) detailBits.push("error: " + String(meta.error) + (meta.status ? " (HTTP " + meta.status + ")" : ""));
                    if (meta.subject && !meta.error) detailBits.push(String(meta.subject));
                    if (meta.subject && meta.error) detailBits.push("subject: " + String(meta.subject));
                    if (meta.code) detailBits.push("code: " + String(meta.code));
                    if (meta.resend_id) detailBits.push("resend: " + String(meta.resend_id).slice(0, 12));
                    if (meta.template_id && !meta.subject) detailBits.push("template: " + String(meta.template_id).slice(0, 8));
                    if (meta.delay_until) detailBits.push("until " + new Date(String(meta.delay_until)).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
                  }
                  return (
                    <tr key={log.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ck-text-muted)" }}>
                        {when.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--ck-text)" }}>
                        {c?.email || log.contact_id.slice(0, 8)}
                        {c?.first_name ? <span className="ml-1.5 text-[11px]" style={{ color: "var(--ck-text-muted)" }}>({c.first_name})</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--ck-text)" }}>{log.step_position + 1}</td>
                      <td className="px-3 py-2" style={{ color: "var(--ck-text-muted)" }}>{log.step_type}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{
                          background: isFailure ? "rgba(239,68,68,0.1)" : isSuccess ? "rgba(16,185,129,0.1)" : "rgba(107,114,128,0.1)",
                          color: isFailure ? "#dc2626" : isSuccess ? "#059669" : "#6b7280",
                        }}>{log.action}</span>
                      </td>
                      <td className="px-3 py-2 text-[11px]" style={{ color: "var(--ck-text-muted)" }} title={meta ? JSON.stringify(meta) : ""}>
                        {detailBits.length > 0 ? detailBits.join(" · ") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Reusable add-step dropdown
function AddStepButton({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const types = [
    { type: "send_email", label: "Send Email" },
    { type: "delay", label: "Delay" },
    { type: "condition", label: "Condition" },
    { type: "generate_voucher", label: "Generate Voucher" },
    { type: "generate_promo", label: "Generate Promo" },
  ];

  return (
    <div ref={dropdownRef} className="relative flex items-center pl-5 py-1">
      <div className="w-px h-full absolute left-[1.55rem] top-0" style={{ background: "var(--ck-border)" }} />
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold hover:shadow-sm z-10"
        style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text-muted)" }}
        title="Add step"
      >
        <Plus size={12} />
      </button>
      {open && (
        <div
          className="absolute left-12 top-0 z-20 rounded-lg border shadow-lg p-1 min-w-[180px]"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
        >
          {types.map((t) => {
            return (
              <button
                key={t.type}
                onClick={() => { onAdd(t.type); setOpen(false); }}
                className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-left hover:opacity-80"
                style={{ color: "var(--ck-text)" }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
