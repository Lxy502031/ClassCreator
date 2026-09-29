const DAILY_SEND_LIMIT = 90;

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents);
    const expectedToken = PropertiesService.getScriptProperties().getProperty("BOOKING_EMAIL_TOKEN");
    if (!expectedToken || !constantTimeEqual(payload.token, expectedToken)) {
      return jsonResponse({ sent: false, error: "Unauthorized request." });
    }

    if (
      !validText(payload.to, 320)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.to)
      || !validText(payload.name, 100)
      || !validText(payload.classTitle, 120)
      || !validText(payload.when, 100)
      || !Number.isInteger(payload.durationMinutes)
      || payload.durationMinutes < 15
      || payload.durationMinutes > 240
      || !validText(payload.phone, 24)
    ) {
      return jsonResponse({ sent: false, error: "Invalid confirmation details." });
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      return jsonResponse({ sent: false, error: "Email service is busy. Try again shortly." });
    }
    try {
      const properties = PropertiesService.getScriptProperties();
      const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
      const counterKey = `daily-send-count-${today}`;
      const sentToday = Number(properties.getProperty(counterKey) || "0");
      if (sentToday >= DAILY_SEND_LIMIT || MailApp.getRemainingDailyQuota() < 1) {
        return jsonResponse({ sent: false, error: "The daily email sending limit has been reached." });
      }
      properties.setProperty(counterKey, String(sentToday + 1));
    } finally {
      lock.releaseLock();
    }

    const safeName = escapeHtml(payload.name.trim());
    const safeTitle = escapeHtml(payload.classTitle.trim());
    const safeWhen = escapeHtml(payload.when.trim());
    const safePhone = escapeHtml(payload.phone.trim());
    const subject = `Lesson booking confirmed: ${payload.classTitle.trim()}`;
    const body = [
      `Hi ${payload.name.trim()},`,
      "",
      `Your ${payload.classTitle.trim()} is reserved.`,
      `When: ${payload.when.trim()} (Singapore time)`,
      `Duration: ${payload.durationMinutes} minutes`,
      "",
      `We’ll contact you at ${payload.phone.trim()} if there are any updates.`,
      "We look forward to creating with you!"
    ].join("\n");
    const htmlBody = [
      `<p>Hi ${safeName},</p>`,
      `<p>Your ${safeTitle} is reserved.</p>`,
      `<p><strong>When:</strong> ${safeWhen} (Singapore time)<br>`,
      `<strong>Duration:</strong> ${payload.durationMinutes} minutes</p>`,
      `<p>We’ll contact you at ${safePhone} if there are any updates.</p>`,
      "<p>We look forward to creating with you!</p>"
    ].join("");

    MailApp.sendEmail({
      to: payload.to.trim().toLowerCase(),
      subject,
      body,
      htmlBody,
      name: "Qingqing’s Knitting Cottage"
    });
    return jsonResponse({ sent: true });
  } catch (error) {
    console.error("Lesson confirmation email failed.", error);
    return jsonResponse({ sent: false, error: "Email could not be sent." });
  }
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function constantTimeEqual(actual, expected) {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
