// The chat asks for these details together or one at a time. This module has
// no runtime dependencies. Mirror it in the independently deployed booking
// app; chat-contact.test.ts checks that both copies use the same contract.
export type ChatContact = { name: string; email: string; phone: string };
type Field = keyof ChatContact;
type Errors = Partial<Record<Field | "message", string>>;
const fields: Field[] = ["name", "email", "phone"];

function validName(value: string): boolean {
  // Do not count words or require a Western first-name/surname structure.
  return value.length > 0 && value.length <= 200 && /\p{L}/u.test(value) && !/[@<>\r\n\u0000-\u001f\u007f]/.test(value);
}

function validEmail(value: string): boolean {
  if (value.length > 254 || !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+$/u.test(value)) return false;
  const [local, domain] = value.split("@");
  return local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..") &&
    domain.split(".").length >= 2 && domain.split(".").every(label => /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label));
}

function normalizedPhone(value: string): string {
  // An explicit international prefix is preserved; never infer a country
  // from a local number. (0) is the optional domestic trunk prefix.
  const international = /^(?:\+|00)/.test(value);
  const digits = (international ? value.replace(/\(0\)/g, "") : value).replace(/\D/g, "");
  return "+" + (value.startsWith("00") ? digits.slice(2) : digits);
}

function validPhone(value: string): boolean {
  if (!/^(?:\+|00)?[\d\s().-]+$/.test(value)) return false;
  let parentheses = 0;
  for (const char of value) {
    if (char === "(") parentheses++;
    if (char === ")" && --parentheses < 0) return false;
  }
  return parentheses === 0 && /^\+[1-9]\d{6,14}$/.test(normalizedPhone(value));
}

function fieldError(field: Field, value: string): string | null {
  if (field === "name") return validName(value) ? null : "Enter your full name. Spaces, apostrophes and hyphens are allowed.";
  if (field === "email") return validEmail(value) ? null : "Enter a valid email, e.g. name@example.com.";
  return validPhone(value) ? null : "Enter a valid phone number with country code, e.g. +44 7700 900123. Spaces, brackets and hyphens are allowed.";
}

export function validateChatContact(input: Record<string, unknown>): { contact: ChatContact; errors: Errors } {
  const contact: ChatContact = { name: "", email: "", phone: "" };
  const errors: Errors = {};
  for (const field of fields) {
    const value = typeof input[field] === "string" ? input[field].trim() : "";
    const error = fieldError(field, value);
    if (error) errors[field] = error;
    else contact[field] = value;
  }
  return { contact, errors };
}

export function parseChatContact(text: string, previous: Record<string, unknown> = {}) {
  const { contact } = validateChatContact(previous);
  const errors: Errors = {};
  const supplied: Partial<ChatContact> = {};
  let contactIntent = false;
  function accept(field: Field, raw: string) {
    const value = raw.trim();
    const error = fieldError(field, value);
    if (error) { errors[field] = error; return; }
    const normalized = field === "email" ? value.toLowerCase() : field === "phone" ? normalizedPhone(value) : value;
    if (supplied[field] && supplied[field] !== normalized) {
      errors[field] = "Please send just one " + (field === "name" ? "full name" : field === "email" ? "email address" : "phone number") + " so I use the right detail.";
      contact[field] = validateChatContact(previous).contact[field];
      return;
    }
    supplied[field] = normalized;
    contact[field] = normalized;
  }
  function unlabeled(part: string) {
    let rest = part.trim();
    if (!rest) return;
    // Match whole tokens, not a valid-looking substring of a malformed email.
    const email = rest.match(/\S*@\S*/);
    if (email) {
      contactIntent = true;
      accept("email", email[0]);
      rest = rest.replace(email[0], " ").trim();
    } else if (/^\S+\.[\p{L}]{2,}$/u.test(rest) || /\b(?:at)\b.*\b(?:dot)\b/i.test(rest)) {
      contactIntent = true;
      accept("email", rest);
      return;
    }
    const phone = rest.match(/(?:\+|00)?\d[\d\s().-]*\d|^(?:\+|00)?\d+$/);
    if (phone) {
      contactIntent ||= /^(?:\+|00)/.test(phone[0]);
      // Letters adjacent to digits belong to the invalid phone input, never
      // to a guessed name (e.g. +44abc123 or 123abc).
      if (/\d\p{L}|\p{L}\d/u.test(rest)) { errors.phone = fieldError("phone", "")!; return; }
      accept("phone", phone[0]);
      rest = rest.replace(phone[0], " ").replace(/^(?:and\s+)|(?:\s+and)$/gi, "").trim();
    }
    if (rest && contact.name && (email || phone) && rest !== contact.name) errors.message = "Please label a corrected name with 'Name:' so I use the right detail.";
    else if (rest) accept("name", rest);
  }
  for (const part of text.split(/[,;\n]+/).map(value => value.trim()).filter(Boolean)) {
    const labels = [...part.matchAll(/(?:^|\s)(?:(?:and|my)\s+)*(full\s+name|name|e-?mail(?:\s+address)?|phone(?:\s+number)?|telephone|tel|mobile(?:\s+number)?|cell(?:\s+number)?)(?:\s*(?::|=|is\b|-)\s*|\s+(?=\S)|\s*$)/gi)];
    if (!labels.length) { unlabeled(part); continue; }
    contactIntent = true;
    unlabeled(part.slice(0, labels[0].index));
    labels.forEach((label, index) => {
      const key = label[1].toLowerCase();
      const field: Field = key.includes("name") ? "name" : /e-?mail/.test(key) ? "email" : "phone";
      accept(field, part.slice(label.index! + label[0].length, labels[index + 1]?.index ?? part.length).replace(/\s+and\s*$/i, ""));
    });
  }
  if (!text.trim()) errors.message = "Send your name, email or phone number, one at a time if you prefer.";
  if (Object.keys(errors).length) Object.assign(contact, validateChatContact(previous).contact);
  return { contact, errors, missing: fields.filter(field => !contact[field]), contactIntent };
}
