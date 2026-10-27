import { describe, expect, it, vi } from "vitest";
import * as jsx from "react/jsx-runtime";
import { sourceExports, sourceFunction } from "../helpers/source-handler";
import { checkInsUrl } from "../../app/lib/simple-view";

const id = "00000000-0000-0000-0000-000000000001";

describe("guest-count pencils", () => {
  const { default: ArrivalCountLink } = sourceExports("components/booking/ArrivalCountLink.tsx", {
    "next/link": { default: "a" },
    "react/jsx-runtime": jsx,
    "@phosphor-icons/react": { PencilSimple: "svg" },
    "@/app/lib/simple-view": { checkInsUrl },
  }) as { default: (props: any) => any };

  it.each([false, true])("opens the correct booking's arrival field for guide=%s", guide => {
    const element = ArrivalCountLink({ booking: { id, customer_name: "Guest", qty: 2, arrived_count: 1 }, date: "2026-10-21", slotId: id, guide });
    const link = element.props.children[1];
    expect(link.props.href).toBe(`${guide ? "/simpleguide" : "/simple"}/check-ins?date=2026-10-21&slot=${id}#arrived-${id}`);
    expect(link.props["aria-label"]).toBe("Edit arrivals for Guest: 1 of 2 arrived");
  });
});

describe("focusing the requested arrival field after data loads", () => {
  class Input {
    focus = vi.fn();
    scrollIntoView = vi.fn();
    select = vi.fn();
  }
  function harness(element: unknown) {
    const getElementById = vi.fn().mockReturnValue(element);
    return { getElementById, focus: sourceFunction("app/simple/check-ins/page.tsx", "focusArrivalInput", {
      document: { getElementById }, HTMLInputElement: Input,
    }) };
  }

  it("focuses and selects the existing Guests arrived input", () => {
    const input = new Input();
    const fixture = harness(input);
    expect(fixture.focus(`arrived-${id}`)).toBe(true);
    expect(fixture.getElementById).toHaveBeenCalledWith(`arrived-${id}`);
    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(input.select).toHaveBeenCalledOnce();
  });

  it("waits until the booking's input exists", () => {
    expect(harness(null).focus(`arrived-${id}`)).toBe(false);
    expect(harness({}).focus(`arrived-${id}`)).toBe(false);
  });

  it("ignores unrelated URL anchors", () => {
    const fixture = harness(new Input());
    expect(fixture.focus("payment")).toBe(false);
    expect(fixture.getElementById).not.toHaveBeenCalled();
  });
});
