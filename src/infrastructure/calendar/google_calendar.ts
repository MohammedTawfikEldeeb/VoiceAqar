import { google, calendar_v3 } from 'googleapis';
import { env } from '../../config/env.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Lazy-built authenticated Google Calendar client using a service account.
 * Requires GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL + GOOGLE_CALENDAR_PRIVATE_KEY
 * and the calendar shared with that service account email.
 */
let calendarClient: calendar_v3.Calendar | null = null;
let notConfiguredMessage = '';

function buildClient(): calendar_v3.Calendar {
  if (!env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_CALENDAR_PRIVATE_KEY) {
    notConfiguredMessage =
      'Google Calendar is not configured. Missing GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL or GOOGLE_CALENDAR_PRIVATE_KEY.';
    throw new Error(notConfiguredMessage);
  }

  if (!calendarClient) {
    const auth = new google.auth.JWT({
      email: env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
      key: env.GOOGLE_CALENDAR_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: SCOPES,
    });
    calendarClient = google.calendar({ version: 'v3', auth });
  }
  return calendarClient;
}

function getCalendarId(): string {
  return env.GOOGLE_CALENDAR_ID || 'primary';
}

/* eslint-disable no-inner-declarations */

/**
 * Helper to append an amount of minutes to a "HH:MM" time string.
 */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hours = Math.floor(total / 60) % 24;
  const mins = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Compute the UTC offset (in minutes) of `timeZone` at the instant described
 * by a naive local datetime `date` (YYYY-MM-DD) + `time` (HH:MM).
 */
function tzOffsetMinutes(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  // Treat the naive local datetime as if it were UTC to get a probe instant.
  const probeUtcMs = Date.UTC(y, m - 1, d, h, min, 0, 0);
  const probe = new Date(probeUtcMs);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(probe)) parts[p.type] = p.value;

  const localAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return (localAsUtcMs - probeUtcMs) / 60000;
}

/**
 * Convert a "YYYY-MM-DD" date + "HH:MM" time into an RFC3339 dateTime string
 * with the calendar timezone's UTC offset (e.g. 2026-08-11T10:00:00+02:00).
 * Required by the Calendar freebusy/events APIs.
 */
function toDateTimeString(date: string, time: string): string {
  const offsetMin = tzOffsetMinutes(date, time, env.CALENDAR_TIMEZONE);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${oh}:${om}`;
}

/**
 * Check whether a specific slot is free in the calendar.
 */
export async function isSlotAvailable(date: string, time: string, durationMin: number): Promise<boolean> {
  const calendar = buildClient();
  const calendarId = getCalendarId();
  const start = toDateTimeString(date, time);
  const end = toDateTimeString(date, addMinutes(time, durationMin));

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: start,
      timeMax: end,
      timeZone: env.CALENDAR_TIMEZONE,
      items: [{ id: calendarId }],
    },
  });

  const busy = response.data.calendars?.[calendarId]?.busy || [];
  return busy.length === 0;
}

export interface AvailableSlot {
  date: string;
  time: string;
  endTime: string;
}

/**
 * Generate the next available appointment slots across the following days.
 * Walks the configured working hours in CALENDAR_APPOINTMENT_DURATION_MIN
 * increments and filters out slots already occupied in the calendar.
 */
export async function findAvailableSlots(fromDate: string, daysAhead: number, limit: number): Promise<AvailableSlot[]> {
  const calendar = buildClient();
  const calendarId = getCalendarId();
  const durationMin = env.CALENDAR_APPOINTMENT_DURATION_MIN;

  // Build one big freebusy window from the requested day to daysAhead
  const windowStart = toDateTimeString(fromDate, '00:00');
  const lastDate = new Date(`${fromDate}T00:00:00`);
  lastDate.setDate(lastDate.getDate() + daysAhead);
  const windowEndDate = lastDate.toISOString().slice(0, 10);
  const windowEnd = toDateTimeString(windowEndDate, '23:59');

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: windowStart,
      timeMax: windowEnd,
      timeZone: env.CALENDAR_TIMEZONE,
      items: [{ id: calendarId }],
    },
  });

  const busy = response.data.calendars?.[calendarId]?.busy || [];

  const results: AvailableSlot[] = [];
  let cursor = new Date(`${fromDate}T00:00:00`);

  while (results.length < limit) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (dateStr > windowEndDate) break;

    const dayStart = `${dateStr}T${env.CALENDAR_WORK_START}`;
    const dayEnd = `${dateStr}T${env.CALENDAR_WORK_END}`;

    let slotStart = dayStart;
    while (slotStart < dayEnd && results.length < limit) {
      const slotTime = slotStart.slice(11, 16);
      const slotEnd = toDateTimeString(dateStr, addMinutes(slotTime, durationMin));

      const clash = busy.some((b) => {
        const bStart = (b.start || '').slice(0, 16);
        const bEnd = (b.end || '').slice(0, 16);
        const s = slotStart.slice(0, 16);
        const e = slotEnd.slice(0, 16);
        return s < bEnd && e > bStart;
      });

      if (!clash) {
        results.push({ date: dateStr, time: slotTime, endTime: addMinutes(slotTime, durationMin) });
      }

      slotStart = slotEnd;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return results;
}

export interface BookedAppointment {
  confirmed: boolean;
  message: string;
  summary?: string;
  start?: string;
  end?: string;
  htmlLink?: string;
}

/**
 * Book an appointment in the company calendar. First verifies the slot is
 * still free, then creates the event. Concurrency-safe enough for a single
 * office calendar (double-booking race is guarded by the availability check).
 */
export async function bookAppointment(params: {
  date: string;
  time: string;
  summary: string;
  description?: string;
  attendeeName?: string;
  attendeePhone?: string;
  durationMin?: number;
}): Promise<BookedAppointment> {
  const calendar = buildClient();
  const calendarId = getCalendarId();
  const durationMin = params.durationMin || env.CALENDAR_APPOINTMENT_DURATION_MIN;

  const available = await isSlotAvailable(params.date, params.time, durationMin);
  if (!available) {
    return {
      confirmed: false,
      message: `The requested slot ${params.date} at ${params.time} is no longer available. Please pick a different time.`,
    };
  }

  const start = toDateTimeString(params.date, params.time);
  const end = toDateTimeString(params.date, addMinutes(params.time, durationMin));

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: params.summary,
      description: params.description || '',
      start: { dateTime: start, timeZone: env.CALENDAR_TIMEZONE },
      end: { dateTime: end, timeZone: env.CALENDAR_TIMEZONE },
    },
  });

  const event = response.data;
  return {
    confirmed: true,
    message: `Appointment booked successfully for ${params.date} at ${params.time}.`,
    summary: event.summary || params.summary,
    start,
    end,
    htmlLink: event.htmlLink || undefined,
  };
}