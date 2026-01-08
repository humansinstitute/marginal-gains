/**
 * Wingman Settings Management
 * Client-side code for managing Wingman AI settings (admin only)
 */

import { escapeHtml } from "./dom.js";
import { formatShortDateTime } from "./dateUtils.js";

// Default model options for dropdown
const MODEL_OPTIONS = [
  // Anthropic models
  { value: "anthropic/claude-opus-4.5", label: "Claude Opus 4.5" },
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (Recommended)" },
  { value: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  // OpenAI models
  { value: "openai/gpt-5.2-pro", label: "GPT-5.2 Pro" },
  { value: "openai/gpt-5.2-chat", label: "GPT-5.2 Chat" },
  { value: "openai/gpt-5.2", label: "GPT-5.2" },
  // Google models
  { value: "google/gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
  { value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  // Other models
  { value: "moonshotai/kimi-k2-thinking", label: "Kimi K2 Thinking" },
  { value: "z-ai/glm-4.7", label: "GLM 4.7" },
];

let settings = null;
let costsData = null;
let showingCosts = false;

/**
 * Initialize Wingman settings section
 */
export async function initWingmanSettings() {
  const section = document.querySelector("[data-wingman-section]");
  if (!section) return;

  await fetchSettings();
  renderSettings();
  wireEventListeners();
}

/**
 * Fetch Wingman settings from API
 */
async function fetchSettings() {
  try {
    const res = await fetch("/api/wingman/settings");
    if (!res.ok) {
      settings = { error: true };
      return;
    }
    settings = await res.json();
  } catch (_err) {
    console.error("[Wingman] Failed to fetch settings");
    settings = { error: true };
  }
}

/**
 * Render the settings form
 */
function renderSettings() {
  const container = document.querySelector("[data-wingman-content]");
  if (!container) return;

  if (settings?.error) {
    container.innerHTML = `<p class="settings-empty">Failed to load Wingman settings</p>`;
    return;
  }

  if (!settings?.available) {
    container.innerHTML = `
      <div class="settings-wingman-unavailable">
        <p>Wingman is not available. Please configure:</p>
        <ul>
          <li>OR_API_KEY - OpenRouter API key</li>
          <li>WINGMAN_KEY - Wingman's Nostr private key (nsec)</li>
        </ul>
      </div>
    `;
    return;
  }

  // Build model options HTML
  const modelOptionsHtml = MODEL_OPTIONS.map((opt) => {
    const selected = settings.model === opt.value ? "selected" : "";
    return `<option value="${escapeHtml(opt.value)}" ${selected}>${escapeHtml(opt.label)}</option>`;
  }).join("");

  // Check if current model is in our list, if not add it as custom
  const isCustomModel = !MODEL_OPTIONS.some((opt) => opt.value === settings.model);
  const customModelHtml = isCustomModel
    ? `<option value="${escapeHtml(settings.model)}" selected>${escapeHtml(settings.model)}</option>`
    : "";

  container.innerHTML = `
    <form class="settings-wingman-form" data-wingman-form>
      <div class="settings-wingman-field">
        <label class="settings-toggle">
          <input type="checkbox" name="enabled" ${settings.enabled ? "checked" : ""} />
          <span>Enable Wingman</span>
        </label>
        <p class="settings-field-hint">When enabled, admins can use /wingman in chat threads</p>
      </div>

      <div class="settings-wingman-field">
        <label>
          <span>Model</span>
          <select name="model">
            ${modelOptionsHtml}
            ${customModelHtml}
            <option value="custom">Custom model...</option>
          </select>
        </label>
        <input
          type="text"
          name="customModel"
          placeholder="e.g. anthropic/claude-3-opus"
          class="settings-wingman-custom-model"
          data-custom-model
          hidden
        />
      </div>

      <div class="settings-wingman-field">
        <label>
          <span>System Prompt</span>
          <textarea name="systemPrompt" rows="4" placeholder="Enter system prompt...">${escapeHtml(settings.systemPrompt)}</textarea>
        </label>
        <p class="settings-field-hint">Instructions that define Wingman's personality and behavior</p>
      </div>

      <div class="settings-wingman-actions">
        <button type="submit" class="primary">Save Changes</button>
        <span class="settings-wingman-status" data-wingman-status></span>
      </div>
    </form>

    <div class="settings-wingman-costs-section">
      <button type="button" class="secondary" data-view-costs>View Usage & Costs</button>
      <div class="settings-wingman-costs" data-costs-container hidden></div>
    </div>
  `;
}

/**
 * Wire up event listeners
 */
function wireEventListeners() {
  const form = document.querySelector("[data-wingman-form]");
  if (!form) return;

  // Handle model dropdown change
  const modelSelect = form.querySelector('select[name="model"]');
  const customModelInput = form.querySelector("[data-custom-model]");

  modelSelect?.addEventListener("change", () => {
    if (modelSelect.value === "custom") {
      customModelInput.hidden = false;
      customModelInput.focus();
    } else {
      customModelInput.hidden = true;
      customModelInput.value = "";
    }
  });

  // Handle form submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveSettings(form);
  });

  // Handle view costs button
  const viewCostsBtn = document.querySelector("[data-view-costs]");
  viewCostsBtn?.addEventListener("click", toggleCostsView);
}

/**
 * Save settings to API
 */
async function saveSettings(form) {
  const statusEl = form.querySelector("[data-wingman-status]");
  const submitBtn = form.querySelector('button[type="submit"]');

  try {
    submitBtn.disabled = true;
    statusEl.textContent = "Saving...";

    const formData = new FormData(form);
    const enabled = formData.get("enabled") === "on";
    const systemPrompt = formData.get("systemPrompt");

    // Get model value
    let model = formData.get("model");
    if (model === "custom") {
      model = formData.get("customModel");
    }

    const res = await fetch("/api/wingman/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        systemPrompt,
        model,
      }),
    });

    if (res.ok) {
      settings = await res.json();
      statusEl.textContent = "Saved!";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    } else {
      const err = await res.json().catch(() => ({}));
      statusEl.textContent = err.error || "Failed to save";
    }
  } catch (_err) {
    console.error("[Wingman] Failed to save settings");
    statusEl.textContent = "Error saving settings";
  } finally {
    submitBtn.disabled = false;
  }
}

/**
 * Toggle costs view visibility
 */
async function toggleCostsView() {
  const container = document.querySelector("[data-costs-container]");
  const btn = document.querySelector("[data-view-costs]");
  if (!container || !btn) return;

  showingCosts = !showingCosts;

  if (showingCosts) {
    container.hidden = false;
    container.innerHTML = '<p class="settings-loading">Loading costs...</p>';
    btn.textContent = "Hide Usage & Costs";
    await fetchAndRenderCosts();
  } else {
    container.hidden = true;
    container.innerHTML = "";
    btn.textContent = "View Usage & Costs";
  }
}

/**
 * Fetch costs data and render
 */
async function fetchAndRenderCosts() {
  const container = document.querySelector("[data-costs-container]");
  if (!container) return;

  try {
    const res = await fetch("/api/wingman/costs");
    if (!res.ok) {
      container.innerHTML = '<p class="settings-error">Failed to load costs</p>';
      return;
    }
    costsData = await res.json();
    renderCosts();
  } catch (_err) {
    console.error("[Wingman] Failed to fetch costs");
    container.innerHTML = '<p class="settings-error">Failed to load costs</p>';
  }
}

/**
 * Render costs data
 */
function renderCosts() {
  const container = document.querySelector("[data-costs-container]");
  if (!container || !costsData) return;

  const { summary, totals, recentRequests } = costsData;

  // Format currency
  const formatCost = (cost) => {
    if (cost === null || cost === undefined) return "$0.00";
    return `$${cost.toFixed(4)}`;
  };

  // Format date (using shared utility for proper timezone handling)
  const formatDate = formatShortDateTime;

  // Summary by user table
  const summaryRows = summary.length > 0
    ? summary.map((s) => `
        <tr>
          <td>${escapeHtml(s.display_name)}</td>
          <td>${s.request_count}</td>
          <td>${s.total_tokens.toLocaleString()}</td>
          <td>${formatCost(s.total_cost)}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="4" class="settings-empty">No usage data yet</td></tr>';

  // Recent requests table
  const recentRows = recentRequests.length > 0
    ? recentRequests.map((r) => `
        <tr>
          <td>${formatDate(r.created_at)}</td>
          <td>${escapeHtml(r.display_name)}</td>
          <td title="${escapeHtml(r.model)}">${escapeHtml(r.model.split("/").pop())}</td>
          <td>${r.total_tokens.toLocaleString()}</td>
          <td>${formatCost(r.cost_usd)}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="5" class="settings-empty">No requests yet</td></tr>';

  container.innerHTML = `
    <div class="settings-wingman-costs-totals">
      <div class="cost-stat">
        <span class="cost-stat-value">${formatCost(totals.total_cost)}</span>
        <span class="cost-stat-label">Total Cost</span>
      </div>
      <div class="cost-stat">
        <span class="cost-stat-value">${(totals.total_tokens || 0).toLocaleString()}</span>
        <span class="cost-stat-label">Total Tokens</span>
      </div>
      <div class="cost-stat">
        <span class="cost-stat-value">${totals.request_count || 0}</span>
        <span class="cost-stat-label">Total Requests</span>
      </div>
    </div>

    <h4>Usage by User</h4>
    <table class="settings-wingman-costs-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Requests</th>
          <th>Tokens</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        ${summaryRows}
      </tbody>
    </table>

    <h4>Recent Requests</h4>
    <table class="settings-wingman-costs-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>User</th>
          <th>Model</th>
          <th>Tokens</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        ${recentRows}
      </tbody>
    </table>
  `;
}
