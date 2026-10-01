// Helpers de data/hora com fuso do estabelecimento, sem dependencias externas.
// Datas de calendario trafegam como "YYYY-MM-DD" e horarios como "HH:mm".

const DEFAULT_TZ = "America/Sao_Paulo";
const formatterCache = new Map();

function getFormatter(tz) {
  if (!formatterCache.has(tz)) {
    formatterCache.set(
      tz,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
      })
    );
  }
  return formatterCache.get(tz);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedParts(date, tz = DEFAULT_TZ) {
  const parts = {};
  for (const part of getFormatter(tz).formatToParts(new Date(date))) parts[part.type] = part.value;
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, "0")}:${parts.minute}`,
    minutesOfDay: hour * 60 + Number(parts.minute),
  };
}

function tzOffsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const d = new Date(date);
  return asUtc - (d.getTime() - d.getUTCMilliseconds());
}

// Converte data+hora local do estabelecimento para Date (UTC).
function zonedToUtc(dateStr, timeStr = "00:00", tz = DEFAULT_TZ) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [hh, mm] = String(timeStr).split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  let result = guess - tzOffsetMs(guess, tz);
  // segunda passada corrige transicoes de horario de verao
  result = guess - tzOffsetMs(result, tz);
  return new Date(result);
}

function timeToMinutes(timeStr) {
  const [hh, mm] = String(timeStr || "0:0").split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

function minutesToTime(total) {
  const safe = Math.max(0, Math.round(total));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function isDateStr(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isTimeStr(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function todayStr(tz = DEFAULT_TZ) {
  return zonedParts(new Date(), tz).date;
}

function dayRangeUtc(dateStr, tz = DEFAULT_TZ) {
  return { start: zonedToUtc(dateStr, "00:00", tz), end: zonedToUtc(addDays(dateStr, 1), "00:00", tz) };
}

function rangeUtc(fromStr, toStr, tz = DEFAULT_TZ) {
  // intervalo [from 00:00, to+1 00:00)
  return { start: zonedToUtc(fromStr, "00:00", tz), end: zonedToUtc(addDays(toStr, 1), "00:00", tz) };
}

function daysBetween(fromStr, toStr) {
  const days = [];
  let cursor = fromStr;
  let guard = 0;
  while (cursor <= toStr && guard < 1000) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

function monthRange(dateStr) {
  const [y, m] = String(dateStr).split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60000);
}

function formatDateBr(date, tz = DEFAULT_TZ) {
  const p = zonedParts(date, tz);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`;
}

function formatTimeBr(date, tz = DEFAULT_TZ) {
  return zonedParts(date, tz).time;
}

const WEEKDAY_NAMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

// Parametros de periodo padrao (?de=YYYY-MM-DD&ate=YYYY-MM-DD). Sem parametros: mes atual.
function parsePeriod(query = {}, tz = DEFAULT_TZ) {
  const today = todayStr(tz);
  const month = monthRange(today);
  const from = isDateStr(query.de) ? query.de : month.from;
  const to = isDateStr(query.ate) ? query.ate : month.to;
  return { from, to, ...rangeUtc(from, to, tz) };
}

module.exports = {
  DEFAULT_TZ,
  WEEKDAY_NAMES,
  zonedParts,
  zonedToUtc,
  timeToMinutes,
  minutesToTime,
  isDateStr,
  isTimeStr,
  addDays,
  addMinutes,
  weekdayOf,
  todayStr,
  dayRangeUtc,
  rangeUtc,
  daysBetween,
  monthRange,
  formatDateBr,
  formatTimeBr,
  parsePeriod,
};
