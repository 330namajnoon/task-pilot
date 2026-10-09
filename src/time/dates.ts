const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in the machine's local time zone (a work day is a local day). */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseLocalDate(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Invalid date "${day}", expected YYYY-MM-DD.`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function addDays(day: string, delta: number): string {
  const date = parseLocalDate(day);
  date.setDate(date.getDate() + delta);
  return localDate(date);
}

/** Every day from `from` to `to`, both included. */
export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Monday of the week that contains `day`. */
export function startOfWeek(day: string): string {
  const offset = (parseLocalDate(day).getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(Math.abs(rounded) / 60);
  const m = Math.abs(rounded) % 60;
  const sign = rounded < 0 ? "-" : "";
  return h ? `${sign}${h}h ${pad(m)}m` : `${sign}${m}m`;
}
