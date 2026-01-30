/**
 * Optikon Integration Module
 *
 * Handles client-side NIP-98 authentication and Optikon API calls.
 * The board creation must happen client-side since it requires
 * signing with the user's Nostr private key.
 */

/**
 * Create a NIP-98 authorization header for HTTP requests
 * @param {string} url - The target URL
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {Object} nostrSigner - Object with signEvent method (extension or ephemeral)
 * @returns {Promise<string>} - The authorization header value
 */
export async function createNip98Auth(url, method, nostrSigner) {
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", method.toUpperCase()],
    ],
    content: "",
  };

  // Sign the event using the provided signer
  const signedEvent = await nostrSigner.signEvent(event);

  // Encode as base64
  const eventJson = JSON.stringify(signedEvent);
  const base64Event = btoa(eventJson);

  return `Nostr ${base64Event}`;
}

/**
 * Get the user's Nostr signer (extension or ephemeral)
 * @returns {Promise<Object|null>} - Signer object with signEvent method, or null
 */
export async function getNostrSigner() {
  // Try NIP-07 extension first (window.nostr)
  if (window.nostr && typeof window.nostr.signEvent === "function") {
    return {
      signEvent: async (event) => {
        return await window.nostr.signEvent(event);
      },
      getPubkey: async () => {
        return await window.nostr.getPublicKey();
      },
    };
  }

  // Try ephemeral key from session storage
  const session = window.__NOSTR_SESSION__;
  if (session?.method === "ephemeral") {
    // For ephemeral users, we need the secret key from IndexedDB
    // This is handled by the auth module, we'll need to coordinate
    const ephemeralSigner = window.__EPHEMERAL_SIGNER__;
    if (ephemeralSigner && typeof ephemeralSigner.signEvent === "function") {
      return ephemeralSigner;
    }
  }

  return null;
}

/**
 * Create a new board on Optikon
 * @param {Object} params - Board creation parameters
 * @param {string} params.title - Board title (from task title)
 * @param {string} params.description - Board description (from task description)
 * @param {number|null} params.workspaceId - Workspace ID (from group settings)
 * @param {string} params.optikonUrl - Optikon base URL
 * @param {Object} params.nostrSigner - Nostr signer object
 * @returns {Promise<{boardId: number, boardUrl: string}|null>}
 */
export async function createOptikonBoard({ title, description, workspaceId, optikonUrl, nostrSigner }) {
  const url = `${optikonUrl}/boards`;
  const method = "POST";

  try {
    // Create NIP-98 auth header
    const authHeader = await createNip98Auth(url, method, nostrSigner);

    // Create the board
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        title: title || "Untitled Board",
        description: description || "",
        workspaceId: workspaceId || null,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Optikon] Failed to create board:", response.status, errorText);
      return null;
    }

    const data = await response.json();

    // Optikon returns the board object with id and url
    return {
      boardId: data.id,
      boardUrl: data.url || `${optikonUrl}/b/${data.id}`,
    };
  } catch (err) {
    console.error("[Optikon] Error creating board:", err);
    return null;
  }
}

/**
 * Fetch Optikon configuration from the server
 * @param {string} teamSlug - Team slug
 * @returns {Promise<{optikonUrl: string}|null>}
 */
export async function fetchOptikonConfig(teamSlug) {
  try {
    const response = await fetch(`/t/${teamSlug}/api/optikon/config`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error("[Optikon] Error fetching config:", err);
    return null;
  }
}

/**
 * Save Optikon board link to a task
 * @param {string} teamSlug - Team slug
 * @param {number} todoId - Task ID
 * @param {number} boardId - Optikon board ID
 * @param {string} boardUrl - Full board URL
 * @returns {Promise<boolean>}
 */
export async function saveTodoOptikonBoard(teamSlug, todoId, boardId, boardUrl) {
  try {
    const response = await fetch(`/t/${teamSlug}/api/todos/${todoId}/optikon`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId, boardUrl }),
    });
    return response.ok;
  } catch (err) {
    console.error("[Optikon] Error saving board link:", err);
    return false;
  }
}

/**
 * Remove Optikon board link from a task
 * @param {string} teamSlug - Team slug
 * @param {number} todoId - Task ID
 * @returns {Promise<boolean>}
 */
export async function clearTodoOptikonBoard(teamSlug, todoId) {
  try {
    const response = await fetch(`/t/${teamSlug}/api/todos/${todoId}/optikon`, {
      method: "DELETE",
    });
    return response.ok;
  } catch (err) {
    console.error("[Optikon] Error clearing board link:", err);
    return false;
  }
}

/**
 * Get the default Optikon workspace for a group
 * @param {string} teamSlug - Team slug
 * @param {number} groupId - Group ID
 * @returns {Promise<number|null>}
 */
export async function getGroupOptikonWorkspace(teamSlug, groupId) {
  try {
    const response = await fetch(`/t/${teamSlug}/groups/${groupId}/optikon-workspace`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.workspaceId;
  } catch (err) {
    console.error("[Optikon] Error fetching workspace:", err);
    return null;
  }
}

/**
 * Fetch the user's Optikon workspaces
 * @param {string} optikonUrl - Optikon base URL
 * @param {Object} nostrSigner - Nostr signer object
 * @returns {Promise<Array<{id: number, name: string}>|null>}
 */
export async function fetchOptikonWorkspaces(optikonUrl, nostrSigner) {
  const url = `${optikonUrl}/workspaces`;
  const method = "GET";

  console.log("[Optikon] Fetching workspaces from:", url);

  try {
    const authHeader = await createNip98Auth(url, method, nostrSigner);

    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": authHeader,
      },
    });

    console.log("[Optikon] Workspaces response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Optikon] Failed to fetch workspaces:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log("[Optikon] Workspaces response:", data);
    // Optikon returns { workspaces: [...] } with id and title
    const workspaces = data.workspaces || data || [];
    // Normalize to id/name format
    return workspaces.map((ws) => ({
      id: ws.id,
      name: ws.title || ws.name || `Workspace ${ws.id}`,
    }));
  } catch (err) {
    console.error("[Optikon] Error fetching workspaces:", err);
    return null;
  }
}
