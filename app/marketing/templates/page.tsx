"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { notify } from "../../lib/app-notify";
import { useBusinessContext } from "../../../components/BusinessContext";
import { Plus, PencilSimple, Trash, Copy, PaperPlaneTilt, X, Flask } from "@phosphor-icons/react";
import EmailBuilder from "../../../components/marketing/EmailBuilder";
import { starterTemplates, StarterTemplate } from "../../../components/marketing/starter-templates";

interface Template {
  id: string;
  name: string;
  category: string;
  subject_line: string;
  html_content: string;
  editor_json: any[];
  created_at: string;
  updated_at: string;
}

interface SendFormState {
  name: string;
  subject: string;
  scheduledAt: string;       // ISO string or "" for immediate
  audienceFilter: "all" | "tagged";
  selectedTags: string[];
}

export default function TemplatesPage() {
  const { businessId } = useBusinessContext();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [initialTemplate, setInitialTemplate] = useState<StarterTemplate | null>(null);
  const [sending, setSending] = useState<Template | null>(null);
  const [sendForm, setSendForm] = useState<SendFormState>({ name: "", subject: "", scheduledAt: "", audienceFilter: "all", selectedTags: [] });
  const [sendingInProgress, setSendingInProgress] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  useEffect(() => {
    if (businessId) load();
  }, [businessId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("marketing_templates")
      .select("*")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false });
    setTemplates((data as Template[]) || []);
    setLoading(false);
  }

  // Load unique tags when send modal opens
  async function loadTags() {
    const { data } = await supabase.from("marketing_contacts")
      .select("tags")
      .eq("business_id", businessId)
      .eq("status", "active");
    const tagSet = new Set<string>();
    for (const row of (data || []) as any[]) {
      const tags = row.tags;
      if (Array.isArray(tags)) {
        for (const t of tags) if (typeof t === "string" && t.trim()) tagSet.add(t.trim().toLowerCase());
      } else if (typeof tags === "string" && tags.trim()) {
        // Handle tags stored as a plain string or comma-separated
        for (const s of tags.split(",")) if (s.trim()) tagSet.add(s.trim().toLowerCase());
      }
    }
    setAvailableTags([...tagSet].sort());
  }

  // Compute audience count based on current filter
  async function computeAudienceCount(filter: "all" | "tagged", tags: string[]) {
    let q = supabase.from("marketing_contacts")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "active");
    if (filter === "tagged" && tags.length > 0) {
      q = q.overlaps("tags", tags);
    }
    const { count } = await q;
    setAudienceCount(count || 0);
  }

  async function handleSave(name: string, subjectLine: string, category: string, blocks: any[], html: string) {
    if (editing) {
      const { error } = await supabase.from("marketing_templates").update({
        name, subject_line: subjectLine, category, editor_json: blocks, html_content: html, updated_at: new Date().toISOString(),
      }).eq("id", editing.id);
      if (error) { notify({ message: error.message, tone: "error" }); return; }
      notify({ message: "Template updated.", tone: "success" });
      setEditing(null);
    } else {
      const { error: createErr } = await supabase.from("marketing_templates").insert({
        business_id: businessId, name, subject_line: subjectLine, category, editor_json: blocks, html_content: html,
      });
      if (createErr) { notify({ message: createErr.message, tone: "error" }); return; }
      notify({ message: "Template created.", tone: "success" });
      setCreating(false);
    }
    load();
  }

  async function duplicateTemplate(t: Template) {
    await supabase.from("marketing_templates").insert({
      business_id: businessId, name: t.name + " (copy)", subject_line: t.subject_line,
      category: t.category, editor_json: t.editor_json, html_content: t.html_content,
    });
    notify({ message: "Template duplicated.", tone: "success" });
    load();
  }

  async function deleteTemplate(id: string) {
    await supabase.from("marketing_templates").delete().eq("id", id);
    notify({ message: "Template deleted.", tone: "success" });
    load();
  }

  async function sendTestEmail(t: Template) {
    try {
      // Resolve test recipient: designated marketing test email > current admin's email
      let testEmail = "";
      let testName = "Admin";

      // Check if business has a designated marketing test email
      const { data: biz, error: bizErr } = await supabase
        .from("businesses")
        .select("marketing_test_email")
        .eq("id", businessId)
        .maybeSingle();
      if (bizErr) console.warn("sendTestEmail biz lookup error:", bizErr.message);
      if (biz?.marketing_test_email) {
        testEmail = biz.marketing_test_email;
        const { data: adminRow } = await supabase
          .from("admin_users")
          .select("name")
          .eq("email", testEmail)
          .eq("business_id", businessId)
          .maybeSingle();
        testName = adminRow?.name || "Admin";
      }

      // Fallback to current admin's email from session or DB
      if (!testEmail) {
        testEmail = localStorage.getItem("ck_admin_email") || "";
        testName = localStorage.getItem("ck_admin_name") || "Admin";
      }

      // If still no email, look up the first admin for this business
      if (!testEmail) {
        const { data: fallbackAdmin } = await supabase
          .from("admin_users")
          .select("email, name")
          .eq("business_id", businessId)
          .in("role", ["MAIN_ADMIN", "SUPER_ADMIN"])
          .order("created_at")
          .limit(1)
          .maybeSingle();
        if (fallbackAdmin?.email) {
          testEmail = fallbackAdmin.email;
          testName = fallbackAdmin.name || "Admin";
          localStorage.setItem("ck_admin_email", testEmail);
          if (fallbackAdmin.name) localStorage.setItem("ck_admin_name", fallbackAdmin.name);
        }
      }

      if (!testEmail) {
        notify({ message: "Could not determine your email address. Please log out and back in, or set a test email in Settings.", tone: "error" });
        return;
      }

      console.log("[MARKETING_TEST] Sending to:", testEmail, "template:", t.name, "businessId:", businessId);
      notify({ message: `Sending test email to ${testEmail}...`, tone: "info" });

      const { data: sendResult, error: sendErr } = await supabase.functions.invoke("send-email", {
        body: {
          type: "MARKETING_TEST",
          data: {
            business_id: businessId,
            email: testEmail,
            first_name: testName.split(" ")[0] || "Admin",
            subject_line: "[TEST] " + t.subject_line,
            html_content: t.html_content || "<p>No content</p>",
          },
        },
      });

      console.log("[MARKETING_TEST] Response:", { sendResult, sendErr: sendErr?.message });

      if (sendErr) {
        // supabase.functions.invoke wraps non-2xx as FunctionsHttpError — read the body
        let errDetail = sendErr.message || "Unknown error";
        try {
          const errBody = typeof sendResult === "object" ? sendResult : null;
          if (errBody?.error) errDetail = errBody.error;
        } catch { /* ignore */ }
        notify({ message: "Test email failed: " + errDetail, tone: "error" });
        return;
      }

      if (sendResult?.error) {
        notify({ message: "Test email failed: " + sendResult.error, tone: "error" });
        return;
      }

      notify({ message: `Test email sent to ${testEmail}.`, tone: "success" });
    } catch (err: unknown) {
      console.error("[MARKETING_TEST] Unexpected error:", err);
      notify({ message: "Test email failed: " + (err instanceof Error ? err.message : String(err)), tone: "error" });
    }
  }

  async function sendCampaign() {
    if (!sending || !sendForm.name.trim()) return;
    setSendingInProgress(true);

    const isScheduled = !!sendForm.scheduledAt;

    // 1. Create campaign
    const { data: campaign, error: campErr } = await supabase.from("marketing_campaigns").insert({
      business_id: businessId,
      template_id: sending.id,
      name: sendForm.name.trim(),
      subject_line: sendForm.subject.trim() || sending.subject_line,
      status: isScheduled ? "scheduled" : "sending",
      scheduled_at: isScheduled ? sendForm.scheduledAt : null,
      started_at: isScheduled ? null : new Date().toISOString(),
    }).select("id").single();
    if (campErr || !campaign) {
      notify({ message: campErr?.message || "Failed to create campaign", tone: "error" });
      setSendingInProgress(false);
      return;
    }

    // 2. Get audience contacts
    let q = supabase.from("marketing_contacts")
      .select("id, email, first_name")
      .eq("business_id", businessId)
      .eq("status", "active");
    if (sendForm.audienceFilter === "tagged" && sendForm.selectedTags.length > 0) {
      q = q.overlaps("tags", sendForm.selectedTags);
    }
    const { data: contacts } = await q;

    if (!contacts || contacts.length === 0) {
      notify({ message: "No active contacts match the selected audience.", tone: "warning" });
      await supabase.from("marketing_campaigns").update({ status: "cancelled" }).eq("id", campaign!.id);
      setSending(null);
      setSendingInProgress(false);
      return;
    }

    // 3. Insert queue rows (DB UNIQUE constraint handles dedup)
    const queueRows = contacts.map((c: any) => ({
      business_id: businessId,
      campaign_id: campaign!.id,
      contact_id: c.id,
      email: c.email,
      first_name: c.first_name || "",
    }));
    const { error: queueErr } = await supabase.from("marketing_queue").insert(queueRows);
    if (queueErr) {
      // If partial insert due to dedup constraint, still proceed
      console.warn("Queue insert warning:", queueErr.message);
    }

    // 4. Update campaign totals
    await supabase.from("marketing_campaigns").update({
      total_recipients: contacts.length,
      ...(isScheduled ? {} : { started_at: new Date().toISOString() }),
    }).eq("id", campaign!.id);

    // 5. For immediate sends, trigger the dispatch function directly
    //    (don't rely solely on the cron job — fire it now for instant delivery)
    if (!isScheduled) {
      // Fire dispatch in batches until all queue items are processed
      let dispatchedTotal = 0;
      for (let attempt = 0; attempt < Math.ceil(contacts.length / 50) + 1; attempt++) {
        try {
          const dispRes = await supabase.functions.invoke("marketing-dispatch", { body: {} });
          const processed = dispRes.data?.sent || 0;
          dispatchedTotal += processed;
          if (processed === 0) break; // no more items to process
        } catch (dispErr) {
          console.warn("Dispatch batch error (cron will retry):", dispErr);
          break;
        }
      }
      if (dispatchedTotal > 0) {
        notify({ message: `${dispatchedTotal} of ${contacts.length} emails sent. Remaining will be sent by background process.`, tone: "success" });
      } else {
        notify({ message: `Campaign queued — ${contacts.length} recipients. Emails will be sent in batches by the background process.`, tone: "success" });
      }
    } else {
      notify({ message: `Campaign scheduled for ${new Date(sendForm.scheduledAt).toLocaleString("en-ZA")} — ${contacts.length} recipients.`, tone: "success" });
    }

    setSending(null);
    setSendForm({ name: "", subject: "", scheduledAt: "", audienceFilter: "all", selectedTags: [] });
    setSendingInProgress(false);
  }

  function openSendModal(t: Template) {
    setSending(t);
    setSendForm({ name: "", subject: t.subject_line, scheduledAt: "", audienceFilter: "all", selectedTags: [] });
    setAudienceCount(null);
    loadTags();
    computeAudienceCount("all", []);
  }

  // Builder view
  if (creating || editing) {
    return (
      <div className="space-y-4">
        <button onClick={() => { setCreating(false); setEditing(null); setInitialTemplate(null); }}
          className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>
          &larr; Back to templates
        </button>
        <EmailBuilder
          businessId={businessId}
          initialName={editing?.name || initialTemplate?.name || ""}
          initialSubject={editing?.subject_line || initialTemplate?.subject || ""}
          initialCategory={editing?.category || initialTemplate?.category || "general"}
          initialBlocks={editing?.editor_json || (initialTemplate ? initialTemplate.blocks() : [])}
          onSave={handleSave}
        />
      </div>
    );
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{templates.length} templates</p>
        <button onClick={() => setShowGallery(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: "var(--ck-accent)" }}>
          <Plus size={14} /> New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No templates yet. Create your first email template.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
              <div>
                <h3 className="font-semibold text-sm truncate" style={{ color: "var(--ck-text-strong)" }}>{t.name}</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>
                  {t.category} &middot; {t.subject_line || "No subject"}
                </p>
              </div>
              {/* Preview (sandboxed iframe to prevent XSS) */}
              <div className="rounded-lg border overflow-hidden h-32" style={{ borderColor: "var(--ck-border)" }}>
                <iframe
                  srcDoc={t.html_content || "<p style='padding:20px;color:#999'>Empty template</p>"}
                  sandbox=""
                  className="w-full h-full border-0 pointer-events-none"
                  style={{ transform: "scale(0.3)", transformOrigin: "top left", width: "333%", height: "333%" }}
                  title={"Preview: " + t.name}
                />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <button onClick={() => setEditing(t)} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
                  <PencilSimple size={12} /> Edit
                </button>
                <button onClick={() => openSendModal(t)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--ck-accent)" }}>
                  <PaperPlaneTilt size={12} /> Send
                </button>
                <button onClick={() => sendTestEmail(t)} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }} title="Send test to yourself">
                  <Flask size={12} /> Test
                </button>
                <button onClick={() => duplicateTemplate(t)} className="p-1.5 rounded-lg border" style={{ borderColor: "var(--ck-border)" }} title="Duplicate">
                  <Copy size={12} />
                </button>
                <button onClick={() => deleteTemplate(t.id)} className="p-1.5 text-red-500 hover:text-red-700" title="Delete">
                  <Trash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Template gallery modal */}
      {showGallery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-4xl max-h-[85vh] rounded-2xl p-6 shadow-2xl overflow-y-auto" style={{ background: "var(--ck-surface)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Choose a Template</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>Start with a pre-built template or create from scratch</p>
              </div>
              <button onClick={() => setShowGallery(false)}><X size={18} /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {starterTemplates.map((tmpl, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setShowGallery(false);
                    setInitialTemplate(tmpl);
                    setCreating(true);
                  }}
                  className="text-left rounded-xl border p-4 hover:ring-2 hover:ring-blue-400 transition-all"
                  style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{tmpl.name}</h4>
                    <span className="text-[10px] rounded-full px-2 py-0.5 font-medium bg-blue-100 text-blue-700">{tmpl.category}</span>
                  </div>
                  <p className="text-xs line-clamp-2" style={{ color: "var(--ck-text-muted)" }}>{tmpl.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Send campaign modal */}
      {sending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl" style={{ background: "var(--ck-surface)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Send Campaign</h3>
              <button onClick={() => setSending(null)}><X size={18} /></button>
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--ck-text-muted)" }}>
              Template: &quot;{sending.name}&quot;
            </p>
            <div className="space-y-4">
              {/* Campaign name */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Campaign name *</label>
                <input value={sendForm.name} onChange={(e) => setSendForm({ ...sendForm, name: e.target.value })}
                  placeholder="e.g. Summer Sale Newsletter"
                  className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              </div>

              {/* Subject line */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Subject line</label>
                <input value={sendForm.subject} onChange={(e) => setSendForm({ ...sendForm, subject: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              </div>

              {/* Audience filter */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                  Audience
                </label>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => {
                      setSendForm({ ...sendForm, audienceFilter: "all", selectedTags: [] });
                      computeAudienceCount("all", []);
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium border ${sendForm.audienceFilter === "all" ? "text-white" : ""}`}
                    style={{
                      background: sendForm.audienceFilter === "all" ? "var(--ck-accent)" : "var(--ck-bg)",
                      borderColor: "var(--ck-border)",
                      color: sendForm.audienceFilter === "all" ? "white" : "var(--ck-text)",
                    }}
                  >
                    All active contacts
                  </button>
                  <button
                    onClick={() => {
                      setSendForm({ ...sendForm, audienceFilter: "tagged" });
                      computeAudienceCount("tagged", sendForm.selectedTags);
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium border ${sendForm.audienceFilter === "tagged" ? "text-white" : ""}`}
                    style={{
                      background: sendForm.audienceFilter === "tagged" ? "var(--ck-accent)" : "var(--ck-bg)",
                      borderColor: "var(--ck-border)",
                      color: sendForm.audienceFilter === "tagged" ? "white" : "var(--ck-text)",
                    }}
                  >
                    Filter by tags
                  </button>
                </div>
                {sendForm.audienceFilter === "tagged" && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {availableTags.length === 0 ? (
                      <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>No tags found. Add tags to contacts first.</p>
                    ) : (
                      availableTags.map((tag) => {
                        const selected = sendForm.selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => {
                              const newTags = selected ? sendForm.selectedTags.filter((t) => t !== tag) : [...sendForm.selectedTags, tag];
                              setSendForm({ ...sendForm, selectedTags: newTags });
                              computeAudienceCount("tagged", newTags);
                            }}
                            className="rounded-full px-2.5 py-0.5 text-xs font-medium border"
                            style={{
                              background: selected ? "var(--ck-accent)" : "var(--ck-bg)",
                              borderColor: selected ? "var(--ck-accent)" : "var(--ck-border)",
                              color: selected ? "white" : "var(--ck-text)",
                            }}
                          >
                            {tag}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {audienceCount !== null && (
                  <p className="text-xs mt-2 font-medium" style={{ color: "var(--ck-accent)" }}>
                    {audienceCount} contact{audienceCount !== 1 ? "s" : ""} will receive this campaign
                  </p>
                )}
              </div>

              {/* Schedule */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                  Schedule (optional)
                </label>
                <input
                  type="datetime-local"
                  value={sendForm.scheduledAt}
                  onChange={(e) => setSendForm({ ...sendForm, scheduledAt: e.target.value })}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                />
                <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>
                  {sendForm.scheduledAt ? "Campaign will start at the scheduled time." : "Leave empty to send immediately."}
                </p>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setSending(null)} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Cancel</button>
                <button
                  onClick={sendCampaign}
                  disabled={!sendForm.name.trim() || sendingInProgress || (sendForm.audienceFilter === "tagged" && sendForm.selectedTags.length === 0)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: sendForm.scheduledAt ? "#7c3aed" : "var(--ck-accent)" }}
                >
                  {sendingInProgress ? "Processing..." : sendForm.scheduledAt ? "Schedule Campaign" : "Send Campaign"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
