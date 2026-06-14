const STABLE_OPERATION_START = {
  year: 2024,
  month: 6,
  day: 4,
} as const;

function shanghaiDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
}

export function getStableOperationDays(now = new Date()) {
  const current = shanghaiDateParts(now);
  const startTimestamp = Date.UTC(
    STABLE_OPERATION_START.year,
    STABLE_OPERATION_START.month - 1,
    STABLE_OPERATION_START.day,
  );
  const currentTimestamp = Date.UTC(
    current.year,
    current.month - 1,
    current.day,
  );

  return Math.max(
    1,
    Math.floor((currentTimestamp - startTimestamp) / 86_400_000) + 1,
  );
}

export const stableOperationStartLabel = "2024.06.04";
