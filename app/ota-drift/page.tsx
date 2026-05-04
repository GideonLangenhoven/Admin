"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";
import { Warning, ArrowsClockwise, Check, CaretDown, CaretRight } from "@phosphor-icons/react";

type Run = {
  id: string;
  channel: string;
  run_at: string;
  period_start: string;
  period_end: string;
  our_count: number;
  ota_count: number;
  matched: number;
  missing_locally: number;
  missing_on_ota: number;
  amount_mismatches: number;
  status_mismatches: number;
  drifts: any[];
  status: string;
};

export default function OtaDriftPage() {
  var { businessId } = useBusinessContext();
  var [runs, setRuns] = useState<Run[]>([]);
  var [loading, setLoading] = useState(true);
  var [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (businessId) refresh();
  }, [businessId]);

  async function refresh() {
    setLoading(true);
    var { data } = await supabase
      .from("ota_reconciliation_runs")
      .select("*")
      .eq("business_id", businessId)
      .order("run_at", { ascending: false })
      .limit(50);
    setRuns((data as Run[]) || []);
    setLoading(false);
  }

  function toggleExpand(id: string) {
    setExpanded(expanded === id ? null : id);
  }

  var totalDrifts = runs.reduce((s, r) => s + (r.drifts?.length || 0), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Warning size={28} weight="duotone" className="text-amber-500" />
        <h1 className="text-2xl font-bold text-[color:var(--text)]">OTA Drift Monitor</h1>
        <button onClick={refresh} className="ml-auto p-2 rounded-lg hover:bg-[color:var(--surface2)] text-[color:var(--textMuted)]">
          <ArrowsClockwise size={20} />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[color:var(--surface)] rounded-xl border border-[color:var(--border)] p-4 text-center">
          <p className="text-2xl font-bold text-[color:var(--text)]">{runs.length}</p>
          <p className="text-xs text-[color:var(--textMuted)]">Recent Runs</p>
        </div>
        <div className={"rounded-xl border p-4 text-center " + (totalDrifts > 0 ? "bg-amber-50 border-amber-200" : "bg-[color:var(--surface)] border-[color:var(--border)]")}>
          <p className={"text-2xl font-bold " + (totalDrifts > 0 ? "text-amber-700" : "text-[color:var(--text)]")}>{totalDrifts}</p>
          <p className="text-xs text-[color:var(--textMuted)]">Total Drifts</p>
        </div>
        <div className="bg-[color:var(--surface)] rounded-xl border border-[color:var(--border)] p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{runs.filter(r => r.status === "ok").length}</p>
          <p className="text-xs text-[color:var(--textMuted)]">Clean Runs</p>
        </div>
      </div>

      {loading && <p className="text-sm text-[color:var(--textMuted)]">Loading...</p>}

      {!loading && runs.length === 0 && (
        <div className="text-center py-12">
          <Check size={40} className="mx-auto mb-3 text-emerald-400" />
          <p className="text-[color:var(--textMuted)]">No reconciliation runs yet. The nightly cron runs at 02:37 UTC.</p>
        </div>
      )}

      {runs.map(run => {
        var isExpanded = expanded === run.id;
        var hasDrifts = run.drifts && run.drifts.length > 0;
        var drifts = typeof run.drifts === "string" ? JSON.parse(run.drifts) : (run.drifts || []);
        return (
          <div key={run.id} className={"mb-3 rounded-xl border transition-colors " + (hasDrifts ? "border-amber-200 bg-amber-50/50" : "border-[color:var(--border)] bg-[color:var(--surface)]")}>
            <button onClick={() => toggleExpand(run.id)} className="w-full flex items-center gap-3 p-4 text-left">
              {isExpanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
              <span className={"text-xs font-mono px-2 py-0.5 rounded " + (run.channel === "VIATOR" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700")}>{run.channel}</span>
              <span className="text-sm text-[color:var(--text)] flex-1">{new Date(run.run_at).toLocaleString()}</span>
              <span className="text-xs text-[color:var(--textMuted)]">
                {run.our_count} ours · {run.ota_count} OTA · {run.matched} matched
              </span>
              {hasDrifts ? (
                <span className="text-xs font-semibold text-amber-600 flex items-center gap-1"><Warning size={14} /> {drifts.length} drift{drifts.length !== 1 ? "s" : ""}</span>
              ) : (
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><Check size={14} /> clean</span>
              )}
            </button>
            {isExpanded && (
              <div className="px-4 pb-4">
                <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
                  <div className="bg-white rounded-lg p-2 text-center border border-[color:var(--border)]">
                    <p className="font-bold text-red-600">{run.missing_locally}</p>
                    <p className="text-[color:var(--textMuted)]">Missing locally</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-[color:var(--border)]">
                    <p className="font-bold text-orange-600">{run.missing_on_ota}</p>
                    <p className="text-[color:var(--textMuted)]">Missing on OTA</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-[color:var(--border)]">
                    <p className="font-bold text-purple-600">{run.amount_mismatches}</p>
                    <p className="text-[color:var(--textMuted)]">Amount diffs</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-[color:var(--border)]">
                    <p className="font-bold text-blue-600">{run.status_mismatches}</p>
                    <p className="text-[color:var(--textMuted)]">Status diffs</p>
                  </div>
                </div>
                {drifts.length > 0 && (
                  <div className="space-y-1">
                    {drifts.map((d: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-xs bg-white rounded-lg p-2 border border-[color:var(--border)]">
                        <span className={"font-mono px-1.5 py-0.5 rounded shrink-0 " + ({
                          missing_locally: "bg-red-100 text-red-700",
                          missing_on_ota: "bg-orange-100 text-orange-700",
                          amount_mismatch: "bg-purple-100 text-purple-700",
                          status_mismatch: "bg-blue-100 text-blue-700",
                        }[d.type as string] || "bg-gray-100 text-gray-700")}>{d.type}</span>
                        <span className="text-[color:var(--textMuted)] font-mono">{d.external_ref}</span>
                        <span className="text-[color:var(--text)] flex-1">{d.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-[color:var(--textMuted)] mt-2">
                  Period: {new Date(run.period_start).toLocaleString()} — {new Date(run.period_end).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
