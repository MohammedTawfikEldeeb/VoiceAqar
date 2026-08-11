import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { env } from '../config/env.js';
import { bookAppointment, findAvailableSlots, isSlotAvailable } from '../infrastructure/calendar/google_calendar.js';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const checkSlotsTool = tool(
  async ({ date }) => {
    try {
      const slots = await findAvailableSlots(date || todayStr(), 7, env.CALENDAR_SLOTS_PER_OFFER * 3);
      if (slots.length === 0) {
        return 'No available slots in the next 7 days for the requested date.';
      }
      return slots
        .map(
          (s) => `${s.date} from ${s.time} to ${s.endTime}`
        )
        .join(', ');
    } catch (error: any) {
      console.error('❌ Error checking calendar availability:', error);
      return `Failed to check availability: ${error.message || String(error)}`;
    }
  },
  {
    name: 'check_calendar_slots',
    description:
      'Check the company calendar for available appointment slots. Use this BEFORE booking an appointment whenever you need to offer available meeting times to the user.',
    schema: z.object({
      date: z.string().optional().describe('Optional target date in YYYY-MM-DD format. If omitted, checks from today.'),
    }),
  }
);

export const bookAppointmentTool = tool(
  async ({ date, time, userName, userPhone, propertyDetails }) => {
    try {
      // 1. Verify the slot is still available before booking
      const available = await isSlotAvailable(date, time, env.CALENDAR_APPOINTMENT_DURATION_MIN);
      if (!available) {
        const alternatives = await findAvailableSlots(date, 7, env.CALENDAR_SLOTS_PER_OFFER);
        const altText = alternatives.length
          ? ` Available alternatives: ${alternatives.map((a) => `${a.date} at ${a.time}`).join(', ')}`
          : ' No alternatives found in the next 7 days.';
        return `The requested time ${date} at ${time} is already booked.${altText}`;
      }

      // 2. Book it
      const result = await bookAppointment({
        date,
        time,
        summary: `Meeting with ${userName || 'Client'} - ${propertyDetails || 'Property viewing'}`,
        description: `Phone: ${userPhone || 'N/A'}\nProperty: ${propertyDetails || 'N/A'}`,
        attendeeName: userName,
        attendeePhone: userPhone,
      });

      if (result.confirmed) {
        return `Appointment confirmed! ${result.message} Meeting: ${result.summary} (${result.start})`;
      }
      return `Booking failed: ${result.message}`;
    } catch (error: any) {
      console.error('❌ Error booking appointment:', error);
      return `Failed to book appointment: ${error.message || String(error)}`;
    }
  },
  {
    name: 'book_appointment',
    description:
      'Book an appointment/meeting in the company Google Calendar for a client. Verifies the slot is available first. Use this when the user confirms they want to book a specific date and time.',
    schema: z.object({
      date: z.string().describe('The appointment date in YYYY-MM-DD format.'),
      time: z.string().describe('The appointment start time in HH:MM 24h format (e.g. 11:00).'),
      userName: z.string().optional().describe('The client name if known.'),
      userPhone: z.string().optional().describe('The client phone number if known.'),
      propertyDetails: z.string().optional().describe('Short description of the property or reason for the meeting, e.g. which property the user is interested in.'),
    }),
  }
);

export default bookAppointmentTool;