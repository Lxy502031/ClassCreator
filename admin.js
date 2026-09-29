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
  const overrideForm = document.getElementById("date-override-form");
  const overrideList = document.getElementById("date-override-list");
  const adminsForm = document.getElementById("lesson-admin-form");
  const adminsList = document.getElementById("lesson-admin-list");
  const overrideOpen = document.getElementById("override-open");
  const overrideFields = document.getElementById("override-session-fields");
  const overrideOriginalDate = document.getElementById("override-original-date");
  const singaporeTimezone = "Asia/Singapore";
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

  function singaporeDateTime(value) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: singaporeTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  }

  function todayInSingapore() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: singaporeTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function formatOverrideDate(value) {
    return new Intl.DateTimeFormat("en-SG", {
      timeZone: singaporeTimezone,
      dateStyle: "full"
    }).format(new Date(`${value}T12:00:00+08:00`));
  }

  function hasValidTimeWindow(start, end) {
    return /^\d{2}:\d{2}$/.test(start)
      && /^\d{2}:\d{2}$/.test(end)
      && start < end;
  }

  function setOverrideFieldsState() {
    overrideFields.disabled = !overrideOpen.checked;
  }

  function resetOverrideForm() {
    overrideForm.reset();
    overrideOriginalDate.value = "";
    document.getElementById("override-date").min = todayInSingapore();
    document.getElementById("override-start").value = "13:00";
    document.getElementById("override-end").value = "15:00";
    document.getElementById("override-duration").value = "60";
    document.getElementById("override-capacity").value = "1";
    overrideOpen.checked = true;
    setOverrideFieldsState();
    document.getElementById("override-save").textContent = "Save date override";
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
    if (!user.email_confirmed_at) {
      await client.auth.signOut();
      showGate("Administrator access required", "Sign in with a confirmed account that has been granted studio access.", true);
      return;
    }

    const { data: isAdmin, error: adminError } = await client.rpc("is_store_admin");
    if (adminError || !isAdmin) {
      if (adminError) console.error("Could not verify studio administrator access.", adminError);
      await client.auth.signOut();
      showGate(
        "Administrator access required",
        adminError?.message || "This account has not been granted studio access.",
        true
      );
      return;
    }

    gate.hidden = true;
    app.hidden = false;
    signoutButton.hidden = false;
    document.getElementById("admin-identity").textContent = `Signed in as ${user.email}`;
    await loadLessons();
  }

  async function loadAdmins() {
    const { data, error } = await client.from("lesson_admins")
      .select("email,is_bootstrap,created_at")
      .order("email", { ascending: true });
    if (error) {
      showError("Could not load studio administrators", error);
      return;
    }
    adminsList.replaceChildren();
    data.forEach(admin => {
      const record = document.createElement("article");
      record.className = "admin-list-record";
      const identity = document.createElement("p");
      identity.textContent = admin.is_bootstrap
        ? `${admin.email} · Primary administrator`
        : admin.email;
      record.append(identity);
      if (!admin.is_bootstrap) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove access";
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Remove studio administrator access for ${admin.email}?`)) return;
          remove.disabled = true;
          const { error: removeError } = await client.rpc("admin_remove_lesson_admin", {
            p_email: admin.email
          });
          remove.disabled = false;
          if (removeError) {
            showError("Could not remove administrator", removeError);
            return;
          }
          await loadAdmins();
          setStatus(`Studio administrator access removed for ${admin.email}.`);
        });
        record.append(remove);
      }
      adminsList.append(record);
    });
  }

  async function loadLessons(clearStatus = true) {
    if (clearStatus) setStatus("");
    const { data, error } = await client.from("lesson_settings")
      .select("class_title,description,weekdays,start_time,end_time,duration_minutes,capacity,booking_horizon_days,is_active")
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
    settingsForm.elements.capacity.value = data.capacity;
    settingsForm.elements.booking_horizon_days.value = data.booking_horizon_days;
    settingsForm.elements.is_active.checked = data.is_active;
    settingsForm.querySelectorAll('input[name="weekdays"]').forEach(input => {
      input.checked = data.weekdays.includes(Number(input.value));
    });

    await loadDateOverrides();
    await loadAdmins();

    const { data: bookings, error: bookingError } = await client.from("lesson_bookings")
      .select("id,student_name,email,phone,slot_start,duration_minutes,status,email_status")
      .eq("status", "booked")
      .gte("slot_start", new Date().toISOString())
      .order("slot_start", { ascending: true })
      .limit(100);
    if (bookingError) {
      showError("Could not load lesson bookings", bookingError);
      return;
    }

    const upcoming = bookings || [];
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
      const editForm = document.createElement("form");
      editForm.className = "booking-edit-form";
      const fields = [
        ["Student name", "student_name", booking.student_name, "text"],
        ["Email address", "email", booking.email, "email"],
        ["Phone number", "phone", booking.phone, "tel"],
        ["New date and time (Singapore time)", "slot_start", singaporeDateTime(booking.slot_start), "datetime-local"]
      ];
      fields.forEach(([labelText, name, value, type]) => {
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.name = name;
        input.type = type;
        input.value = value;
        input.required = true;
        if (name === "student_name") input.maxLength = 100;
        if (name === "email") {
          input.maxLength = 320;
          input.autocomplete = "email";
        }
        if (name === "phone") {
          input.maxLength = 24;
          input.autocomplete = "tel";
        }
        if (name === "slot_start") {
          input.min = singaporeDateTime(new Date());
          input.step = "60";
        }
        label.append(input);
        editForm.append(label);
      });
      const editActions = document.createElement("div");
      editActions.className = "booking-edit-actions";
      const saveEdit = document.createElement("button");
      saveEdit.type = "submit";
      saveEdit.className = "admin-primary";
      saveEdit.textContent = "Save booking changes";
      editActions.append(saveEdit);
      editForm.append(editActions);
      editForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (!editForm.reportValidity()) return;
        const formData = new FormData(editForm);
        const localSlot = String(formData.get("slot_start") || "");
        const slotStart = Date.parse(`${localSlot}:00+08:00`);
        if (!Number.isFinite(slotStart)) {
          setStatus("Choose a valid date and time in Singapore time.", "error");
          return;
        }
        saveEdit.disabled = true;
        setStatus("Saving booking changes…", "pending");
        const { error: updateError } = await client.rpc("admin_update_lesson_booking", {
          p_booking_id: booking.id,
          p_student_name: String(formData.get("student_name") || "").trim(),
          p_email: String(formData.get("email") || "").trim(),
          p_phone: String(formData.get("phone") || "").trim(),
          p_slot_start: new Date(slotStart).toISOString()
        });
        saveEdit.disabled = false;
        if (updateError) {
          showError("Could not update booking", updateError);
          return;
        }
        await loadLessons(false);
        setStatus("Booking details and session time updated.");
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "booking-cancel";
      cancel.textContent = "Cancel booking";
      cancel.addEventListener("click", async () => {
        if (!window.confirm(`Cancel ${booking.student_name}’s lesson booking?`)) return;
        cancel.disabled = true;
        setStatus("Cancelling lesson booking…", "pending");
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
        await loadLessons(false);
        setStatus("Lesson booking cancelled. Its time is available to book again.");
      });
      record.append(name, when, contact, editForm, cancel);
      bookingsList.append(record);
    });
  }

  async function loadDateOverrides() {
    const { data, error } = await client.from("lesson_date_overrides")
      .select("session_date,is_open,start_time,end_time,duration_minutes,capacity")
      .order("session_date", { ascending: true });
    if (error) {
      showError("Could not load date overrides", error);
      return;
    }
    overrideList.replaceChildren();
    if (!data.length) {
      const empty = document.createElement("p");
      empty.className = "admin-muted";
      empty.textContent = "No one-off dates yet. The regular weekly schedule will be used.";
      overrideList.append(empty);
      return;
    }
    data.forEach(override => {
      const record = document.createElement("article");
      record.className = "override-record";
      const details = document.createElement("div");
      const date = document.createElement("h3");
      date.textContent = formatOverrideDate(override.session_date);
      const summary = document.createElement("p");
      summary.textContent = override.is_open
        ? `${override.start_time.slice(0, 5)}–${override.end_time.slice(0, 5)} · ${override.duration_minutes}-minute sessions · ${override.capacity} students per session`
        : "Closed — no sessions offered";
      details.append(date, summary);
      const actions = document.createElement("div");
      actions.className = "override-record-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        overrideOriginalDate.value = override.session_date;
        overrideForm.elements.session_date.value = override.session_date;
        overrideOpen.checked = override.is_open;
        overrideForm.elements.start_time.value = override.start_time.slice(0, 5);
        overrideForm.elements.end_time.value = override.end_time.slice(0, 5);
        overrideForm.elements.duration_minutes.value = override.duration_minutes;
        overrideForm.elements.capacity.value = override.capacity;
        document.getElementById("override-date").min = todayInSingapore();
        document.getElementById("override-save").textContent = "Update date override";
        setOverrideFieldsState();
        overrideForm.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "override-delete";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Remove the override for ${formatOverrideDate(override.session_date)}? The regular weekly schedule will apply again.`)) return;
        remove.disabled = true;
        const { error: deleteError } = await client.from("lesson_date_overrides")
          .delete()
          .eq("session_date", override.session_date);
        if (deleteError) {
          remove.disabled = false;
          showError("Could not remove date override", deleteError);
          return;
        }
        resetOverrideForm();
        await loadLessons();
        setStatus("Date override removed. The regular weekly schedule now applies.");
      });
      actions.append(edit, remove);
      record.append(details, actions);
      overrideList.append(record);
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
    if (!hasValidTimeWindow(settingsForm.elements.start_time.value, settingsForm.elements.end_time.value)) {
      setStatus("The daily end time must be later than the start time. Sessions cannot cross midnight.", "error");
      settingsForm.elements.end_time.focus();
      return;
    }
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
      capacity: Number(settingsForm.elements.capacity.value),
      booking_horizon_days: Number(settingsForm.elements.booking_horizon_days.value),
      is_active: settingsForm.elements.is_active.checked,
      updated_at: new Date().toISOString()
    };
    const button = settingsForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus("Saving lesson settings…", "pending");
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
    await loadLessons(false);
    setStatus("Lesson schedule saved and published.");
  });

  adminsForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!adminsForm.reportValidity()) return;
    const email = String(new FormData(adminsForm).get("email") || "").trim().toLowerCase();
    const button = adminsForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus("Adding studio administrator…", "pending");
    const { error } = await client.rpc("admin_add_lesson_admin", { p_email: email });
    button.disabled = false;
    if (error) {
      showError("Could not add studio administrator", error);
      return;
    }
    adminsForm.reset();
    await loadAdmins();
    setStatus(`Studio administrator access granted to ${email}.`);
  });

  overrideOpen.addEventListener("change", setOverrideFieldsState);
  document.getElementById("override-reset").addEventListener("click", resetOverrideForm);
  overrideForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!overrideForm.reportValidity()) return;
    const formData = new FormData(overrideForm);
    const sessionDate = String(formData.get("session_date") || "");
    if (sessionDate < todayInSingapore()) {
      setStatus("Choose today or a future date for a schedule override.", "error");
      return;
    }
    if (!hasValidTimeWindow(overrideForm.elements.start_time.value, overrideForm.elements.end_time.value)) {
      setStatus("The date override end time must be later than the start time. Sessions cannot cross midnight.", "error");
      overrideForm.elements.end_time.focus();
      return;
    }
    const values = {
      session_date: sessionDate,
      is_open: overrideOpen.checked,
      start_time: overrideForm.elements.start_time.value,
      end_time: overrideForm.elements.end_time.value,
      duration_minutes: Number(overrideForm.elements.duration_minutes.value),
      capacity: Number(overrideForm.elements.capacity.value),
      updated_at: new Date().toISOString()
    };
    const originalDate = overrideOriginalDate.value;
    const button = document.getElementById("override-save");
    button.disabled = true;
    setStatus(originalDate ? "Updating date override…" : "Saving date override…", "pending");
    let error;
    if (originalDate) {
      const result = await client.from("lesson_date_overrides")
        .update(values)
        .eq("session_date", originalDate)
        .select("session_date")
        .maybeSingle();
      error = result.error || (!result.data ? new Error("The date override no longer exists. Refresh and try again.") : null);
    } else {
      const result = await client.from("lesson_date_overrides").insert(values);
      error = result.error;
    }
    button.disabled = false;
    if (error) {
      showError("Could not save date override", error);
      return;
    }
    resetOverrideForm();
    await loadLessons(false);
    setStatus("Date override saved. Public availability has been updated.");
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
