/**
 * App Settings Management
 * Client-side code for managing app name and favicon (admin only)
 */

import { escapeHtml, hide, show } from "./dom.js";

let settings = null;

/**
 * Initialize App Settings section
 */
export async function initAppSettings() {
  const section = document.querySelector("[data-app-settings-section]");
  if (!section) return;

  await fetchSettings();
  renderSettings();
  wireEventListeners();
}

/**
 * Fetch app settings from API
 */
async function fetchSettings() {
  try {
    const res = await fetch("/api/app/settings");
    if (!res.ok) {
      settings = { error: true };
      return;
    }
    settings = await res.json();
  } catch (_err) {
    console.error("[AppSettings] Failed to fetch settings");
    settings = { error: true };
  }
}

/**
 * Render the settings form
 */
function renderSettings() {
  const content = document.querySelector("[data-app-settings-content]");
  const form = document.querySelector("[data-app-settings-form]");
  if (!content || !form) return;

  if (settings?.error) {
    content.innerHTML = `<p class="settings-empty">Failed to load app settings</p>`;
    hide(form);
    return;
  }

  // Populate form fields
  const appNameInput = form.querySelector('input[name="appName"]');
  const faviconInput = form.querySelector('input[name="faviconUrl"]');

  if (appNameInput) {
    appNameInput.value = settings.appName || "";
  }
  if (faviconInput) {
    faviconInput.value = settings.faviconUrl || "";
  }

  // Show current values summary
  const appNameDisplay = settings.appName || "Marginal Gains (default)";
  const faviconDisplay = settings.faviconUrl || "Default favicon";

  content.innerHTML = `
    <div class="app-settings-summary">
      <p><strong>App Name:</strong> ${escapeHtml(appNameDisplay)}</p>
      <p><strong>Favicon:</strong> ${settings.faviconUrl ? `<a href="${escapeHtml(settings.faviconUrl)}" target="_blank">${escapeHtml(faviconDisplay)}</a>` : escapeHtml(faviconDisplay)}</p>
    </div>
  `;

  show(form);
}

/**
 * Wire up event listeners
 */
function wireEventListeners() {
  const form = document.querySelector("[data-app-settings-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveSettings(form);
  });
}

/**
 * Save settings to API
 */
async function saveSettings(form) {
  const statusEl = form.querySelector("[data-app-settings-status]");
  const submitBtn = form.querySelector("[data-save-app-settings]");

  try {
    submitBtn.disabled = true;
    statusEl.textContent = "Saving...";
    statusEl.hidden = false;

    const formData = new FormData(form);
    const appName = formData.get("appName")?.trim() || "";
    const faviconUrl = formData.get("faviconUrl")?.trim() || "";

    const res = await fetch("/api/app/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appName, faviconUrl }),
    });

    if (res.ok) {
      settings = await res.json();
      renderSettings();
      statusEl.textContent = "Saved! Refresh the page to see changes.";
      statusEl.className = "app-settings-status success";
      setTimeout(() => {
        statusEl.hidden = true;
      }, 4000);
    } else {
      const err = await res.json().catch(() => ({}));
      statusEl.textContent = err.error || "Failed to save";
      statusEl.className = "app-settings-status error";
    }
  } catch (_err) {
    console.error("[AppSettings] Failed to save settings");
    statusEl.textContent = "Error saving settings";
    statusEl.className = "app-settings-status error";
  } finally {
    submitBtn.disabled = false;
  }
}
