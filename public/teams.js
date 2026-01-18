/**
 * Teams Module
 *
 * Client-side functionality for multi-tenant team management:
 * - Team selector dropdown
 * - Team switching
 * - Teams page (join/create)
 * - Team settings page
 */

import { teamUrl } from "./api.js";
import { fetchChannelKey } from "./chatCrypto.js";
import { wrapKeyForUser } from "./crypto.js";
import { state, setSession } from "./state.js";
import { hashInviteCode, storeEncryptedKeyForInvite, redeemInviteForTeamKey } from "./teamCrypto.js";

// ============================================================================
// Team Selector (in app menu)
// ============================================================================

/**
 * Initialize team selector dropdown behavior
 */
export function initTeamSelector() {
  document.addEventListener("click", (e) => {
    // Toggle dropdown
    const selectorBtn = e.target.closest("[data-team-selector-btn]");
    if (selectorBtn) {
      const dropdown = document.querySelector("[data-team-dropdown]");
      if (dropdown) {
        dropdown.hidden = !dropdown.hidden;
      }
      return;
    }

    // Switch team
    const switchBtn = e.target.closest("[data-switch-team]");
    if (switchBtn) {
      const teamSlug = switchBtn.dataset.switchTeam;
      switchTeam(teamSlug);
      return;
    }

    // Close dropdown on outside click
    const dropdown = document.querySelector("[data-team-dropdown]");
    if (dropdown && !dropdown.hidden) {
      const selector = e.target.closest("[data-team-selector]");
      if (!selector) {
        dropdown.hidden = true;
      }
    }
  });
}

/**
 * Switch to a different team
 */
async function switchTeam(teamSlug) {
  console.log("[Teams] switchTeam called with slug:", teamSlug);
  try {
    const res = await fetch("/teams/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamSlug }),
    });

    console.log("[Teams] switch response status:", res.status);

    if (res.ok) {
      const data = await res.json();
      console.log("[Teams] switch success, redirecting to team:", data.team?.slug);
      // Redirect to team chat
      window.location.href = `/t/${data.team?.slug || teamSlug}/chat`;
    } else {
      const data = await res.json();
      console.error("[Teams] Failed to switch team:", data.error);
    }
  } catch (err) {
    console.error("[Teams] Failed to switch team:", err);
  }
}

// ============================================================================
// Teams Page
// ============================================================================

/**
 * Initialize teams page functionality
 */
export function initTeamsPage() {
  console.log("[Teams] initTeamsPage called, __TEAMS_PAGE__ =", window.__TEAMS_PAGE__);
  if (!window.__TEAMS_PAGE__) return;

  console.log("[Teams] Setting up click handler for team selection");

  // Team selection
  document.addEventListener("click", (e) => {
    const selectBtn = e.target.closest("[data-select-team]");
    if (selectBtn) {
      const teamSlug = selectBtn.dataset.selectTeam;
      console.log("[Teams] Team card clicked, slug:", teamSlug);
      switchTeam(teamSlug);
    }
  });

  // Create team modal
  initCreateTeamModal();

  // Join team form
  initJoinTeamForm();

  // Delete team buttons
  initDeleteTeamButtons();
}

function initDeleteTeamButtons() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delete-team-id]");
    if (!btn) return;

    e.stopPropagation(); // Prevent triggering team selection

    const teamId = btn.dataset.deleteTeamId;
    const teamName = btn.dataset.deleteTeamName;

    const confirmText = prompt(`Type "${teamName}" to confirm deletion:`);
    if (confirmText !== teamName) {
      if (confirmText !== null) {
        alert("Team name did not match. Deletion cancelled.");
      }
      return;
    }

    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        // Reload to refresh the teams list
        window.location.reload();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete team");
      }
    } catch (err) {
      console.error("[Teams] Failed to delete team:", err);
      alert("Network error. Please try again.");
    }
  });
}

function initCreateTeamModal() {
  const createBtn = document.querySelector("[data-create-team]");
  const modal = document.querySelector("[data-create-team-modal]");
  if (!createBtn || !modal) return;

  createBtn.addEventListener("click", () => {
    modal.hidden = false;
  });

  // Close modal
  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-modal]") || e.target === modal) {
      modal.hidden = true;
    }
  });

  // Auto-generate slug from name
  const nameInput = modal.querySelector("input[name=displayName]");
  const slugInput = modal.querySelector("input[name=slug]");
  if (nameInput && slugInput) {
    nameInput.addEventListener("input", () => {
      if (!slugInput.dataset.userEdited) {
        slugInput.value = generateSlug(nameInput.value);
      }
    });
    slugInput.addEventListener("input", () => {
      slugInput.dataset.userEdited = "true";
    });
  }

  // Submit form
  const form = modal.querySelector("[data-create-team-form]");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorEl = form.querySelector("[data-form-error]");
      if (errorEl) errorEl.hidden = true;

      const formData = new FormData(form);
      const data = {
        displayName: formData.get("displayName"),
        slug: formData.get("slug"),
        description: formData.get("description") || "",
      };

      try {
        const res = await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (res.ok) {
          // Switch to new team
          await switchTeam(result.team.slug);
        } else {
          if (errorEl) {
            errorEl.textContent = result.error || "Failed to create team";
            errorEl.hidden = false;
          }
        }
      } catch (err) {
        console.error("Failed to create team:", err);
        if (errorEl) {
          errorEl.textContent = "Network error. Please try again.";
          errorEl.hidden = false;
        }
      }
    });
  }
}

function initJoinTeamForm() {
  const form = document.querySelector("[data-join-team-form]");
  const errorEl = document.querySelector("[data-join-error]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;

    let code = form.elements.code.value.trim();
    if (!code) return;

    // Parse code from full URL if pasted (e.g., http://example.com/teams/join/ABC123)
    const urlMatch = code.match(/\/teams\/join\/([^/?#]+)/);
    if (urlMatch) {
      code = urlMatch[1];
    }

    try {
      const res = await fetch("/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const result = await res.json();

      if (res.ok) {
        // Redeem invite code to get team encryption key
        try {
          const teamSlug = result.team.slug;
          console.log("[Teams] Redeeming team key for:", teamSlug);
          const keyResult = await redeemInviteForTeamKey(code, teamSlug);
          if (!keyResult.success) {
            console.warn("[Teams] Failed to redeem team key:", keyResult.error);
          } else {
            console.log("[Teams] Team key redeemed successfully");
          }
        } catch (keyErr) {
          console.error("[Teams] Error redeeming team key:", keyErr);
        }

        // Switch to joined team
        await switchTeam(result.team.slug);
      } else {
        if (errorEl) {
          errorEl.textContent = result.error || "Invalid invite code";
          errorEl.hidden = false;
        }
      }
    } catch (err) {
      console.error("Failed to join team:", err);
      if (errorEl) {
        errorEl.textContent = "Network error. Please try again.";
        errorEl.hidden = false;
      }
    }
  });
}

// ============================================================================
// Team Settings Page
// ============================================================================

/**
 * Initialize team settings page functionality
 */
export function initTeamSettingsPage() {
  if (!window.__TEAM_SETTINGS_PAGE__) return;

  const team = window.__CURRENT_TEAM__;
  const isOwner = window.__IS_TEAM_OWNER__;

  // Team info form
  initTeamInfoForm(team, isOwner);

  // Feature visibility form (managers and owners)
  initFeatureVisibilityForm(team);

  // Member management
  if (isOwner) {
    initMemberManagement(team);
  }

  // Invitation management
  initInvitationManagement(team, isOwner);

  // Delete team
  if (isOwner) {
    initDeleteTeam(team);
  }
}

function initTeamInfoForm(team, isOwner) {
  if (!isOwner) return;

  const form = document.querySelector("[data-team-info-form]");
  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"]');

  // Handle form submission (name, description)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const data = {
      displayName: formData.get("displayName"),
      description: formData.get("description"),
    };

    // Show saving state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";
    }

    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        // Update page title
        document.title = `${data.displayName} Settings`;
        // Show success feedback
        if (submitBtn) {
          submitBtn.textContent = "Saved!";
          submitBtn.classList.add("success");
          setTimeout(() => {
            submitBtn.textContent = "Save Changes";
            submitBtn.classList.remove("success");
            submitBtn.disabled = false;
          }, 2000);
        }
      } else {
        const result = await res.json();
        alert(result.error || "Failed to update team");
        if (submitBtn) {
          submitBtn.textContent = "Save Changes";
          submitBtn.disabled = false;
        }
      }
    } catch (err) {
      console.error("Failed to update team:", err);
      alert("Network error. Please try again.");
      if (submitBtn) {
        submitBtn.textContent = "Save Changes";
        submitBtn.disabled = false;
      }
    }
  });

  // Handle icon upload
  initTeamIconUpload(team);
}

/**
 * Initialize feature visibility form
 */
function initFeatureVisibilityForm(team) {
  const form = document.querySelector("[data-feature-visibility-form]");
  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const data = {
      hideTasks: formData.get("hideTasks") === "on",
      hideCrm: formData.get("hideCrm") === "on",
    };

    // Show saving state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";
    }

    try {
      const res = await fetch(`/api/teams/${team.id}/features`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        if (submitBtn) {
          submitBtn.textContent = "Saved!";
          setTimeout(() => {
            submitBtn.textContent = "Save Changes";
            submitBtn.disabled = false;
          }, 1500);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to update feature visibility");
        if (submitBtn) {
          submitBtn.textContent = "Save Changes";
          submitBtn.disabled = false;
        }
      }
    } catch (err) {
      console.error("Failed to update feature visibility:", err);
      alert("Network error. Please try again.");
      if (submitBtn) {
        submitBtn.textContent = "Save Changes";
        submitBtn.disabled = false;
      }
    }
  });
}

/**
 * Initialize team icon upload functionality
 */
function initTeamIconUpload(team) {
  const iconInput = document.querySelector("[data-icon-input]");
  const iconPreview = document.querySelector("[data-icon-preview]");
  if (!iconInput || !iconPreview) return;

  iconInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      alert("Icon file too large. Maximum size is 5MB.");
      iconInput.value = "";
      return;
    }

    // Validate file type
    if (!file.type.match(/^image\/(png|jpeg|gif|webp)$/)) {
      alert("Invalid image file. Supported formats: PNG, JPEG, GIF, WebP.");
      iconInput.value = "";
      return;
    }

    // Show loading state
    const uploadBtn = iconInput.closest("label");
    const originalText = uploadBtn?.textContent?.trim();
    if (uploadBtn) {
      uploadBtn.classList.add("loading");
      const textNode = Array.from(uploadBtn.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = "Uploading...";
    }

    try {
      const formData = new FormData();
      formData.append("icon", file);

      const res = await fetch(`/api/teams/${team.id}/icon`, {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (res.ok) {
        // Update preview with new icon
        iconPreview.innerHTML = `<img src="${result.iconUrl}" alt="Team icon" class="team-icon-img" />`;
        console.log("[Teams] Icon uploaded successfully:", result);
      } else {
        alert(result.error || "Failed to upload icon");
      }
    } catch (err) {
      console.error("Failed to upload icon:", err);
      alert("Network error. Please try again.");
    } finally {
      // Reset input and button state
      iconInput.value = "";
      if (uploadBtn) {
        uploadBtn.classList.remove("loading");
        const textNode = Array.from(uploadBtn.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.textContent = originalText || "Upload Icon";
      }
    }
  });
}

// Cache for user suggestions
let teamUsersCache = [];

/**
 * Fetch all users for autocomplete suggestions
 */
async function fetchTeamUsers() {
  if (teamUsersCache.length > 0) {
    return teamUsersCache;
  }

  try {
    // Fetch from the global users endpoint (all users seen by server)
    const res = await fetch("/chat/users");
    if (!res.ok) {
      console.error("[Teams] Failed to fetch users for suggestions");
      return [];
    }
    teamUsersCache = await res.json();
    return teamUsersCache;
  } catch (err) {
    console.error("[Teams] Error fetching users:", err);
    return [];
  }
}

/**
 * Escape HTML for safe insertion
 */
function escapeHtmlAttr(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Populate the user suggestions datalist
 */
function populateTeamUserSuggestions(users) {
  const datalist = document.querySelector("[data-team-user-suggestions]");
  if (!datalist) return;

  datalist.innerHTML = users
    .map((user) => {
      const displayName = user.display_name || user.name || "";
      const label = displayName || user.npub.slice(0, 16) + "...";
      // Value is the npub, label shows the display name
      return `<option value="${escapeHtmlAttr(user.npub)}">${escapeHtmlAttr(label)}</option>`;
    })
    .join("");
}

function initMemberManagement(team) {
  // Add member modal
  const addBtn = document.querySelector("[data-add-member]");
  const addModal = document.querySelector("[data-add-member-modal]");

  if (addBtn && addModal) {
    addBtn.addEventListener("click", async () => {
      // Fetch users and populate suggestions when modal opens
      const users = await fetchTeamUsers();
      populateTeamUserSuggestions(users);
      addModal.hidden = false;
    });

    addModal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-modal]") || e.target === addModal) {
        addModal.hidden = true;
      }
    });

    const form = addModal.querySelector("[data-add-member-form]");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errorEl = form.querySelector("[data-form-error]");
        if (errorEl) errorEl.hidden = true;

        const formData = new FormData(form);
        const data = {
          npub: formData.get("npub"),
          role: formData.get("role"),
        };

        try {
          const res = await fetch(`/api/teams/${team.id}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });

          if (res.ok) {
            window.location.reload();
          } else {
            const result = await res.json();
            if (errorEl) {
              errorEl.textContent = result.error || "Failed to add member";
              errorEl.hidden = false;
            }
          }
        } catch (err) {
          console.error("Failed to add member:", err);
          if (errorEl) {
            errorEl.textContent = "Network error. Please try again.";
            errorEl.hidden = false;
          }
        }
      });
    }
  }

  // Role change handlers
  document.addEventListener("change", async (e) => {
    const select = e.target.closest("[data-member-role]");
    if (!select) return;

    const npub = select.dataset.memberRole;
    const role = select.value;

    try {
      const res = await fetch(`/api/teams/${team.id}/members/${encodeURIComponent(npub)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      if (!res.ok) {
        const result = await res.json();
        alert(result.error || "Failed to update role");
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to update role:", err);
      alert("Network error. Please try again.");
      window.location.reload();
    }
  });

  // Remove member handlers
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove-member]");
    if (!btn) return;

    const npub = btn.dataset.removeMember;
    if (!confirm("Remove this member from the team?")) return;

    try {
      const res = await fetch(`/api/teams/${team.id}/members/${encodeURIComponent(npub)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        window.location.reload();
      } else {
        const result = await res.json();
        alert(result.error || "Failed to remove member");
      }
    } catch (err) {
      console.error("Failed to remove member:", err);
      alert("Network error. Please try again.");
    }
  });
}

function initInvitationManagement(team, isOwner) {
  const createBtn = document.querySelector("[data-create-invite]");
  const inviteModal = document.querySelector("[data-invite-modal]");

  if (!createBtn || !inviteModal) return;

  createBtn.addEventListener("click", () => {
    // Reset modal
    const form = inviteModal.querySelector("[data-create-invite-form]");
    const result = inviteModal.querySelector("[data-invite-result]");
    if (form) form.style.display = "";
    if (result) result.hidden = true;
    inviteModal.hidden = false;
  });

  inviteModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-modal]") || e.target === inviteModal) {
      inviteModal.hidden = true;
    }
  });

  // Create invite form
  const form = inviteModal.querySelector("[data-create-invite-form]");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(form);

      // Get selected group IDs from checkboxes
      const groupIds = formData.getAll("groupIds").map((id) => parseInt(id, 10));
      console.log("[Teams] Form data - groupIds:", groupIds, "label:", formData.get("label"));

      const data = {
        role: formData.get("role"),
        expiresInHours: parseInt(formData.get("expiresInHours"), 10),
        singleUse: formData.get("singleUse") === "on",
        label: formData.get("label") || null,
        groupIds: groupIds.length > 0 ? groupIds : undefined,
      };
      console.log("[Teams] Sending invite data:", data);

      try {
        const res = await fetch(`/api/teams/${team.id}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();
        console.log("[Teams] Invite API response:", result);

        if (res.ok) {
          // Store encrypted team key for this invite
          try {
            const codeHash = await hashInviteCode(result.code);
            const keyResult = await storeEncryptedKeyForInvite(result.code, codeHash);
            if (!keyResult.success) {
              console.warn("[Teams] Failed to store team key for invite:", keyResult.error);
            } else {
              console.log("[Teams] Team key stored for invite");
            }
          } catch (keyErr) {
            console.error("[Teams] Error storing team key for invite:", keyErr);
          }

          // Show invite link
          form.style.display = "none";
          const resultEl = inviteModal.querySelector("[data-invite-result]");
          const linkInput = inviteModal.querySelector("[data-invite-link]");
          console.log("[Teams] Result elements:", { resultEl, linkInput, inviteUrl: result.inviteUrl });
          if (resultEl && linkInput) {
            linkInput.value = result.inviteUrl;
            resultEl.hidden = false;
          } else {
            console.error("[Teams] Missing result elements in modal");
          }
        } else {
          alert(result.error || "Failed to create invitation");
        }
      } catch (err) {
        console.error("Failed to create invite:", err);
        alert("Network error. Please try again.");
      }
    });
  }

  // Copy invite link
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy-invite]");
    if (!btn) return;

    const input = inviteModal.querySelector("[data-invite-link]");
    if (input) {
      navigator.clipboard.writeText(input.value).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 2000);
      });
    }
  });

  // Delete invite handlers
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delete-invite]");
    if (!btn) return;

    const inviteId = btn.dataset.deleteInvite;
    if (!confirm("Delete this invitation?")) return;

    try {
      const res = await fetch(`/api/teams/${team.id}/invitations/${inviteId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        window.location.reload();
      } else {
        const result = await res.json();
        alert(result.error || "Failed to delete invitation");
      }
    } catch (err) {
      console.error("Failed to delete invite:", err);
      alert("Network error. Please try again.");
    }
  });
}

function initDeleteTeam(team) {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delete-team]");
    if (!btn) return;

    const confirmText = prompt(`Type "${team.displayName}" to confirm deletion:`);
    if (confirmText !== team.displayName) {
      alert("Team name did not match. Deletion cancelled.");
      return;
    }

    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        window.location.href = "/teams";
      } else {
        const result = await res.json();
        alert(result.error || "Failed to delete team");
      }
    } catch (err) {
      console.error("Failed to delete team:", err);
      alert("Network error. Please try again.");
    }
  });
}

// ============================================================================
// Helpers
// ============================================================================

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

// ============================================================================
// Key Request Auto-Fulfillment
// ============================================================================

/**
 * Fetch pending key requests that this user should fulfill
 * (requests from invites they created)
 */
async function fetchPendingKeyRequests() {
  try {
    const res = await fetch(teamUrl("/api/key-requests/pending"));
    if (!res.ok) {
      console.error("[Teams] Failed to fetch pending key requests:", res.status);
      return [];
    }
    const data = await res.json();
    return data.requests || [];
  } catch (err) {
    console.error("[Teams] Error fetching pending key requests:", err);
    return [];
  }
}

/**
 * Fulfill a single key request with a wrapped encryption key
 */
async function fulfillKeyRequest(request) {
  try {
    // Get the channel key
    const channelKey = await fetchChannelKey(String(request.channel_id));
    if (!channelKey) {
      console.warn(`[Teams] Cannot fulfill request ${request.id} - no channel key available`);
      return false;
    }

    // Wrap the key for the requester
    const wrappedKey = await wrapKeyForUser(channelKey, request.requester_pubkey);

    // Submit to server
    const res = await fetch(teamUrl(`/api/key-requests/${request.id}/fulfill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedKey: wrappedKey, keyVersion: 1 }),
    });

    if (!res.ok) {
      const data = await res.json();
      console.error(`[Teams] Failed to fulfill request ${request.id}:`, data.error);
      return false;
    }

    console.log(`[Teams] Auto-fulfilled key request ${request.id} for channel ${request.channel_id}`);
    return true;
  } catch (err) {
    console.error(`[Teams] Error fulfilling key request ${request.id}:`, err);
    return false;
  }
}

/**
 * Auto-fulfill all pending key requests from invites this user created
 * Called on page load and when key_request:new SSE event received
 */
export async function autoFulfillPendingKeyRequests() {
  if (!window.__TEAM_SLUG__) {
    // Not in team context
    return;
  }

  console.log("[Teams] Checking for pending key requests to auto-fulfill...");
  const requests = await fetchPendingKeyRequests();

  if (requests.length === 0) {
    console.log("[Teams] No pending key requests");
    return;
  }

  console.log(`[Teams] Found ${requests.length} pending key request(s)`);

  let fulfilled = 0;
  for (const request of requests) {
    const success = await fulfillKeyRequest(request);
    if (success) fulfilled++;
  }

  console.log(`[Teams] Auto-fulfilled ${fulfilled}/${requests.length} key requests`);
}

// ============================================================================
// Initialize
// ============================================================================

export function initTeams() {
  initTeamSelector();
  initTeamsPage();
  initTeamSettingsPage();

  // Auto-fulfill pending key requests on page load (non-blocking)
  autoFulfillPendingKeyRequests();
}
