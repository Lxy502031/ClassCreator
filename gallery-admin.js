document.addEventListener("DOMContentLoaded", async () => {
  const config = window.CLASSCREATOR_SUPABASE_CONFIG;
  const form = document.getElementById("teacher-gallery-form");
  if (!form || !config?.url || !config?.anonKey || !window.getClassCreatorSupabaseClient) return;

  const client = window.getClassCreatorSupabaseClient();
  if (!client) return;
  const list = document.getElementById("teacher-gallery-list");
  const status = document.getElementById("teacher-gallery-status");
  const submit = document.getElementById("teacher-gallery-submit");
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  function setStatus(message, kind = "success") {
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = !message;
  }

  async function loadTeacherProducts() {
    const { data, error } = await client.from("gallery_products")
      .select("id,description,image_path,image_url")
      .eq("product_type", "teacher")
      .order("created_at", { ascending: false });
    if (error) throw error;
    list.replaceChildren();
    (data || []).forEach(product => {
      const record = document.createElement("article");
      record.className = "admin-list-record";
      const description = document.createElement("p");
      description.textContent = product.description;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove product";
      remove.addEventListener("click", async () => {
        if (!window.confirm("Remove this product from the teacher gallery?")) return;
        remove.disabled = true;
        const { error: deleteError } = await client.from("gallery_products")
          .delete()
          .eq("id", product.id);
        if (deleteError) {
          remove.disabled = false;
          setStatus(`Could not remove gallery product: ${deleteError.message}`, "error");
          return;
        }
        const { error: storageError } = await client.storage.from("gallery-products").remove([product.image_path]);
        if (storageError) console.error("Could not remove teacher gallery image.", storageError);
        await loadTeacherProducts();
        setStatus(storageError ? "Product removed, but its image file could not be cleaned up." : "Product removed from the teacher gallery.");
      });
      record.append(description, remove);
      list.append(record);
    });
  }

  try {
    const { data: admin, error: adminError } = await client.rpc("is_store_admin");
    if (adminError) throw adminError;
    if (!admin) return;
    await loadTeacherProducts();
  } catch (error) {
    console.error("Could not load teacher gallery tools.", error);
    setStatus(`Could not load teacher gallery tools: ${error.message || "Please refresh the page."}`, "error");
    return;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
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
    submit.disabled = true;
    setStatus("Adding the product…", "pending");
    let imagePath = "";
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw userError || new Error("Sign in to the studio again.");
      const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[image.type];
      imagePath = `teacher/${userData.user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await client.storage.from("gallery-products")
        .upload(imagePath, image, { contentType: image.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: publicData } = client.storage.from("gallery-products").getPublicUrl(imagePath);
      const { error: insertError } = await client.from("gallery_products").insert({
        product_type: "teacher",
        author_id: userData.user.id,
        author_name: "Qingqing",
        description,
        image_path: imagePath,
        image_url: publicData.publicUrl
      });
      if (insertError) throw insertError;
      imagePath = "";
      form.reset();
      await loadTeacherProducts();
      setStatus("Product added to Qingqing’s public gallery.");
    } catch (error) {
      if (imagePath) {
        const { error: cleanupError } = await client.storage.from("gallery-products").remove([imagePath]);
        if (cleanupError) console.error("Could not clean up an unpublished teacher gallery image.", cleanupError);
      }
      console.error("Could not add teacher gallery product.", error);
      setStatus(`Could not add product: ${error.message || "Please try again."}`, "error");
    } finally {
      submit.disabled = false;
    }
  });
});
