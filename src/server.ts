import {
  APP_NAME,
  APP_TAG,
  COOKIE_SECURE,
  LOGIN_EVENT_KIND,
  LOGIN_MAX_AGE_SECONDS,
  PORT,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./config";
import { withErrorHandling } from "./http";
import { logError } from "./logger";
import { handleAiTasks, handleAiTasksPost, handleLatestSummary, handleSummaryPost } from "./routes/ai";
import { createAuthHandlers } from "./routes/auth";
import {
  handleChatPage,
  handleCreateChannel,
  handleCreateDm,
  handleDeleteChannel,
  handleGetChannel,
  handleGetMe,
  handleGetMessages,
  handleListChannels,
  handleListUsers,
  handleSendMessage,
  handleUpdateChannel,
  handleUpdateUser,
} from "./routes/chat";
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
import { handleAssetUpload, serveAsset } from "./routes/assets";
import { handleSettings } from "./routes/settings";
import { handleTodoCreate, handleTodoDelete, handleTodoState, handleTodoUpdate } from "./routes/todos";
import { AuthService } from "./services/auth";
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

        // Chat routes
        if (pathname === "/chat") return handleChatPage(session);
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

        const deleteMatch = pathname.match(/^\/todos\/(\d+)\/delete$/);
        if (deleteMatch) return handleTodoDelete(session, Number(deleteMatch[1]));

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
      }

      if (req.method === "PATCH") {
        const updateChannelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (updateChannelMatch) return handleUpdateChannel(req, session, Number(updateChannelMatch[1]));
        const updateGroupMatch = pathname.match(/^\/chat\/groups\/(\d+)$/);
        if (updateGroupMatch) return handleUpdateGroup(req, session, Number(updateGroupMatch[1]));
      }

      if (req.method === "DELETE") {
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
      }

      return new Response("Not found", { status: 404 });
    },
    (error) => logError("Request failed", error)
  ),
});

console.log(`${APP_NAME} ready on http://localhost:${server.port}`);
