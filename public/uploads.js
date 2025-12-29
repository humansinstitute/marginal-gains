// File upload handling module

// Track upload state
let isUploading = false;

// Check if currently uploading
export function getIsUploading() {
  return isUploading;
}

// Extract files from clipboard or drop event
export function extractUploadableFiles(items) {
  const files = [];
  for (const item of Array.from(items)) {
    if (!item) continue;
    if (item.kind === "file") {
      const file = item.getAsFile?.();
      if (file) files.push(file);
    } else if (item instanceof File) {
      files.push(item);
    }
  }
  return files;
}

// Upload files and insert markdown into a specific input element
export async function uploadFilesToInput(files, inputEl, sendBtn, defaultPlaceholder, sessionCheck) {
  if (!sessionCheck?.() || !inputEl || isUploading) return;

  for (const file of files) {
    isUploading = true;
    sendBtn?.setAttribute("disabled", "disabled");
    inputEl.setAttribute("placeholder", "Uploading...");

    try {
      const form = new FormData();
      form.append("file", file, file.name);

      const res = await fetch("/api/assets/upload", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Upload failed");
        continue;
      }

      const payload = await res.json();
      const markdown = payload.isImage
        ? `![${file.name}](${payload.url})`
        : `[${file.name}](${payload.url})`;

      insertTextAtCursorIn(inputEl, markdown);
    } catch (error) {
      console.error("[Upload] Failed:", error);
      alert("Upload failed");
    } finally {
      isUploading = false;
      inputEl.setAttribute("placeholder", defaultPlaceholder);
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

// Insert text at cursor position in a specific input element
export function insertTextAtCursorIn(inputEl, text) {
  if (!inputEl) return;
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const before = inputEl.value.slice(0, start);
  const after = inputEl.value.slice(end);

  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";

  inputEl.value = before + prefix + text + suffix + after;
  const newPos = start + prefix.length + text.length + suffix.length;
  inputEl.selectionStart = inputEl.selectionEnd = newPos;
  inputEl.focus();
}

// Wire paste and drop handlers to an input element
export function wirePasteAndDrop(inputEl, sendBtn, placeholder, sessionCheck) {
  if (!inputEl) return;

  // Paste handler
  inputEl.addEventListener("paste", async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = extractUploadableFiles(items);
    if (files.length > 0) {
      event.preventDefault();
      await uploadFilesToInput(files, inputEl, sendBtn, placeholder, sessionCheck);
    }
  });

  // Find composer container for drag/drop
  const composer = inputEl.closest(".chat-composer, .chat-thread-panel-composer");
  if (composer) {
    composer.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      composer.classList.add("drag-over");
    });
    composer.addEventListener("dragleave", () => {
      composer.classList.remove("drag-over");
    });
    composer.addEventListener("drop", async (event) => {
      event.preventDefault();
      composer.classList.remove("drag-over");
      const items = event.dataTransfer?.items || event.dataTransfer?.files;
      if (!items) return;
      const files = extractUploadableFiles(items);
      if (files.length > 0) {
        await uploadFilesToInput(files, inputEl, sendBtn, placeholder, sessionCheck);
      }
    });
  }
}
