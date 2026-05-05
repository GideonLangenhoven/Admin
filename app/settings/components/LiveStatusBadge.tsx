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
    const label = mode === "OUTSIDE_HOURS" ? "Outside hours — bot active" : "Bot is replying now";
    const dotColor = mode === "OUTSIDE_HOURS" ? "bg-amber-400" : "bg-emerald-500";
    const bgColor = mode === "OUTSIDE_HOURS" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${bgColor}`}>
        <span className={`h-2 w-2 rounded-full ${dotColor} animate-pulse`} />
        {label}
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
