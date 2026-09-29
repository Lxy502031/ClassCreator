import { getRequestOrigin, isRecord, jsonResponse } from "../_shared/lesson-http.ts";

type Booking = {
  booking_id: string;
  class_title: string;
  slot_start: string;
  duration_minutes: number;
  already_booked: boolean;
  email_status: "pending" | "sent" | "failed";
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function isBooking(value: unknown): value is Booking {
  return isRecord(value)
    && typeof value.booking_id === "string"
    && typeof value.class_title === "string"
    && typeof value.slot_start === "string"
    && typeof value.duration_minutes === "number"
    && typeof value.already_booked === "boolean"
    && (value.email_status === "pending" || value.email_status === "sent" || value.email_status === "failed");
}

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  };
  return value.replace(/[&<>"']/g, character => replacements[character] || character);
}

function formatSingaporeTime(value: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(value));
}

Deno.serve(async request => {
  const { origin, productionOrigin, allowedOrigin } = getRequestOrigin(request);
  const lessonSiteUrl = Deno.env.get("LESSON_SITE_URL");
  const lessonSiteOrigin = lessonSiteUrl ? new URL(lessonSiteUrl).origin : null;
  const requestOriginAllowed = allowedOrigin || origin === lessonSiteOrigin;
  const respond = (status: number, body: Record<string, unknown>) =>
    jsonResponse(status, body, requestOriginAllowed ? origin : null, productionOrigin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Lesson booking is missing required Supabase configuration.");
    return respond(500, { error: "Lesson booking is not configured yet." });
  }
  if (request.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin && requestOriginAllowed ? origin : productionOrigin || "",
      "access-control-allow-headers": "authorization, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin"
    }
  });
  if (!origin || !requestOriginAllowed) {
    return jsonResponse(403, { error: "This booking page origin is not allowed." }, null, productionOrigin);
  }
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 10_000) return respond(413, { error: "The booking request is too large." });
    payload = JSON.parse(body);
  } catch {
    return respond(400, { error: "Enter your details and choose a lesson time." });
  }
  if (!isRecord(payload)) return respond(400, { error: "Enter your details and choose a lesson time." });
  if (payload.website !== undefined && payload.website !== "") return respond(400, { error: "Invalid booking request." });
  if (
    !validText(payload.name, 100)
    || !validText(payload.email, 320)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())
    || !validText(payload.phone, 24)
    || !/^\+?[0-9][0-9 ()-]{6,22}$/.test(payload.phone.trim())
    || typeof payload.slotStart !== "string"
    || Number.isNaN(Date.parse(payload.slotStart))
    || typeof payload.requestId !== "string"
    || !UUID_PATTERN.test(payload.requestId)
  ) {
    return respond(400, { error: "Check your name, email, phone number, and selected lesson time." });
  }

  let bookingResponse: Response;
  try {
    bookingResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/create_lesson_booking`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        p_student_name: payload.name.trim(),
        p_email: payload.email.trim().toLowerCase(),
        p_phone: payload.phone.trim(),
        p_slot_start: payload.slotStart,
        p_request_id: payload.requestId
      })
    });
  } catch (error) {
    console.error("Could not create lesson booking.", error);
    return respond(502, { error: "We couldn’t reserve that lesson time. Please try again." });
  }

  if (!bookingResponse.ok) {
    const errorText = await bookingResponse.text();
    console.error("Lesson booking RPC failed.", bookingResponse.status, errorText.slice(0, 500));
    const userErrors = new Set([
      "Enter a valid name, email, phone number, and lesson time",
      "Lesson bookings are not available right now",
      "This booking request is invalid",
      "You have reached the daily booking limit. Please contact us if you need help",
      "That lesson time is no longer available",
      "That lesson time overlaps with a booking. Please choose another available time",
      "That lesson session is full. Please choose another available time",
      "That lesson time was just booked. Please choose another available time",
      "That booking request was cancelled. Please choose a new time"
    ]);
    let message = "We couldn’t reserve that lesson time. Please choose another time and try again.";
    try {
      const errorBody: unknown = JSON.parse(errorText);
      if (isRecord(errorBody) && typeof errorBody.message === "string" && userErrors.has(errorBody.message)) {
        message = errorBody.message;
      }
    } catch (error) {
      console.error("Could not parse lesson booking error response.", error);
    }
    return respond(409, { error: message });
  }

  let rows: unknown;
  try {
    rows = await bookingResponse.json();
  } catch (error) {
    console.error("Could not parse lesson booking RPC response.", error);
    return respond(502, { error: "The lesson time may be reserved, but we couldn’t confirm it. Please contact us before submitting another booking." });
  }
  if (!Array.isArray(rows) || !isBooking(rows[0])) {
    console.error("Lesson booking RPC returned an invalid response.");
    return respond(502, { error: "The lesson time may be reserved, but we couldn’t confirm it. Please contact us before submitting another booking." });
  }
  const booking = rows[0];
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("LESSON_FROM_EMAIL");
  const testRecipient = Deno.env.get("LESSON_TEST_RECIPIENT")?.trim();
  const testSender = fromEmail === "onboarding@resend.dev";
  const emailTestMode = Boolean(testRecipient) || testSender;
  let emailSent = false;
  const emailConfigured = Boolean(apiKey && fromEmail && (!testSender || testRecipient));

  if (booking.already_booked) {
    emailSent = booking.email_status === "sent";
  } else if (apiKey && fromEmail && emailConfigured) {
    const when = formatSingaporeTime(booking.slot_start);
    const html = [
      `<p>Hi ${escapeHtml(payload.name.trim())},</p>`,
      `<p>Your ${escapeHtml(booking.class_title)} is reserved.</p>`,
      `<p><strong>When:</strong> ${escapeHtml(when)} (Singapore time)<br>`,
      `<strong>Duration:</strong> ${booking.duration_minutes} minutes</p>`,
      `<p>We’ll contact you at ${escapeHtml(payload.phone.trim())} if there are any updates.</p>`,
      `<p>We look forward to creating with you!</p>`
    ].join("");
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [testRecipient || payload.email.trim().toLowerCase()],
          subject: `Lesson booking confirmed: ${booking.class_title}`,
          html
        })
      });
      emailSent = response.ok;
      if (!response.ok) {
        console.error("Lesson booking confirmation email failed.", response.status, (await response.text()).slice(0, 500));
      }
    } catch (error) {
      console.error("Could not send lesson booking confirmation email.", error);
    }
  }

  if (!booking.already_booked) {
    const emailStatus = emailTestMode ? "pending" : emailSent ? "sent" : emailConfigured ? "failed" : "pending";
    try {
      const updateResponse = await fetch(
        `${supabaseUrl}/rest/v1/lesson_bookings?id=eq.${encodeURIComponent(booking.booking_id)}`,
        {
          method: "PATCH",
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            "content-type": "application/json",
            prefer: "return=minimal"
          },
          body: JSON.stringify({ email_status: emailStatus })
        }
      );
      if (!updateResponse.ok) {
        console.error("Could not record lesson booking email status.", updateResponse.status);
      }
    } catch (error) {
      console.error("Could not update lesson booking email status.", error);
    }
  }

  return respond(200, {
    booked: true,
    bookingId: booking.booking_id,
    classTitle: booking.class_title,
    slotStart: booking.slot_start,
    durationMinutes: booking.duration_minutes,
    emailSent,
    emailConfigured,
    emailTestMode
  });
});
