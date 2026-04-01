"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { notify } from "../../lib/app-notify";
import { useBusinessContext } from "../../../components/BusinessContext";
import { Plus, Search, Upload, Trash2, X, Tag } from "lucide-react";

interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string;
  source: string;
  tags: string[];
  total_received: number;
  total_opens: number;
  total_clicks: number;
  created_at: string;
  date_of_birth: string | null;
}

export default function ContactsPage() {
  var { businessId } = useBusinessContext();
  var [contacts, setContacts] = useState<Contact[]>([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState("");
  var [showAdd, setShowAdd] = useState(false);
  var [addForm, setAddForm] = useState({ email: "", first_name: "", last_name: "", tags: "", date_of_birth: "" });
  var [saving, setSaving] = useState(false);
  var [showImport, setShowImport] = useState(false);
  var [importText, setImportText] = useState("");
  var [importing, setImporting] = useState(false);
  var [filterStatus, setFilterStatus] = useState<"all" | "active" | "unsubscribed" | "bounced" | "inactive">("all");
  var [filterTag, setFilterTag] = useState("");
  var [tagInput, setTagInput] = useState<{ contactId: string; value: string } | null>(null);
  var [showCleanList, setShowCleanList] = useState(false);
  var [staleContacts, setStaleContacts] = useState<Contact[]>([]);
  var [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    if (businessId) load();
  }, [businessId]);

  async function load() {
    setLoading(true);
    var { data, error: loadErr } = await supabase.from("marketing_contacts")
      .select("id, email, first_name, last_name, phone, status, source, tags, total_received, total_opens, total_clicks, created_at, date_of_birth")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(500);
    setContacts((data as Contact[]) || []);
    setLoading(false);
  }

  async function checkAutoEnroll(contactId: string, event: string, eventData?: any) {
    var { data: automations } = await supabase
      .from("marketing_automations")
      .select("id, trigger_type, trigger_config")
      .eq("business_id", businessId)
      .eq("status", "active")
      .eq("trigger_type", event);

    for (var automation of (automations || []) as any[]) {
      if (event === "tag_added" && automation.trigger_config?.tag) {
        if (eventData?.tag !== automation.trigger_config.tag) continue;
      }

      // Check if already enrolled (avoid inflating enrolled_count on duplicate)
      var { data: existing } = await supabase
        .from("marketing_automation_enrollments")
        .select("id")
        .eq("automation_id", automation.id)
        .eq("contact_id", contactId)
        .maybeSingle();

      if (!existing) {
        await supabase.from("marketing_automation_enrollments").insert({
          automation_id: automation.id,
          contact_id: contactId,
          business_id: businessId,
          status: "active",
          next_action_at: new Date().toISOString(),
        });

        await supabase.rpc("increment_automation_counter", {
          p_automation_id: automation.id,
          p_column: "enrolled_count",
          p_amount: 1,
        });
      }
    }
  }

  async function addContact() {
    if (!addForm.email.trim()) return;
    setSaving(true);
    var tags = addForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
    var { data: inserted, error } = await supabase.from("marketing_contacts").insert({
      business_id: businessId,
      email: addForm.email.trim().toLowerCase(),
      first_name: addForm.first_name.trim() || null,
      last_name: addForm.last_name.trim() || null,
      tags: tags.length > 0 ? tags : [],
      date_of_birth: addForm.date_of_birth || null,
    }).select("id").single();
    setSaving(false);
    if (error) {
      if (error.code === "23505") {
        notify({ message: "This email already exists in your contacts.", tone: "warning" });
      } else {
        notify({ message: error.message, tone: "error" });
      }
      return;
    }
    if (inserted) {
      checkAutoEnroll(inserted.id, "contact_added");
    }
    notify({ message: "Contact added.", tone: "success" });
    setAddForm({ email: "", first_name: "", last_name: "", tags: "", date_of_birth: "" });
    setShowAdd(false);
    load();
  }

  async function importContacts() {
    if (!importText.trim()) return;
    setImporting(true);
    var lines = importText.trim().split("\n").filter(Boolean);
    var rows = lines.map((line) => {
      var parts = line.split(",").map((p) => p.trim());
      return {
        business_id: businessId,
        email: parts[0]?.toLowerCase() || "",
        first_name: parts[1] || null,
        last_name: parts[2] || null,
        date_of_birth: parts[3] || null,
        source: "import",
      };
    }).filter((r) => r.email && r.email.includes("@"));

    if (rows.length === 0) {
      notify({ message: "No valid emails found.", tone: "warning" });
      setImporting(false);
      return;
    }

    var { data: imported, error } = await supabase.from("marketing_contacts").upsert(rows, { onConflict: "business_id,email", ignoreDuplicates: true }).select("id");
    setImporting(false);
    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    // Auto-enroll imported contacts into matching automations
    var importedCount = imported?.length ?? 0;
    for (var row of (imported || []) as any[]) {
      checkAutoEnroll(row.id, "contact_added");
    }
    notify({ message: `Imported ${importedCount} contacts (${rows.length - importedCount} duplicates skipped).`, tone: "success" });
    setImportText("");
    setShowImport(false);
    load();
  }

  async function toggleStatus(contact: Contact) {
    var newStatus = contact.status === "active" ? "unsubscribed" : "active";
    await supabase.from("marketing_contacts").update({ status: newStatus }).eq("id", contact.id);
    setContacts(contacts.map((c) => c.id === contact.id ? { ...c, status: newStatus } : c));
  }

  async function deleteContact(id: string) {
    await supabase.from("marketing_contacts").delete().eq("id", id);
    setContacts(contacts.filter((c) => c.id !== id));
    notify({ message: "Contact removed.", tone: "success" });
  }

  async function addTagToContact(contactId: string, tag: string) {
    var contact = contacts.find((c) => c.id === contactId);
    if (!contact || !tag.trim()) return;
    var normalizedTag = tag.trim().toLowerCase();
    var newTags = [...new Set([...(contact.tags || []), normalizedTag])];
    await supabase.from("marketing_contacts").update({ tags: newTags }).eq("id", contactId);
    setContacts(contacts.map((c) => c.id === contactId ? { ...c, tags: newTags } : c));
    setTagInput(null);
    checkAutoEnroll(contactId, "tag_added", { tag: normalizedTag });
  }

  async function removeTagFromContact(contactId: string, tag: string) {
    var contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    var newTags = (contact.tags || []).filter((t) => t !== tag);
    await supabase.from("marketing_contacts").update({ tags: newTags }).eq("id", contactId);
    setContacts(contacts.map((c) => c.id === contactId ? { ...c, tags: newTags } : c));
  }

  async function previewCleanList() {
    var { data } = await supabase.from("marketing_contacts")
      .select("id, email, first_name, last_name, phone, status, source, tags, total_received, total_opens, total_clicks, created_at, date_of_birth")
      .eq("business_id", businessId)
      .eq("status", "active")
      .gte("total_received", 5)
      .eq("total_opens", 0);
    setStaleContacts((data as Contact[]) || []);
    setShowCleanList(true);
  }

  async function deactivateStaleContacts() {
    setCleaning(true);
    var ids = staleContacts.map((c) => c.id);
    var { error } = await supabase.from("marketing_contacts")
      .update({ status: "inactive" })
      .in("id", ids);
    setCleaning(false);
    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    notify({ message: `Deactivated ${ids.length} stale contacts.`, tone: "success" });
    setShowCleanList(false);
    load();
  }

  // Collect all unique tags for filter
  var allTags = [...new Set(contacts.flatMap((c) => c.tags || []))].sort();

  var filtered = contacts.filter((c) => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterTag && !(c.tags || []).includes(filterTag)) return false;
    if (!search) return true;
    var q = search.toLowerCase();
    return (c.email?.toLowerCase().includes(q) || c.first_name?.toLowerCase().includes(q) || c.last_name?.toLowerCase().includes(q));
  });

  var activeCount = contacts.filter((c) => c.status === "active").length;
  var unsubCount = contacts.filter((c) => c.status === "unsubscribed").length;
  var bouncedCount = contacts.filter((c) => c.status === "bounced").length;
  var inactiveCount = contacts.filter((c) => c.status === "inactive").length;

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary + actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
          {activeCount} active · {unsubCount} unsubscribed · {bouncedCount} bounced · {inactiveCount} inactive · {contacts.length} total
        </p>
        <div className="flex gap-2">
          <button onClick={previewCleanList} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
            <Trash2 size={14} /> Clean List
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
            <Upload size={14} /> Import CSV
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: "var(--ck-accent)" }}>
            <Plus size={14} /> Add Contact
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="bounced">Bounced</option>
          <option value="inactive">Inactive</option>
        </select>
        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}
          >
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
            {contacts.length === 0 ? "No contacts yet. Add your first contact or import a CSV." : "No contacts match your search."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--ck-border)" }}>
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr style={{ background: "var(--ck-surface)" }}>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Email</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Name</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Tags</th>
                <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Engagement</th>
                <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                  <td className="px-4 py-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{c.email}</td>
                  <td className="px-4 py-3" style={{ color: "var(--ck-text)" }}>
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 items-center">
                      {(c.tags || []).map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">
                          {tag}
                          <button onClick={() => removeTagFromContact(c.id, tag)} className="hover:text-red-500 ml-0.5">&times;</button>
                        </span>
                      ))}
                      {tagInput?.contactId === c.id ? (
                        <input
                          autoFocus
                          value={tagInput!.value}
                          onChange={(e) => setTagInput({ ...tagInput!, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { addTagToContact(c.id, tagInput!.value); }
                            if (e.key === "Escape") setTagInput(null);
                          }}
                          onBlur={() => { if (tagInput!.value.trim()) addTagToContact(c.id, tagInput!.value); else setTagInput(null); }}
                          className="rounded-full border px-2 py-0.5 text-xs w-20"
                          style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                          placeholder="tag..."
                        />
                      ) : (
                        <button
                          onClick={() => setTagInput({ contactId: c.id, value: "" })}
                          className="rounded-full border px-1.5 py-0.5 text-xs"
                          style={{ borderColor: "var(--ck-border)", color: "var(--ck-text-muted)" }}
                          title="Add tag"
                        >
                          <Tag size={10} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-xs" style={{ color: "var(--ck-text-muted)" }}>
                    {c.total_received > 0 ? (
                      <span>{c.total_received} recv · {c.total_opens} opens · {c.total_clicks} clicks</span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleStatus(c)} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer ${
                      c.status === "active" ? "bg-emerald-100 text-emerald-700" :
                      c.status === "bounced" ? "bg-red-100 text-red-600" :
                      c.status === "inactive" ? "bg-amber-100 text-amber-600" :
                      "bg-gray-100 text-gray-500"
                    }`}>
                      {c.status}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteContact(c.id)} className="text-red-500 hover:text-red-700 p-1" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add contact modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl" style={{ background: "var(--ck-surface)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Add Contact</h3>
              <button onClick={() => setShowAdd(false)}><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <input placeholder="Email *" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="First name" value={addForm.first_name} onChange={(e) => setAddForm({ ...addForm, first_name: e.target.value })}
                  className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
                <input placeholder="Last name" value={addForm.last_name} onChange={(e) => setAddForm({ ...addForm, last_name: e.target.value })}
                  className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              </div>
              <input placeholder="Tags (comma-separated, e.g. vip, customer)" value={addForm.tags} onChange={(e) => setAddForm({ ...addForm, tags: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Date of Birth</label>
                <input type="date" value={addForm.date_of_birth || ""} onChange={(e) => setAddForm({ ...addForm, date_of_birth: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowAdd(false)} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Cancel</button>
                <button onClick={addContact} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ck-accent)" }}>
                  {saving ? "Saving..." : "Add Contact"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl" style={{ background: "var(--ck-surface)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Import Contacts</h3>
              <button onClick={() => setShowImport(false)}><X size={18} /></button>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--ck-text-muted)" }}>
              Paste one contact per line: <code>email, first_name, last_name, date_of_birth</code><br />
              Duplicates are automatically skipped.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder={"john@example.com, John, Doe\njane@example.com, Jane, Smith"}
              className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
              style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
            />
            <div className="flex justify-end gap-2 pt-3">
              <button onClick={() => setShowImport(false)} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Cancel</button>
              <button onClick={importContacts} disabled={importing} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ck-accent)" }}>
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean List modal */}
      {showCleanList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl" style={{ background: "var(--ck-surface)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Clean List</h3>
              <button onClick={() => setShowCleanList(false)}><X size={18} /></button>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--ck-text-muted)" }}>
              Found {staleContacts.length} contacts who received 5+ emails but never opened any.
              Deactivating them improves your deliverability and open rates.
            </p>
            {staleContacts.length === 0 ? (
              <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--ck-border)" }}>
                <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No stale contacts found. Your list is clean!</p>
              </div>
            ) : (
              <>
                <div className="max-h-60 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--ck-border)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "var(--ck-surface)" }}>
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Email</th>
                        <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Received</th>
                        <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Opens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staleContacts.map((c) => (
                        <tr key={c.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                          <td className="px-3 py-2" style={{ color: "var(--ck-text)" }}>{c.email}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "var(--ck-text-muted)" }}>{c.total_received}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "var(--ck-text-muted)" }}>0</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button onClick={() => setShowCleanList(false)} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Cancel</button>
                  <button onClick={deactivateStaleContacts} disabled={cleaning} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#ef4444" }}>
                    {cleaning ? "Deactivating..." : `Deactivate ${staleContacts.length} Contacts`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
