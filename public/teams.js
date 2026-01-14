/**
 * Teams Module
 *
 * Client-side functionality for multi-tenant team management:
 * - Team selector dropdown
 * - Team switching
 * - Teams page (join/create)
 * - Team settings page
 */

import { state, setSession } from "./state.js";

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const data = {
      displayName: formData.get("displayName"),
      description: formData.get("description"),
    };

    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        // Update page title
        document.title = `${data.displayName} Settings`;
      } else {
        const result = await res.json();
        alert(result.error || "Failed to update team");
      }
    } catch (err) {
      console.error("Failed to update team:", err);
      alert("Network error. Please try again.");
    }
  });
}

function initMemberManagement(team) {
  // Add member modal
  const addBtn = document.querySelector("[data-add-member]");
  const addModal = document.querySelector("[data-add-member-modal]");

  if (addBtn && addModal) {
    addBtn.addEventListener("click", () => {
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
      const data = {
        role: formData.get("role"),
        expiresInHours: parseInt(formData.get("expiresInHours"), 10),
        singleUse: formData.get("singleUse") === "on",
      };

      try {
        const res = await fetch(`/api/teams/${team.id}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();
        console.log("[Teams] Invite API response:", result);

        if (res.ok) {
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
// Initialize
// ============================================================================

export function initTeams() {
  initTeamSelector();
  initTeamsPage();
  initTeamSettingsPage();
}
