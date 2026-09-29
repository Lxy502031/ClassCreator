document.addEventListener("DOMContentLoaded", async () => {
  const config = window.CLASSCREATOR_SUPABASE_CONFIG;
  const gate = document.getElementById("admin-gate");
  const app = document.getElementById("admin-app");
  const title = document.getElementById("admin-gate-title");
  const message = document.getElementById("admin-gate-message");
  const signinForm = document.getElementById("admin-signin-form");
  const signoutButton = document.getElementById("admin-signout");
  const status = document.getElementById("admin-status");
  const settingsForm = document.getElementById("lesson-settings-form");
  const bookingsList = document.getElementById("lesson-booking-list");
  let client;

  function setStatus(text, kind = "success") {
    status.textContent = text;
    status.dataset.kind = kind;
    status.hidden = !text;
  }

  function showGate(heading, copy, allowSignin = false) {
    title.textContent = heading;
    message.textContent = copy;
    signinForm.hidden = !allowSignin;
    gate.hidden = false;
    app.hidden = true;
    signoutButton.hidden = true;
  }

  function showError(context, error) {
    console.error(context, error);
    setStatus(`${context}: ${error?.message || "Please try again."}`, "error");
  }

  if (!config?.url || !config?.anonKey || !window.supabase?.createClient) {
    showGate("Admin tools are not configured", "The Supabase project settings could not be loaded.");
    return;
  }

  client = window.supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  async function openAdmin() {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      showGate("Could not verify your session", sessionError.message, true);
      return;
    }
    if (!sessionData.session) {
      showGate("Sign in to manage lessons", "Use the verified ClassCreator administrator account.", true);
      return;
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      showGate("Could not verify your account", userError?.message || "Sign in again to continue.", true);
      return;
    }

    const user = userData.user;
    if (
      !user.email_confirmed_at
      || user.app_metadata?.role !== "admin"
    ) {
      await client.auth.signOut();
      showGate("Administrator access required", "This area is restricted to the verified ClassCreator administrator account.", true);
      return;
    }

    gate.hidden = true;
    app.hidden = false;
    signoutButton.hidden = false;
    document.getElementById("admin-identity").textContent = `Signed in as ${user.email}`;
    await loadLessons();
  }

  async function loadLessons() {
    setStatus("");
    const { data, error } = await client.from("lesson_settings")
      .select("class_title,description,weekdays,start_time,end_time,duration_minutes,booking_horizon_days,is_active")
      .eq("id", true)
      .single();
    if (error) {
      showError("Could not load lesson settings", error);
      return;
    }

    settingsForm.elements.class_title.value = data.class_title;
    settingsForm.elements.description.value = data.description;
    settingsForm.elements.start_time.value = data.start_time.slice(0, 5);
    settingsForm.elements.end_time.value = data.end_time.slice(0, 5);
    settingsForm.elements.duration_minutes.value = data.duration_minutes;
    settingsForm.elements.booking_horizon_days.value = data.booking_horizon_days;
    settingsForm.elements.is_active.checked = data.is_active;
    settingsForm.querySelectorAll('input[name="weekdays"]').forEach(input => {
      input.checked = data.weekdays.includes(Number(input.value));
    });

    const { data: bookings, error: bookingError } = await client.from("lesson_bookings")
      .select("id,student_name,email,phone,slot_start,duration_minutes,status,email_status")
      .order("slot_start", { ascending: true })
      .limit(100);
    if (bookingError) {
      showError("Could not load lesson bookings", bookingError);
      return;
    }

    const upcoming = (bookings || []).filter(booking =>
      booking.status === "booked" && new Date(booking.slot_start) >= new Date()
    );
    bookingsList.replaceChildren();
    if (!upcoming.length) {
      const empty = document.createElement("p");
      empty.className = "admin-muted";
      empty.textContent = "There are no upcoming lesson bookings.";
      bookingsList.append(empty);
      return;
    }

    upcoming.forEach(booking => {
      const record = document.createElement("article");
      record.className = "booking-record";
      const name = document.createElement("h3");
      name.textContent = booking.student_name;
      const when = document.createElement("p");
      when.textContent = `${new Intl.DateTimeFormat("en-SG", {
        timeZone: "Asia/Singapore",
        dateStyle: "full",
        timeStyle: "short"
      }).format(new Date(booking.slot_start))} SGT · ${booking.duration_minutes} minutes`;
      const contact = document.createElement("p");
      contact.textContent = `${booking.email} · ${booking.phone} · Confirmation email: ${booking.email_status}`;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel booking";
      cancel.addEventListener("click", async () => {
        if (!window.confirm(`Cancel ${booking.student_name}’s lesson booking?`)) return;
        cancel.disabled = true;
        const { data: cancelled, error: cancelError } = await client.from("lesson_bookings")
          .update({ status: "cancelled" })
          .eq("id", booking.id)
          .eq("status", "booked")
          .select("id")
          .maybeSingle();
        if (cancelError || !cancelled) {
          cancel.disabled = false;
          showError("Could not cancel lesson booking", cancelError || new Error("The booking was already changed."));
          return;
        }
        await loadLessons();
        setStatus("Lesson booking cancelled. Its time is available to book again.");
      });
      record.append(name, when, contact, cancel);
      bookingsList.append(record);
    });
  }

  signinForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!signinForm.reportValidity()) return;
    const button = signinForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const formData = new FormData(signinForm);
    const { error } = await client.auth.signInWithPassword({
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || "")
    });
    button.disabled = false;
    if (error) {
      showGate("Sign in failed", error.message, true);
      return;
    }
    signinForm.reset();
    await openAdmin();
  });

  settingsForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!settingsForm.reportValidity()) return;
    const weekdays = [...settingsForm.querySelectorAll('input[name="weekdays"]:checked')]
      .map(input => Number(input.value));
    if (!weekdays.length) {
      setStatus("Choose at least one available weekday.", "error");
      return;
    }

    const values = {
      class_title: settingsForm.elements.class_title.value.trim(),
      description: settingsForm.elements.description.value.trim(),
      weekdays,
      start_time: settingsForm.elements.start_time.value,
      end_time: settingsForm.elements.end_time.value,
      duration_minutes: Number(settingsForm.elements.duration_minutes.value),
      booking_horizon_days: Number(settingsForm.elements.booking_horizon_days.value),
      is_active: settingsForm.elements.is_active.checked,
      updated_at: new Date().toISOString()
    };
    const button = settingsForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const { data, error } = await client.from("lesson_settings")
      .update(values)
      .eq("id", true)
      .select("id")
      .maybeSingle();
    button.disabled = false;
    if (error || !data) {
      showError("Could not save lesson settings", error || new Error("No lesson settings were updated."));
      return;
    }
    setStatus("Lesson schedule saved and published.");
  });

  document.getElementById("admin-refresh").addEventListener("click", () => void loadLessons());
  signoutButton.addEventListener("click", async () => {
    const { error } = await client.auth.signOut();
    if (error) {
      showError("Could not sign out", error);
      return;
    }
    showGate("Sign in to manage lessons", "Use the verified ClassCreator administrator account.", true);
  });

  await openAdmin();
});
