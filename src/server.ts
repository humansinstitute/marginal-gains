import {
  APP_NAME,
  APP_TAG,
  COOKIE_SECURE,
  LOGIN_EVENT_KIND,
  LOGIN_MAX_AGE_SECONDS,
  PORT,
  PUSH_CONTACT_EMAIL,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./config";
import { withErrorHandling } from "./http";
import { logError } from "./logger";
import { handleAiTasks, handleAiTasksPost, handleLatestSummary, handleSummaryPost } from "./routes/ai";
import { handleAssetUpload, serveAsset } from "./routes/assets";
import { createAuthHandlers } from "./routes/auth";
import {
  handleChatPage,
  handleCreateChannel,
  handleCreateDm,
  handleDeleteChannel,
  handleDeleteMessage,
  handleGetChannel,
  handleGetMe,
  handleGetMessages,
  handleListChannels,
  handleListUsers,
  handleSendMessage,
  handleUpdateChannel,
  handleUpdateUser,
} from "./routes/chat";
import { handleChatEvents } from "./routes/events";
import {
  handleAddChannelGroups,
  handleAddGroupMembers,
  handleCreateGroup,
  handleDeleteGroup,
  handleGetGroup,
  handleListChannelGroups,
  handleListGroupMembers,
  handleListGroups,
  handleRemoveChannelGroup,
  handleRemoveGroupMember,
  handleUpdateGroup,
} from "./routes/groups";
import { handleHome, handleTodos } from "./routes/home";
import {
  handleGetPushStatus,
  handleGetVapidPublicKey,
  handlePushSubscribe,
  handlePushUnsubscribe,
  handlePushUpdateFrequency,
  handleSendTestNotification,
} from "./routes/push";
import { handleSettings } from "./routes/settings";
import {
  handleCreateTask,
  handleGetTaskThreads,
  handleGetThreadTasks,
  handleLinkThreadToTask,
  handleSearchTasks,
  handleUnlinkThreadFromTask,
} from "./routes/tasks";
import { handleApiTodoState, handleTodoCreate, handleTodoDelete, handleTodoState, handleTodoUpdate } from "./routes/todos";
import {
  handleGetSlashCommands,
  handleGetWingmanSettings,
  handleUpdateWingmanSettings,
  handleGetWingmanCosts,
} from "./routes/wingman";
import { AuthService } from "./services/auth";
import { initPushService } from "./services/push";
import { serveStatic } from "./static";

const authService = new AuthService(
  SESSION_COOKIE,
  APP_TAG,
  LOGIN_EVENT_KIND,
  LOGIN_MAX_AGE_SECONDS,
  COOKIE_SECURE,
  SESSION_MAX_AGE_SECONDS
);

const { login, logout, sessionFromRequest } = createAuthHandlers(authService, SESSION_COOKIE);

// Initialize push notification service
try {
  initPushService(PUSH_CONTACT_EMAIL);
} catch (err) {
  console.error("[Push] Failed to initialize push service:", err);
}

const server = Bun.serve({
  port: PORT,
  fetch: withErrorHandling(
    async (req) => {
      const url = new URL(req.url);
      const { pathname } = url;
      const session = sessionFromRequest(req);

      if (req.method === "GET") {
        const staticResponse = await serveStatic(pathname);
        if (staticResponse) return staticResponse;

        // Serve uploaded assets
        const assetResponse = await serveAsset(pathname);
        if (assetResponse) return assetResponse;

        const aiTasksMatch = pathname.match(/^\/ai\/tasks\/(\d+)(?:\/(yes|no))?$/);
        if (aiTasksMatch) return handleAiTasks(url, aiTasksMatch);
        if (pathname === "/ai/summary/latest") return handleLatestSummary(url);

        // Chat routes - support deep linking to channels/DMs
        if (pathname === "/chat") return handleChatPage(session);
        const chatChannelMatch = pathname.match(/^\/chat\/channel\/([^/]+)$/);
        if (chatChannelMatch) return handleChatPage(session, { type: "channel", slug: chatChannelMatch[1] });
        const chatDmMatch = pathname.match(/^\/chat\/dm\/(\d+)$/);
        if (chatDmMatch) return handleChatPage(session, { type: "dm", id: Number(chatDmMatch[1]) });
        if (pathname === "/chat/events") return handleChatEvents(req, session);
        if (pathname === "/chat/channels") return handleListChannels(session);
        if (pathname === "/chat/users") return handleListUsers(session);
        if (pathname === "/chat/me") return handleGetMe(session);
        const channelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (channelMatch) return handleGetChannel(session, Number(channelMatch[1]));
        const messagesMatch = pathname.match(/^\/chat\/channels\/(\d+)\/messages$/);
        if (messagesMatch) return handleGetMessages(session, Number(messagesMatch[1]));
        const channelGroupsMatch = pathname.match(/^\/chat\/channels\/(\d+)\/groups$/);
        if (channelGroupsMatch) return handleListChannelGroups(session, Number(channelGroupsMatch[1]));

        // Group routes (admin only)
        if (pathname === "/chat/groups") return handleListGroups(session);
        const groupMatch = pathname.match(/^\/chat\/groups\/(\d+)$/);
        if (groupMatch) return handleGetGroup(session, Number(groupMatch[1]));
        const groupMembersMatch = pathname.match(/^\/chat\/groups\/(\d+)\/members$/);
        if (groupMembersMatch) return handleListGroupMembers(session, Number(groupMembersMatch[1]));

        if (pathname === "/") return handleHome(session);
        if (pathname === "/todo") return handleTodos(url, session);
        if (pathname === "/settings") return handleSettings(session);

        // Push notification routes
        if (pathname === "/api/push/vapid-public-key") return handleGetVapidPublicKey();
        if (pathname === "/api/push/status") return handleGetPushStatus(session);

        // Task-thread linking routes
        if (pathname === "/api/tasks/search") return handleSearchTasks(url, session);
        const taskThreadsMatch = pathname.match(/^\/api\/tasks\/(\d+)\/threads$/);
        if (taskThreadsMatch) return handleGetTaskThreads(session, Number(taskThreadsMatch[1]));
        const threadTasksMatch = pathname.match(/^\/api\/threads\/(\d+)\/tasks$/);
        if (threadTasksMatch) return handleGetThreadTasks(session, Number(threadTasksMatch[1]));

        // Wingman routes
        if (pathname === "/api/wingman/settings") return handleGetWingmanSettings(session);
        if (pathname === "/api/wingman/costs") return handleGetWingmanCosts(session);
        if (pathname === "/api/slashcommands") return handleGetSlashCommands(session);
      }

      if (req.method === "POST") {
        if (pathname === "/auth/login") return login(req);
        if (pathname === "/auth/logout") return logout(req);
        if (pathname === "/api/assets/upload") return handleAssetUpload(req, session);
        if (pathname === "/ai/summary") return handleSummaryPost(req);
        if (pathname === "/ai/tasks") return handleAiTasksPost(req);
        if (pathname === "/todos") return handleTodoCreate(req, session);

        const updateMatch = pathname.match(/^\/todos\/(\d+)\/update$/);
        if (updateMatch) return handleTodoUpdate(req, session, Number(updateMatch[1]));

        const stateMatch = pathname.match(/^\/todos\/(\d+)\/state$/);
        if (stateMatch) return handleTodoState(req, session, Number(stateMatch[1]));

        // API endpoint for Kanban drag-drop (JSON)
        const apiStateMatch = pathname.match(/^\/api\/todos\/(\d+)\/state$/);
        if (apiStateMatch) return handleApiTodoState(req, session, Number(apiStateMatch[1]));

        const deleteMatch = pathname.match(/^\/todos\/(\d+)\/delete$/);
        if (deleteMatch) return handleTodoDelete(req, session, Number(deleteMatch[1]));

        // Chat routes
        if (pathname === "/chat/channels") return handleCreateChannel(req, session);
        if (pathname === "/chat/dm") return handleCreateDm(req, session);
        if (pathname === "/chat/users") return handleUpdateUser(req, session);
        const sendMessageMatch = pathname.match(/^\/chat\/channels\/(\d+)\/messages$/);
        if (sendMessageMatch) return handleSendMessage(req, session, Number(sendMessageMatch[1]));
        const addChannelGroupsMatch = pathname.match(/^\/chat\/channels\/(\d+)\/groups$/);
        if (addChannelGroupsMatch) return handleAddChannelGroups(req, session, Number(addChannelGroupsMatch[1]));

        // Group routes (admin only)
        if (pathname === "/chat/groups") return handleCreateGroup(req, session);
        const addGroupMembersMatch = pathname.match(/^\/chat\/groups\/(\d+)\/members$/);
        if (addGroupMembersMatch) return handleAddGroupMembers(req, session, Number(addGroupMembersMatch[1]));

        // Push notification routes
        if (pathname === "/api/push/subscribe") return handlePushSubscribe(req, session);
        if (pathname === "/api/push/unsubscribe") return handlePushUnsubscribe(req, session);
        if (pathname === "/api/push/test") return handleSendTestNotification(session);

        // Task-thread linking routes
        if (pathname === "/api/tasks") return handleCreateTask(req, session);
        const linkThreadMatch = pathname.match(/^\/api\/tasks\/(\d+)\/threads$/);
        if (linkThreadMatch) return handleLinkThreadToTask(req, session, Number(linkThreadMatch[1]));
      }

      if (req.method === "PATCH") {
        const updateChannelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (updateChannelMatch) return handleUpdateChannel(req, session, Number(updateChannelMatch[1]));
        const updateGroupMatch = pathname.match(/^\/chat\/groups\/(\d+)$/);
        if (updateGroupMatch) return handleUpdateGroup(req, session, Number(updateGroupMatch[1]));

        // Push notification routes
        if (pathname === "/api/push/frequency") return handlePushUpdateFrequency(req, session);

        // Wingman routes
        if (pathname === "/api/wingman/settings") return handleUpdateWingmanSettings(req, session);
      }

      if (req.method === "DELETE") {
        // Message delete (author or admin)
        const deleteMessageMatch = pathname.match(/^\/chat\/messages\/(\d+)$/);
        if (deleteMessageMatch) return handleDeleteMessage(session, Number(deleteMessageMatch[1]));

        // Channel delete (admin only)
        const deleteChannelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (deleteChannelMatch) return handleDeleteChannel(session, Number(deleteChannelMatch[1]));

        // Group routes (admin only)
        const deleteGroupMatch = pathname.match(/^\/chat\/groups\/(\d+)$/);
        if (deleteGroupMatch) return handleDeleteGroup(session, Number(deleteGroupMatch[1]));
        const removeGroupMemberMatch = pathname.match(/^\/chat\/groups\/(\d+)\/members\/([^/]+)$/);
        if (removeGroupMemberMatch) {
          return handleRemoveGroupMember(
            session,
            Number(removeGroupMemberMatch[1]),
            decodeURIComponent(removeGroupMemberMatch[2])
          );
        }
        const removeChannelGroupMatch = pathname.match(/^\/chat\/channels\/(\d+)\/groups\/(\d+)$/);
        if (removeChannelGroupMatch) {
          return handleRemoveChannelGroup(
            session,
            Number(removeChannelGroupMatch[1]),
            Number(removeChannelGroupMatch[2])
          );
        }

        // Task-thread linking routes
        const unlinkThreadMatch = pathname.match(/^\/api\/tasks\/(\d+)\/threads\/(\d+)$/);
        if (unlinkThreadMatch) {
          return handleUnlinkThreadFromTask(
            session,
            Number(unlinkThreadMatch[1]),
            Number(unlinkThreadMatch[2])
          );
        }
      }

      return new Response("Not found", { status: 404 });
    },
    (error) => logError("Request failed", error)
  ),
});

console.log(`${APP_NAME} ready on http://localhost:${server.port}`);
