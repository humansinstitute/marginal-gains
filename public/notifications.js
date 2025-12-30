import { hide, show, escapeHtml } from "./dom.js";
import {
  initPush,
  isPushSupported,
  getPushDebugInfo,
  subscribeToPush,
  unsubscribeFromPush,
  updateFrequency,
  getCurrentSubscription,
  getPushStatus,
  sendTestNotification,
} from "./push.js";

let currentFrequency = null;
let isSubscribed = false;
let isSupported = false;

export async function initNotifications() {
  const container = document.querySelector("[data-notifications-section]");
  if (!container) return;

  isSupported = isPushSupported();

  if (!isSupported) {
    renderUnsupported(container);
    return;
  }

  const initialized = await initPush();
  if (!initialized) {
    renderUnsupported(container);
    return;
  }

  // Check current status
  const subscription = await getCurrentSubscription();
  isSubscribed = !!subscription;

  if (isSubscribed) {
    const status = await getPushStatus();
    if (status?.subscriptions?.length > 0) {
      currentFrequency = status.subscriptions[0].frequency;
    }
  }

  renderNotificationSettings(container);
  wireNotificationListeners(container);
}

function renderUnsupported(container) {
  const debug = getPushDebugInfo();

  let message = "Push notifications are not supported on this device.";
  if (debug.isIOS && !debug.isStandalone) {
    message = "To enable notifications on iOS, add this app to your home screen first.";
  }

  const debugRows = Object.entries(debug)
    .map(([key, val]) => {
      const displayVal = key === "userAgent" ? val.slice(0, 50) + "..." : String(val);
      const status = val === true ? "✅" : val === false ? "❌" : "➖";
      return `<tr><td>${escapeHtml(key)}</td><td>${status} ${escapeHtml(displayVal)}</td></tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="settings-section-header">
      <h2>Notifications</h2>
    </div>
    <div class="notification-unsupported">
      <p>${escapeHtml(message)}</p>
      <details style="margin-top: 1rem;">
        <summary style="cursor: pointer; font-size: 0.85rem;">Debug Info</summary>
        <table style="font-size: 0.75rem; margin-top: 0.5rem; width: 100%; border-collapse: collapse;">
          <tbody>
            ${debugRows}
          </tbody>
        </table>
      </details>
    </div>
  `;
}

function renderNotificationSettings(container) {
  const frequencyOptions = [
    { value: "on_update", label: "Every update", description: "Get notified immediately when something changes" },
    { value: "hourly", label: "Hourly summary", description: "Receive a summary every hour" },
    { value: "daily", label: "Daily digest", description: "Get one notification per day with your summary" },
  ];

  container.innerHTML = `
    <div class="settings-section-header">
      <h2>Notifications</h2>
      ${isSubscribed ? `<button type="button" class="ghost" data-test-notification>Test</button>` : ""}
    </div>
    <div class="notification-options">
      ${frequencyOptions
        .map(
          (opt) => `
        <label class="notification-option ${currentFrequency === opt.value ? "selected" : ""}">
          <input
            type="radio"
            name="notification-frequency"
            value="${opt.value}"
            ${currentFrequency === opt.value ? "checked" : ""}
          />
          <div class="notification-option-content">
            <span class="notification-option-label">${escapeHtml(opt.label)}</span>
            <span class="notification-option-desc">${escapeHtml(opt.description)}</span>
          </div>
        </label>
      `
        )
        .join("")}
    </div>
    ${
      isSubscribed
        ? `<button type="button" class="ghost notification-disable" data-disable-notifications>
            Disable notifications
          </button>`
        : ""
    }
    <p class="notification-status" data-notification-status hidden></p>
  `;
}

function wireNotificationListeners(container) {
  // Frequency selection
  container.querySelectorAll('input[name="notification-frequency"]').forEach((radio) => {
    radio.addEventListener("change", async (e) => {
      const frequency = e.target.value;
      await handleFrequencyChange(container, frequency);
    });
  });

  // Disable button
  const disableBtn = container.querySelector("[data-disable-notifications]");
  disableBtn?.addEventListener("click", async () => {
    await handleDisable(container);
  });

  // Test button
  const testBtn = container.querySelector("[data-test-notification]");
  testBtn?.addEventListener("click", async () => {
    await handleTest(container);
  });
}

async function handleFrequencyChange(container, frequency) {
  const statusEl = container.querySelector("[data-notification-status]");

  try {
    show(statusEl);
    statusEl.textContent = "Updating...";
    statusEl.className = "notification-status";

    if (isSubscribed) {
      await updateFrequency(frequency);
    } else {
      await subscribeToPush(frequency);
      isSubscribed = true;
    }

    currentFrequency = frequency;
    statusEl.textContent = "Notifications enabled!";
    statusEl.className = "notification-status success";

    // Re-render to show disable button if newly subscribed
    renderNotificationSettings(container);
    wireNotificationListeners(container);
  } catch (err) {
    console.error("[Notifications] Error:", err);
    statusEl.textContent = err.message || "Failed to update notifications";
    statusEl.className = "notification-status error";
  }
}

async function handleDisable(container) {
  const statusEl = container.querySelector("[data-notification-status]");

  try {
    show(statusEl);
    statusEl.textContent = "Disabling...";
    statusEl.className = "notification-status";

    await unsubscribeFromPush();

    isSubscribed = false;
    currentFrequency = null;
    statusEl.textContent = "Notifications disabled";
    statusEl.className = "notification-status";

    // Re-render to remove disable button
    renderNotificationSettings(container);
    wireNotificationListeners(container);
  } catch (err) {
    console.error("[Notifications] Error:", err);
    statusEl.textContent = "Failed to disable notifications";
    statusEl.className = "notification-status error";
  }
}

async function handleTest(container) {
  const statusEl = container.querySelector("[data-notification-status]");

  try {
    show(statusEl);
    statusEl.textContent = "Sending test...";
    statusEl.className = "notification-status";

    const result = await sendTestNotification();
    statusEl.textContent = `Test sent! (${result.sent} delivered, ${result.failed} failed)`;
    statusEl.className = "notification-status success";
  } catch (err) {
    statusEl.textContent = "Failed to send test";
    statusEl.className = "notification-status error";
  }
}
