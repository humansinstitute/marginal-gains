import { chatUrl, teamUrl } from "./api.js";
import { initAppSettings } from "./appSettings.js";
import { clearBunkerConnection, hasBunkerConnection } from "./auth.js";
import { distributeKeysToAllPendingMembers } from "./chatCrypto.js";
import {
  getCommunityStatus,
  bootstrapCommunityEncryption,
  createInviteCode,
  listInviteCodes,
  deleteInviteCode,
  getMigrationStatus,
  getMigrationMessages,
  submitMigrationBatch,
  completeMigration,
} from "./communityCrypto.js";
import { formatUnixDate } from "./dateUtils.js";
import { elements as el, hide, show, escapeHtml } from "./dom.js";
import { initNotifications } from "./notifications.js";
import { state } from "./state.js";
import { initWingmanSettings } from "./wingmanSettings.js";

// Settings page state
let groups = [];
let users = [];
let selectedGroupId = null;
let groupMembers = [];

// Initialize settings page
export async function initSettings() {
  try {
    // Handle Personal Settings page
    if (window.__PERSONAL_SETTINGS_PAGE__) {
      initAccountSection();
      await initNotifications();
      return;
    }

    // Handle App Settings page (admin only)
    if (window.__APP_SETTINGS_PAGE__) {
      await initAppSettings();
      return;
    }

    // Handle Team Settings page
    if (window.__TEAM_SETTINGS_PAGE__) {
      // Wingman AI settings for team
      await initWingmanSettings();

      // Groups management for team
      await Promise.all([fetchGroups(), fetchUsers()]);
      renderGroups();
      wireEventListeners();
      return;
    }
  } catch (err) {
    console.error("[Settings] Error during initialization:", err);
    throw err;
  }

  // Legacy: Handle old combined settings page
  if (!window.__SETTINGS_PAGE__) return;

  // Account section is available to all users
  initAccountSection();

  // Notifications are available to all users
  await initNotifications();

  // Admin-only sections
  if (window.__IS_ADMIN__) {
    // App settings (name, favicon)
    await initAppSettings();

    // Community encryption settings
    await initCommunityEncryption();

    // Wingman AI settings
    await initWingmanSettings();

    // Groups management
    await Promise.all([fetchGroups(), fetchUsers()]);
    renderGroups();
    wireEventListeners();
  }
}

// Initialize account section
function initAccountSection() {
  const accountContent = document.querySelector("[data-account-content]");
  const bunkerSettings = document.querySelector("[data-bunker-settings]");
  const clearBunkerBtn = document.querySelector("[data-clear-bunker]");

  if (!accountContent) return;

  // Show login method info
  const session = state.session || window.__NOSTR_SESSION__;
  if (session) {
    const methodLabels = {
      ephemeral: "Ephemeral Key",
      extension: "Browser Extension",
      bunker: "Remote Signer (Nostr Connect)",
      secret: "Secret Key (nsec)",
    };
    const methodLabel = methodLabels[session.method] || session.method;
    accountContent.innerHTML = `<p class="account-method">Login method: <strong>${escapeHtml(methodLabel)}</strong></p>`;

    // Show bunker settings if using bunker
    if (session.method === "bunker" && hasBunkerConnection()) {
      show(bunkerSettings);
    }
  } else {
    accountContent.innerHTML = `<p class="settings-empty">Not logged in</p>`;
  }

  // Wire up clear bunker button
  clearBunkerBtn?.addEventListener("click", async () => {
    if (!confirm("Clear bunker connection and log out?")) return;

    clearBunkerConnection();

    // Log out
    await fetch("/auth/logout", { method: "POST" });
    window.location.href = "/";
  });
}

// Fetch all groups
async function fetchGroups() {
  try {
    const res = await fetch(teamUrl("/groups"));
    if (!res.ok) return;
    groups = await res.json();
  } catch (_err) {
    console.error("[Settings] Failed to fetch groups");
  }
}

// Fetch all users for autocomplete
async function fetchUsers() {
  try {
    const res = await fetch(chatUrl("/users"));
    if (!res.ok) return;
    users = await res.json();
    updateUserSuggestions();
  } catch (_err) {
    console.error("[Settings] Failed to fetch users");
  }
}

// Update the datalist for user suggestions
function updateUserSuggestions() {
  const datalist = document.querySelector("[data-user-suggestions]");
  if (!datalist) return;

  datalist.innerHTML = users
    .map((user) => {
      const label = user.display_name || user.name || user.npub.slice(0, 16) + "...";
      return `<option value="${escapeHtml(user.npub)}">${escapeHtml(label)}</option>`;
    })
    .join("");
}

// Render groups list
function renderGroups() {
  const container = document.querySelector("[data-groups-list]");
  if (!container) return;

  if (groups.length === 0) {
    container.innerHTML = `<p class="settings-empty">No groups yet. Create one to get started.</p>`;
    return;
  }

  container.innerHTML = groups
    .map((group) => {
      const isActive = group.id === selectedGroupId;
      return `<div class="settings-group-item${isActive ? " active" : ""}" data-group-id="${group.id}">
        <div class="settings-group-info">
          <span class="settings-group-name">${escapeHtml(group.name)}</span>
          <span class="settings-group-meta">${escapeHtml(group.description || "No description")}</span>
        </div>
        <div class="settings-group-actions">
          <button type="button" class="ghost" data-delete-group="${group.id}" title="Delete group">Delete</button>
        </div>
      </div>`;
    })
    .join("");

  // Wire up click handlers
  container.querySelectorAll("[data-group-id]").forEach((item) => {
    item.addEventListener("click", (e) => {
      // Ignore if clicking delete button
      if (e.target.closest("[data-delete-group]")) return;
      const groupId = Number(item.dataset.groupId);
      selectGroup(groupId);
    });
  });

  // Wire up delete handlers
  container.querySelectorAll("[data-delete-group]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const groupId = Number(btn.dataset.deleteGroup);
      if (confirm("Delete this group? Members will lose access to associated channels.")) {
        await deleteGroup(groupId);
      }
    });
  });
}

// Select a group and show its members
async function selectGroup(groupId) {
  selectedGroupId = groupId;
  renderGroups();

  const membersSection = document.querySelector("[data-members-section]");
  const groupNameEl = document.querySelector("[data-members-group-name]");
  const group = groups.find((g) => g.id === groupId);

  if (!group || !membersSection) return;

  show(membersSection);
  if (groupNameEl) {
    groupNameEl.textContent = `${group.name} members`;
  }

  await fetchGroupMembers(groupId);
}

// Fetch members for a group
async function fetchGroupMembers(groupId) {
  try {
    const res = await fetch(teamUrl(`/groups/${groupId}/members`));
    if (!res.ok) return;
    groupMembers = await res.json();
    renderMembers();
  } catch (_err) {
    console.error("[Settings] Failed to fetch group members");
  }
}

// Render members list
function renderMembers() {
  const container = document.querySelector("[data-members-list]");
  if (!container) return;

  if (groupMembers.length === 0) {
    container.innerHTML = `<p class="settings-empty">No members yet. Add someone using the input above.</p>`;
    return;
  }

  container.innerHTML = groupMembers
    .map((member) => {
      const name = member.display_name || member.npub.slice(0, 12) + "...";
      const shortNpub = member.npub.slice(0, 16) + "..." + member.npub.slice(-8);
      const avatarUrl = member.picture || `https://robohash.org/${member.npub}.png?set=set3`;
      return `<div class="settings-member-item">
        <div class="settings-member-info">
          <img class="settings-member-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
          <div class="settings-member-details">
            <span class="settings-member-name">${escapeHtml(name)}</span>
            <span class="settings-member-npub">${escapeHtml(shortNpub)}</span>
          </div>
        </div>
        <button type="button" class="ghost" data-remove-member="${escapeHtml(member.npub)}">Remove</button>
      </div>`;
    })
    .join("");

  // Wire up remove handlers
  container.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const npub = btn.dataset.removeMember;
      await removeMember(npub);
    });
  });
}

// Create a new group
async function createGroup(name, description) {
  try {
    const res = await fetch(teamUrl("/groups"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (res.ok) {
      const group = await res.json();
      groups.push(group);
      renderGroups();
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to create group");
      return false;
    }
  } catch (_err) {
    console.error("[Settings] Failed to create group");
    return false;
  }
}

// Delete a group
async function deleteGroup(groupId) {
  try {
    const res = await fetch(teamUrl(`/groups/${groupId}`), { method: "DELETE" });
    if (res.ok) {
      groups = groups.filter((g) => g.id !== groupId);
      if (selectedGroupId === groupId) {
        selectedGroupId = null;
        hide(document.querySelector("[data-members-section]"));
      }
      renderGroups();
    }
  } catch (_err) {
    console.error("[Settings] Failed to delete group");
  }
}

// Add a member to the selected group
async function addMember(npub) {
  if (!selectedGroupId || !npub) return;

  // Validate npub format
  if (!npub.startsWith("npub")) {
    alert("Please enter a valid npub (starts with 'npub')");
    return;
  }

  // Check if adding Wingman - show privacy warning
  if (communityStatus?.wingmanNpub && npub === communityStatus.wingmanNpub) {
    const confirmed = confirm(
      "Please be aware adding Wingman to your group has privacy implications " +
      "and conversation threads may get leaked to 3rd party AI or server logs.\n\n" +
      "Continue?"
    );
    if (!confirmed) return;
  }

  try {
    const res = await fetch(teamUrl(`/groups/${selectedGroupId}/members`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npubs: [npub] }),
    });
    if (res.ok) {
      const data = await res.json();
      await fetchGroupMembers(selectedGroupId);
      // Clear the input
      const input = document.querySelector("[data-member-input]");
      if (input) input.value = "";

      // Distribute keys to encrypted channels that need them
      if (data.encryptedChannelsNeedingKeys?.length > 0) {
        console.log("[Settings] Distributing keys to encrypted channels:", data.encryptedChannelsNeedingKeys);
        for (const channel of data.encryptedChannelsNeedingKeys) {
          try {
            const result = await distributeKeysToAllPendingMembers(channel.id);
            console.log(`[Settings] Distributed keys for channel ${channel.name}:`, result);
          } catch (err) {
            console.error(`[Settings] Failed to distribute keys for channel ${channel.name}:`, err);
          }
        }
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to add member");
    }
  } catch (_err) {
    console.error("[Settings] Failed to add member");
  }
}

// Remove a member from the selected group
async function removeMember(npub) {
  if (!selectedGroupId) return;

  try {
    const res = await fetch(teamUrl(`/groups/${selectedGroupId}/members/${encodeURIComponent(npub)}`), {
      method: "DELETE",
    });
    if (res.ok) {
      groupMembers = groupMembers.filter((m) => m.npub !== npub);
      renderMembers();
    }
  } catch (_err) {
    console.error("[Settings] Failed to remove member");
  }
}

// Wire up all event listeners
function wireEventListeners() {
  // Create group button
  const createGroupBtn = document.querySelector("[data-create-group]");
  const groupModal = document.querySelector("[data-group-modal]");
  const closeModalBtns = document.querySelectorAll("[data-close-group-modal]");
  const groupForm = document.querySelector("[data-group-form]");

  createGroupBtn?.addEventListener("click", () => show(groupModal));
  closeModalBtns?.forEach((btn) => btn.addEventListener("click", () => hide(groupModal)));
  groupModal?.addEventListener("click", (e) => {
    if (e.target === groupModal) hide(groupModal);
  });

  groupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();

    if (!name) {
      alert("Group name is required");
      return;
    }

    const success = await createGroup(name, description);
    if (success) {
      hide(groupModal);
      e.currentTarget.reset();
    }
  });

  // Close members section
  const closeMembersBtn = document.querySelector("[data-close-members]");
  closeMembersBtn?.addEventListener("click", () => {
    selectedGroupId = null;
    hide(document.querySelector("[data-members-section]"));
    renderGroups();
  });

  // Add member
  const addMemberBtn = document.querySelector("[data-add-member]");
  const memberInput = document.querySelector("[data-member-input]");

  addMemberBtn?.addEventListener("click", () => {
    const npub = memberInput?.value?.trim();
    if (npub) addMember(npub);
  });

  memberInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const npub = memberInput.value?.trim();
      if (npub) addMember(npub);
    }
  });
}

// ============================================================
// Community Encryption Management
// ============================================================

let communityStatus = null;
let inviteCodes = [];

async function initCommunityEncryption() {
  // Load community status
  communityStatus = await getCommunityStatus();
  if (!communityStatus) {
    console.warn("[Settings] Could not load community status");
    return;
  }

  renderCommunityStatus();
  wireCommunityEventListeners();

  // If bootstrapped, load invite codes
  if (communityStatus.bootstrapped) {
    inviteCodes = await listInviteCodes();
    renderInviteCodes();
  }
}

function renderCommunityStatus() {
  const statusEl = document.querySelector("[data-community-status]");
  const bootstrapPanel = document.querySelector("[data-community-bootstrap]");
  const invitesPanel = document.querySelector("[data-community-invites]");
  const migrationPanel = document.querySelector("[data-community-migration]");

  if (!statusEl) return;

  if (!communityStatus.bootstrapped) {
    // Not bootstrapped - show bootstrap panel
    statusEl.innerHTML = `<p class="community-status-text">
      <span class="status-icon warning">!</span>
      Community encryption is not enabled yet.
    </p>`;
    show(bootstrapPanel);
    hide(invitesPanel);
    hide(migrationPanel);
  } else {
    // Bootstrapped - show status and invite panel
    const admin = communityStatus.admin;
    statusEl.innerHTML = `<p class="community-status-text">
      <span class="status-icon success">&#10003;</span>
      Community encryption is active.
      ${admin ? `<br><small>${admin.keysDistributed} users have keys, ${admin.pendingMessages} messages pending encryption.</small>` : ""}
    </p>`;
    hide(bootstrapPanel);
    show(invitesPanel);

    // Show migration panel if needed
    if (admin?.needsMigration) {
      show(migrationPanel);
      renderMigrationStatus(admin.pendingMessages);
    } else {
      hide(migrationPanel);
    }
  }
}

function renderMigrationStatus(pendingCount) {
  const statusEl = document.querySelector("[data-migration-status]");
  if (!statusEl) return;

  if (pendingCount === 0) {
    statusEl.innerHTML = `<p class="migration-complete">All messages are encrypted.</p>`;
  } else {
    statusEl.innerHTML = `<p>${pendingCount} messages need encryption.</p>`;
  }
}

function renderInviteCodes() {
  const container = document.querySelector("[data-invite-list]");
  if (!container) return;

  if (inviteCodes.length === 0) {
    container.innerHTML = `<p class="settings-empty">No active invite codes</p>`;
    return;
  }

  container.innerHTML = inviteCodes
    .map((invite) => {
      const expiresStr = formatUnixDate(invite.expiresAt);
      const useType = invite.singleUse ? "Single-use" : "Multi-use";
      const usedCount = invite.redeemedCount || 0;

      return `<div class="invite-item">
        <div class="invite-info">
          <span class="invite-type">${escapeHtml(useType)}</span>
          <span class="invite-meta">Expires ${escapeHtml(expiresStr)} &middot; Used ${usedCount} times</span>
        </div>
        <button type="button" class="ghost danger" data-delete-invite="${invite.id}">Delete</button>
      </div>`;
    })
    .join("");

  // Wire up delete handlers
  container.querySelectorAll("[data-delete-invite]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.deleteInvite);
      if (confirm("Delete this invite code?")) {
        const success = await deleteInviteCode(id);
        if (success) {
          inviteCodes = inviteCodes.filter((i) => i.id !== id);
          renderInviteCodes();
        }
      }
    });
  });
}

function wireCommunityEventListeners() {
  // Bootstrap button
  const bootstrapBtn = document.querySelector("[data-bootstrap-community]");
  bootstrapBtn?.addEventListener("click", handleBootstrapCommunity);

  // Invite modal
  const createInviteBtn = document.querySelector("[data-create-invite]");
  const inviteModal = document.querySelector("[data-invite-modal]");
  const closeInviteModalBtns = document.querySelectorAll("[data-close-invite-modal]");
  const inviteForm = document.querySelector("[data-invite-form]");
  const inviteResult = document.querySelector("[data-invite-result]");
  const copyInviteBtn = document.querySelector("[data-copy-invite]");

  createInviteBtn?.addEventListener("click", () => {
    // Reset modal state
    hide(inviteResult);
    show(inviteForm);
    inviteForm?.reset();
    show(inviteModal);
  });

  closeInviteModalBtns?.forEach((btn) =>
    btn.addEventListener("click", () => hide(inviteModal))
  );

  inviteModal?.addEventListener("click", (e) => {
    if (e.target === inviteModal) hide(inviteModal);
  });

  inviteForm?.addEventListener("submit", handleCreateInvite);

  copyInviteBtn?.addEventListener("click", () => {
    const codeEl = document.querySelector("[data-invite-code-text]");
    if (codeEl?.textContent) {
      navigator.clipboard.writeText(codeEl.textContent);
      copyInviteBtn.textContent = "Copied!";
      setTimeout(() => {
        copyInviteBtn.textContent = "Copy";
      }, 2000);
    }
  });

  // Migration button
  const migrationBtn = document.querySelector("[data-run-migration]");
  migrationBtn?.addEventListener("click", handleRunMigration);
}

async function handleBootstrapCommunity() {
  const btn = document.querySelector("[data-bootstrap-community]");
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = "Enabling...";

  try {
    // Include Wingman in key distribution if configured
    const wingmanPubkey = communityStatus?.admin?.wingmanPubkey ?? null;
    const result = await bootstrapCommunityEncryption(users, wingmanPubkey);

    if (result.success) {
      // Refresh status
      communityStatus = await getCommunityStatus();
      renderCommunityStatus();

      // Load invite codes
      inviteCodes = await listInviteCodes();
      renderInviteCodes();

      alert(`Community encryption enabled! ${result.keysDistributed} users have been given keys.`);
    } else {
      alert(`Failed to enable encryption: ${result.error}`);
    }
  } catch (err) {
    console.error("[Settings] Bootstrap error:", err);
    alert("Failed to enable community encryption");
  } finally {
    btn.disabled = false;
    btn.textContent = "Enable Community Encryption";
  }
}

async function handleCreateInvite(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);

  const ttlDays = Number(formData.get("ttlDays")) || 7;
  const singleUse = formData.get("singleUse") === "on";

  submitBtn.disabled = true;
  submitBtn.textContent = "Generating...";

  try {
    const result = await createInviteCode({ singleUse, ttlDays });

    if (result.success) {
      // Show the code
      const inviteResult = document.querySelector("[data-invite-result]");
      const codeText = document.querySelector("[data-invite-code-text]");

      if (codeText) codeText.textContent = result.code;
      hide(form);
      show(inviteResult);

      // Refresh invite list
      inviteCodes = await listInviteCodes();
      renderInviteCodes();
    } else {
      alert(`Failed to create invite: ${result.error}`);
    }
  } catch (err) {
    console.error("[Settings] Create invite error:", err);
    alert("Failed to create invite code");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Generate";
  }
}

async function handleRunMigration() {
  const btn = document.querySelector("[data-run-migration]");
  const statusEl = document.querySelector("[data-migration-status]");
  if (!btn || !statusEl) return;

  btn.disabled = true;
  btn.textContent = "Encrypting...";

  try {
    let lastId = null;
    let totalProcessed = 0;

    // Process in batches
    while (true) {
      const batch = await getMigrationMessages(100, lastId);
      if (!batch || batch.messages.length === 0) break;

      statusEl.innerHTML = `<p>Processing batch... (${totalProcessed} messages done)</p>`;

      const result = await submitMigrationBatch(batch.messages);
      if (!result) {
        console.error("[Settings] Migration batch failed");
        break;
      }

      totalProcessed += result.updated;
      lastId = batch.messages[batch.messages.length - 1].id;

      if (result.complete || !batch.hasMore) {
        break;
      }
    }

    // Complete migration
    await completeMigration();

    // Refresh status
    communityStatus = await getCommunityStatus();
    renderCommunityStatus();

    statusEl.innerHTML = `<p class="migration-complete">Migration complete! ${totalProcessed} messages encrypted.</p>`;
  } catch (err) {
    console.error("[Settings] Migration error:", err);
    statusEl.innerHTML = `<p class="migration-error">Migration failed. Please try again.</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Encrypt Existing Messages";
  }
}
