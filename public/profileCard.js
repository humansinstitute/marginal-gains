/**
 * Profile Card Popover
 *
 * A clickable profile card that shows user info (avatar, name, npub)
 * when clicking on any avatar or element with [data-profile-npub].
 *
 * Usage: import { initProfileCards } from "./profileCard.js";
 *        initProfileCards({ getUserInfo });
 */

let getUserInfo = null;
let activeCard = null;
let initialized = false;

/**
 * Initialize profile cards.
 * @param {Object} deps
 * @param {Function} deps.getUserInfo - (npub) => { displayName, picture, npub, about, nip05 }
 */
export function initProfileCards(deps) {
  if (deps.getUserInfo) getUserInfo = deps.getUserInfo;

  if (initialized) return;
  initialized = true;

  // Create the card element once
  ensureCardElement();

  // Use event delegation on document body
  document.addEventListener("click", handleClick);
}

/**
 * Update the getUserInfo callback (e.g., when additional data becomes available)
 */
export function updateProfileCardUserInfo(fn) {
  const prev = getUserInfo;
  getUserInfo = (npub) => {
    const result = fn(npub);
    if (result) return result;
    return prev ? prev(npub) : null;
  };
}

function ensureCardElement() {
  if (document.getElementById("profile-card")) return;

  const card = document.createElement("div");
  card.id = "profile-card";
  card.className = "profile-card";
  card.hidden = true;
  card.innerHTML = `
    <div class="profile-card-inner">
      <img class="profile-card-avatar" src="" alt="" />
      <div class="profile-card-info">
        <div class="profile-card-name"></div>
        <div class="profile-card-nip05"></div>
        <div class="profile-card-about"></div>
        <div class="profile-card-npub-row">
          <code class="profile-card-npub"></code>
          <button type="button" class="profile-card-copy" title="Copy npub">Copy</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(card);

  // Wire copy button
  card.querySelector(".profile-card-copy").addEventListener("click", (e) => {
    e.stopPropagation();
    const npub = card.querySelector(".profile-card-npub").textContent;
    if (npub) {
      navigator.clipboard.writeText(npub).then(() => {
        const btn = card.querySelector(".profile-card-copy");
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy"; }, 1500);
      });
    }
  });

  // Prevent card clicks from closing the card
  card.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

function handleClick(e) {
  const trigger = e.target.closest("[data-profile-npub]");

  // If clicking outside card and trigger, close
  if (!trigger) {
    closeCard();
    return;
  }

  e.stopPropagation();

  const npub = trigger.dataset.profileNpub;
  if (!npub) return;

  // Toggle off if clicking the same trigger
  if (activeCard && activeCard.dataset.triggerNpub === npub) {
    closeCard();
    return;
  }

  showCard(npub, trigger);
}

function showCard(npub, triggerEl) {
  const card = document.getElementById("profile-card");
  if (!card) return;

  // Get user info
  const info = getUserInfo ? getUserInfo(npub) : null;
  const displayName = info?.displayName || info?.display_name || formatNpub(npub);
  const picture = info?.picture || `https://robohash.org/${encodeURIComponent(npub)}.png?set=set3`;
  const about = info?.about || "";
  const nip05 = info?.nip05 || "";

  // Fill card
  card.querySelector(".profile-card-avatar").src = picture;
  card.querySelector(".profile-card-name").textContent = displayName;
  card.querySelector(".profile-card-npub").textContent = npub;

  const aboutEl = card.querySelector(".profile-card-about");
  if (about) {
    aboutEl.textContent = about.length > 120 ? about.slice(0, 120) + "..." : about;
    aboutEl.hidden = false;
  } else {
    aboutEl.hidden = true;
  }

  const nip05El = card.querySelector(".profile-card-nip05");
  if (nip05) {
    nip05El.textContent = nip05;
    nip05El.hidden = false;
  } else {
    nip05El.hidden = true;
  }

  // Position card near the trigger element
  card.hidden = false;
  card.dataset.triggerNpub = npub;
  activeCard = card;

  positionCard(card, triggerEl);
}

function positionCard(card, triggerEl) {
  const triggerRect = triggerEl.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const padding = 8;

  // Try positioning to the right of the trigger
  let left = triggerRect.right + padding;
  let top = triggerRect.top;

  // If it overflows right, position to the left
  if (left + cardRect.width > window.innerWidth - padding) {
    left = triggerRect.left - cardRect.width - padding;
  }

  // If it overflows left, center it under the trigger
  if (left < padding) {
    left = Math.max(padding, triggerRect.left + (triggerRect.width / 2) - (cardRect.width / 2));
    top = triggerRect.bottom + padding;
  }

  // If it overflows bottom, move up
  if (top + cardRect.height > window.innerHeight - padding) {
    top = window.innerHeight - cardRect.height - padding;
  }

  // Ensure not above viewport
  if (top < padding) {
    top = padding;
  }

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function closeCard() {
  const card = document.getElementById("profile-card");
  if (card) {
    card.hidden = true;
    delete card.dataset.triggerNpub;
  }
  activeCard = null;
}

function formatNpub(npub) {
  if (!npub || npub.length <= 16) return npub || "";
  return `${npub.slice(0, 10)}...${npub.slice(-6)}`;
}

/**
 * Close the profile card programmatically (e.g., on scroll or navigation)
 */
export function closeProfileCard() {
  closeCard();
}
