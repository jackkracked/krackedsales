import { NextRequest, NextResponse } from "next/server";
import { calendarClient, isGoogleConfigured } from "@/lib/google/client";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

interface BookRequestBody {
  contactId: string;
  contactName: string;
  repEmail: string;
  callType: "meet" | "dialer";
  startTime: string;
  endTime: string;
  notes?: string;
  ghlCalendarId: string;
}

interface GhlAppointmentResponse {
  id: string;
  [key: string]: unknown;
}

interface GhlConversationSearchResponse {
  conversations: { id: string; [key: string]: unknown }[];
}

interface GhlMessageResponse {
  messageId: string;
  [key: string]: unknown;
}

interface GhlContactResponse {
  contact?: { email?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** Generate a simple RFC 4122 v4 UUID without external dependencies. */
function randomUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function POST(req: NextRequest) {
  let body: BookRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contactId, contactName, repEmail, callType, startTime, endTime, notes, ghlCalendarId } =
    body;

  if (!contactId || !contactName || !repEmail || !callType || !startTime || !endTime || !ghlCalendarId) {
    return NextResponse.json(
      { error: "Missing required fields: contactId, contactName, repEmail, callType, startTime, endTime, ghlCalendarId" },
      { status: 400 }
    );
  }

  const locId = locationId();

  // ── Step 1: Create GHL appointment ──────────────────────────────────────
  let ghlAppointmentId: string;
  try {
    const appt = await ghl.post<GhlAppointmentResponse>(
      "/calendars/events/appointments",
      {
        locationId: locId,
        calendarId: ghlCalendarId,
        contactId,
        title: `Call with ${contactName}`,
        startTime,
        endTime,
        ...(notes ? { notes } : {}),
      }
    );
    ghlAppointmentId = appt.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[calendar/book] GHL appointment creation failed:", message);
    return NextResponse.json(
      { error: `Failed to create GHL appointment: ${message}` },
      { status: 502 }
    );
  }

  // ── Step 2: Create Google Calendar event (meet only) ────────────────────
  let googleEventId: string | null = null;
  let meetLink: string | null = null;

  if (callType === "meet") {
    if (!isGoogleConfigured()) {
      console.warn("[calendar/book] Google not configured — skipping Meet event creation");
    } else {
      try {
        // Fetch contact email so we can add them as an attendee
        let contactEmail: string | undefined;
        try {
          const contactRes = await ghl.get<GhlContactResponse>(
            `/contacts/${contactId}`
          );
          contactEmail = contactRes.contact?.email;
        } catch (err) {
          console.warn("[calendar/book] Could not fetch contact email:", err);
        }

        const cal = await calendarClient(repEmail);
        const event = await cal.events.insert({
          calendarId: "primary",
          conferenceDataVersion: 1,
          requestBody: {
            summary: `Call with ${contactName}`,
            description: notes ?? "",
            start: { dateTime: startTime },
            end: { dateTime: endTime },
            conferenceData: {
              createRequest: { requestId: randomUUID() },
            },
            ...(contactEmail
              ? { attendees: [{ email: contactEmail }] }
              : {}),
          },
        });

        googleEventId = event.data.id ?? null;
        meetLink = event.data.hangoutLink ?? null;
      } catch (err) {
        // Google step failed after GHL succeeded — log and continue
        const message = err instanceof Error ? err.message : String(err);
        console.error("[calendar/book] Google Calendar event creation failed:", message);
      }
    }
  }

  // ── Step 3: Send GHL booking confirmation message ───────────────────────
  try {
    // Find the most recent active conversation for this contact
    const searchRes = await ghl.get<GhlConversationSearchResponse>(
      `/conversations/search?locationId=${locId}&contactId=${contactId}`
    );

    const conversation = searchRes.conversations?.[0];
    if (conversation?.id) {
      const confirmationText = meetLink
        ? `Hi ${contactName}, your call has been booked! Join via Google Meet: ${meetLink}`
        : `Hi ${contactName}, your call has been booked for ${startTime}. We'll be in touch shortly!`;

      await ghl.post<GhlMessageResponse>("/conversations/messages", {
        type: "SMS",
        conversationId: conversation.id,
        message: confirmationText,
      });
    } else {
      console.warn("[calendar/book] No conversation found for contact, skipping confirmation message");
    }
  } catch (err) {
    // Non-fatal — appointment was already created
    const message = err instanceof Error ? err.message : String(err);
    console.error("[calendar/book] Failed to send confirmation message:", message);
  }

  return NextResponse.json({
    ghlAppointmentId,
    googleEventId,
    meetLink,
  });
}
