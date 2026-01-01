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
  if (!window.__SETTINGS_PAGE__) return;

  // Notifications are available to all users
  await initNotifications();

  // Admin-only sections
  if (window.__IS_ADMIN__) {
    // Wingman AI settings
    await initWingmanSettings();

    // Groups management
    await Promise.all([fetchGroups(), fetchUsers()]);
    renderGroups();
    wireEventListeners();
  }
}

// Fetch all groups
async function fetchGroups() {
  try {
    const res = await fetch("/chat/groups");
    if (!res.ok) return;
    groups = await res.json();
  } catch (_err) {
    console.error("[Settings] Failed to fetch groups");
  }
}

// Fetch all users for autocomplete
async function fetchUsers() {
  try {
    const res = await fetch("/chat/users");
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
    const res = await fetch(`/chat/groups/${groupId}/members`);
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
    const res = await fetch("/chat/groups", {
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
    const res = await fetch(`/chat/groups/${groupId}`, { method: "DELETE" });
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

  try {
    const res = await fetch(`/chat/groups/${selectedGroupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npubs: [npub] }),
    });
    if (res.ok) {
      await fetchGroupMembers(selectedGroupId);
      // Clear the input
      const input = document.querySelector("[data-member-input]");
      if (input) input.value = "";
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
    const res = await fetch(`/chat/groups/${selectedGroupId}/members/${encodeURIComponent(npub)}`, {
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
