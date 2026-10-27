import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";
import { applicableBookingQuestions, bookingCustomFieldEntries, captureQuestionFields, QUESTION_SCHEMA_KEY, questionConfigurationChanged, reconcileQuestionAnswers, validateQuestionAnswers } from "../../supabase/functions/_shared/booking-custom-fields";

const businessId = "44ff11ab-c697-47de-9227-0ffa51db127c";
const tourId = "96e07644-315b-4e96-8f36-bb070b665cf8";
const question = { key: "any_allergies_87180", label: "Any  Allergies", type: "text", required: true };

function checkoutFixture(options: { questions?: unknown; fields?: Record<string, unknown>; questionError?: boolean; saveError?: boolean; qty?: number } = {}) {
  const booking = { id: "test-booking", business_id: businessId, tour_id: tourId, qty: options.qty ?? 1, status: "PENDING", source: "WEB", waiver_token: "private-test-proof", custom_fields: options.fields ?? {} };
  const events: string[] = [];
  const db = {
    from(table: string) {
      let patch: Record<string, unknown> | undefined;
      const query: any = {
        select: () => query, eq: () => query, in: () => query,
        update: (value: Record<string, unknown>) => { patch = value; return query; },
        maybeSingle: async () => result(), single: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      function result() {
        if (table === "businesses") {
          events.push("questions-read");
          return options.questionError ? { data: null, error: { message: "Configuration unavailable" } } : { data: { booking_custom_fields: Object.hasOwn(options, "questions") ? options.questions : [question] }, error: null };
        }
        if (table === "bookings") {
          if (patch) {
            events.push("booking-save");
            if (options.saveError) return { data: null, error: { message: "Save unavailable" } };
            Object.assign(booking, patch);
          }
          return { data: booking, error: null };
        }
        throw new Error("Unexpected table: " + table);
      }
      return query;
    },
    async rpc(name: string) {
      events.push(name);
      if (name === "prepare_booking_checkout") return { data: { ok: true, amount: 600, expires_at: "2026-10-02T12:00:00Z" }, error: null };
      if (name === "save_checkout_request") return { data: { ok: true, request: { id: "test-request", mode: "test", body: { amount: 60000, currency: "ZAR", metadata: { booking_id: booking.id }, successUrl: "https://sandbox.example.invalid/success" } } }, error: null };
      throw new Error("Unexpected RPC: " + name);
    },
  };
  const helper = readFileSync("supabase/functions/create-checkout/index.ts", "utf8").includes('"../_shared/booking-custom-fields.ts"')
    ? sourceExports("supabase/functions/_shared/booking-custom-fields.ts", {}) : {};
  const handler = sourceHandler("supabase/functions/create-checkout/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => db,
      getTenantByBusinessId: async () => ({ business: { id: businessId, currency: "ZAR" }, credentials: { activeYocoSecretKey: "fixture-test-key", yocoTestMode: true, yocoTestSecretKey: "fixture-test-key", yocoTestWebhookSecret: "fixture-webhook" } }),
      resolveBusinessSiteUrls: () => ({ bookingSuccessUrl: "https://sandbox.example.invalid/success", bookingCancelUrl: "https://sandbox.example.invalid/cancel" }),
      getBusinessAllowedOrigins: () => ["https://sandbox.example.invalid"], isAllowedOrigin: () => true,
    },
    "../_shared/subscription.ts": { blockIfNotTrading: async () => null },
    "../_shared/auth.ts": { requireAuth: async () => { throw new Error("Anonymous test"); }, canAccessBusiness: () => false },
    "../_shared/booking-success.ts": { bookingSuccessUrl: async (url: string) => url },
    "../_shared/booking-custom-fields.ts": helper,
  }, {}, async () => {
    events.push("sandbox-payment");
    return Response.json({ id: "test-checkout", redirectUrl: "https://sandbox.example.invalid/payment" });
  });
  async function request(fields?: Record<string, unknown>, token = booking.waiver_token, type = "BOOKING") {
    const response = await handler(new Request("https://test.invalid/functions/v1/create-checkout", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://sandbox.example.invalid" }, body: JSON.stringify({ booking_id: booking.id, booking_token: token, amount: 600, type, ...(fields === undefined ? {} : { custom_fields: fields }) }) }));
    return { status: response.status, body: await response.json() };
  }
  return { request, booking, events };
}

describe("custom booking questions before checkout", () => {
  it("reproduces the required Kayak question bypass before any pricing or payment", async () => {
    const fixture = checkoutFixture();
    const result = await fixture.request();
    expect(result.status).toBe(422);
    expect(fixture.events).not.toContain("prepare_booking_checkout");
    expect(fixture.events).not.toContain("sandbox-payment");
  });

  it.each(["", " ", "\t\n"])("rejects a blank required answer (%j)", async value => {
    const fixture = checkoutFixture({ fields: { [question.key]: value } });
    const result = await fixture.request();
    expect(result.status).toBe(422);
    expect(result.body.field_errors).toEqual([{ key: question.key, participant: null, message: expect.any(String) }]);
    expect(fixture.events).not.toContain("sandbox-payment");
  });

  it("also validates draft bookings, which the existing pricing RPC accepts", async () => {
    const fixture = checkoutFixture();
    fixture.booking.status = "DRAFT";
    expect((await fixture.request()).status).toBe(422);
    expect(fixture.events).not.toContain("prepare_booking_checkout");
  });

  it("cannot bypass pending booking questions by changing the request type", async () => {
    const fixture = checkoutFixture();
    expect((await fixture.request({}, fixture.booking.waiver_token, "OTHER")).status).toBe(400);
    expect(fixture.events).not.toContain("sandbox-payment");
  });

  it("stores trusted question labels and versions before payment, against the matching booking", async () => {
    const fixture = checkoutFixture();
    const fields = { [question.key]: "None (test answer)", special_requests: "Client-supplied unrelated text" };
    const result = await fixture.request(fields);
    expect(result.status).toBe(200);
    expect(fixture.booking.custom_fields).toMatchObject({ [question.key]: fields[question.key], [QUESTION_SCHEMA_KEY]: { format: 1, business_id: businessId, tour_id: tourId, definitions: [{ key: question.key, label: question.label, type: "text", required: true, scope: "booking", version: expect.any(String) }] } });
    expect(fixture.booking.custom_fields).not.toHaveProperty("special_requests");
    expect(fixture.events.indexOf("booking-save")).toBeLessThan(fixture.events.indexOf("prepare_booking_checkout"));
    expect(fixture.events.indexOf("prepare_booking_checkout")).toBeLessThan(fixture.events.indexOf("sandbox-payment"));
  });

  it("retains answers on repeated checkout requests and can correct answers on a held retry", async () => {
    const fixture = checkoutFixture({ fields: { [question.key]: "First test answer", special_requests: "Preserve existing notes" } });
    expect((await fixture.request()).status).toBe(200);
    expect((await fixture.request()).status).toBe(200);
    fixture.booking.status = "HELD";
    expect((await fixture.request({ [question.key]: "Corrected test answer" })).status).toBe(200);
    expect(fixture.booking.custom_fields).toMatchObject({ [question.key]: "Corrected test answer", special_requests: "Preserve existing notes" });
  });

  it.each([[], [{ ...question, required: false }], [{ ...question, enabled: false }], [{ ...question, tour_ids: ["another-tour"] }]].map(questions => [questions]))("allows genuinely empty or optional configuration (%j)", async questions => {
    const fixture = checkoutFixture({ questions });
    expect((await fixture.request()).status).toBe(200);
    expect(fixture.events).toContain("sandbox-payment");
  });

  it.each([null, {}, "broken", [{ ...question, type: "unsupported" }], [question, question], [{ ...question, scope: "unknown" }]].map(questions => [questions]))("blocks malformed configuration rather than dropping questions (%j)", async questions => {
    const fixture = checkoutFixture({ questions });
    expect((await fixture.request()).status).toBe(503);
    expect(fixture.events).not.toContain("prepare_booking_checkout");
    expect(fixture.events).not.toContain("sandbox-payment");
  });

  it("distinguishes a failed configuration read from no questions", async () => {
    const fixture = checkoutFixture({ questionError: true });
    const result = await fixture.request();
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("CUSTOM_QUESTIONS_UNAVAILABLE");
    expect(fixture.events).not.toContain("prepare_booking_checkout");
  });

  it("blocks payment if answers cannot be saved", async () => {
    const fixture = checkoutFixture({ fields: { [question.key]: "None (test)" }, saveError: true });
    expect((await fixture.request()).status).toBe(503);
    expect(fixture.events).not.toContain("prepare_booking_checkout");
    expect(fixture.events).not.toContain("sandbox-payment");
  });

  it("checks booking access before reading configuration or answers", async () => {
    const fixture = checkoutFixture();
    expect((await fixture.request({}, "wrong-proof")).status).toBe(403);
    expect(fixture.events).not.toContain("questions-read");
  });

  it("requires each participant's answer and accepts a numeric zero", async () => {
    const questions = [{ ...question, key: "age", label: "Age", type: "number", scope: "per_participant" }];
    const fixture = checkoutFixture({ questions, qty: 2 });
    const missing = await fixture.request({ age: ["0", ""] });
    expect(missing.status).toBe(422);
    expect(missing.body.field_errors[0]).toMatchObject({ key: "age", participant: 1 });
    expect((await fixture.request({ age: ["0", "18"] })).status).toBe(200);
    expect(fixture.booking.custom_fields.age).toEqual(["0", "18"]);
  });

  it("returns changed configuration for review before charging an old snapshot", async () => {
    const before = applicableBookingQuestions([question], tourId, businessId);
    const fields = captureQuestionFields(before, { [question.key]: "None (test)" }, businessId, tourId);
    const fixture = checkoutFixture({ fields, questions: [{ ...question, label: "Emergency contact" }] });
    const result = await fixture.request();
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("CUSTOM_QUESTIONS_CHANGED");
    expect(result.body.questions[0].label).toBe("Emergency contact");
    expect(fixture.events).not.toContain("sandbox-payment");
  });

  it("keeps completed bookings' historical snapshots when operator questions change", async () => {
    const fixture = checkoutFixture({ fields: { historical: "Original answer" }, questionError: true });
    fixture.booking.status = "PAID";
    await fixture.request();
    expect(fixture.events).not.toContain("questions-read");
    expect(fixture.booking.custom_fields).toHaveProperty("historical", "Original answer");
  });
});

describe("question definitions, answers and historical display", () => {
  it("keeps independently deployed client and server rules identical", () => {
    expect(readFileSync("booking/app/lib/booking-custom-fields.ts", "utf8")).toBe(readFileSync("supabase/functions/_shared/booking-custom-fields.ts", "utf8"));
  });

  it("does not hard-code the live question into the implementation", () => {
    for (const file of ["booking/app/book/page.tsx", "booking/app/components/BookingQuestions.tsx", "supabase/functions/create-checkout/index.ts"]) expect(readFileSync(file, "utf8")).not.toMatch(/any_allergies_87180|Any\s+Allergies/);
  });

  it("preserves scope, order, labels and choice values while filtering disabled and non-applicable questions", () => {
    const raw = [{ key: "late", label: "Later", type: "text", sort_order: 9 }, { key: "first", label: "Exact label", type: "select", sort_order: 1, scope: "per_participant", options: [{ value: "small", label: "Small size" }, "Large"], tour_ids: [tourId] }, { key: "off", label: "Disabled", enabled: false }, { key: "other", label: "Other tour", tour_id: "other" }];
    const questions = applicableBookingQuestions(raw, tourId, businessId);
    expect(questions.map(q => q.key)).toEqual(["first", "late"]);
    expect(questions[0]).toMatchObject({ label: "Exact label", scope: "participant", required: false, options: [{ value: "small", label: "Small size" }, { value: "Large", label: "Large" }] });
  });

  it.each([
    ["text", "Short test answer", undefined], ["textarea", "Long\nmultilingual café 测试", undefined], ["number", "0", undefined],
    ["select", "s", ["s", "m"]], ["radio", "m", ["s", "m"]], ["multiselect", ["s", "m"], ["s", "m"]],
    ["checkbox", "false", undefined], ["checkbox", ["s"], ["s", "m"]], ["date", "2026-10-02", undefined],
  ])("validates supported %s answers", (type, answer, options) => {
    const questions = applicableBookingQuestions([{ ...question, type, options }], tourId, businessId);
    expect(validateQuestionAnswers(questions, { [question.key]: answer }, 1).errors).toEqual([]);
  });

  it("preserves configured choice values including surrounding spaces", () => {
    const questions = applicableBookingQuestions([{ ...question, type: "select", options: [{ value: " A ", label: "Option A" }] }], tourId, businessId);
    const result = validateQuestionAnswers(questions, { [question.key]: " A " }, 1);
    expect(result.errors).toEqual([]);
    expect(result.answers[question.key]).toBe(" A ");
  });

  it.each([["number", "not a number", undefined], ["select", "forged", ["s"]], ["multiselect", ["forged"], ["s"]], ["multiselect", ["s", "s"], ["s"]], ["checkbox", "maybe", undefined], ["date", "2026-02-30", undefined], ["text", {}, undefined]])("rejects invalid %s answers", (type, answer, options) => {
    const questions = applicableBookingQuestions([{ ...question, type, options }], tourId, businessId);
    expect(validateQuestionAnswers(questions, { [question.key]: answer }, 1).errors).toHaveLength(1);
  });

  it("keeps multi-choice answers per participant distinct", () => {
    const questions = applicableBookingQuestions([{ ...question, type: "multiselect", scope: "participant", options: ["s", "m"] }], tourId, businessId);
    const result = validateQuestionAnswers(questions, { [question.key]: [["s"], ["m"]] }, 2);
    expect(result.errors).toEqual([]);
    const fields = captureQuestionFields(questions, result.answers, businessId, tourId);
    expect(bookingCustomFieldEntries(fields)).toEqual([{ key: question.key + ":0", label: "Guest 1: " + question.label, value: "s" }, { key: question.key + ":1", label: "Guest 2: " + question.label, value: "m" }]);
  });

  it("reconciles by stable identifier and version, never position or a similar label", () => {
    const before = applicableBookingQuestions([question, { key: "shared", label: "Unchanged" }], tourId, businessId);
    const after = applicableBookingQuestions([{ key: "shared", label: "Unchanged" }, { ...question, key: "replacement" }], tourId, businessId);
    const result = reconcileQuestionAnswers(before, after, { [question.key]: "Old sensitive answer", shared: "Keep me" });
    expect(result).toEqual({ answers: { shared: "Keep me" }, changed: true });
    const edited = applicableBookingQuestions([{ ...question, label: "Different question" }], tourId, businessId);
    expect(reconcileQuestionAnswers(before, edited, { [question.key]: "Old answer" }).answers).toEqual({});
  });

  it("formats historical labels and choices without revealing snapshot internals", () => {
    const definitions = applicableBookingQuestions([{ ...question, type: "select", options: [{ value: "none", label: "None (test)" }] }], tourId, businessId);
    const fields = captureQuestionFields(definitions, { [question.key]: "none" }, businessId, tourId, { special_requests: "Legacy request", dietary: "Legacy note" });
    const current = applicableBookingQuestions([{ ...question, label: "Edited later" }], tourId, businessId);
    expect(questionConfigurationChanged(fields, current, businessId, tourId)).toBe(true);
    expect(bookingCustomFieldEntries(fields)).toEqual([{ key: question.key, label: question.label, value: "None (test)" }, { key: "special_requests", label: "Special requests", value: "Legacy request" }, { key: "dietary", label: "Dietary", value: "Legacy note" }]);
  });

  it("drops retired question values when capturing new applicable answers", () => {
    const before = applicableBookingQuestions([question], tourId, businessId);
    const prior = captureQuestionFields(before, { [question.key]: "Old answer" }, businessId, tourId);
    const updated = captureQuestionFields([], {}, businessId, "another-tour", prior);
    expect(updated).not.toHaveProperty(question.key);
    expect(bookingCustomFieldEntries(updated)).toEqual([]);
  });

  it("settings edits preserve stored scope, options, ordering and enabled state", async () => {
    const configured = { ...question, type: "select", scope: "per_participant", enabled: false, sort_order: 4, options: ["A", "B"], placeholder: "Hint" };
    let saved: any;
    const query: any = { eq: async () => ({ error: null }) };
    const save = sourceFunction("app/settings/page.tsx", "saveBookingQuestions", { bookingQuestions: [configured], businessId, setQuestionsSaving: () => {}, setQuestionsMessage: () => {}, setBookingQuestions: () => {}, setTimeout: () => 0, supabase: { from: () => ({ update: (payload: unknown) => { saved = payload; return query; } }) } });
    await save();
    expect(saved.booking_custom_fields[0]).toMatchObject(configured);
  });
});
