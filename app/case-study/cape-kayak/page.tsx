import Link from "next/link";

export default function CapeKayakCaseStudyPage() {
  return (
    <div className="min-h-screen bg-white px-6 py-12 md:px-10">
      <article className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Case Study</p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">How Cape Kayak runs booking, ops, and customer communication from one dashboard</h1>
          <p className="text-sm text-slate-600">A practical blueprint for activity operators that want fewer manual steps and faster paid-booking conversion.</p>
        </header>

        <section className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Business Type</p>
            <p className="mt-1 font-semibold text-slate-900">Adventure activity operator</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Primary Challenge</p>
            <p className="mt-1 font-semibold text-slate-900">Inquiry-to-payment drop-off and manual admin overhead</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">System Outcome</p>
            <p className="mt-1 font-semibold text-slate-900">Unified booking + ops workflow with automation</p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-slate-900">What was implemented</h2>
          <ul className="list-disc space-y-1 pl-5 text-slate-700">
            <li>Booking flows across web chat, WhatsApp, and direct admin actions</li>
            <li>Real-time slot and hold management with payment-link workflow</li>
            <li>Automated invoice, confirmation, refund, and rebook handling</li>
            <li>Weather cancellations with bulk customer communication</li>
            <li>Post-trip follow-up flows for retention and repeat bookings</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-slate-900">Why this matters for operators</h2>
          <p className="text-slate-700">Most teams lose time by stitching together inboxes, payment links, spreadsheets, and manual follow-ups. This operating model centralizes those workflows so teams can focus on conversion and customer experience instead of repetitive admin.</p>
        </section>

        <footer className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h3 className="text-lg font-semibold text-slate-900">Next step</h3>
          <p className="mt-1 text-sm text-slate-700">See the pricing and rollout model for this stack.</p>
          <Link href="/operators" className="mt-3 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">View plans</Link>
        </footer>
      </article>
    </div>
  );
}
