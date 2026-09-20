import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceExports } from "../helpers/source-handler";

type Props = { businessId: string; date: string; timeZone: string };
type Cleanup = () => void;
type Day = { date: string; currency: string; departures: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function day(date: string, currency = "ZAR"): Day {
  return { date, currency, departures: [] };
}

function sameDeps(left: unknown[] | undefined, right: unknown[]) {
  return !!left && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function createHarness(loadSimpleDay: ReturnType<typeof vi.fn>) {
  const states: Array<{ value: unknown; set: (value: unknown) => void }> = [];
  const refs: Array<{ current: unknown }> = [];
  const memos: Array<{ value: unknown; deps: unknown[] }> = [];
  const effects: Array<{ deps: unknown[]; cleanup?: Cleanup }> = [];
  const channels: Array<{ handlers: Array<() => void>; channel: Record<string, unknown> }> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let memoCursor = 0;
  let effectCursor = 0;
  let pendingEffects: Array<{ index: number; deps: unknown[]; create: () => void | Cleanup }> = [];
  let props: Props = { businessId: "operator-a", date: "2026-09-20", timeZone: "Africa/Johannesburg" };
  let mounted = true;
  let writesAfterUnmount = 0;

  const react = {
    useState(initial: unknown) {
      const index = stateCursor++;
      if (!states[index]) {
        const slot = {
          value: typeof initial === "function" ? (initial as () => unknown)() : initial,
          set: () => {},
        };
        slot.set = (next: unknown) => {
          if (!mounted) writesAfterUnmount++;
          slot.value = typeof next === "function" ? (next as (value: unknown) => unknown)(slot.value) : next;
        };
        states[index] = slot;
      }
      return [states[index].value, states[index].set];
    },
    useRef(initial: unknown) {
      const index = refCursor++;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index];
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const index = memoCursor++;
      if (!memos[index] || !sameDeps(memos[index].deps, deps)) memos[index] = { value: factory(), deps: [...deps] };
      return memos[index].value;
    },
    useCallback(callback: unknown, deps: unknown[]) {
      return react.useMemo(() => callback, deps);
    },
    useEffect(create: () => void | Cleanup, deps: unknown[]) {
      const index = effectCursor++;
      if (!effects[index] || !sameDeps(effects[index].deps, deps)) pendingEffects.push({ index, deps: [...deps], create });
    },
  };

  const supabase = {
    channel: vi.fn(() => {
      const entry = { handlers: [] as Array<() => void>, channel: {} as Record<string, unknown> };
      const channel = {
        on: vi.fn((_type: string, _config: unknown, handler: () => void) => {
          entry.handlers.push(handler);
          return channel;
        }),
        subscribe: vi.fn(() => channel),
      };
      entry.channel = channel;
      channels.push(entry);
      return channel;
    }),
    removeChannel: vi.fn(),
  };

  const { useSimpleDay } = sourceExports("app/simple/use-simple-day.ts", {
    react,
    "@/app/lib/bookings-realtime": { bookingRealtimeFilter: (businessId: string) => "business_id=eq." + businessId },
    "@/app/lib/supabase": { supabase },
    "./simple-data": { loadSimpleDay },
  }) as { useSimpleDay: (businessId: string, date: string, timeZone: string) => {
    data: Day | null;
    loading: boolean;
    error: string;
    reload: (quiet?: boolean) => Promise<void>;
  } };

  function render(next = props) {
    if (!mounted) throw new Error("Cannot render an unmounted hook");
    props = next;
    stateCursor = 0;
    refCursor = 0;
    memoCursor = 0;
    effectCursor = 0;
    pendingEffects = [];
    // This dependency-free harness intentionally supplies the hook runtime.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = useSimpleDay(props.businessId, props.date, props.timeZone);
    const scheduled = pendingEffects;
    for (const { index } of scheduled) effects[index]?.cleanup?.();
    for (const { index, deps, create } of scheduled) {
      const cleanup = create();
      effects[index] = { deps, ...(cleanup ? { cleanup } : {}) };
    }
    return result;
  }

  function unmount() {
    mounted = false;
    for (const effect of effects) effect?.cleanup?.();
  }

  return {
    render,
    unmount,
    channels,
    supabase,
    writesAfterUnmount: () => writesAfterUnmount,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSimpleDay request ordering", () => {
  it("keeps the newest date and timezone when successes resolve in reverse order", async () => {
    const older = deferred<Day>();
    const newer = deferred<Day>();
    const staleCallback = deferred<Day>();
    const load = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
      .mockReturnValueOnce(staleCallback.promise);
    const harness = createHarness(load);
    const first = harness.render();
    const oldReload = first.reload;

    harness.render({ businessId: "operator-a", date: "2026-09-21", timeZone: "UTC" });
    void oldReload(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map(([params]) => params)).toEqual([
      { businessId: "operator-a", date: "2026-09-20", timeZone: "Africa/Johannesburg" },
      { businessId: "operator-a", date: "2026-09-21", timeZone: "UTC" },
    ]);

    newer.resolve(day("2026-09-21", "NEW"));
    await settle();
    expect(harness.render()).toMatchObject({ data: day("2026-09-21", "NEW"), loading: false, error: "" });

    older.resolve(day("2026-09-20", "OLD"));
    await settle();
    expect(harness.render()).toMatchObject({ data: day("2026-09-21", "NEW"), loading: false, error: "" });
  });

  it("ignores a stale failure and its finally while the current request is loading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const older = deferred<Day>();
    const newer = deferred<Day>();
    const harness = createHarness(vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise));
    harness.render();
    harness.render({ businessId: "operator-a", date: "2026-09-21", timeZone: "Africa/Johannesburg" });

    older.reject(new Error("stale offline response"));
    await settle();
    expect(harness.render()).toMatchObject({ data: null, loading: true, error: "" });

    newer.resolve(day("2026-09-21"));
    await settle();
    expect(harness.render()).toMatchObject({ data: day("2026-09-21"), loading: false, error: "" });
  });

  it("keeps the current error when an older success settles last", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const older = deferred<Day>();
    const newer = deferred<Day>();
    const harness = createHarness(vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise));
    harness.render();
    harness.render({ businessId: "operator-a", date: "2026-09-21", timeZone: "Africa/Johannesburg" });

    newer.reject(new Error("current offline response"));
    await settle();
    const failed = harness.render();
    expect(failed.data).toBeNull();
    expect(failed.loading).toBe(false);
    expect(failed.error).toContain("couldn’t load");

    older.resolve(day("2026-09-20"));
    await settle();
    expect(harness.render()).toMatchObject({ data: null, loading: false, error: failed.error });
  });

  it("coalesces realtime events and orders overlapping quiet refreshes", async () => {
    vi.useFakeTimers();
    const initial = deferred<Day>();
    const olderQuiet = deferred<Day>();
    const newerQuiet = deferred<Day>();
    const load = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(olderQuiet.promise)
      .mockReturnValueOnce(newerQuiet.promise);
    const harness = createHarness(load);
    harness.render();
    initial.resolve(day("2026-09-20", "INITIAL"));
    await settle();
    harness.render();

    const refreshSoon = harness.channels[0].handlers[0];
    refreshSoon();
    refreshSoon();
    vi.advanceTimersByTime(149);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(2);

    refreshSoon();
    vi.advanceTimersByTime(150);
    expect(load).toHaveBeenCalledTimes(3);
    newerQuiet.resolve(day("2026-09-20", "NEWER"));
    await settle();
    expect(harness.render().data).toEqual(day("2026-09-20", "NEWER"));
    olderQuiet.resolve(day("2026-09-20", "OLDER"));
    await settle();
    expect(harness.render().data).toEqual(day("2026-09-20", "NEWER"));

    refreshSoon();
    harness.unmount();
    vi.advanceTimersByTime(150);
    expect(load).toHaveBeenCalledTimes(3);
    expect(harness.supabase.removeChannel).toHaveBeenCalledWith(harness.channels[0].channel);
  });

  it.each([
    { businessId: "", date: "2026-09-20", timeZone: "Africa/Johannesburg" },
    { businessId: "operator-a", date: "", timeZone: "Africa/Johannesburg" },
  ])("invalidates work when identifiers are missing: $businessId/$date", async (next) => {
    const pending = deferred<Day>();
    const load = vi.fn().mockReturnValueOnce(pending.promise);
    const harness = createHarness(load);
    harness.render();
    harness.render(next);
    expect(harness.render()).toMatchObject({ data: null, loading: false, error: "" });
    pending.resolve(day("2026-09-20", "STALE"));
    await settle();
    expect(harness.render()).toMatchObject({ data: null, loading: false, error: "" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("blocks settlements and captured reload callbacks after unmount", async () => {
    const pending = deferred<Day>();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(day("2026-09-20", "LATE"));
    const harness = createHarness(load);
    const { reload } = harness.render();
    harness.unmount();

    await reload(true);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(day("2026-09-20", "STALE"));
    await settle();
    expect(harness.writesAfterUnmount()).toBe(0);
  });
});
