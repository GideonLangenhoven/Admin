import { expect, it, vi } from "vitest";
import * as jsx from "react/jsx-runtime";
import { sourceExports, sourceFunction } from "../helpers/source-handler";

it("copies only the email, reports clipboard failures, and offers no action for a missing address", async () => {
  const notify = vi.fn(), writeText = vi.fn().mockResolvedValue(undefined), stopPropagation = vi.fn();
  const component = sourceExports("components/booking/CopyEmailButton.tsx", {
    "react/jsx-runtime": jsx,
    "@phosphor-icons/react": { Clipboard: () => null },
    "../../app/lib/app-notify": { notify },
  }).default as (props: { email?: string }) => any;
  expect(component({ email: "   " })).toBeNull();
  const button = component({ email: " guest@example.invalid " });
  expect(button.props["aria-label"]).toBe("Copy email address");
  const copy = sourceFunction("components/booking/CopyEmailButton.tsx", "copyEmail", { address: "guest@example.invalid", navigator: { clipboard: { writeText } }, notify });
  await copy({ stopPropagation });
  expect(stopPropagation).toHaveBeenCalledOnce();
  expect(writeText).toHaveBeenCalledWith("guest@example.invalid");
  expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "success" }));
  writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
  await copy({ stopPropagation });
  expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "warning" }));
});
