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
  handleGetChannel,
  handleGetMessages,
  handleListChannels,
  handleListUsers,
  handleSendMessage,
  handleUpdateChannel,
  handleUpdateUser,
} from "./routes/chat";
import { handleHome, handleTodos } from "./routes/home";
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

        const aiTasksMatch = pathname.match(/^\/ai\/tasks\/(\d+)(?:\/(yes|no))?$/);
        if (aiTasksMatch) return handleAiTasks(url, aiTasksMatch);
        if (pathname === "/ai/summary/latest") return handleLatestSummary(url);

        // Chat routes
        if (pathname === "/chat") return handleChatPage(session);
        if (pathname === "/chat/channels") return handleListChannels(session);
        if (pathname === "/chat/users") return handleListUsers(session);
        const channelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (channelMatch) return handleGetChannel(session, Number(channelMatch[1]));
        const messagesMatch = pathname.match(/^\/chat\/channels\/(\d+)\/messages$/);
        if (messagesMatch) return handleGetMessages(session, Number(messagesMatch[1]));

        if (pathname === "/") return handleHome(session);
        if (pathname === "/todo") return handleTodos(url, session);
      }

      if (req.method === "POST") {
        if (pathname === "/auth/login") return login(req);
        if (pathname === "/auth/logout") return logout(req);
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
        if (pathname === "/chat/users") return handleUpdateUser(req, session);
        const sendMessageMatch = pathname.match(/^\/chat\/channels\/(\d+)\/messages$/);
        if (sendMessageMatch) return handleSendMessage(req, session, Number(sendMessageMatch[1]));
      }

      if (req.method === "PATCH") {
        const updateChannelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (updateChannelMatch) return handleUpdateChannel(req, session, Number(updateChannelMatch[1]));
      }

      return new Response("Not found", { status: 404 });
    },
    (error) => logError("Request failed", error)
  ),
});

console.log(`${APP_NAME} ready on http://localhost:${server.port}`);
