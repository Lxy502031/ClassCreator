document.addEventListener("DOMContentLoaded", async () => {
  const config = window.CLASSCREATOR_SUPABASE_CONFIG;
  const status = document.getElementById("gallery-status");
  const authForm = document.getElementById("gallery-auth-form");
  const uploadArea = document.getElementById("gallery-upload-area");
  const uploadForm = document.getElementById("gallery-upload-form");
  const products = document.getElementById("student-products");
  const uploadButton = document.getElementById("gallery-upload-submit");
  const authButton = document.getElementById("gallery-auth-submit");
  const displayName = document.getElementById("gallery-display-name");
  const displayNameLabel = document.getElementById("gallery-display-name-label");
  const publicName = document.getElementById("gallery-public-name");
  const publicNameLabel = document.getElementById("gallery-public-name-label");
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  let client;

  function setStatus(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = !message;
  }

  function setAccountMode(mode) {
    const creatingAccount = mode === "signup";
    displayName.hidden = !creatingAccount;
    displayNameLabel.hidden = !creatingAccount;
    displayName.required = creatingAccount;
    document.getElementById("gallery-password").autocomplete = creatingAccount ? "new-password" : "current-password";
    authButton.textContent = creatingAccount ? "Create student account" : "Sign in";
  }

  function renderProducts(container, rows, emptyMessage) {
    container.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "product-gallery-empty";
      empty.textContent = emptyMessage;
      container.append(empty);
      return;
    }
    rows.forEach(product => {
      const card = document.createElement("article");
      card.className = "product-card";
      const image = document.createElement("img");
      image.src = product.image_url;
      image.alt = `Handmade product by ${product.author_name}`;
      image.loading = "lazy";
      const copy = document.createElement("div");
      copy.className = "product-card-copy";
      const description = document.createElement("p");
      description.textContent = product.description;
      const author = document.createElement("span");
      author.textContent = `Made by ${product.author_name}`;
      copy.append(description, author);
      card.append(image, copy);
      container.append(card);
    });
  }

  async function loadProducts(container, productType, emptyMessage) {
    const { data, error } = await client.from("gallery_products")
      .select("id,author_name,description,image_url,created_at")
      .eq("product_type", productType)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw error;
    renderProducts(container, data || [], emptyMessage);
  }

  async function loadGallery(container, productType, emptyMessage, label) {
    try {
      await loadProducts(container, productType, emptyMessage);
    } catch (error) {
      console.error(`Could not load ${label}.`, error);
      const message = error.code === "PGRST205"
        ? "This gallery will be available after studio setup is complete."
        : `Could not load ${label}. Please try again later.`;
      const notice = document.createElement("p");
      notice.className = "product-gallery-empty";
      notice.textContent = message;
      container.replaceChildren(notice);
      if (productType === "student") setStatus(message, "error");
    }
  }

  function showSession(user) {
    if (!user) {
      authForm.hidden = false;
      uploadArea.hidden = true;
      return;
    }
    const name = getPublicName(user);
    authForm.hidden = true;
    uploadArea.hidden = false;
    document.getElementById("gallery-upload-form").hidden = !user.email_confirmed_at;
    publicName.hidden = Boolean(name);
    publicNameLabel.hidden = Boolean(name);
    publicName.required = !name;
    if (!user.email_confirmed_at) {
      setStatus(
        "Confirm your email address before sharing a product.",
        "error"
      );
      return;
    }
    document.getElementById("gallery-signed-in").textContent = name
      ? `Signed in as ${name}`
      : "You’re signed in. Add the name you’d like shown with your products.";
  }

  function getPublicName(user) {
    for (const value of [user.user_metadata?.display_name, user.user_metadata?.full_name]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  if (!config?.url || !config?.anonKey || !window.getClassCreatorSupabaseClient) {
    products.replaceChildren();
    const error = document.createElement("p");
    error.className = "product-gallery-empty";
    error.textContent = "The student gallery is not configured yet.";
    products.append(error);
    const teacherProducts = document.getElementById("teacher-products");
    teacherProducts.replaceChildren();
    const teacherError = document.createElement("p");
    teacherError.className = "product-gallery-empty";
    teacherError.textContent = "The teacher gallery is not configured yet.";
    teacherProducts.append(teacherError);
    setStatus("Student accounts are not configured yet.", "error");
    return;
  }

  client = window.getClassCreatorSupabaseClient();
  if (!client) {
    setStatus("Student accounts are not configured yet.", "error");
    return;
  }
  client.auth.onAuthStateChange((_event, session) => {
    showSession(session?.user ?? null);
  });
  await Promise.all([
    loadGallery(
      document.getElementById("teacher-products"),
      "teacher",
      "Qingqing’s creations will appear here soon.",
      "Qingqing’s creations"
    ),
    loadGallery(products, "student", "No student creations yet. Be the first to share something you’ve made!", "student creations")
  ]);
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData.session) {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      showSession(data.user);
    } else {
      showSession(null);
    }
  } catch (error) {
    console.error("Could not load the student gallery.", error);
    setStatus(`Could not load the student gallery: ${error.message || "Please try again later."}`, "error");
  }

  authForm.querySelectorAll('input[name="account_mode"]').forEach(input => {
    input.addEventListener("change", () => setAccountMode(input.value));
  });

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!authForm.reportValidity()) return;
    const formData = new FormData(authForm);
    const mode = String(formData.get("account_mode"));
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    authButton.disabled = true;
    setStatus(mode === "signup" ? "Creating your student account…" : "Signing in…");
    try {
      let user;
      if (mode === "signup") {
        const name = String(formData.get("display_name") || "").trim();
        if (!name || name.length > 60) throw new Error("Enter a display name of 1–60 characters.");
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name },
            emailRedirectTo: window.location.origin
          }
        });
        if (error) throw error;
        user = data.user;
        if (!data.session) {
          setStatus("Account created. Check your email to confirm your address, then sign in to share a product.", "success");
          authForm.reset();
          setAccountMode("signin");
          return;
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        user = data.user;
      }
      showSession(user);
      setStatus(user?.email_confirmed_at ? "You’re signed in and ready to share." : "Confirm your email address before sharing a product.", user?.email_confirmed_at ? "success" : "error");
    } catch (error) {
      console.error("Could not authenticate student.", error);
      setStatus(error.message || "Could not sign in. Please try again.", "error");
    } finally {
      authButton.disabled = false;
    }
  });

  document.getElementById("gallery-signout").addEventListener("click", async () => {
    const { error } = await client.auth.signOut();
    if (error) {
      console.error("Could not sign out of the student account.", error);
      setStatus(`Could not sign out: ${error.message}`, "error");
      return;
    }
    showSession(null);
    setStatus("You have signed out.");
  });

  uploadForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!uploadForm.reportValidity()) return;
    const formData = new FormData(uploadForm);
    const image = formData.get("image");
    const description = String(formData.get("description") || "").trim();
    if (!(image instanceof File) || !image.size) {
      setStatus("Choose a product photo to upload.", "error");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.type) || image.size > MAX_IMAGE_BYTES) {
      setStatus("Choose a JPEG, PNG, or WebP image no larger than 5 MB.", "error");
      return;
    }
    uploadButton.disabled = true;
    uploadButton.textContent = "Sharing your product…";
    setStatus("Uploading your product to the student gallery…");
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) throw new Error("Please sign in again before sharing a product.");
      const profileName = getPublicName(sessionData.session.user);
      if (sessionData.session.user.user_metadata?.display_name !== profileName) {
        const name = profileName || publicName.value.trim();
        if (!name || name.length > 60) throw new Error("Enter a name of 1–60 characters to show with your product.");
        const { data: updatedUser, error: updateError } = await client.auth.updateUser({
          data: { display_name: name }
        });
        if (updateError) throw updateError;
        showSession(updatedUser.user);
        const { data: refreshedSession, error: refreshError } = await client.auth.getSession();
        if (refreshError) throw refreshError;
        if (!refreshedSession.session) throw new Error("Please sign in again before sharing a product.");
        sessionData.session = refreshedSession.session;
      }
      const submission = new FormData();
      submission.set("description", description);
      submission.set("image", image);
      const response = await fetch(`${config.url.replace(/\/$/, "")}/functions/v1/gallery-submit`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          authorization: `Bearer ${sessionData.session.access_token}`
        },
        body: submission
      });
      const result = await response.json();
      if (!response.ok || result.published !== true) {
        throw new Error(result.error || result.reason || "The product could not be shared.");
      }
      uploadForm.reset();
      await loadProducts(products, "student", "No student creations yet. Be the first to share something you’ve made!");
      setStatus("Your product has been added to the student gallery.", "success");
    } catch (error) {
      console.error("Could not share student product.", error);
      setStatus(error.message || "Could not share your product. Please try again.", "error");
    } finally {
      uploadButton.disabled = false;
      uploadButton.textContent = "Share product";
    }
  });
});
