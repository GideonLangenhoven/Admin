// Pure question rules, mirrored in the independently deployed booking app.
// Keep the two copies identical (checked by booking-custom-questions.test.ts).
export type BookingQuestionType = "text" | "textarea" | "number" | "select" | "radio" | "checkbox" | "multiselect" | "date";
export type BookingQuestion = {
  key: string;
  label: string;
  type: BookingQuestionType;
  scope: "booking" | "participant";
  required: boolean;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  version: string;
};
export type QuestionAnswer = string | string[];
export type QuestionAnswers = Record<string, QuestionAnswer | QuestionAnswer[]>;
export type QuestionError = { key: string; participant: number | null; message: string };
export const QUESTION_SCHEMA_KEY = "__booking_questions";
const types = new Set<BookingQuestionType>(["text", "textarea", "number", "select", "radio", "checkbox", "multiselect", "date"]);
const choiceTypes = new Set(["select", "radio", "multiselect"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function applicableBookingQuestions(raw: unknown, tourId: string, businessId?: string): BookingQuestion[] {
  if (!Array.isArray(raw)) throw new Error("Invalid booking question configuration");
  const keys = new Set<string>();
  return raw.flatMap((field, index) => {
    if (!record(field)) throw new Error("Invalid booking question definition");
    if (field.enabled === false || field.active === false) return [];
    if (field.business_id && field.business_id !== businessId) return [];
    if (field.tour_id && field.tour_id !== tourId) return [];
    if (field.tour_ids !== undefined && (!Array.isArray(field.tour_ids) || field.tour_ids.some(id => typeof id !== "string"))) throw new Error("Invalid question tour scope");
    if (Array.isArray(field.tour_ids) && field.tour_ids.length && !field.tour_ids.includes(tourId)) return [];
    const key = String(field.key || field.id || "");
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key) || [QUESTION_SCHEMA_KEY, "__proto__", "constructor", "prototype"].includes(key) || keys.has(key)) throw new Error("Invalid or duplicate booking question identifier");
    keys.add(key);
    if (typeof field.label !== "string" || !field.label.trim()) throw new Error("Missing booking question label");
    const type = (field.type || "text") as BookingQuestionType;
    if (!types.has(type)) throw new Error("Unsupported booking question type");
    const rawScope = field.scope || "booking";
    if (!["booking", "per_booking", "participant", "per_participant"].includes(String(rawScope))) throw new Error("Unsupported booking question scope");
    if (field.required !== undefined && typeof field.required !== "boolean") throw new Error("Invalid required setting");
    const scope = rawScope === "participant" || rawScope === "per_participant" ? "participant" : "booking";
    const options = field.options === undefined ? [] : field.options;
    if (!Array.isArray(options)) throw new Error("Invalid booking question choices");
    const choices = options.map(option => {
      if (typeof option === "string" && option.trim()) return { value: option, label: option };
      if (record(option) && typeof option.value === "string" && option.value && typeof option.label === "string" && option.label.trim()) return { value: option.value, label: option.label };
      throw new Error("Invalid booking question choice");
    });
    if (new Set(choices.map(option => option.value)).size !== choices.length || (choiceTypes.has(type) && choices.length === 0)) throw new Error("Missing or duplicate booking question choices");
    const definition = { key, label: field.label, type, scope, required: field.required === true, placeholder: typeof field.placeholder === "string" ? field.placeholder : "", options: choices };
    return [{ question: { ...definition, version: JSON.stringify([definition, field.version ?? field.updated_at ?? null]) } as BookingQuestion, order: typeof field.sort_order === "number" && Number.isFinite(field.sort_order) ? field.sort_order : index, index }];
  }).sort((a, b) => a.order - b.order || a.index - b.index).map(item => item.question);
}

export function questionInputId(key: string, participant: number | null = null): string {
  return "book-question-" + key + "-" + (participant === null ? "booking" : participant);
}

export function questionErrorKey(key: string, participant: number | null): string {
  return key + ":" + (participant === null ? "booking" : participant);
}

export function reconcileQuestionAnswers(previous: BookingQuestion[], next: BookingQuestion[], answers: QuestionAnswers) {
  const retained: QuestionAnswers = {};
  let changed = previous.length !== next.length || previous.some((question, i) => question.key !== next[i]?.key || question.version !== next[i]?.version);
  for (const question of previous) {
    const replacement = next.find(field => field.key === question.key && field.version === question.version);
    if (replacement && Object.hasOwn(answers, question.key)) retained[question.key] = answers[question.key];
    else if (Object.hasOwn(answers, question.key)) changed = true;
  }
  return { answers: retained, changed };
}

function validateAnswer(question: BookingQuestion, raw: unknown): { value: QuestionAnswer; error?: string } {
  const multiple = question.type === "multiselect" || (question.type === "checkbox" && question.options.length > 0);
  const blank = raw === undefined || raw === null || raw === "" || (typeof raw === "string" && !raw.trim()) || (Array.isArray(raw) && raw.length === 0);
  if (blank) return { value: multiple ? [] : "", ...(question.required ? { error: "Please answer “" + question.label + "”." } : {}) };
  if (multiple) {
    if (!Array.isArray(raw) || raw.some(value => typeof value !== "string" || !question.options.some(option => option.value === value)) || new Set(raw).size !== raw.length) return { value: [], error: "Choose from the listed options." };
    return { value: raw as string[] };
  }
  if (!["string", "number", "boolean"].includes(typeof raw)) return { value: "", error: "Enter a valid answer." };
  const value = question.type === "select" || question.type === "radio" ? String(raw) : String(raw).trim();
  if (value.length > 4000) return { value, error: "Use 4,000 characters or fewer." };
  if (question.type === "number" && !Number.isFinite(Number(value))) return { value, error: "Enter a valid number." };
  if ((question.type === "select" || question.type === "radio") && !question.options.some(option => option.value === value)) return { value, error: "Choose from the listed options." };
  if (question.type === "checkbox" && !question.options.length && !["true", "false"].includes(value)) return { value, error: "Choose Yes or No." };
  if (question.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return { value, error: "Enter a valid date." };
  return { value };
}

export function validateQuestionAnswers(questions: BookingQuestion[], answers: unknown, qty: number) {
  const values = record(answers) ? answers : {};
  const clean: QuestionAnswers = {};
  const errors: QuestionError[] = [];
  if (!Number.isSafeInteger(qty) || qty < 1) throw new Error("Invalid participant count");
  for (const question of questions) {
    const participants = question.scope === "participant" ? Array.from({ length: qty }, (_, i) => i) : [null];
    const items: QuestionAnswer[] = [];
    for (const participant of participants) {
      const raw = participant === null ? values[question.key] : Array.isArray(values[question.key]) ? (values[question.key] as unknown[])[participant] : undefined;
      const result = validateAnswer(question, raw);
      if (result.error) errors.push({ key: question.key, participant, message: result.error });
      items.push(result.value);
    }
    clean[question.key] = question.scope === "participant" ? items : items[0];
  }
  return { answers: clean, errors };
}

export function savedQuestionDefinitions(fields: unknown): BookingQuestion[] {
  if (!record(fields)) return [];
  const snapshot = fields[QUESTION_SCHEMA_KEY];
  if (!record(snapshot) || snapshot.format !== 1 || !Array.isArray(snapshot.definitions)) return [];
  return snapshot.definitions.filter((definition): definition is BookingQuestion => record(definition) && typeof definition.key === "string" && typeof definition.label === "string" && typeof definition.version === "string"
    && types.has(definition.type as BookingQuestionType) && ["booking", "participant"].includes(String(definition.scope)) && Array.isArray(definition.options)
    && definition.options.every(option => record(option) && typeof option.value === "string" && typeof option.label === "string"));
}

export function questionConfigurationChanged(fields: unknown, questions: BookingQuestion[], businessId: string, tourId: string): boolean {
  if (!record(fields) || !Object.hasOwn(fields, QUESTION_SCHEMA_KEY)) return false; // Legacy manual/bot answers are validated against current definitions.
  const snapshot = fields[QUESTION_SCHEMA_KEY];
  if (!record(snapshot) || snapshot.format !== 1 || snapshot.business_id !== businessId || snapshot.tour_id !== tourId) return true;
  const previous = savedQuestionDefinitions(fields);
  return previous.length !== questions.length || previous.some((question, i) => question.key !== questions[i].key || question.version !== questions[i].version);
}

export function captureQuestionFields(questions: BookingQuestion[], answers: QuestionAnswers, businessId: string, tourId: string, existing: unknown = {}) {
  const fields: Record<string, unknown> = record(existing) ? { ...existing } : {};
  for (const old of savedQuestionDefinitions(existing)) delete fields[old.key];
  for (const question of questions) fields[question.key] = answers[question.key];
  fields[QUESTION_SCHEMA_KEY] = { format: 1, business_id: businessId, tour_id: tourId, definitions: questions.map(question => ({ ...question })), captured_at: new Date().toISOString() };
  return fields;
}

// Only authorised operational views use this formatter. The snapshot supplies
// historical labels; it is never rendered as an answer or sent to analytics.
export function bookingCustomFieldEntries(raw: unknown): Array<{ key: string; label: string; value: string }> {
  if (!record(raw)) return [];
  const definitions = savedQuestionDefinitions(raw);
  const keys = [...definitions.map(question => question.key), ...Object.keys(raw).filter(key => key !== QUESTION_SCHEMA_KEY && !definitions.some(question => question.key === key))];
  return keys.flatMap(key => {
    const question = definitions.find(definition => definition.key === key);
    const label = question?.label || key.replace(/_/g, " ").replace(/^\w/, char => char.toUpperCase());
    const display = (answer: unknown) => {
      const values = Array.isArray(answer) ? answer : [answer];
      return values.filter(value => typeof value === "string" || typeof value === "number" || typeof value === "boolean").map(value => {
        const text = String(value);
        if (question?.type === "checkbox" && !question.options?.length) return text === "true" ? "Yes" : text === "false" ? "No" : text;
        return question?.options?.find(option => option.value === text)?.label || text;
      }).filter(value => value.trim()).join(", ");
    };
    if (question?.scope === "participant" && Array.isArray(raw[key])) return (raw[key] as unknown[]).flatMap((answer, i) => {
      const value = display(answer);
      return value ? [{ key: key + ":" + i, label: "Guest " + (i + 1) + ": " + label, value }] : [];
    });
    const value = display(raw[key]);
    return value ? [{ key, label, value }] : [];
  });
}
