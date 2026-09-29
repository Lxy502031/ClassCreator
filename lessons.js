document.addEventListener("DOMContentLoaded", async () => {
  const setup = window.CLASSCREATOR_SUPABASE_CONFIG;
  const loading = document.getElementById("lessons-loading");
  const bookingSection = document.getElementById("lessons-booking");
  const unavailable = document.getElementById("lessons-unavailable");
  const calendar = document.getElementById("lesson-calendar");
  const timesContainer = document.getElementById("lesson-times");
  const calendarMessage = document.getElementById("lesson-calendar-message");
  const status = document.getElementById("lesson-booking-status");
  const submitButton = document.getElementById("lesson-booking-submit");
  const selectionSummary = document.getElementById("lesson-selection-summary");
  const monthLabel = document.getElementById("lesson-month-label");
  const previousButton = document.getElementById("lesson-month-previous");
  const nextButton = document.getElementById("lesson-month-next");
  const timezone = "Asia/Singapore";
  let client;
  let month;
  let earliestMonth;
  let latestDate;
  let slotsByDate = new Map();
  let selectedDate = "";
  let selectedSlot = null;
  let bookingRequestId = null;

  function dateInSingapore(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function parseDate(value) {
    const [year, monthValue, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, monthValue - 1, day));
  }

  function dateString(date) {
    return date.toISOString().slice(0, 10);
  }

  function formatFullDate(value) {
    return new Intl.DateTimeFormat("en-SG", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date(`${value}T12:00:00+08:00`));
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat("en-SG", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function setStatus(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = !message;
  }

  function setSelection(slot) {
    if (slot !== selectedSlot) bookingRequestId = slot ? crypto.randomUUID() : null;
    selectedSlot = slot;
    submitButton.disabled = !slot;
    selectionSummary.textContent = slot
      ? `${formatFullDate(selectedDate)} · ${formatTime(slot)} Singapore time`
      : "Choose an available date and time to continue.";
    timesContainer.querySelectorAll("button").forEach(button => {
      button.classList.toggle("selected", button.dataset.slot === slot);
      button.setAttribute("aria-pressed", String(button.dataset.slot === slot));
    });
  }

  function renderTimes() {
    timesContainer.replaceChildren();
    const times = slotsByDate.get(selectedDate) || [];
    if (!selectedDate || !times.length) {
      const message = document.createElement("p");
      message.className = "lessons-muted";
      message.textContent = selectedDate ? "No times remain on this date. Choose another day." : "Select a date with an available lesson.";
      timesContainer.append(message);
      setSelection(null);
      return;
    }
    times.forEach(slot => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lesson-time-option";
      button.textContent = `${formatTime(slot.slot_start)} · ${slot.spots_remaining} ${slot.spots_remaining === 1 ? "spot" : "spots"} left`;
      button.dataset.slot = slot.slot_start;
      button.setAttribute("aria-pressed", String(slot.slot_start === selectedSlot));
      button.classList.toggle("selected", slot.slot_start === selectedSlot);
      button.addEventListener("click", () => setSelection(slot.slot_start));
      timesContainer.append(button);
    });
  }

  function renderCalendar() {
    calendar.replaceChildren();
    const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7;
    monthLabel.textContent = new Intl.DateTimeFormat("en-SG", {
      timeZone: timezone,
      month: "long",
      year: "numeric"
    }).format(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 15, 12)));
    previousButton.disabled = month <= earliestMonth;
    nextButton.disabled = dateString(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1))) > latestDate.slice(0, 7);

    ["M", "T", "W", "T", "F", "S", "S"].forEach((label, index) => {
      const weekday = document.createElement("span");
      weekday.className = "lesson-weekday";
      weekday.textContent = label;
      weekday.setAttribute("aria-label", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index]);
      calendar.append(weekday);
    });
    for (let index = 0; index < offset; index += 1) {
      const spacer = document.createElement("span");
      spacer.className = "lesson-calendar-spacer";
      calendar.append(spacer);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const value = dateString(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day)));
      const available = (slotsByDate.get(value) || []).length > 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lesson-calendar-day";
      button.textContent = String(day);
      button.disabled = value < dateInSingapore() || value > latestDate || !available;
      button.setAttribute("aria-label", `${formatFullDate(value)}${available ? ", available" : ", unavailable"}`);
      button.setAttribute("aria-pressed", String(value === selectedDate));
      button.classList.toggle("selected", value === selectedDate);
      button.classList.toggle("has-availability", available && !button.disabled);
      button.addEventListener("click", () => {
        selectedDate = value;
        setSelection(null);
        renderCalendar();
        renderTimes();
      });
      calendar.append(button);
    }
  }

  async function loadMonth() {
    loading.textContent = "Loading available lesson times…";
    calendarMessage.textContent = "";
    const firstDate = dateString(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)));
    const lastDate = dateString(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)));
    try {
      const { data, error } = await client.rpc("get_lesson_available_slots", {
        p_start_date: firstDate < dateInSingapore() ? dateInSingapore() : firstDate,
        p_end_date: lastDate > latestDate ? latestDate : lastDate
      });
      if (error) throw error;
      slotsByDate = new Map();
      (data || []).forEach(row => {
        if (typeof row.slot_start !== "string") return;
        const day = dateInSingapore(new Date(row.slot_start));
        const slots = slotsByDate.get(day) || [];
        slots.push({
          slot_start: row.slot_start,
          spots_remaining: typeof row.spots_remaining === "number" ? row.spots_remaining : 1
        });
        slotsByDate.set(day, slots);
      });
      if (!selectedDate || !(slotsByDate.get(selectedDate) || []).length) {
        selectedDate = [...slotsByDate.keys()].sort()[0] || "";
      }
      if (selectedSlot && !(slotsByDate.get(selectedDate) || []).some(slot => slot.slot_start === selectedSlot)) {
        setSelection(null);
      }
      renderCalendar();
      renderTimes();
      calendarMessage.textContent = slotsByDate.size
        ? "All times shown are in Singapore time (SGT)."
        : "There are no available lesson times this month. Try another month.";
    } catch (error) {
      console.error("Could not load lesson availability.", error);
      calendarMessage.textContent = `Lesson availability could not be loaded: ${error.message || "Please try again."}`;
    } finally {
      loading.hidden = true;
    }
  }

  if (!setup?.url || !setup?.anonKey || !window.supabase?.createClient) {
    loading.hidden = true;
    unavailable.hidden = false;
    unavailable.querySelector("p").textContent = "Bookings aren’t configured yet. Please contact us to ask about lessons.";
    return;
  }

  client = window.supabase.createClient(setup.url, setup.anonKey);
  try {
    const { data, error } = await client.from("lesson_settings")
      .select("class_title,description,weekdays,start_time,end_time,duration_minutes,booking_horizon_days,is_active")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Lesson schedule settings are not available.");
    document.getElementById("lesson-title").textContent = data.class_title;
    document.getElementById("lesson-description").textContent = data.description;
    document.getElementById("lesson-duration").textContent =
      `${data.duration_minutes}-minute sessions · Singapore time · Reserve a slot for free`;
    if (!data.is_active) {
      loading.hidden = true;
      unavailable.hidden = false;
      return;
    }

    const today = dateInSingapore();
    earliestMonth = parseDate(today);
    month = new Date(Date.UTC(earliestMonth.getUTCFullYear(), earliestMonth.getUTCMonth(), 1));
    latestDate = dateString(new Date(parseDate(today).getTime() + data.booking_horizon_days * 86400000));
    bookingSection.hidden = false;
    await loadMonth();

    previousButton.addEventListener("click", () => {
      month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));
      selectedDate = "";
      setSelection(null);
      void loadMonth();
    });
    nextButton.addEventListener("click", () => {
      month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
      selectedDate = "";
      setSelection(null);
      void loadMonth();
    });
  } catch (error) {
    console.error("Could not load lesson settings.", error);
    loading.hidden = true;
    unavailable.hidden = false;
    unavailable.querySelector("p").textContent = `Lesson bookings could not be loaded: ${error.message || "Please contact us for help."}`;
    return;
  }

  document.getElementById("lesson-booking-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!selectedSlot) {
      setStatus("Choose an available date and time before reserving.", "error");
      return;
    }
    const config = window.CLASSCREATOR_SUPABASE_CONFIG;
    const formData = new FormData(form);
    submitButton.disabled = true;
    submitButton.textContent = "Reserving…";
    setStatus("");
    try {
      const response = await fetch(`${config.url.replace(/\/$/, "")}/functions/v1/lesson-booking`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: config.anonKey },
        body: JSON.stringify({
          name: String(formData.get("name") || "").trim(),
          email: String(formData.get("email") || "").trim(),
          phone: String(formData.get("phone") || "").trim(),
          website: String(formData.get("website") || ""),
          slotStart: selectedSlot,
          requestId: bookingRequestId
        })
      });
      const result = await response.json();
      if (!response.ok || result.booked !== true) {
        throw new Error(result.error || "We couldn’t reserve that lesson time. Please try again.");
      }
      const updatedSlots = (slotsByDate.get(selectedDate) || [])
        .map(slot => slot.slot_start === selectedSlot
          ? { ...slot, spots_remaining: slot.spots_remaining - 1 }
          : slot)
        .filter(slot => slot.spots_remaining > 0);
      slotsByDate.set(selectedDate, updatedSlots);
      setSelection(null);
      renderCalendar();
      renderTimes();
      if (result.emailTestMode && result.emailSent) {
        setStatus("Your lesson is reserved. A test confirmation was sent to the configured test inbox; no email was sent to the student.", "warning");
      } else if (result.emailTestMode) {
        setStatus("Your lesson is reserved, but the test confirmation could not be delivered. Please check the email setup.", "warning");
      } else if (result.emailSent) {
        setStatus("Your lesson is reserved and a confirmation email is on its way. We’ll contact you by phone if there are any updates.", "success");
      } else if (result.emailConfigured) {
        setStatus("Your lesson is reserved, but the confirmation email could not be sent. Please contact us so we can confirm the details.", "warning");
      } else {
        setStatus("Your lesson is reserved. Email confirmation isn’t configured yet; please contact us to confirm the details.", "warning");
      }
      form.reset();
    } catch (error) {
      console.error("Could not complete lesson booking.", error);
      setStatus(error.message || "We couldn’t reserve that lesson time. Please try again.", "error");
      await loadMonth();
    } finally {
      submitButton.textContent = "Reserve my lesson";
      submitButton.disabled = !selectedSlot;
    }
  });
});
