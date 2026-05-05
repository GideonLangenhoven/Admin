"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { notify } from "../../lib/app-notify";
import { useBusinessContext } from "../../../components/BusinessContext";
import { Plus, MagnifyingGlass, UploadSimple, Trash, X, PencilSimple, Check } from "@phosphor-icons/react";
import * as XLSX from "xlsx";

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
  const { businessId } = useBusinessContext();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", first_name: "", last_name: "", phone: "", tags: "", date_of_birth: "" });
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [csvRows, setCsvRows] = useState<Array<{ data: Record<string, string>; errors: string[] }>>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvStep, setCsvStep] = useState<"upload" | "map" | "preview" | "done">("upload");
  const [showValidate, setShowValidate] = useState(false);
  const [validating, setValidating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "unsubscribed" | "bounced" | "inactive">("all");
  const [filterTag, setFilterTag] = useState("");
  const [tagInput, setTagInput] = useState<{ contactId: string; value: string } | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;
  const [showCleanList, setShowCleanList] = useState(false);
  const [staleContacts, setStaleContacts] = useState<Contact[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ email: "", first_name: "", last_name: "", phone: "", tags: "", date_of_birth: "" });
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (businessId) load();
  }, [businessId]);

  async function load() {
    setLoading(true);
    // Fetch all contacts in batches of 1000 (Supabase default limit)
    const all: Contact[] = [];
    const batchSize = 1000;
    let from = 0;
    while (true) {
      const { data, error: loadErr } = await supabase.from("marketing_contacts")
        .select("id, email, first_name, last_name, phone, status, source, tags, total_received, total_opens, total_clicks, created_at, date_of_birth")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .range(from, from + batchSize - 1);
      if (loadErr || !data) break;
      all.push(...(data as Contact[]));
      if (data.length < batchSize) break;
      from += batchSize;
    }
    setContacts(all);
    setPage(0);
    setLoading(false);
  }

  async function checkAutoEnroll(contactId: string, event: string, eventData?: any) {
    const { data: automations } = await supabase
      .from("marketing_automations")
      .select("id, trigger_type, trigger_config")
      .eq("business_id", businessId)
      .eq("status", "active")
      .eq("trigger_type", event);

    for (const automation of (automations || []) as any[]) {
      if (event === "tag_added" && automation.trigger_config?.tag) {
        if (eventData?.tag !== automation.trigger_config.tag) continue;
      }

      // Check if already enrolled (avoid inflating enrolled_count on duplicate)
      const { data: existing } = await supabase
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
    if (!addForm.email.trim()) { notify({ message: "Email is required.", tone: "warning" }); return; }
    if (!addForm.first_name.trim()) { notify({ message: "First name is required.", tone: "warning" }); return; }
    if (!addForm.last_name.trim()) { notify({ message: "Last name is required.", tone: "warning" }); return; }
    if (!addForm.phone.trim()) { notify({ message: "Phone number is required.", tone: "warning" }); return; }
    setSaving(true);
    const tags = addForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
    let normalizedPhone = addForm.phone.trim().replace(/\D/g, "");
    if (normalizedPhone.startsWith("0")) normalizedPhone = "27" + normalizedPhone.substring(1);
    const { data: inserted, error } = await supabase.from("marketing_contacts").insert({
      business_id: businessId,
      email: addForm.email.trim().toLowerCase(),
      first_name: addForm.first_name.trim(),
      last_name: addForm.last_name.trim(),
      phone: normalizedPhone,
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
    setAddForm({ email: "", first_name: "", last_name: "", phone: "", tags: "", date_of_birth: "" });
    setShowAdd(false);
    load();
  }

  function startEdit(c: Contact) {
    setEditingId(c.id);
    setEditForm({
      email: c.email,
      first_name: c.first_name || "",
      last_name: c.last_name || "",
      phone: c.phone || "",
      tags: (c.tags || []).join(", "),
      date_of_birth: c.date_of_birth || "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.email.trim()) { notify({ message: "Email is required.", tone: "warning" }); return; }
    setEditSaving(true);
    const tags = editForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
    let normalizedPhone = editForm.phone.trim().replace(/\D/g, "");
    if (normalizedPhone.startsWith("0")) normalizedPhone = "27" + normalizedPhone.substring(1);
    const { error: updateErr } = await supabase.from("marketing_contacts").update({
      email: editForm.email.trim().toLowerCase(),
      first_name: editForm.first_name.trim() || null,
      last_name: editForm.last_name.trim() || null,
      phone: normalizedPhone || null,
      tags: tags.length > 0 ? tags : [],
      date_of_birth: editForm.date_of_birth || null,
    }).eq("id", editingId);
    setEditSaving(false);
    if (updateErr) {
      if (updateErr.code === "23505") notify({ message: "This email already exists.", tone: "warning" });
      else notify({ message: updateErr.message, tone: "error" });
      return;
    }
    setContacts(contacts.map((c) => c.id === editingId ? {
      ...c,
      email: editForm.email.trim().toLowerCase(),
      first_name: editForm.first_name.trim() || null,
      last_name: editForm.last_name.trim() || null,
      phone: normalizedPhone || null,
      tags,
      date_of_birth: editForm.date_of_birth || null,
    } : c));
    notify({ message: "Contact updated.", tone: "success" });
    setEditingId(null);
  }

  // ── DB fields that can be mapped ──
  const DB_FIELDS: { key: string; label: string; required?: boolean }[] = [
    { key: "email", label: "Email", required: true },
    { key: "first_name", label: "First Name" },
    { key: "last_name", label: "Last Name" },
    { key: "phone", label: "Phone" },
    { key: "tags", label: "Tags" },
    { key: "date_of_birth", label: "Date of Birth" },
    { key: "anniversary_date", label: "Anniversary Date" },
    { key: "notes", label: "Notes" },
    { key: "_skip", label: "— Skip Column —" },
  ];

  function cleanVal(raw: string): string {
    return raw.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ");
  }
  function cleanEmail(raw: string): string { return cleanVal(raw).toLowerCase(); }
  function cleanPhone(raw: string): string {
    let c = raw.replace(/[\s\-\(\)\.]+/g, "").replace(/^["']+|["']+$/g, "");
    if (c.startsWith("0") && c.length === 10) c = "+27" + c.substring(1);
    if (/^\d{9,}$/.test(c) && !c.startsWith("+")) c = "+" + c;
    return c;
  }
  function cleanName(raw: string): string { return cleanVal(raw).replace(/\b\w/g, (c) => c.toUpperCase()); }
  function isValidEmail(e: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  function parseRawCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    // Detect delimiter: tab, comma, semicolon
    const firstLine = lines[0];
    const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

    function splitLine(line: string): string[] {
      const parts: string[] = []; let cur = ""; let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === delim && !inQ) { parts.push(cur); cur = ""; continue; }
        cur += ch;
      }
      parts.push(cur);
      return parts.map((p) => p.trim().replace(/^["']+|["']+$/g, ""));
    }

    // Detect if first row is a header (contains common header words)
    const firstLower = firstLine.toLowerCase();
    const hasHeader = /email|name|phone|mobile|first|last|tag|birth|notes|address|company|city|country/.test(firstLower);
    const headerParts = splitLine(lines[0]);
    const headers = hasHeader ? headerParts.map((h) => h.trim()) : headerParts.map((_, i) => `Column ${i + 1}`);
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const rows = dataLines.map((line) => {
      const parts = splitLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = parts[i] || ""; });
      return row;
    }).filter((r) => Object.values(r).some((v) => v.trim())); // skip fully empty rows

    return { headers, rows };
  }

  function autoMapHeaders(headers: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    const patterns: [string, RegExp][] = [
      ["email", /e[\-_]?mail|email.?address/i],
      ["first_name", /first[\s_-]?name|fname|given[\s_-]?name|^name$/i],
      ["last_name", /last[\s_-]?name|lname|surname|family[\s_-]?name/i],
      ["phone", /phone|mobile|cell|tel|contact[\s_-]?number|whatsapp/i],
      ["tags", /tag|group|segment|list|category|type/i],
      ["date_of_birth", /birth|dob|birthday|date[\s_-]?of[\s_-]?birth/i],
      ["anniversary_date", /anniversary|anniv/i],
      ["notes", /note|comment|remark|description|memo|info|detail|other|custom|extra|address|company|city|country|state|zip|postal/i],
    ];
    for (const h of headers) {
      for (const [field, regex] of patterns) {
        if (regex.test(h) && !Object.values(map).includes(h)) {
          map[field] = h;
          break;
        }
      }
    }
    // If no email found, try first column that looks like emails
    if (!map.email && headers.length > 0) map.email = headers[0];
    return map;
  }

  function handleCsvFile(file: File | null) {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isExcel = ["xlsx", "xls", "xlsb", "xlsm"].includes(ext);

    if (isExcel) {
      // Read Excel with SheetJS
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          // Convert to array of arrays, then to CSV-like structure
          const jsonRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          if (jsonRows.length === 0) {
            notify({ message: "Excel file is empty.", tone: "warning" });
            return;
          }
          const headers = Object.keys(jsonRows[0]).map((h) => String(h).trim());
          const rows = jsonRows.map((row) => {
            const mapped: Record<string, string> = {};
            headers.forEach((h) => { mapped[h] = String(row[h] ?? "").trim(); });
            return mapped;
          }).filter((r) => Object.values(r).some((v) => v));

          setCsvHeaders(headers);
          const autoMap = autoMapHeaders(headers);
          setCsvMapping(autoMap);
          setCsvRows(rows.map((r) => ({ data: r, errors: [] })));
          setCsvStep("map");
          notify({ message: `Loaded ${rows.length} rows from "${sheetName}" sheet.`, tone: "success" });
        } catch (err: any) {
          notify({ message: "Failed to read Excel file: " + (err.message || "Unknown error"), tone: "error" });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Read as text (CSV, TSV, TXT)
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setImportText(text);
        const { headers, rows } = parseRawCsv(text);
        setCsvHeaders(headers);
        const autoMap = autoMapHeaders(headers);
        setCsvMapping(autoMap);
        setCsvRows(rows.map((r) => ({ data: r, errors: [] })));
        setCsvStep("map");
      };
      reader.readAsText(file);
    }
  }

  function handlePasteImport() {
    if (!importText.trim()) return;
    const { headers, rows } = parseRawCsv(importText);
    setCsvHeaders(headers);
    const autoMap = autoMapHeaders(headers);
    setCsvMapping(autoMap);
    setCsvRows(rows.map((r) => ({ data: r, errors: [] })));
    setCsvStep("map");
  }

  function applyMappingAndValidate() {
    // Reverse mapping: dbField → csvHeader
    const reverseMap: Record<string, string> = {};
    for (const [dbField, csvHeader] of Object.entries(csvMapping)) {
      if (csvHeader && dbField !== "_skip") reverseMap[dbField] = csvHeader;
    }
    // Gather all "notes" columns (unmapped + explicitly mapped to notes)
    const notesCols = csvHeaders.filter((h) => {
      const mappedTo = Object.entries(csvMapping).find(([, v]) => v === h)?.[0];
      return mappedTo === "notes" || (!mappedTo && !Object.values(csvMapping).includes(h));
    });

    const validated = csvRows.map((row) => {
      const d = row.data;
      const email = cleanEmail(d[reverseMap.email] || "");
      const first_name = reverseMap.first_name ? cleanName(d[reverseMap.first_name] || "") : "";
      const last_name = reverseMap.last_name ? cleanName(d[reverseMap.last_name] || "") : "";
      const phone = reverseMap.phone ? cleanPhone(d[reverseMap.phone] || "") : "";
      const tags = reverseMap.tags ? cleanVal(d[reverseMap.tags] || "") : "";
      const dob = reverseMap.date_of_birth ? cleanVal(d[reverseMap.date_of_birth] || "") : "";
      const anniversary = reverseMap.anniversary_date ? cleanVal(d[reverseMap.anniversary_date] || "") : "";

      // Collect notes from all notes-mapped + unmapped columns
      const noteParts: string[] = [];
      if (reverseMap.notes) noteParts.push(cleanVal(d[reverseMap.notes] || ""));
      for (const nc of notesCols) {
        if (nc !== reverseMap.notes) {
          const val = cleanVal(d[nc] || "");
          if (val) noteParts.push(nc + ": " + val);
        }
      }
      const notes = noteParts.filter(Boolean).join(" | ");

      const errors: string[] = [];
      if (!email) errors.push("No email");
      else if (!isValidEmail(email)) errors.push("Bad email");
      if (phone && !/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ""))) errors.push("Bad phone");

      return { data: { ...d, _email: email, _first_name: first_name, _last_name: last_name, _phone: phone, _tags: tags, _dob: dob, _anniversary: anniversary, _notes: notes }, errors };
    });
    setCsvRows(validated);
    setCsvStep("preview");
  }

  async function importContacts() {
    const validRows = csvRows.filter((r) => r.errors.length === 0 && r.data._email);
    if (validRows.length === 0) { notify({ message: "No valid contacts to import.", tone: "warning" }); return; }
    setImporting(true);

    const dbRows = validRows.map((r) => {
      const d = r.data;
      const row: Record<string, any> = {
        business_id: businessId,
        email: d._email,
        source: "import",
      };
      if (d._first_name) row.first_name = d._first_name;
      if (d._last_name) row.last_name = d._last_name;
      if (d._phone) row.phone = d._phone;
      if (d._tags) row.tags = d._tags.split(/[;|,]/).map((t: string) => t.trim()).filter(Boolean);
      if (d._dob && !isNaN(Date.parse(d._dob))) row.date_of_birth = new Date(d._dob).toISOString().slice(0, 10);
      if (d._anniversary && !isNaN(Date.parse(d._anniversary))) row.anniversary_date = new Date(d._anniversary).toISOString().slice(0, 10);
      if (d._notes) row.notes = d._notes;
      return row;
    });

    const { data: imported, error } = await supabase.from("marketing_contacts").upsert(dbRows, { onConflict: "business_id,email", ignoreDuplicates: true }).select("id");
    setImporting(false);
    if (error) { notify({ message: error.message, tone: "error" }); return; }
    const importedCount = imported?.length ?? 0;
    for (const row of (imported || []) as any[]) { checkAutoEnroll(row.id, "contact_added"); }
    notify({ message: `Imported ${importedCount} contacts (${validRows.length - importedCount} dupes skipped, ${csvRows.length - validRows.length} invalid excluded).`, tone: "success" });
    setImportText(""); setCsvRows([]); setCsvHeaders([]); setCsvMapping({}); setCsvStep("upload"); setShowImport(false);
    load();
  }

  async function runValidation() {
    setValidating(true);
    const issues: { id: string; email: string; issue: string; action: string }[] = [];

    for (const c of contacts) {
      if (!isValidEmail(c.email)) {
        issues.push({ id: c.id, email: c.email, issue: "Invalid email format", action: "deactivate" });
      }
      if (c.total_received >= 5 && c.total_opens === 0) {
        issues.push({ id: c.id, email: c.email, issue: "Never opened (5+ emails sent)", action: "tag:unengaged" });
      }
      if (c.total_received >= 3 && c.total_clicks > 0 && c.total_opens > 2) {
        issues.push({ id: c.id, email: c.email, issue: "Highly engaged", action: "tag:vip" });
      }
      if (c.total_received === 0 && c.status === "active") {
        issues.push({ id: c.id, email: c.email, issue: "Never emailed", action: "tag:new" });
      }
    }

    // Apply segmentation tags
    const tagUpdates: Record<string, string[]> = {};
    for (const issue of issues) {
      if (issue.action.startsWith("tag:")) {
        const tag = issue.action.replace("tag:", "");
        if (!tagUpdates[issue.id]) {
          const contact = contacts.find((c) => c.id === issue.id);
          tagUpdates[issue.id] = [...(contact?.tags || [])];
        }
        if (!tagUpdates[issue.id].includes(tag)) {
          tagUpdates[issue.id].push(tag);
        }
      }
    }

    // Deactivate invalid emails
    const deactivateIds = issues.filter((i) => i.action === "deactivate").map((i) => i.id);
    if (deactivateIds.length > 0) {
      await supabase.from("marketing_contacts").update({ status: "inactive" }).in("id", deactivateIds);
    }

    // Apply tags
    for (const [contactId, tags] of Object.entries(tagUpdates)) {
      await supabase.from("marketing_contacts").update({ tags }).eq("id", contactId);
    }

    const deactivated = deactivateIds.length;
    const tagged = Object.keys(tagUpdates).length;

    notify({ message: `Validation complete: ${deactivated} deactivated, ${tagged} contacts tagged for segmentation.`, tone: "success" });
    setValidating(false);
    setShowValidate(false);
    load();
  }

  async function toggleStatus(contact: Contact) {
    const newStatus = contact.status === "active" ? "unsubscribed" : "active";
    await supabase.from("marketing_contacts").update({ status: newStatus }).eq("id", contact.id);
    setContacts(contacts.map((c) => c.id === contact.id ? { ...c, status: newStatus } : c));
  }

  async function deleteContact(id: string) {
    await supabase.from("marketing_contacts").delete().eq("id", id);
    setContacts(contacts.filter((c) => c.id !== id));
    notify({ message: "Contact removed.", tone: "success" });
  }

  async function deleteAllContacts() {
    setDeletingAll(true);
    const { error } = await supabase.from("marketing_contacts").delete().eq("business_id", businessId);
    if (error) {
      notify({ title: "Delete failed", message: error.message, tone: "error" });
    } else {
      setContacts([]);
      notify({ message: "All contacts deleted.", tone: "success" });
    }
    setDeletingAll(false);
    setShowDeleteAll(false);
    setDeleteConfirmText("");
  }

  async function addTagToContact(contactId: string, tag: string) {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact || !tag.trim()) return;
    const normalizedTag = tag.trim().toLowerCase();
    const newTags = [...new Set([...(contact.tags || []), normalizedTag])];
    await supabase.from("marketing_contacts").update({ tags: newTags }).eq("id", contactId);
    setContacts(contacts.map((c) => c.id === contactId ? { ...c, tags: newTags } : c));
    setTagInput(null);
    checkAutoEnroll(contactId, "tag_added", { tag: normalizedTag });
  }

  async function removeTagFromContact(contactId: string, tag: string) {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    const newTags = (contact.tags || []).filter((t) => t !== tag);
    await supabase.from("marketing_contacts").update({ tags: newTags }).eq("id", contactId);
    setContacts(contacts.map((c) => c.id === contactId ? { ...c, tags: newTags } : c));
  }

  async function previewCleanList() {
    const { data } = await supabase.from("marketing_contacts")
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
    const ids = staleContacts.map((c) => c.id);
    const { error } = await supabase.from("marketing_contacts")
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
  const allTags = [...new Set(contacts.flatMap((c) => c.tags || []))].sort();

  const filtered = contacts.filter((c) => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterTag && !(c.tags || []).includes(filterTag)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.email?.toLowerCase().includes(q) || c.first_name?.toLowerCase().includes(q) || c.last_name?.toLowerCase().includes(q));
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeCount = contacts.filter((c) => c.status === "active").length;
  const unsubCount = contacts.filter((c) => c.status === "unsubscribed").length;
  const bouncedCount = contacts.filter((c) => c.status === "bounced").length;
  const inactiveCount = contacts.filter((c) => c.status === "inactive").length;

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
          {contacts.length > 0 && (
            <button onClick={() => setShowDeleteAll(true)} className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
              <Trash size={14} /> Delete All
            </button>
          )}
          <button onClick={() => setShowValidate(true)} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
            Validate & Segment
          </button>
          <button onClick={previewCleanList} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
            <Trash size={14} /> Clean List
          </button>
          <button onClick={() => { setShowImport(true); setCsvStep("upload"); setCsvRows([]); setImportText(""); }} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
            <UploadSimple size={14} /> Import CSV
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: "var(--ck-accent)" }}>
            <Plus size={14} /> Add Contact
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search contacts..."
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value as any); setPage(0); }}
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
            onChange={(e) => { setFilterTag(e.target.value); setPage(0); }}
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
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Phone</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>DOB</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Tags</th>
                <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Engagement</th>
                <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((c) => {
                const isEditing = editingId === c.id;
                return isEditing ? (
                  <tr key={c.id} className="border-t" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg-subtle, var(--ck-bg))" }}>
                    <td className="px-4 py-2">
                      <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text-strong)" }} placeholder="Email" />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <input value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                          className="w-1/2 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }} placeholder="First" />
                        <input value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                          className="w-1/2 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }} placeholder="Last" />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                        className="w-full rounded-lg border px-2 py-1.5 text-xs font-mono" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }} placeholder="Phone" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="date" value={editForm.date_of_birth} onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })}
                        className="rounded-lg border px-2 py-1.5 text-xs w-[120px]" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }} />
                    </td>
                    <td className="px-4 py-2">
                      <input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                        className="w-full rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }} placeholder="tag1, tag2" />
                    </td>
                    <td className="px-4 py-2 text-center text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      {c.total_received > 0 ? <span>{c.total_received} / {c.total_opens} / {c.total_clicks}</span> : "—"}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button onClick={() => toggleStatus(c)} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer ${
                        c.status === "active" ? "bg-emerald-100 text-emerald-700" :
                        c.status === "bounced" ? "bg-red-100 text-red-600" :
                        c.status === "inactive" ? "bg-amber-100 text-amber-600" :
                        "bg-gray-100 text-gray-500"
                      }`}>{c.status}</button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={saveEdit} disabled={editSaving} className="p-1 rounded-lg hover:bg-emerald-50" style={{ color: "var(--ck-success, #059669)" }} title="Save">
                          <Check size={16} weight="bold" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1 rounded-lg hover:bg-gray-100" style={{ color: "var(--ck-text-muted)" }} title="Cancel">
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                <tr key={c.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                  <td className="px-4 py-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{c.email}</td>
                  <td className="px-4 py-3" style={{ color: "var(--ck-text)" }}>
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--ck-text-muted)" }}>
                    {c.phone || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--ck-text)" }}>
                    {c.date_of_birth || "—"}
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
                          +
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
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(c)} className="p-1 rounded-lg hover:bg-gray-100" style={{ color: "var(--ck-text-muted)" }} title="Edit">
                        <PencilSimple size={14} />
                      </button>
                      <button onClick={() => deleteContact(c.id)} className="text-red-500 hover:text-red-700 p-1" title="Delete">
                        <Trash size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()} contacts
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-30"
              style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>First</button>
            <button onClick={() => setPage(page - 1)} disabled={page === 0}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-30"
              style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Prev</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) p = i;
              else if (page < 3) p = i;
              else if (page > totalPages - 4) p = totalPages - 7 + i;
              else p = page - 3 + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={"rounded-lg px-2.5 py-1.5 text-xs font-medium " + (p === page ? "font-bold" : "")}
                  style={{ background: p === page ? "var(--ck-accent)" : "transparent", color: p === page ? "#fff" : "var(--ck-text)" }}
                >{p + 1}</button>
              );
            })}
            <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-30"
              style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Next</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-30"
              style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Last</button>
          </div>
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
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="First name *" value={addForm.first_name} onChange={(e) => setAddForm({ ...addForm, first_name: e.target.value })}
                  className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
                <input placeholder="Last name *" value={addForm.last_name} onChange={(e) => setAddForm({ ...addForm, last_name: e.target.value })}
                  className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              </div>
              <input placeholder="Email *" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
              <input placeholder="Phone number *" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
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

      {/* Import modal — 3-step: upload → map columns → preview & import */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl" style={{ background: "var(--ck-surface)" }}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b" style={{ borderColor: "var(--ck-border)" }}>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Import Contacts</h3>
                <div className="flex items-center gap-4 mt-1">
                  {["upload", "map", "preview"].map((s, i) => (
                    <span key={s} className={"text-[10px] font-semibold uppercase " + (csvStep === s ? "text-[var(--ck-accent)]" : "")} style={{ color: csvStep === s ? undefined : "var(--ck-text-muted)" }}>
                      {i + 1}. {s === "upload" ? "Upload" : s === "map" ? "Map Columns" : "Preview & Import"}
                    </span>
                  ))}
                </div>
              </div>
              <button onClick={() => setShowImport(false)}><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* STEP 1: Upload */}
              {csvStep === "upload" && (
                <div className="space-y-4">
                  <div className="rounded-xl border-2 border-dashed p-8 text-center" style={{ borderColor: "var(--ck-border)" }}>
                    <UploadSimple size={32} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium mb-2" style={{ color: "var(--ck-text)" }}>Upload a CSV, TXT, or tab-separated file</p>
                    <input type="file" accept=".csv,.txt,.tsv,.xls,.xlsx" onChange={(e) => handleCsvFile(e.target.files?.[0] || null)} className="mx-auto block text-sm" />
                    <p className="text-[10px] mt-2" style={{ color: "var(--ck-text-muted)" }}>
                      Any columns accepted — you&apos;ll map them in the next step. Gaps in data are fine.
                    </p>
                  </div>
                  <div className="text-center text-xs font-medium" style={{ color: "var(--ck-text-muted)" }}>— or paste data —</div>
                  <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6}
                    placeholder={"email, first_name, last_name, phone, company, city\njohn@example.com, John, Doe, 0821234567, Acme, Cape Town\njane@example.com, Jane, , , , Johannesburg"}
                    className="w-full rounded-lg border px-3 py-2 text-sm font-mono" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowImport(false)} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Cancel</button>
                    <button onClick={handlePasteImport} disabled={!importText.trim()} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ck-accent)" }}>Next: Map Columns</button>
                  </div>
                </div>
              )}

              {/* STEP 2: Map columns */}
              {csvStep === "map" && (
                <div className="space-y-4">
                  <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                    We found <strong>{csvHeaders.length}</strong> columns and <strong>{csvRows.length}</strong> rows. Map each column to a contact field. Unmapped columns go into <em>Notes</em>.
                  </p>

                  {/* Sample data preview */}
                  <div className="rounded-lg border overflow-x-auto" style={{ borderColor: "var(--ck-border)" }}>
                    <table className="w-full text-[11px]">
                      <thead style={{ background: "var(--ck-bg-subtle)" }}>
                        <tr>
                          {csvHeaders.map((h) => (
                            <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap" style={{ color: "var(--ck-text-muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0, 3).map((r, i) => (
                          <tr key={i} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                            {csvHeaders.map((h) => (
                              <td key={h} className="px-3 py-1 whitespace-nowrap" style={{ color: "var(--ck-text)" }}>{r.data[h] || <span className="opacity-30">—</span>}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Column mapping dropdowns */}
                  <div className="grid grid-cols-2 gap-3">
                    {csvHeaders.map((h) => {
                      const mappedField = Object.entries(csvMapping).find(([, v]) => v === h)?.[0] || "";
                      return (
                        <div key={h} className="flex items-center gap-2">
                          <span className="w-32 text-xs font-mono truncate" style={{ color: "var(--ck-text)" }} title={h}>{h}</span>
                          <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>→</span>
                          <select
                            value={mappedField}
                            onChange={(e) => {
                              const newMap = { ...csvMapping };
                              // Remove old mapping for this header
                              for (const [k, v] of Object.entries(newMap)) { if (v === h) delete newMap[k]; }
                              // Set new mapping
                              if (e.target.value && e.target.value !== "_skip") newMap[e.target.value] = h;
                              setCsvMapping(newMap);
                            }}
                            className="flex-1 rounded border px-2 py-1.5 text-xs" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                          >
                            <option value="">Notes (auto)</option>
                            {DB_FIELDS.map((f) => (
                              <option key={f.key} value={f.key} disabled={f.key !== "_skip" && f.key !== mappedField && Object.keys(csvMapping).includes(f.key)}>
                                {f.label}{f.required ? " *" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>

                  {!csvMapping.email && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                      Please map at least one column to <strong>Email</strong> (required).
                    </div>
                  )}

                  <div className="flex justify-between gap-2">
                    <button onClick={() => setCsvStep("upload")} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Back</button>
                    <button onClick={applyMappingAndValidate} disabled={!csvMapping.email} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ck-accent)" }}>
                      Next: Preview
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Preview & Import */}
              {csvStep === "preview" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--ck-border)" }}>
                      <div className="text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>{csvRows.length}</div>
                      <div className="text-[10px]" style={{ color: "var(--ck-text-muted)" }}>Total rows</div>
                    </div>
                    <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--ck-border)" }}>
                      <div className="text-xl font-bold text-emerald-600">{csvRows.filter((r) => r.errors.length === 0).length}</div>
                      <div className="text-[10px]" style={{ color: "var(--ck-text-muted)" }}>Valid</div>
                    </div>
                    <div className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--ck-border)" }}>
                      <div className="text-xl font-bold text-red-500">{csvRows.filter((r) => r.errors.length > 0).length}</div>
                      <div className="text-[10px]" style={{ color: "var(--ck-text-muted)" }}>Invalid (skipped)</div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-3 text-xs space-y-1" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text-muted)" }}>
                    <div className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>Auto-cleaned:</div>
                    <div>Emails lowercased · Names capitalized · Phones normalized (0XX→+27XX) · Quotes stripped · Empty gaps preserved as blank</div>
                    <div>Unmapped columns saved to <strong>Notes</strong> field</div>
                  </div>

                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ck-border)" }}>
                    <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0" style={{ background: "var(--ck-bg-subtle)" }}>
                          <tr>
                            <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--ck-text-muted)" }}>Email</th>
                            <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--ck-text-muted)" }}>Name</th>
                            <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--ck-text-muted)" }}>Phone</th>
                            <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--ck-text-muted)" }}>Tags</th>
                            <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--ck-text-muted)" }}>Notes</th>
                            <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y" style={{ borderColor: "var(--ck-border)" }}>
                          {csvRows.slice(0, 100).map((r, i) => (
                            <tr key={i} className={r.errors.length > 0 ? "bg-red-50/50" : ""}>
                              <td className="px-2 py-1.5 font-mono" style={{ color: "var(--ck-text)" }}>{r.data._email || "—"}</td>
                              <td className="px-2 py-1.5" style={{ color: "var(--ck-text)" }}>{[r.data._first_name, r.data._last_name].filter(Boolean).join(" ") || "—"}</td>
                              <td className="px-2 py-1.5 font-mono" style={{ color: "var(--ck-text-muted)" }}>{r.data._phone || "—"}</td>
                              <td className="px-2 py-1.5" style={{ color: "var(--ck-text-muted)" }}>{r.data._tags || "—"}</td>
                              <td className="px-2 py-1.5 max-w-[200px] truncate" style={{ color: "var(--ck-text-muted)" }} title={r.data._notes}>{r.data._notes || "—"}</td>
                              <td className="px-2 py-1.5">{r.errors.length > 0 ? <span className="text-red-500 font-medium">{r.errors.join(", ")}</span> : <span className="text-emerald-600 font-medium">OK</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {csvRows.length > 100 && (
                      <div className="px-3 py-2 text-[10px] text-center" style={{ color: "var(--ck-text-muted)", background: "var(--ck-bg-subtle)" }}>Showing first 100 of {csvRows.length} rows</div>
                    )}
                  </div>

                  <div className="flex justify-between gap-2">
                    <button onClick={() => setCsvStep("map")} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Back</button>
                    <div className="flex gap-2">
                      <button onClick={() => setShowImport(false)} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Cancel</button>
                      <button onClick={importContacts} disabled={importing || csvRows.filter((r) => r.errors.length === 0).length === 0} className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ck-accent)" }}>
                        {importing ? "Importing..." : `Import ${csvRows.filter((r) => r.errors.length === 0).length} contacts`}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Validate & Segment modal */}
      {showValidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl" style={{ background: "var(--ck-surface)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Validate & Segment Contacts</h3>
              <button onClick={() => setShowValidate(false)}><X size={18} /></button>
            </div>
            <div className="space-y-3 text-sm" style={{ color: "var(--ck-text)" }}>
              <p style={{ color: "var(--ck-text-muted)" }}>This will scan all {contacts.length} contacts and automatically:</p>
              <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--ck-border)" }}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  <span><strong>Deactivate</strong> contacts with invalid email addresses</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span><strong>Tag "unengaged"</strong> — received 5+ emails, never opened any</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span><strong>Tag "vip"</strong> — high engagement (opens + clicks)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  <span><strong>Tag "new"</strong> — active contacts never emailed yet</span>
                </div>
              </div>
              <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                You can then filter by these tags when sending campaigns to target specific segments.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setShowValidate(false)} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Cancel</button>
              <button onClick={runValidation} disabled={validating} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ck-accent)" }}>
                {validating ? "Validating..." : "Run Validation"}
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
      {/* Delete All Contacts confirmation */}
      {showDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Delete All Contacts</h3>
            <p className="mt-2 text-sm text-gray-600">
              This will permanently delete <strong>{contacts.length}</strong> contacts from your marketing list. This action cannot be undone.
            </p>
            <p className="mt-3 text-sm text-gray-600">
              Type <strong>DELETE</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase"
            />
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(""); }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={deleteAllContacts}
                disabled={deleteConfirmText !== "DELETE" || deletingAll}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingAll ? "Deleting..." : "Delete All Contacts"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
