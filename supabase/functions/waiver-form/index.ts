import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
var supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function esc(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDateTime(iso?: string | null, timeZone?: string | null) {
  if (!iso) return "TBC";
  return new Date(iso).toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone || "UTC",
  });
}

function pageShell(title: string, body: string) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${esc(title)}</title>
      <style>
        :root {
          color-scheme: light;
          --ink: #0f172a;
          --muted: #475569;
          --line: #dbe2ea;
          --card: #ffffff;
          --wash: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%);
          --accent: #0f766e;
          --accent-2: #134e4a;
          --danger: #b91c1c;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          background: var(--wash);
          color: var(--ink);
          min-height: 100vh;
          padding: 24px;
        }
        .wrap {
          max-width: 760px;
          margin: 0 auto;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 28px;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }
        .hero {
          background: linear-gradient(135deg, #0f172a 0%, #134e4a 100%);
          color: white;
          padding: 32px;
        }
        .hero h1 {
          margin: 0 0 8px;
          font-size: clamp(2rem, 4vw, 3rem);
          line-height: 1;
        }
        .hero p {
          margin: 0;
          color: rgba(255, 255, 255, 0.8);
          font-size: 1rem;
          line-height: 1.6;
        }
        .content {
          padding: 28px;
        }
        .grid {
          display: grid;
          gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          margin: 0 0 24px;
        }
        .stat {
          border: 1px solid var(--line);
          border-radius: 18px;
          padding: 14px 16px;
          background: #f8fafc;
        }
        .stat strong {
          display: block;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
          margin-bottom: 6px;
        }
        .copy {
          color: var(--muted);
          line-height: 1.7;
          margin: 0 0 20px;
        }
        form {
          display: grid;
          gap: 16px;
        }
        label {
          display: grid;
          gap: 8px;
          font-size: 0.95rem;
          font-weight: 600;
        }
        input[type="text"], textarea {
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 14px 16px;
          font: inherit;
        }
        textarea { min-height: 120px; resize: vertical; }
        .check {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          border: 1px solid var(--line);
          border-radius: 18px;
          padding: 16px;
          background: #f8fafc;
          color: var(--muted);
          line-height: 1.6;
        }
        .check input {
          margin-top: 4px;
          width: 18px;
          height: 18px;
        }
        .button {
          border: 0;
          border-radius: 999px;
          padding: 15px 22px;
          font: inherit;
          font-weight: 700;
          color: white;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
          cursor: pointer;
        }
        .ok {
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
          border-radius: 18px;
          padding: 18px;
          margin-bottom: 20px;
        }
        .warn {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: var(--danger);
          border-radius: 18px;
          padding: 18px;
        }
        .fine {
          margin-top: 24px;
          font-size: 0.85rem;
          color: var(--muted);
          line-height: 1.6;
        }
      </style>
    </head>
    <body>
      <div class="wrap">${body}</div>
    </body>
  </html>`;
}

function waiverPage(data: any, business: any, message?: string) {
  var title = (business?.name || "Booking") + " waiver";
  var signed = data.waiver_status === "SIGNED";
  return pageShell(title, `
    <div class="card">
      <div class="hero">
        <h1>${signed ? "Waiver signed" : "Complete your waiver"}</h1>
        <p>${esc(business?.name || "Your booking team")} needs a signed waiver before the trip starts. This form covers the booking contact and the guests attached to this reservation.</p>
      </div>
      <div class="content">
        ${message ? `<div class="${signed ? "ok" : "warn"}">${esc(message)}</div>` : ""}
        <div class="grid">
          <div class="stat"><strong>Reference</strong>${esc(String(data.id || "").substring(0, 8).toUpperCase())}</div>
          <div class="stat"><strong>Guest</strong>${esc(data.customer_name || "Guest")}</div>
          <div class="stat"><strong>Guests</strong>${esc(data.qty || 0)}</div>
          <div class="stat"><strong>Trip time</strong>${esc(fmtDateTime(data.slots?.start_time, business?.timezone))}</div>
        </div>
        ${signed ? `
          <div class="ok">
            <strong>Signed by ${esc(data.waiver_signed_name || data.customer_name || "guest")}</strong><br />
            ${esc(fmtDateTime(data.waiver_signed_at, business?.timezone))}
            ${data.waiver_payload?.id_number ? `<br /><span style="font-size:0.85rem;opacity:0.75;">ID / Passport: ${esc(data.waiver_payload.id_number)}</span>` : ""}
          </div>
        ` : `
          <div style="border:1px solid #dbe2ea;border-radius:18px;padding:20px 22px;margin-bottom:20px;background:#f8fafc;font-size:0.88rem;line-height:1.75;color:#374151;max-height:320px;overflow-y:auto;">
            <p style="margin:0 0 12px;font-weight:700;font-size:1rem;color:#0f172a;">Indemnity, Assumption of Risk &amp; Release of Liability</p>

            <p style="margin:0 0 10px;"><strong>1. Nature of Activity &amp; Inherent Risks</strong><br/>
            I understand that adventure and outdoor activities — including but not limited to kayaking, paddling, hiking, water-based excursions, and associated transfers — involve inherent risks and dangers that cannot be eliminated. These include, without limitation: adverse or unpredictable weather and sea conditions; collision with vessels, rocks, or other obstacles; capsizing or falling into water; exhaustion; hypothermia; marine wildlife encounters; equipment failure; and the physical demands of the activity. I voluntarily and knowingly accept these risks.</p>

            <p style="margin:0 0 10px;"><strong>2. Assumption of Risk</strong><br/>
            I freely and voluntarily accept and assume all risks of injury, loss, damage, or death arising from my participation and the participation of the guests listed on this booking, whether caused by the negligence of the operator, its employees, guides, or agents, or by any other cause. I acknowledge that no assurance of safety has been given to me.</p>

            <p style="margin:0 0 10px;"><strong>3. Release and Indemnity</strong><br/>
            In consideration of being permitted to participate, I hereby release, indemnify and hold harmless the operator, its owners, directors, employees, guides, contractors and agents (collectively "the Operator") from any and all claims, actions, damages, liability, costs and expenses — including legal fees — arising from or relating to my participation or the participation of any guest on this booking, even if such loss or damage arises from the Operator's negligence, to the fullest extent permitted by applicable law.</p>

            <p style="margin:0 0 10px;"><strong>4. Medical Fitness</strong><br/>
            I confirm that I and all guests on this booking are in good physical health and are not aware of any medical condition, disability, or impairment that would increase the risk of participation or endanger themselves or others. I accept full responsibility for disclosing any relevant medical information to the Operator's guides before the activity commences. I authorise the Operator to seek emergency medical treatment on my behalf or on behalf of any guest if deemed necessary, and I accept responsibility for any associated costs.</p>

            <p style="margin:0 0 10px;"><strong>5. Compliance with Instructions</strong><br/>
            I agree to follow all safety briefings and instructions given by the Operator's guides at all times. I understand that failure to comply may result in removal from the activity without refund.</p>

            <p style="margin:0 0 10px;"><strong>6. Personal Property</strong><br/>
            I acknowledge that the Operator accepts no liability for loss of or damage to personal property, including electronic devices, valuables, or vehicles, however caused.</p>

            <p style="margin:0 0 10px;"><strong>7. Photography &amp; Media</strong><br/>
            I consent to the Operator photographing or filming me and the guests on this booking during the activity and using such images for marketing, social media, or promotional purposes without compensation, unless I notify the Operator's guide in person before the activity begins.</p>

            <p style="margin:0 0 10px;"><strong>8. Governing Law</strong><br/>
            This waiver is governed by the laws of the Republic of South Africa. Any dispute shall be subject to the jurisdiction of the South African courts. This document constitutes the entire agreement between the parties regarding assumption of risk and release of liability and supersedes any prior representations.</p>

            <p style="margin:0;color:#6b7280;font-size:0.82rem;">By submitting this form you confirm that you have read, understood and agreed to all of the above terms on behalf of yourself and all guests listed on this booking.</p>
          </div>

          <form method="POST">
            <input type="hidden" name="booking" value="${esc(data.id)}" />
            <input type="hidden" name="token" value="${esc(data.waiver_token)}" />
            <label>
              Full name of person signing
              <input type="text" name="signer_name" value="${esc(data.customer_name || "")}" required placeholder="First and last name" />
            </label>
            <label>
              SA ID number or passport number <span style="font-weight:400;color:#64748b;">(optional — strengthens identity verification)</span>
              <input type="text" name="id_number" placeholder="e.g. 8001015009087 or A12345678" autocomplete="off" />
            </label>
            <label>
              Medical or mobility notes for the team (optional)
              <textarea name="notes" placeholder="Any medical conditions, injuries, mobility limitations, dietary requirements, or notes about any guest in this booking."></textarea>
            </label>
            <label class="check">
              <input type="checkbox" name="accept_risk" value="yes" required />
              <span>I have read the full Indemnity, Assumption of Risk &amp; Release of Liability above. I understand and accept all terms on behalf of myself and all guests on this booking, including the inherent risks of the activity and the release of the Operator from liability.</span>
            </label>
            <label class="check">
              <input type="checkbox" name="guardian_consent" value="yes" required />
              <span>If any participant in this booking is under 18 years of age, I confirm that I am their parent or legal guardian and I accept all terms on their behalf with full legal authority to do so.</span>
            </label>
            <button class="button" type="submit">Sign waiver</button>
          </form>
        `}
        <p class="fine">This record is timestamped and attached to your booking. If something looks wrong, reply to your booking confirmation email so the operator can help.</p>
      </div>
    </div>
  `);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    var url = new URL(req.url);
    var form = req.method === "POST" ? await req.formData() : null;
    var bookingId = String(form?.get("booking") || url.searchParams.get("booking") || "");
    var token = String(form?.get("token") || url.searchParams.get("token") || "");

    if (!bookingId || !token) {
      return new Response(pageShell("Waiver unavailable", `<div class="card"><div class="content"><div class="warn">This waiver link is incomplete. Please open the link from your booking confirmation email.</div></div></div>`), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    var bookingRes = await supabase
      .from("bookings")
      .select("id, business_id, customer_name, qty, waiver_status, waiver_token, waiver_signed_at, waiver_signed_name, waiver_payload, slots(start_time)")
      .eq("id", bookingId)
      .maybeSingle();

    if (!bookingRes.data || bookingRes.data.waiver_token !== token) {
      return new Response(pageShell("Waiver unavailable", `<div class="card"><div class="content"><div class="warn">This waiver link is invalid or has expired.</div></div></div>`), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    var businessRes = await supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", bookingRes.data.business_id)
      .maybeSingle();

    if (req.method === "POST") {
      var signerName = String(form?.get("signer_name") || "").trim();
      var acceptRisk = String(form?.get("accept_risk") || "") === "yes";
      var guardianConsent = String(form?.get("guardian_consent") || "") === "yes";
      var notes = String(form?.get("notes") || "").trim();
      var idNumber = String(form?.get("id_number") || "").trim();

      if (!signerName || !acceptRisk || !guardianConsent) {
        return new Response(waiverPage(bookingRes.data, businessRes.data, "Please complete all required waiver confirmations."), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      var payload = {
        notes: notes || null,
        id_number: idNumber || null,
        accept_risk: true,
        guardian_consent: true,
        user_agent: req.headers.get("user-agent") || null,
      };

      await supabase
        .from("bookings")
        .update({
          waiver_status: "SIGNED",
          waiver_signed_at: new Date().toISOString(),
          waiver_signed_name: signerName,
          waiver_payload: payload,
        })
        .eq("id", bookingId);

      var refreshed = await supabase
        .from("bookings")
        .select("id, business_id, customer_name, qty, waiver_status, waiver_token, waiver_signed_at, waiver_signed_name, waiver_payload, slots(start_time)")
        .eq("id", bookingId)
        .maybeSingle();

      return new Response(waiverPage(refreshed.data || bookingRes.data, businessRes.data, "Waiver saved successfully."), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(waiverPage(bookingRes.data, businessRes.data), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    return new Response(pageShell("Waiver unavailable", `<div class="card"><div class="content"><div class="warn">${esc(error instanceof Error ? error.message : String(error))}</div></div></div>`), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});
