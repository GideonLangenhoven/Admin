export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type DayKey = (typeof DAY_KEYS)[number];

export type DayBusinessHours = {
  closed: boolean;
  open: string;
  close: string;
};

export type BusinessHours = Record<DayKey, DayBusinessHours>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { closed: false, open: "08:00", close: "17:00" },
  tue: { closed: false, open: "08:00", close: "17:00" },
  wed: { closed: false, open: "08:00", close: "17:00" },
  thu: { closed: false, open: "08:00", close: "17:00" },
  fri: { closed: false, open: "08:00", close: "17:00" },
  sat: { closed: false, open: "08:00", close: "17:00" },
  sun: { closed: false, open: "08:00", close: "17:00" },
};

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalTime(value: unknown, fallback: string) {
  return typeof value === "string" && TIME_RE.test(value) ? value : fallback;
}

function minutes(value: string) {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

export function normalizeBusinessHours(value: unknown): BusinessHours {
  const source = isRecord(value) ? value : {};
  return DAY_KEYS.reduce((hours, day) => {
    const fallback = DEFAULT_BUSINESS_HOURS[day];
    const raw = isRecord(source[day]) ? source[day] : {};
    hours[day] = {
      closed: raw.closed === true,
      open: normalTime(raw.open, fallback.open),
      close: normalTime(raw.close, fallback.close),
    };
    return hours;
  }, {} as BusinessHours);
}

export function isCompleteBusinessHours(value: unknown): value is BusinessHours {
  if (!isRecord(value)) return false;

  return DAY_KEYS.every((day) => {
    const raw = value[day];
    if (!isRecord(raw) || typeof raw.closed !== "boolean") return false;
    const open = raw.open;
    const close = raw.close;
    if (raw.closed) return true;
    return typeof open === "string"
      && typeof close === "string"
      && TIME_RE.test(open)
      && TIME_RE.test(close)
      && minutes(close) > minutes(open);
  });
}
