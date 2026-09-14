// deno test _shared/bot-llm.test.ts
// The JSON contract validator is the money path between the model and a
// customer's phone — these are the cases that must never regress.
import { validateBotOut } from "./bot-llm.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

Deno.test("valid reply passes and preserves message", () => {
  const out = validateBotOut(JSON.stringify({
    plan: "p", action: "reply", message: "The tour is R650.", flow_id: null,
    template_id: null, template_params: null, escalation_reason: null,
    intent: "price", grounded: true,
  }));
  assert(!!out && out.action === "reply" && out.message === "The tour is R650." && out.grounded === true, "reply");
});

Deno.test("fenced JSON is unwrapped", () => {
  const out = validateBotOut("```json\n" + JSON.stringify({ plan: "", action: "silent", message: null, intent: "other", grounded: true }) + "\n```");
  assert(!!out && out.action === "silent" && out.message === null, "fence");
});

Deno.test("silent forces message null even when model includes one", () => {
  const out = validateBotOut(JSON.stringify({ plan: "", action: "silent", message: "should vanish", grounded: true }));
  assert(!!out && out.message === null, "silent-null");
});

Deno.test("reply without message is invalid", () => {
  assert(validateBotOut(JSON.stringify({ plan: "", action: "reply", message: null })) === null, "reply-no-msg");
});

Deno.test("a plan leaking into message is rejected, not sent", () => {
  const nested = JSON.stringify({ action: "reply", message: '{"plan": "internal", "action": "reply", "message": "hi"}' });
  assert(validateBotOut(nested) === null, "plan-leak");
});

Deno.test("garbage and unknown actions are null", () => {
  assert(validateBotOut("sorry, I cannot do JSON today") === null, "garbage");
  assert(validateBotOut(JSON.stringify({ action: "self_destruct", message: "x" })) === null, "unknown-action");
});
