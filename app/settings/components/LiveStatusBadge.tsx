"use client";

type Props = {
  active: boolean;
  mode: string;
};

export default function LiveStatusBadge({ active, mode }: Props) {
  if (mode === "OFF") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-600">
        <span className="h-2 w-2 rounded-full bg-gray-400" />
        Customers go straight to inbox
      </span>
    );
  }

  if (active) {
    if (mode !== "OUTSIDE_HOURS") return null;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700">
        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        Outside hours: bot active
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-600">
      <span className="h-2 w-2 rounded-full bg-gray-400" />
      Customers go straight to inbox
    </span>
  );
}
