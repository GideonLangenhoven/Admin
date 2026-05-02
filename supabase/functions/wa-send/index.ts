import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN") || "";
const WA_PHONE_NUMBER_ID = Deno.env.get("WA_PHONE_NUMBER_ID") || "";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // Read raw body so we can debug parsing issues
  const rawBody = await req.text();
  console.log("RAW REQUEST BODY:", rawBody);

  let body: any;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (e) {
    return json(400, {
      error: "Invalid JSON body",
      hint: "In Supabase Test, set Content-Type: application/json and paste raw JSON in Request Body.",
      rawBody,
    });
  }

  console.log("PARSED BODY:", body);

  if (!WA_TOKEN) return json(500, { error: "Missing secret WA_ACCESS_TOKEN" });
  if (!WA_PHONE_NUMBER_ID) return json(500, { error: "Missing secret WA_PHONE_NUMBER_ID" });

  const to = body?.to;
  const text = body?.text;
  const interactive = body?.interactive;

  if (!to) {
    return json(400, {
      error: "Missing 'to'",
      expected: { to: "27716145061", text: "Hello" },
      got: body,
    });
  }
  if (!text && !interactive) {
    return json(400, {
      error: "Missing 'text' or 'interactive'",
      expected: { to: "27716145061", text: "Hello" },
      got: body,
    });
  }

  const payload: any = {
    messaging_product: "whatsapp",
    to,
  };

  if (text) {
    payload.type = "text";
    payload.text = { body: text };
  } else {
    payload.type = "interactive";
    payload.interactive = interactive;
  }

  const url = `https://graph.facebook.com/v19.0/${WA_PHONE_NUMBER_ID}/messages`;

  console.log("META URL:", url);
  console.log("META PAYLOAD:", payload);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const metaText = await resp.text();
  console.log("META STATUS:", resp.status);
  console.log("META RESPONSE:", metaText);

  // Return Meta response so you can see the real error in Supabase Test UI
  return new Response(metaText, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
});
