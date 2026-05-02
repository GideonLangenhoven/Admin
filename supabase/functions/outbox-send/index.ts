import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
var WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")!;
var WA_PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID")!;

async function sendText(to: any, t: any) {
  var res = await fetch("https://graph.facebook.com/v19.0/" + WA_PHONE_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, type: "text", text: { body: t } }),
  });
  return await res.json();
}

Deno.serve(async () => {
  try {
    var now = new Date().toISOString();
    var r = await supabase.from("outbox").select("*").eq("status", "PENDING").lte("scheduled_for", now).order("scheduled_for", { ascending: true }).limit(20);
    var messages = r.data || [];
    console.log("OUTBOX: " + messages.length + " to send");
    var sent = 0;
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      try {
        var result = await sendText(msg.phone, msg.message_body);
        if (result.messages && result.messages[0] && result.messages[0].id) {
          await supabase.from("outbox").update({ status: "SENT", sent_at: new Date().toISOString(), attempts: msg.attempts + 1 }).eq("id", msg.id);
          sent++;
        } else {
          await supabase.from("outbox").update({ status: msg.attempts >= 2 ? "FAILED" : "PENDING", attempts: msg.attempts + 1 }).eq("id", msg.id);
        }
      } catch (e) {
        await supabase.from("outbox").update({ status: msg.attempts >= 2 ? "FAILED" : "PENDING", attempts: msg.attempts + 1 }).eq("id", msg.id);
      }
    }
    return new Response(JSON.stringify({ processed: messages.length, sent: sent }), { status: 200 });
  } catch (err) { console.error("ERR:", err); return new Response("Error", { status: 500 }); }
});
