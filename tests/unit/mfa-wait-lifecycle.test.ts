import { describe, expect, it, vi } from "vitest";
import { sourceExports } from "../helpers/source-handler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function hookHarness(supabase: any, fetchImpl: typeof fetch) {
  type Slot = { value?: any; deps?: any[]; cleanup?: () => void };
  const slots: Slot[] = [];
  let cursor = 0;
  let queued: Array<() => void> = [];
  const react = {
    useState(initial: any) {
      const slot = slots[cursor++] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (value: any) => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
    },
    useRef(initial: any) {
      const slot = slots[cursor++] ||= { value: { current: initial } };
      return slot.value;
    },
    useEffect(effect: () => void | (() => void), deps: any[]) {
      const slot = slots[cursor++] ||= {};
      const changed = !slot.deps || deps.some((value, index) => value !== slot.deps?.[index]);
      if (!changed) return;
      queued.push(() => {
        slot.cleanup?.();
        slot.cleanup = effect() || undefined;
        slot.deps = deps;
      });
    },
  };
  const exports = sourceExports("components/MfaSensitiveAction.tsx", {
    react,
    "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }) },
    "../app/lib/supabase": { supabase },
    "./MfaSensitiveActionPanel": { MfaSensitiveActionPanel: "MfaSensitiveActionPanel" },
  }, {}, fetchImpl);
  const useHook = exports.useSensitiveActionMfa as (disabled: boolean, scope: string) => any;
  return {
    render(scope: string) {
      cursor = 0;
      queued = [];
      const value = useHook(false, scope);
      const effects = queued;
      queued = [];
      effects.forEach((effect) => effect());
      return value;
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}

const STATUS = { enrolled: true, currentLevel: "aal1", ready: false, recoveryState: "none", reEnrollRequired: false };
const session = { data: { session: { access_token: "signed-fixture" } } };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MFA wait lifecycle", () => {
  it("does not continue a save when the business changes during getSession/status", async () => {
    const waiting = deferred<any>();
    const supabase = { auth: { getSession: vi.fn(() => waiting.promise), mfa: {} } };
    const harness = hookHarness(supabase, vi.fn(async () => Response.json(STATUS)) as any);
    const first = harness.render("business-a");
    let effects = 0;
    const pending = first.requireMfa("Save bank details").then((allowed: boolean) => { if (allowed) effects += 1; return allowed; });
    harness.render("business-b");
    waiting.resolve(session);
    await flush();
    expect(await pending).toBe(false);
    expect(effects).toBe(0);
  });

  it("does not continue a save when unmounted during a status check", async () => {
    const waiting = deferred<any>();
    const supabase = { auth: { getSession: vi.fn(() => waiting.promise), mfa: {} } };
    const harness = hookHarness(supabase, vi.fn(async () => Response.json(STATUS)) as any);
    const first = harness.render("business-a");
    const pending = first.requireMfa("Save Yoco credentials");
    harness.unmount();
    waiting.resolve(session);
    await flush();
    expect(await pending).toBe(false);
  });

  it("does not apply an enrollment result to a newly selected business", async () => {
    const enrollment = deferred<any>();
    const supabase = { auth: {
      getSession: vi.fn(async () => session),
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: [] }, error: null })),
        enroll: vi.fn(() => enrollment.promise),
      },
    } };
    const harness = hookHarness(supabase, vi.fn(async () => Response.json({ ...STATUS, enrolled: false })) as any);
    const first = harness.render("business-a");
    const pending = first.requireMfa("Save WhatsApp credentials");
    await flush();
    harness.render("business-b");
    enrollment.resolve({ data: { id: "old-factor", type: "totp", totp: { qr_code: "fixture", secret: "fixture" } }, error: null });
    await flush();
    expect(await pending).toBe(false);
  });

  it("cancels a pending authenticator challenge when the target changes", async () => {
    const challenge = deferred<any>();
    const supabase = { auth: {
      getSession: vi.fn(async () => session),
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: [{ id: "factor-a" }] }, error: null })),
        challengeAndVerify: vi.fn(() => challenge.promise),
      },
    } };
    const harness = hookHarness(supabase, vi.fn(async () => Response.json(STATUS)) as any);
    let current = harness.render("business-a");
    const pending = current.requireMfa("Recover MFA");
    await flush();
    current = harness.render("business-a");
    expect(current.panel?.props?.mode).toBe("challenge");
    current.panel.props.onCodeChange("123456");
    current = harness.render("business-a");
    const verifying = current.panel.props.onVerify();
    harness.render("business-b");
    challenge.resolve({ data: {}, error: null });
    await verifying;
    expect(await pending).toBe(false);
  });
});
