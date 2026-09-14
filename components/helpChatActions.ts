// The help assistant's reply may end with directives it uses to drive the
// dashboard: [[open:/route]], [[fill:name=value]], [[submit]]. This is the
// pure parser that splits them off the prose; HelpChat executes them.
// Kept import-free so tests/unit can run it in a plain node environment.
export function parseActions(reply: string): {
  text: string;
  open: string | null;
  fills: [string, string][];
  submit: boolean;
} {
  let open: string | null = null;
  let submit = false;
  const fills: [string, string][] = [];
  const text = reply
    .replace(/\[\[(open|fill|submit):?([^\]]*)\]\]/g, (_, kind, body) => {
      if (kind === "open") open = body.trim();
      else if (kind === "submit") submit = true;
      else {
        const i = body.indexOf("=");
        if (i > 0) fills.push([body.slice(0, i).trim(), body.slice(i + 1).trim()]);
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, open, fills, submit };
}
