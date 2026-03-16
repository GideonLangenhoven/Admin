import Link from "next/link";

const rows = [
  { label: "Inquiry to booking flow", manual: "Manual handoff + delays", platform: "Single guided flow with payment-ready handoff" },
  { label: "Capacity control", manual: "Spreadsheet and ad-hoc checks", platform: "Live slots, holds, and booking status in one place" },
  { label: "Customer comms", manual: "Repeated copy/paste across channels", platform: "Template-backed automated WhatsApp + email actions" },
  { label: "Refunds and rebooks", manual: "Case-by-case manual processing", platform: "Structured refund/rebook workflows" },
  { label: "Reporting", manual: "Manual exports and reconciliation", platform: "Operational and financial views from one system" },
];

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12 md:px-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comparison</p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Manual Ops vs Disconnected Tools vs Unified Platform</h1>
          <p className="text-slate-600">Use this as sales collateral for launch conversations.</p>
        </header>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">Area</th>
                <th className="px-4 py-3 font-semibold">Manual / Disconnected</th>
                <th className="px-4 py-3 font-semibold">CapeKayak SaaS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-slate-200 align-top">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.label}</td>
                  <td className="px-4 py-3 text-slate-600">{r.manual}</td>
                  <td className="px-4 py-3 text-slate-800">{r.platform}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-center">
          <Link href="/operators" className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Back to plans</Link>
        </div>
      </div>
    </div>
  );
}
