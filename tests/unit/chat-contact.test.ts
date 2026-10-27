import { describe, expect, it } from "vitest";
import { parseChatContact, validateChatContact } from "../../supabase/functions/_shared/chat-contact";
import { readFileSync } from "node:fs";

const saved = { name: "Zoë O'Neill", email: "zoe@example.com", phone: "+353 87 123 4567" };

describe("the shared multi-field chat contact contract", () => {
  it("keeps the independently deployed widget and edge contact contracts identical", () => {
    expect(readFileSync("booking/app/lib/chat-contact.ts", "utf8")).toBe(readFileSync("supabase/functions/_shared/chat-contact.ts", "utf8"));
  });
  it.each(["Zoë O'Neill", "Jean-Luc D’Arcy", "María del Carmen de la Cruz Fernández", "李小龍", "李", "Nǃxau ǂToma", "Søren Ångström", "محمد عبد الله", "Anne · Marie"])("accepts and preserves the name %s", name => {
    expect(parseChatContact(name).contact.name).toBe(name);
    expect(validateChatContact({ ...saved, name }).errors).toEqual({});
  });

  it.each([
    ["+44 7700 900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
    ["+1 (415) 555-0123", "+14155550123"],
    ["+44 (0)20 7946 0958", "+442079460958"],
    ["+86 138 0013 8000", "+8613800138000"],
    ["+34 612 34 56 78", "+34612345678"],
    ["27110000000", "+27110000000"],
  ])("preserves the international number in %s", (phone, normalized) => {
    const result = parseChatContact("Phone: " + phone, saved);
    expect(result.errors).toEqual({});
    expect(result.contact.phone).toBe(normalized);
    expect(result.contact.name).toBe(saved.name);
  });

  it.each(["Email: guest.example.com", "Email guest.example.com", "guest.example.com", "guest@@example.com", "guest@example", "guest@example..com", "guest@-example.com", "guest@example_.com", ".guest@example.com", "guest..name@example.com", "Email:"])("rejects malformed email without corrupting saved details: %s", text => {
    const result = parseChatContact(text, saved);
    expect(result.errors.email).toMatch(/valid email/);
    expect(result.contact).toEqual(saved);
  });

  it.each(["Phone: abcdef", "Phone abcdef", "Phone:", "+44abc123", "123abc", "+44 12", "+00 123456789", "+1234567890123456", "+44 (7700 900123", "Phone: 082 123 4567"])("rejects invalid phone without interpreting it as a name: %s", text => {
    const result = parseChatContact(text, saved);
    expect(result.errors.phone).toMatch(/valid phone/);
    expect(result.contact).toEqual(saved);
  });

  it.each([
    "Zoë O'Neill, zoe@example.com, +44 7700 900123",
    "Zoë O'Neill zoe@example.com +44 7700 900123",
    "My name is Zoë O'Neill and my email is zoe@example.com and my phone is +44 7700 900123",
    "Name: Zoë O'Neill; Email: zoe@example.com; Phone: +44 7700 900123",
    "Name: Zoë O'Neill\nEmail: zoe@example.com\nPhone: +44 7700 900123",
  ])("collects all fields together: %s", text => {
    const result = parseChatContact(text);
    expect(result.errors).toEqual({});
    expect(result.missing).toEqual([]);
    expect(result.contact).toEqual({ ...saved, phone: "+447700900123" });
  });

  it("collects separate fields without inventing the missing ones", () => {
    let result = parseChatContact("  Zoë O'Neill  ");
    expect(result.contact).toEqual({ name: saved.name, email: "", phone: "" });
    expect(result.missing).toEqual(["email", "phone"]);
    result = parseChatContact("zoe@example.com", result.contact);
    expect(result.missing).toEqual(["phone"]);
    result = parseChatContact("+44 7700 900123", result.contact);
    expect(result.missing).toEqual([]);
  });

  it.each(["", "   ", "\t\n"])("does not advance or replace details for whitespace %j", text => {
    const result = parseChatContact(text, saved);
    expect(result.errors.message).toBeTruthy();
    expect(result.contact).toEqual(saved);
  });

  it.each([
    "Name: Other Guest, Email: guest@@example.com, Phone: +44 7700 900123",
    "Other Guest, other@example.com, Phone: nope",
    "Email: other@example.com; Email: another@example.com",
    "Phone: +44 7700 900123; Phone: +34 612345678",
    "Name: <img src=x onerror=alert(1)>, Email: guest@example.com, Phone: +44 7700 900123",
  ])("rejects invalid or conflicting mixed input as a whole: %s", text => {
    const result = parseChatContact(text, saved);
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    expect(result.contact).toEqual(saved);
  });

  it("requires every field at the server boundary and preserves the valid fields", () => {
    for (const field of ["name", "email", "phone"] as const) {
      const result = validateChatContact({ ...saved, [field]: "   " });
      expect(Object.keys(result.errors)).toEqual([field]);
      expect(result.contact).toEqual({ ...saved, [field]: "" });
    }
    expect(Object.keys(validateChatContact({ name: {}, email: null, phone: 123 }).errors)).toEqual(["name", "email", "phone"]);
  });
});
