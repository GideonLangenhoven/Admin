import { describe, expect, it, vi } from "vitest";
import * as jsx from "react/jsx-runtime";
import { sourceExports } from "../helpers/source-handler";

const booking = { id: "booking-a", customer_name: "Guest Example", status: "CONFIRMED", waiver_status: "PENDING" };

function fixture(options: { booking?: Partial<typeof booking>; readOnly?: boolean; businessId?: string } = {}) {
  const invoke = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  const notify = vi.fn();
  const setSending = vi.fn();
  const { default: BookingWaiverEmail } = sourceExports("components/booking/BookingWaiverEmail.tsx", {
    "react/jsx-runtime": jsx,
    react: { useRef: () => ({ current: false }), useState: () => [false, setSending] },
    "@phosphor-icons/react": { EnvelopeSimple: "svg", CircleNotch: "svg" },
    "@/app/lib/supabase": { supabase: { functions: { invoke } } },
    "@/app/lib/app-notify": { notify },
    "@/components/BusinessContext": { useBusinessContext: () => ({ businessId: options.businessId ?? "business-a", readOnly: options.readOnly }) },
  }) as { default: (props: { booking: typeof booking }) => { props: { onClick: () => Promise<void>; disabled: boolean; "aria-label": string } } };
  return { element: BookingWaiverEmail({ booking: { ...booking, ...options.booking } }), invoke, notify, setSending };
}

describe("Roll Call waiver email", () => {
  it("sends only the saved booking's waiver request and reports acceptance", async () => {
    const f = fixture();
    expect(f.element.props["aria-label"]).toBe("Email waiver to Guest Example");
    await f.element.props.onClick();
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith("send-email", {
      body: { type: "WAIVER_REQUEST", data: { business_id: "business-a", booking_id: "booking-a" } },
    });
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Waiver email sent", tone: "success" }));
    expect(f.setSending.mock.calls).toEqual([[true], [false]]);
  });

  it.each([
    { booking: { waiver_status: "SIGNED" } },
    { booking: { status: "CANCELLED" } },
    { booking: { status: "EXPIRED" } },
    { readOnly: true },
    { businessId: "" },
  ])("does not send when unavailable: %j", async options => {
    const f = fixture(options);
    expect(f.element.props.disabled).toBe(true);
    await f.element.props.onClick();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("blocks a second click while the email is being sent", async () => {
    const f = fixture();
    let finish!: (result: unknown) => void;
    f.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = f.element.props.onClick();
    await f.element.props.onClick();
    expect(f.invoke).toHaveBeenCalledOnce();
    finish({ data: { ok: true } });
    await first;
  });

  it("shows the saved-booking validation error instead of claiming success", async () => {
    const f = fixture();
    f.invoke.mockResolvedValue({ data: null, error: { context: Response.json({ error: "This booking does not need a waiver request" }, { status: 409 }) } });
    await f.element.props.onClick();
    expect(f.notify).toHaveBeenCalledWith({ title: "Waiver email not sent", message: "This booking does not need a waiver request", tone: "error" });
  });

  it("does not claim success or retry automatically after a lost connection", async () => {
    const f = fixture();
    f.invoke.mockRejectedValue(new Error("Offline"));
    await f.element.props.onClick();
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Email outcome unknown", tone: "warning" }));
    expect(f.setSending).toHaveBeenLastCalledWith(false);
  });
});
