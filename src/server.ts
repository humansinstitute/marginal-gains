import {
  APP_NAME_DEFAULT,
  APP_TAG,
  COOKIE_SECURE,
  LOGIN_EVENT_KIND,
  LOGIN_MAX_AGE_SECONDS,
  PORT,
  PUSH_CONTACT_EMAIL,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./config";
import { createContext, createTeamRouteContext } from "./context";
import { withErrorHandling } from "./http";
import { logError } from "./logger";
import { handleAiTasks, handleAiTasksPost, handleLatestSummary, handleSummaryPost } from "./routes/ai";
import { handleGetAppSettings, handleManifest, handleUpdateAppSettings } from "./routes/app-settings";
import { handleAssetUpload, serveAsset } from "./routes/assets";
import { createAuthHandlers } from "./routes/auth";
import {
  handleChatPage,
  handleCreateChannel,
  handleCreateDm,
  handleDeleteChannel,
  handleDeleteMessage,
  handleCheckMessagePinned,
  handleGetChannel,
  handleGetChannelKey,
  handleGetChannelKeysAll,
  handleGetMe,
  handleGetMessages,
  handleGetPendingKeyMembers,
  handleGetPinnedMessages,
  handleListChannels,
  handleListUsers,
  handleMarkChannelRead,
  handlePinMessage,
  handleSendMessage,
  handleStoreChannelKey,
  handleStoreChannelKeysBatch,
  handleToggleReaction,
  handleUnpinMessage,
  handleUpdateChannel,
  handleUpdateUser,
} from "./routes/chat";
import {
  handleCommunityStatus,
  handleGetCommunityKey,
  handleBootstrapCommunity,
  handleStoreCommunityKey,
  handleCreateInvite,
  handleListInvites,
  handleDeleteInvite,
  handleRedeemInvite,
  handleGetPendingMigration,
  handleGetMigrationMessages,
  handleMigrationBatch,
  handleCompleteMigration,
} from "./routes/community";
import {
  handleCrmPage,
  handleCreateActivity,
  handleCreateCompany,
  handleCreateContact,
  handleCreateOpportunity,
  handleDeleteActivity,
  handleDeleteCompany,
  handleDeleteContact,
  handleDeleteOpportunity,
  handleGetActivity,
  handleGetCompany,
  handleGetContact,
  handleGetOpportunity,
  handleListActivities,
  handleListCompanies,
  handleListContacts,
  handleListOpportunities,
  handlePipelineSummary,
  handleUpdateCompany,
  handleUpdateContact,
  handleUpdateOpportunity,
} from "./routes/crm";
import { handleDebugLog, handleClearDebugLog, handleGetDebugLog } from "./routes/debug";
import { handleChatEvents, handleTeamChatEvents } from "./routes/events";
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
import { handleHome } from "./routes/home";
import {
  handleOnboardingPage,
  handlePreviewInvite,
  handleRedeemInvite as handleRedeemTeamInvite,
  handleStoreInviteKeys,
} from "./routes/invites";
import {
  handleListOwnKeyRequests,
  handleListPendingKeyRequests,
  handleFulfillKeyRequest,
  handleRejectKeyRequest,
} from "./routes/key-requests";
import { handleKeyTeleport } from "./routes/keyteleport";
import {
  handleGetPushStatus,
  handleGetVapidPublicKey,
  handlePushSubscribe,
  handlePushUnsubscribe,
  handlePushUpdateFrequency,
  handleSendTestNotification,
} from "./routes/push";
import { handleSettings, handleAppSettingsPage, handleTeamConfigPage } from "./routes/settings";
import {
  handleCreateTask,
  handleGetActivityTasks,
  handleGetCompanyTasks,
  handleGetContactTasks,
  handleGetOpportunityTasks,
  handleGetTaskAllLinks,
  handleGetTaskCrmLinks,
  handleGetTaskThreads,
  handleGetThreadTasks,
  handleLinkTaskToCrm,
  handleLinkThreadToTask,
  handleSearchTasks,
  handleUnlinkTaskFromCrm,
  handleUnlinkThreadFromTask,
} from "./routes/tasks";
import {
  handleTeamAddChannelGroups,
  handleTeamArchiveDm,
  handleTeamChatPage,
  handleTeamCreateChannel,
  handleTeamCreateDm,
  handleTeamCheckMessagePinned,
  handleTeamDeleteChannel,
  handleTeamDeleteMessage,
  handleTeamGetChannel,
  handleTeamGetChannelKey,
  handleTeamGetChannelKeysAll,
  handleTeamGetMe,
  handleTeamGetMessages,
  handleTeamGetPendingKeyMembers,
  handleTeamGetPinnedMessages,
  handleTeamListChannelGroups,
  handleTeamListChannels,
  handleTeamListUsers,
  handleTeamMarkChannelRead,
  handleTeamPinMessage,
  handleTeamRemoveChannelGroup,
  handleTeamSendMessage,
  handleTeamStoreChannelKey,
  handleTeamStoreChannelKeysBatch,
  handleTeamToggleReaction,
  handleTeamUnpinMessage,
  handleTeamUpdateChannel,
  handleTeamUpdateUser,
} from "./routes/team-chat";
import {
  handleTeamCrmPage,
  handleTeamListCompanies,
  handleTeamGetCompany,
  handleTeamCreateCompany,
  handleTeamUpdateCompany,
  handleTeamDeleteCompany,
  handleTeamListContacts,
  handleTeamGetContact,
  handleTeamCreateContact,
  handleTeamUpdateContact,
  handleTeamDeleteContact,
  handleTeamListOpportunities,
  handleTeamGetOpportunity,
  handleTeamCreateOpportunity,
  handleTeamUpdateOpportunity,
  handleTeamDeleteOpportunity,
  handleTeamListActivities,
  handleTeamGetActivity,
  handleTeamCreateActivity,
  handleTeamDeleteActivity,
  handleTeamPipelineSummary,
} from "./routes/team-crm";
import {
  handleGetTeamEncryption,
  handleGetUserTeamKey,
  handleStoreUserTeamKey,
  handleGetInviteKey,
  handleInitTeamEncryption,
  handleStoreInviteKey,
} from "./routes/team-encryption";
import {
  handleTeamListGroups,
  handleTeamGetGroup,
  handleTeamCreateGroup,
  handleTeamUpdateGroup,
  handleTeamDeleteGroup,
  handleTeamListGroupMembers,
  handleTeamAddGroupMembers,
  handleTeamRemoveGroupMember,
} from "./routes/team-groups";
import {
  handleTeamSearchTasks,
  handleTeamGetTaskThreads,
  handleTeamGetThreadTasks,
  handleTeamCreateTask,
  handleTeamLinkThreadToTask,
  handleTeamUnlinkThreadFromTask,
} from "./routes/team-tasks";
import {
  handleTeamTodos,
  handleTeamTodosRedirect,
  handleTeamTodoCreate,
  handleTeamTodoUpdate,
  handleTeamTodoState,
  handleTeamTodoDelete,
  handleTeamApiTodoState,
  handleTeamApiTodoPosition,
  handleTeamGetTodo,
  handleTeamGetSubtasks,
  handleTeamCreateSubtask,
} from "./routes/team-todos";
import {
  handleTeamsPage,
  handleListTeams,
  handleSwitchTeam,
  handleCreateTeam,
  handleJoinTeam,
  handleJoinTeamPage,
  handleTeamSettingsPage,
  handleUpdateTeam,
  handleUpdateTeamFeatures,
  handleDeleteTeam,
  handleListTeamMembers,
  handleAddTeamMember,
  handleUpdateTeamMember,
  handleRemoveTeamMember,
  handleListTeamInvitations,
  handleCreateTeamInvitation,
  handleDeleteTeamInvitation,
  handleListTeamManagers,
  handleAddTeamManager,
  handleUploadTeamIcon,
} from "./routes/teams";
import {
  handleApiTodoPosition,
  handleApiTodoState,
  handleCreateSubtask,
  handleGetSubtasks,
  handleHasSubtasks,
  handleTodoCreate,
  handleTodoDelete,
  handleTodoState,
  handleTodoUpdate,
} from "./routes/todos";
import {
  handleWalletPage,
  handleWalletConnect,
  handleWalletDisconnect,
  handleWalletStatus,
  handleWalletBalance,
  handleWalletTransactions,
  handleWalletInvoice,
  handleWalletPay,
} from "./routes/wallet";
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
        // Dynamic manifest with custom app name
        if (pathname === "/manifest.webmanifest") return handleManifest();

        const staticResponse = await serveStatic(pathname);
        if (staticResponse) return staticResponse;

        // Serve uploaded assets
        const assetResponse = await serveAsset(pathname);
        if (assetResponse) return assetResponse;

        // Team routes - no team context required
        if (pathname === "/teams") return handleTeamsPage(session, url);
        if (pathname === "/api/teams") return handleListTeams(session);
        const joinTeamPageMatch = pathname.match(/^\/teams\/join\/([^/]+)$/);
        if (joinTeamPageMatch) return handleJoinTeamPage(session, joinTeamPageMatch[1]);
        const teamSettingsMatch = pathname.match(/^\/t\/([^/]+)\/settings$/);
        if (teamSettingsMatch) return handleTeamSettingsPage(session, teamSettingsMatch[1]);
        const teamMembersMatch = pathname.match(/^\/api\/teams\/(\d+)\/members$/);
        if (teamMembersMatch) return handleListTeamMembers(session, Number(teamMembersMatch[1]));
        const teamInvitationsMatch = pathname.match(/^\/api\/teams\/(\d+)\/invitations$/);
        if (teamInvitationsMatch) return handleListTeamInvitations(session, Number(teamInvitationsMatch[1]));
        if (pathname === "/api/team-managers") return handleListTeamManagers(session);

        // Team-scoped chat page and SSE events
        const teamChatPageMatch = pathname.match(/^\/t\/([^/]+)\/chat$/);
        if (teamChatPageMatch) {
          return handleTeamChatPage(session, teamChatPageMatch[1]);
        }
        const teamChatChannelMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channel\/([^/]+)$/);
        if (teamChatChannelMatch) {
          return handleTeamChatPage(session, teamChatChannelMatch[1], {
            type: "channel",
            slug: teamChatChannelMatch[2],
          });
        }
        const teamChatDmMatch = pathname.match(/^\/t\/([^/]+)\/chat\/dm\/(\d+)$/);
        if (teamChatDmMatch) {
          return handleTeamChatPage(session, teamChatDmMatch[1], {
            type: "dm",
            id: Number(teamChatDmMatch[2]),
          });
        }
        const teamChatEventsMatch = pathname.match(/^\/t\/([^/]+)\/chat\/events$/);
        if (teamChatEventsMatch) {
          return handleTeamChatEvents(req, session, teamChatEventsMatch[1]);
        }

        // Team-scoped API routes
        const teamChannelsMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels$/);
        if (teamChannelsMatch) return handleTeamListChannels(session, teamChannelsMatch[1]);

        const teamUsersMatch = pathname.match(/^\/t\/([^/]+)\/chat\/users$/);
        if (teamUsersMatch) return handleTeamListUsers(session, teamUsersMatch[1]);

        const teamMeMatch = pathname.match(/^\/t\/([^/]+)\/chat\/me$/);
        if (teamMeMatch) return handleTeamGetMe(session, teamMeMatch[1]);

        const teamChannelMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)$/);
        if (teamChannelMatch) {
          return handleTeamGetChannel(session, teamChannelMatch[1], Number(teamChannelMatch[2]));
        }

        const teamMessagesMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/messages$/);
        if (teamMessagesMatch) {
          return handleTeamGetMessages(session, teamMessagesMatch[1], Number(teamMessagesMatch[2]));
        }

        const teamChannelGroupsMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/groups$/);
        if (teamChannelGroupsMatch) {
          return handleTeamListChannelGroups(session, teamChannelGroupsMatch[1], Number(teamChannelGroupsMatch[2]));
        }

        const teamPinnedMessagesMatch = pathname.match(/^\/t\/([^/]+)\/api\/channels\/(\d+)\/pinned$/);
        if (teamPinnedMessagesMatch) {
          return handleTeamGetPinnedMessages(req, session, teamPinnedMessagesMatch[1], Number(teamPinnedMessagesMatch[2]));
        }

        const teamCheckPinnedMatch = pathname.match(/^\/t\/([^/]+)\/api\/channels\/(\d+)\/messages\/(\d+)\/pinned$/);
        if (teamCheckPinnedMatch) {
          return handleTeamCheckMessagePinned(req, session, teamCheckPinnedMatch[1], Number(teamCheckPinnedMatch[2]), Number(teamCheckPinnedMatch[3]));
        }

        // Team-scoped groups route (for chat UI to fetch available groups)
        const teamChatGroupsMatch = pathname.match(/^\/t\/([^/]+)\/chat\/groups$/);
        if (teamChatGroupsMatch) {
          return handleTeamListGroups(session, teamChatGroupsMatch[1]);
        }

        // Team-scoped channel encryption key routes
        const teamChannelKeysMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/keys$/);
        if (teamChannelKeysMatch) {
          return handleTeamGetChannelKey(session, teamChannelKeysMatch[1], Number(teamChannelKeysMatch[2]));
        }

        const teamChannelKeysAllMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/keys\/all$/);
        if (teamChannelKeysAllMatch) {
          return handleTeamGetChannelKeysAll(session, teamChannelKeysAllMatch[1], Number(teamChannelKeysAllMatch[2]));
        }

        const teamChannelKeysPendingMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/keys\/pending$/);
        if (teamChannelKeysPendingMatch) {
          return handleTeamGetPendingKeyMembers(session, teamChannelKeysPendingMatch[1], Number(teamChannelKeysPendingMatch[2]));
        }

        // Team-level encryption routes (zero-knowledge key distribution)
        const teamEncryptionMatch = pathname.match(/^\/t\/([^/]+)\/api\/team\/encryption$/);
        if (teamEncryptionMatch) {
          const result = createTeamRouteContext(session, teamEncryptionMatch[1]);
          if (!result.ok) return result.response;
          return handleGetTeamEncryption(result.ctx);
        }

        const teamUserKeyMatch = pathname.match(/^\/t\/([^/]+)\/api\/team\/key$/);
        if (teamUserKeyMatch) {
          const result = createTeamRouteContext(session, teamUserKeyMatch[1]);
          if (!result.ok) return result.response;
          return handleGetUserTeamKey(result.ctx);
        }

        const teamInviteKeyMatch = pathname.match(/^\/t\/([^/]+)\/api\/team\/invite-key$/);
        if (teamInviteKeyMatch) {
          const result = createTeamRouteContext(session, teamInviteKeyMatch[1]);
          if (!result.ok) return result.response;
          return handleGetInviteKey(result.ctx, url);
        }

        const aiTasksMatch = pathname.match(/^\/ai\/tasks\/(\d+)(?:\/(yes|no))?$/);
        if (aiTasksMatch) return handleAiTasks(url, aiTasksMatch);
        if (pathname === "/ai/summary/latest") return handleLatestSummary(url);

        // Helper to redirect unauthenticated users to root with return path
        const requireAuth = () => {
          if (session) return null;
          const returnPath = encodeURIComponent(pathname + url.search);
          return new Response(null, { status: 302, headers: { Location: `/?return=${returnPath}` } });
        };

        // Chat routes - support deep linking to channels/DMs
        if (pathname === "/chat") return requireAuth() || handleChatPage(session);
        const chatChannelMatch = pathname.match(/^\/chat\/channel\/([^/]+)$/);
        if (chatChannelMatch) return requireAuth() || handleChatPage(session, { type: "channel", slug: chatChannelMatch[1] });
        const chatDmMatch = pathname.match(/^\/chat\/dm\/(\d+)$/);
        if (chatDmMatch) return requireAuth() || handleChatPage(session, { type: "dm", id: Number(chatDmMatch[1]) });
        if (pathname === "/chat/events") return handleChatEvents(req, createContext(session));
        if (pathname === "/chat/channels") return handleListChannels(session);
        if (pathname === "/chat/users") return handleListUsers(session);
        if (pathname === "/chat/me") return handleGetMe(session);
        const channelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (channelMatch) return handleGetChannel(session, Number(channelMatch[1]));
        const messagesMatch = pathname.match(/^\/chat\/channels\/(\d+)\/messages$/);
        if (messagesMatch) return handleGetMessages(session, Number(messagesMatch[1]));
        const channelGroupsMatch = pathname.match(/^\/chat\/channels\/(\d+)\/groups$/);
        if (channelGroupsMatch) return handleListChannelGroups(session, Number(channelGroupsMatch[1]));
        const pinnedMessagesMatch = pathname.match(/^\/api\/channels\/(\d+)\/pinned$/);
        if (pinnedMessagesMatch) return handleGetPinnedMessages(req, session, Number(pinnedMessagesMatch[1]));
        const checkPinnedMatch = pathname.match(/^\/api\/channels\/(\d+)\/messages\/(\d+)\/pinned$/);
        if (checkPinnedMatch) return handleCheckMessagePinned(req, session, Number(checkPinnedMatch[1]), Number(checkPinnedMatch[2]));

        // Channel encryption key routes
        const channelKeysMatch = pathname.match(/^\/chat\/channels\/(\d+)\/keys$/);
        if (channelKeysMatch) return handleGetChannelKey(session, Number(channelKeysMatch[1]));
        const channelKeysAllMatch = pathname.match(/^\/chat\/channels\/(\d+)\/keys\/all$/);
        if (channelKeysAllMatch) return handleGetChannelKeysAll(session, Number(channelKeysAllMatch[1]));
        const channelKeysPendingMatch = pathname.match(/^\/chat\/channels\/(\d+)\/keys\/pending$/);
        if (channelKeysPendingMatch) return handleGetPendingKeyMembers(session, Number(channelKeysPendingMatch[1]));

        // Group routes (admin only)
        if (pathname === "/chat/groups") return handleListGroups(session);
        const groupMatch = pathname.match(/^\/chat\/groups\/(\d+)$/);
        if (groupMatch) return handleGetGroup(session, Number(groupMatch[1]));
        const groupMembersMatch = pathname.match(/^\/chat\/groups\/(\d+)\/members$/);
        if (groupMembersMatch) return handleListGroupMembers(session, Number(groupMembersMatch[1]));

        // Handle invite codes on home page - /?code={inviteCode}
        if (pathname === "/") {
          const inviteCode = url.searchParams.get("code");
          if (inviteCode) {
            return handleOnboardingPage(session, inviteCode);
          }
          return handleHome(session);
        }
        // Redirect legacy /todo routes to team context
        if (pathname === "/todo" || pathname === "/todo/kanban" || pathname === "/todo/list") {
          const authCheck = requireAuth();
          if (authCheck) return authCheck;
          const teamSlug = session!.currentTeamSlug || session!.teamMemberships?.[0]?.teamSlug;
          const viewMode = pathname === "/todo/list" ? "list" : "kanban";
          const location = teamSlug ? `/t/${teamSlug}/todo/${viewMode}` : "/chat";
          return new Response(null, { status: 302, headers: { Location: location } });
        }
        if (pathname === "/settings") return requireAuth() || handleSettings(session);
        if (pathname === "/admin/settings") return handleAppSettingsPage(session);
        const teamConfigMatch = pathname.match(/^\/t\/([^/]+)\/config$/);
        if (teamConfigMatch) return handleTeamConfigPage(session, teamConfigMatch[1]);

        // Team-scoped group routes
        const teamGroupsMatch = pathname.match(/^\/t\/([^/]+)\/groups$/);
        if (teamGroupsMatch) return handleTeamListGroups(session, teamGroupsMatch[1]);
        const teamGroupMatch = pathname.match(/^\/t\/([^/]+)\/groups\/(\d+)$/);
        if (teamGroupMatch) return handleTeamGetGroup(session, teamGroupMatch[1], Number(teamGroupMatch[2]));
        const teamGroupMembersMatch = pathname.match(/^\/t\/([^/]+)\/groups\/(\d+)\/members$/);
        if (teamGroupMembersMatch) return handleTeamListGroupMembers(session, teamGroupMembersMatch[1], Number(teamGroupMembersMatch[2]));

        // Team-scoped tasks page (with view mode routing)
        const teamTodosRedirectMatch = pathname.match(/^\/t\/([^/]+)\/todo$/);
        if (teamTodosRedirectMatch) return handleTeamTodosRedirect(url, teamTodosRedirectMatch[1]);
        const teamTodosKanbanMatch = pathname.match(/^\/t\/([^/]+)\/todo\/kanban$/);
        if (teamTodosKanbanMatch) return handleTeamTodos(url, session, teamTodosKanbanMatch[1], "kanban");
        const teamTodosListMatch = pathname.match(/^\/t\/([^/]+)\/todo\/list$/);
        if (teamTodosListMatch) return handleTeamTodos(url, session, teamTodosListMatch[1], "list");

        // Team-scoped single todo GET endpoint (for full task details)
        const teamGetTodoMatch = pathname.match(/^\/t\/([^/]+)\/api\/todos\/(\d+)$/);
        if (teamGetTodoMatch) return handleTeamGetTodo(req, session, teamGetTodoMatch[1], Number(teamGetTodoMatch[2]));

        // Team-scoped subtask API routes (GET)
        const teamSubtasksMatch = pathname.match(/^\/t\/([^/]+)\/api\/todos\/(\d+)\/subtasks$/);
        if (teamSubtasksMatch) return handleTeamGetSubtasks(req, session, teamSubtasksMatch[1], Number(teamSubtasksMatch[2]));

        // Team-scoped CRM page
        const teamCrmPageMatch = pathname.match(/^\/t\/([^/]+)\/crm$/);
        if (teamCrmPageMatch) return handleTeamCrmPage(session, teamCrmPageMatch[1]);

        // Team-scoped CRM API routes
        const teamCrmCompaniesMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/companies$/);
        if (teamCrmCompaniesMatch) return handleTeamListCompanies(session, teamCrmCompaniesMatch[1]);
        const teamCrmCompanyMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/companies\/(\d+)$/);
        if (teamCrmCompanyMatch) return handleTeamGetCompany(session, teamCrmCompanyMatch[1], Number(teamCrmCompanyMatch[2]));
        const teamCrmContactsMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/contacts$/);
        if (teamCrmContactsMatch) {
          const companyId = url.searchParams.get("company_id");
          return handleTeamListContacts(session, teamCrmContactsMatch[1], companyId ? Number(companyId) : undefined);
        }
        const teamCrmContactMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/contacts\/(\d+)$/);
        if (teamCrmContactMatch) return handleTeamGetContact(session, teamCrmContactMatch[1], Number(teamCrmContactMatch[2]));
        const teamCrmOpportunitiesMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/opportunities$/);
        if (teamCrmOpportunitiesMatch) {
          const stage = url.searchParams.get("stage") ?? undefined;
          return handleTeamListOpportunities(session, teamCrmOpportunitiesMatch[1], stage);
        }
        const teamCrmOpportunityMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/opportunities\/(\d+)$/);
        if (teamCrmOpportunityMatch) return handleTeamGetOpportunity(session, teamCrmOpportunityMatch[1], Number(teamCrmOpportunityMatch[2]));
        const teamCrmActivitiesMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/activities$/);
        if (teamCrmActivitiesMatch) {
          const contactId = url.searchParams.get("contact_id");
          const opportunityId = url.searchParams.get("opportunity_id");
          const companyId = url.searchParams.get("company_id");
          return handleTeamListActivities(session, teamCrmActivitiesMatch[1], {
            contact_id: contactId ? Number(contactId) : undefined,
            opportunity_id: opportunityId ? Number(opportunityId) : undefined,
            company_id: companyId ? Number(companyId) : undefined,
          });
        }
        const teamCrmActivityMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/activities\/(\d+)$/);
        if (teamCrmActivityMatch) return handleTeamGetActivity(session, teamCrmActivityMatch[1], Number(teamCrmActivityMatch[2]));
        const teamCrmPipelineMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/pipeline$/);
        if (teamCrmPipelineMatch) return handleTeamPipelineSummary(session, teamCrmPipelineMatch[1]);

        // Team-scoped tasks API routes
        const teamTasksSearchMatch = pathname.match(/^\/t\/([^/]+)\/api\/tasks\/search$/);
        if (teamTasksSearchMatch) return handleTeamSearchTasks(url, session, teamTasksSearchMatch[1]);
        const teamTaskThreadsMatch = pathname.match(/^\/t\/([^/]+)\/api\/tasks\/(\d+)\/threads$/);
        if (teamTaskThreadsMatch) return handleTeamGetTaskThreads(session, teamTaskThreadsMatch[1], Number(teamTaskThreadsMatch[2]));
        const teamThreadTasksMatch = pathname.match(/^\/t\/([^/]+)\/api\/threads\/(\d+)\/tasks$/);
        if (teamThreadTasksMatch) return handleTeamGetThreadTasks(session, teamThreadTasksMatch[1], Number(teamThreadTasksMatch[2]));

        // Team-scoped key request routes
        const teamKeyRequestsMatch = pathname.match(/^\/t\/([^/]+)\/api\/key-requests$/);
        if (teamKeyRequestsMatch) return handleListOwnKeyRequests(session, teamKeyRequestsMatch[1]);
        const teamKeyRequestsPendingMatch = pathname.match(/^\/t\/([^/]+)\/api\/key-requests\/pending$/);
        if (teamKeyRequestsPendingMatch) return handleListPendingKeyRequests(session, teamKeyRequestsPendingMatch[1]);

        if (pathname === "/wallet") return requireAuth() || handleWalletPage(session);

        // Push notification routes
        if (pathname === "/api/push/vapid-public-key") return handleGetVapidPublicKey();
        if (pathname === "/api/push/status") return handleGetPushStatus(session);

        // Task-thread linking routes
        if (pathname === "/api/tasks/search") return handleSearchTasks(url, session);
        const taskThreadsMatch = pathname.match(/^\/api\/tasks\/(\d+)\/threads$/);
        if (taskThreadsMatch) return handleGetTaskThreads(session, Number(taskThreadsMatch[1]));
        const threadTasksMatch = pathname.match(/^\/api\/threads\/(\d+)\/tasks$/);
        if (threadTasksMatch) return handleGetThreadTasks(session, Number(threadTasksMatch[1]));

        // Task-CRM linking routes
        const taskCrmLinksMatch = pathname.match(/^\/api\/tasks\/(\d+)\/crm-links$/);
        if (taskCrmLinksMatch) return handleGetTaskCrmLinks(session, Number(taskCrmLinksMatch[1]));
        const taskAllLinksMatch = pathname.match(/^\/api\/tasks\/(\d+)\/all-links$/);
        if (taskAllLinksMatch) return handleGetTaskAllLinks(session, Number(taskAllLinksMatch[1]));
        const contactTasksMatch = pathname.match(/^\/api\/crm\/contacts\/(\d+)\/tasks$/);
        if (contactTasksMatch) return handleGetContactTasks(session, Number(contactTasksMatch[1]));
        const companyTasksMatch = pathname.match(/^\/api\/crm\/companies\/(\d+)\/tasks$/);
        if (companyTasksMatch) return handleGetCompanyTasks(session, Number(companyTasksMatch[1]));
        const activityTasksMatch = pathname.match(/^\/api\/crm\/activities\/(\d+)\/tasks$/);
        if (activityTasksMatch) return handleGetActivityTasks(session, Number(activityTasksMatch[1]));
        const opportunityTasksMatch = pathname.match(/^\/api\/crm\/opportunities\/(\d+)\/tasks$/);
        if (opportunityTasksMatch) return handleGetOpportunityTasks(session, Number(opportunityTasksMatch[1]));

        // Subtask routes
        const subtasksMatch = pathname.match(/^\/api\/todos\/(\d+)\/subtasks$/);
        if (subtasksMatch) return handleGetSubtasks(req, session, Number(subtasksMatch[1]));
        const hasSubtasksMatch = pathname.match(/^\/api\/todos\/(\d+)\/has-subtasks$/);
        if (hasSubtasksMatch) return handleHasSubtasks(req, session, Number(hasSubtasksMatch[1]));

        // Wingman routes
        if (pathname === "/api/wingman/settings") return handleGetWingmanSettings(session);
        if (pathname === "/api/wingman/costs") return handleGetWingmanCosts(session);
        if (pathname === "/api/slashcommands") return handleGetSlashCommands(session);

        // App settings routes (admin only)
        if (pathname === "/api/app/settings") return handleGetAppSettings(session);

        // Team invite preview (public - no auth required)
        if (pathname === "/api/invites/preview") return handlePreviewInvite(url);

        // Community encryption routes
        if (pathname === "/api/community/status") return handleCommunityStatus(session);
        if (pathname === "/api/community/key") return handleGetCommunityKey(session);
        if (pathname === "/api/invites") return handleListInvites(session);
        if (pathname === "/api/community/migration/pending") return handleGetPendingMigration(session);
        if (pathname === "/api/community/migration/messages") return handleGetMigrationMessages(session, url);

        // CRM routes (admin only)
        if (pathname === "/crm") return requireAuth() || handleCrmPage(session);
        if (pathname === "/api/crm/companies") return handleListCompanies(session);
        const crmCompanyMatch = pathname.match(/^\/api\/crm\/companies\/(\d+)$/);
        if (crmCompanyMatch) return handleGetCompany(session, Number(crmCompanyMatch[1]));
        if (pathname === "/api/crm/contacts") {
          const companyId = url.searchParams.get("company_id");
          return handleListContacts(session, companyId ? Number(companyId) : undefined);
        }
        const crmContactMatch = pathname.match(/^\/api\/crm\/contacts\/(\d+)$/);
        if (crmContactMatch) return handleGetContact(session, Number(crmContactMatch[1]));
        if (pathname === "/api/crm/opportunities") {
          const stage = url.searchParams.get("stage") ?? undefined;
          return handleListOpportunities(session, stage);
        }
        const crmOpportunityMatch = pathname.match(/^\/api\/crm\/opportunities\/(\d+)$/);
        if (crmOpportunityMatch) return handleGetOpportunity(session, Number(crmOpportunityMatch[1]));
        if (pathname === "/api/crm/activities") {
          const contactId = url.searchParams.get("contact_id");
          const opportunityId = url.searchParams.get("opportunity_id");
          const companyId = url.searchParams.get("company_id");
          return handleListActivities(session, {
            contact_id: contactId ? Number(contactId) : undefined,
            opportunity_id: opportunityId ? Number(opportunityId) : undefined,
            company_id: companyId ? Number(companyId) : undefined,
          });
        }
        const crmActivityMatch = pathname.match(/^\/api\/crm\/activities\/(\d+)$/);
        if (crmActivityMatch) return handleGetActivity(session, Number(crmActivityMatch[1]));
        if (pathname === "/api/crm/pipeline") return handlePipelineSummary(session);

        // Wallet routes
        if (pathname === "/api/wallet/status") return handleWalletStatus(req, session);
        if (pathname === "/api/wallet/balance") return handleWalletBalance(req, session);
        if (pathname === "/api/wallet/transactions") return handleWalletTransactions(req, session);

        // Debug log route (for inspecting client-side logs)
        if (pathname === "/api/debug/log") return handleGetDebugLog();
      }

      if (req.method === "POST") {
        if (pathname === "/auth/login") return login(req);
        if (pathname === "/auth/logout") return logout(req);

        // Key Teleport route (no auth required)
        if (pathname === "/api/keyteleport") return handleKeyTeleport(req);

        // Team routes
        if (pathname === "/api/teams") return handleCreateTeam(req, session);
        if (pathname === "/teams/switch") return handleSwitchTeam(req, session);
        if (pathname === "/teams/join") return handleJoinTeam(req, session);
        const addTeamMemberMatch = pathname.match(/^\/api\/teams\/(\d+)\/members$/);
        if (addTeamMemberMatch) return handleAddTeamMember(req, session, Number(addTeamMemberMatch[1]));
        const createTeamInviteMatch = pathname.match(/^\/api\/teams\/(\d+)\/invitations$/);
        if (createTeamInviteMatch) return handleCreateTeamInvitation(req, session, Number(createTeamInviteMatch[1]));
        if (pathname === "/api/team-managers") return handleAddTeamManager(req, session);
        const uploadTeamIconMatch = pathname.match(/^\/api\/teams\/(\d+)\/icon$/);
        if (uploadTeamIconMatch) return handleUploadTeamIcon(req, session, Number(uploadTeamIconMatch[1]));

        // Team-scoped chat POST routes
        const teamCreateChannelMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels$/);
        if (teamCreateChannelMatch) return handleTeamCreateChannel(req, session, teamCreateChannelMatch[1]);

        const teamCreateDmMatch = pathname.match(/^\/t\/([^/]+)\/chat\/dm$/);
        if (teamCreateDmMatch) return handleTeamCreateDm(req, session, teamCreateDmMatch[1]);

        const teamArchiveDmMatch = pathname.match(/^\/t\/([^/]+)\/api\/dm\/(\d+)\/archive$/);
        if (teamArchiveDmMatch) return handleTeamArchiveDm(req, session, teamArchiveDmMatch[1], Number(teamArchiveDmMatch[2]));

        const teamUpdateUserMatch = pathname.match(/^\/t\/([^/]+)\/chat\/users$/);
        if (teamUpdateUserMatch) return handleTeamUpdateUser(req, session, teamUpdateUserMatch[1]);

        const teamSendMessageMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/messages$/);
        if (teamSendMessageMatch) {
          return handleTeamSendMessage(req, session, teamSendMessageMatch[1], Number(teamSendMessageMatch[2]));
        }

        const teamMarkReadMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/read$/);
        if (teamMarkReadMatch) {
          return handleTeamMarkChannelRead(session, teamMarkReadMatch[1], Number(teamMarkReadMatch[2]));
        }

        const teamReactionMatch = pathname.match(/^\/t\/([^/]+)\/api\/messages\/(\d+)\/reactions$/);
        if (teamReactionMatch) {
          return handleTeamToggleReaction(req, session, teamReactionMatch[1], Number(teamReactionMatch[2]));
        }

        const teamPinMessageMatch = pathname.match(/^\/t\/([^/]+)\/api\/channels\/(\d+)\/messages\/(\d+)\/pin$/);
        if (teamPinMessageMatch) {
          return handleTeamPinMessage(req, session, teamPinMessageMatch[1], Number(teamPinMessageMatch[2]), Number(teamPinMessageMatch[3]));
        }

        const teamAddChannelGroupsMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/groups$/);
        if (teamAddChannelGroupsMatch) {
          return handleTeamAddChannelGroups(req, session, teamAddChannelGroupsMatch[1], Number(teamAddChannelGroupsMatch[2]));
        }

        // Team-scoped channel encryption key routes
        const teamStoreChannelKeyMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/keys$/);
        if (teamStoreChannelKeyMatch) {
          return handleTeamStoreChannelKey(req, session, teamStoreChannelKeyMatch[1], Number(teamStoreChannelKeyMatch[2]));
        }

        const teamStoreChannelKeysBatchMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/keys\/batch$/);
        if (teamStoreChannelKeysBatchMatch) {
          return handleTeamStoreChannelKeysBatch(req, session, teamStoreChannelKeysBatchMatch[1], Number(teamStoreChannelKeysBatchMatch[2]));
        }

        // Team-level encryption POST routes (zero-knowledge key distribution)
        const teamInitEncryptionMatch = pathname.match(/^\/t\/([^/]+)\/api\/team\/init-encryption$/);
        if (teamInitEncryptionMatch) {
          const result = createTeamRouteContext(session, teamInitEncryptionMatch[1]);
          if (!result.ok) return result.response;
          return handleInitTeamEncryption(req, result.ctx);
        }

        const teamStoreUserKeyMatch = pathname.match(/^\/t\/([^/]+)\/api\/team\/key$/);
        if (teamStoreUserKeyMatch) {
          const result = createTeamRouteContext(session, teamStoreUserKeyMatch[1]);
          if (!result.ok) return result.response;
          return handleStoreUserTeamKey(req, result.ctx);
        }

        const teamStoreInviteKeyMatch = pathname.match(/^\/t\/([^/]+)\/api\/team\/invite-key$/);
        if (teamStoreInviteKeyMatch) {
          const result = createTeamRouteContext(session, teamStoreInviteKeyMatch[1]);
          if (!result.ok) return result.response;
          return handleStoreInviteKey(req, result.ctx);
        }

        // Team-scoped group POST routes
        const teamCreateGroupMatch = pathname.match(/^\/t\/([^/]+)\/groups$/);
        if (teamCreateGroupMatch) return handleTeamCreateGroup(req, session, teamCreateGroupMatch[1]);
        const teamAddGroupMembersMatch = pathname.match(/^\/t\/([^/]+)\/groups\/(\d+)\/members$/);
        if (teamAddGroupMembersMatch) {
          return handleTeamAddGroupMembers(req, session, teamAddGroupMembersMatch[1], Number(teamAddGroupMembersMatch[2]));
        }

        // Team-scoped todos POST routes
        const teamTodoCreateMatch = pathname.match(/^\/t\/([^/]+)\/todos$/);
        if (teamTodoCreateMatch) return handleTeamTodoCreate(req, session, teamTodoCreateMatch[1]);
        const teamTodoUpdateMatch = pathname.match(/^\/t\/([^/]+)\/todos\/(\d+)\/update$/);
        if (teamTodoUpdateMatch) return handleTeamTodoUpdate(req, session, teamTodoUpdateMatch[1], Number(teamTodoUpdateMatch[2]));
        const teamTodoStateMatch = pathname.match(/^\/t\/([^/]+)\/todos\/(\d+)\/state$/);
        if (teamTodoStateMatch) return handleTeamTodoState(req, session, teamTodoStateMatch[1], Number(teamTodoStateMatch[2]));
        const teamTodoDeleteMatch = pathname.match(/^\/t\/([^/]+)\/todos\/(\d+)\/delete$/);
        if (teamTodoDeleteMatch) return handleTeamTodoDelete(req, session, teamTodoDeleteMatch[1], Number(teamTodoDeleteMatch[2]));
        const teamApiTodoStateMatch = pathname.match(/^\/t\/([^/]+)\/api\/todos\/(\d+)\/state$/);
        if (teamApiTodoStateMatch) return handleTeamApiTodoState(req, session, teamApiTodoStateMatch[1], Number(teamApiTodoStateMatch[2]));
        const teamApiTodoPositionMatch = pathname.match(/^\/t\/([^/]+)\/api\/todos\/(\d+)\/position$/);
        if (teamApiTodoPositionMatch) return handleTeamApiTodoPosition(req, session, teamApiTodoPositionMatch[1], Number(teamApiTodoPositionMatch[2]));
        const teamCreateSubtaskMatch = pathname.match(/^\/t\/([^/]+)\/api\/todos\/(\d+)\/subtasks$/);
        if (teamCreateSubtaskMatch) return handleTeamCreateSubtask(req, session, teamCreateSubtaskMatch[1], Number(teamCreateSubtaskMatch[2]));

        // Team-scoped CRM POST routes
        const teamCreateCompanyMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/companies$/);
        if (teamCreateCompanyMatch) return handleTeamCreateCompany(req, session, teamCreateCompanyMatch[1]);
        const teamCreateContactMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/contacts$/);
        if (teamCreateContactMatch) return handleTeamCreateContact(req, session, teamCreateContactMatch[1]);
        const teamCreateOpportunityMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/opportunities$/);
        if (teamCreateOpportunityMatch) return handleTeamCreateOpportunity(req, session, teamCreateOpportunityMatch[1]);
        const teamCreateActivityMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/activities$/);
        if (teamCreateActivityMatch) return handleTeamCreateActivity(req, session, teamCreateActivityMatch[1]);

        // Team-scoped tasks POST routes
        const teamCreateTaskMatch = pathname.match(/^\/t\/([^/]+)\/api\/tasks$/);
        if (teamCreateTaskMatch) return handleTeamCreateTask(req, session, teamCreateTaskMatch[1]);
        const teamLinkThreadMatch = pathname.match(/^\/t\/([^/]+)\/api\/tasks\/(\d+)\/link$/);
        if (teamLinkThreadMatch) return handleTeamLinkThreadToTask(req, session, teamLinkThreadMatch[1], Number(teamLinkThreadMatch[2]));

        // Team-scoped key request POST routes
        const teamKeyRequestFulfillMatch = pathname.match(/^\/t\/([^/]+)\/api\/key-requests\/(\d+)\/fulfill$/);
        if (teamKeyRequestFulfillMatch) {
          return handleFulfillKeyRequest(req, session, teamKeyRequestFulfillMatch[1], Number(teamKeyRequestFulfillMatch[2]));
        }
        const teamKeyRequestRejectMatch = pathname.match(/^\/t\/([^/]+)\/api\/key-requests\/(\d+)\/reject$/);
        if (teamKeyRequestRejectMatch) {
          return handleRejectKeyRequest(req, session, teamKeyRequestRejectMatch[1], Number(teamKeyRequestRejectMatch[2]));
        }

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

        // API endpoint for position-only updates (Summary card reordering)
        const apiPositionMatch = pathname.match(/^\/api\/todos\/(\d+)\/position$/);
        if (apiPositionMatch) return handleApiTodoPosition(req, session, Number(apiPositionMatch[1]));

        // API endpoint for creating subtasks (JSON)
        const createSubtaskMatch = pathname.match(/^\/api\/todos\/(\d+)\/subtasks$/);
        if (createSubtaskMatch) return handleCreateSubtask(req, session, Number(createSubtaskMatch[1]));

        const deleteMatch = pathname.match(/^\/todos\/(\d+)\/delete$/);
        if (deleteMatch) return handleTodoDelete(req, session, Number(deleteMatch[1]));

        // Chat routes
        if (pathname === "/chat/channels") return handleCreateChannel(req, session);
        if (pathname === "/chat/dm") return handleCreateDm(req, session);
        if (pathname === "/chat/users") return handleUpdateUser(req, session);
        const sendMessageMatch = pathname.match(/^\/chat\/channels\/(\d+)\/messages$/);
        if (sendMessageMatch) return handleSendMessage(req, session, Number(sendMessageMatch[1]));
        const reactionMatch = pathname.match(/^\/api\/messages\/(\d+)\/reactions$/);
        if (reactionMatch) return handleToggleReaction(req, session, Number(reactionMatch[1]));
        const pinMessageMatch = pathname.match(/^\/api\/channels\/(\d+)\/messages\/(\d+)\/pin$/);
        if (pinMessageMatch) return handlePinMessage(req, session, Number(pinMessageMatch[1]), Number(pinMessageMatch[2]));
        const markReadMatch = pathname.match(/^\/chat\/channels\/(\d+)\/read$/);
        if (markReadMatch) return handleMarkChannelRead(session, Number(markReadMatch[1]));
        const addChannelGroupsMatch = pathname.match(/^\/chat\/channels\/(\d+)\/groups$/);
        if (addChannelGroupsMatch) return handleAddChannelGroups(req, session, Number(addChannelGroupsMatch[1]));

        // Channel encryption key routes
        const storeChannelKeyMatch = pathname.match(/^\/chat\/channels\/(\d+)\/keys$/);
        if (storeChannelKeyMatch) return handleStoreChannelKey(req, session, Number(storeChannelKeyMatch[1]));
        const storeChannelKeysBatchMatch = pathname.match(/^\/chat\/channels\/(\d+)\/keys\/batch$/);
        if (storeChannelKeysBatchMatch) return handleStoreChannelKeysBatch(req, session, Number(storeChannelKeysBatchMatch[1]));

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

        // Task-CRM linking routes
        const linkCrmMatch = pathname.match(/^\/api\/tasks\/(\d+)\/crm-links$/);
        if (linkCrmMatch) return handleLinkTaskToCrm(req, session, Number(linkCrmMatch[1]));

        // Community encryption routes
        if (pathname === "/api/community/bootstrap") return handleBootstrapCommunity(req, session);
        if (pathname === "/api/community/key") return handleStoreCommunityKey(req, session);
        if (pathname === "/api/invites") return handleCreateInvite(req, session);
        if (pathname === "/api/invites/redeem") return handleRedeemInvite(req, session);
        if (pathname === "/api/community/migration/batch") return handleMigrationBatch(req, session);
        if (pathname === "/api/community/migration/complete") return handleCompleteMigration(session);

        // Team invite redemption and key storage (new onboarding flow)
        if (pathname === "/api/team-invites/redeem") return handleRedeemTeamInvite(req, session);
        if (pathname === "/api/team-invites/keys") return handleStoreInviteKeys(req, session);

        // CRM routes (admin only)
        if (pathname === "/api/crm/companies") return handleCreateCompany(req, session);
        if (pathname === "/api/crm/contacts") return handleCreateContact(req, session);
        if (pathname === "/api/crm/opportunities") return handleCreateOpportunity(req, session);
        if (pathname === "/api/crm/activities") return handleCreateActivity(req, session);

        // Wallet routes
        if (pathname === "/api/wallet/connect") return handleWalletConnect(req, session);
        if (pathname === "/api/wallet/invoice") return handleWalletInvoice(req, session);
        if (pathname === "/api/wallet/pay") return handleWalletPay(req, session);

        // Debug logging (no auth required for client-side logging)
        if (pathname === "/api/debug/log") return handleDebugLog(req);
        if (pathname === "/api/debug/clear") return handleClearDebugLog();
      }

      if (req.method === "PATCH") {
        // Team routes
        const updateTeamMatch = pathname.match(/^\/api\/teams\/(\d+)$/);
        if (updateTeamMatch) return handleUpdateTeam(req, session, Number(updateTeamMatch[1]));
        const updateTeamFeaturesMatch = pathname.match(/^\/api\/teams\/(\d+)\/features$/);
        if (updateTeamFeaturesMatch) return handleUpdateTeamFeatures(req, session, Number(updateTeamFeaturesMatch[1]));
        const updateTeamMemberMatch = pathname.match(/^\/api\/teams\/(\d+)\/members\/([^/]+)$/);
        if (updateTeamMemberMatch) {
          return handleUpdateTeamMember(
            req,
            session,
            Number(updateTeamMemberMatch[1]),
            decodeURIComponent(updateTeamMemberMatch[2])
          );
        }

        // Team-scoped PATCH routes
        const teamUpdateChannelMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)$/);
        if (teamUpdateChannelMatch) {
          return handleTeamUpdateChannel(req, session, teamUpdateChannelMatch[1], Number(teamUpdateChannelMatch[2]));
        }
        const teamUpdateGroupMatch = pathname.match(/^\/t\/([^/]+)\/groups\/(\d+)$/);
        if (teamUpdateGroupMatch) {
          return handleTeamUpdateGroup(req, session, teamUpdateGroupMatch[1], Number(teamUpdateGroupMatch[2]));
        }

        // Team-scoped CRM PATCH routes
        const teamUpdateCrmCompanyMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/companies\/(\d+)$/);
        if (teamUpdateCrmCompanyMatch) {
          return handleTeamUpdateCompany(req, session, teamUpdateCrmCompanyMatch[1], Number(teamUpdateCrmCompanyMatch[2]));
        }
        const teamUpdateCrmContactMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/contacts\/(\d+)$/);
        if (teamUpdateCrmContactMatch) {
          return handleTeamUpdateContact(req, session, teamUpdateCrmContactMatch[1], Number(teamUpdateCrmContactMatch[2]));
        }
        const teamUpdateCrmOpportunityMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/opportunities\/(\d+)$/);
        if (teamUpdateCrmOpportunityMatch) {
          return handleTeamUpdateOpportunity(req, session, teamUpdateCrmOpportunityMatch[1], Number(teamUpdateCrmOpportunityMatch[2]));
        }

        const updateChannelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (updateChannelMatch) return handleUpdateChannel(req, session, Number(updateChannelMatch[1]));
        const updateGroupMatch = pathname.match(/^\/chat\/groups\/(\d+)$/);
        if (updateGroupMatch) return handleUpdateGroup(req, session, Number(updateGroupMatch[1]));

        // Push notification routes
        if (pathname === "/api/push/frequency") return handlePushUpdateFrequency(req, session);

        // Wingman routes
        if (pathname === "/api/wingman/settings") return handleUpdateWingmanSettings(req, session);

        // App settings routes (admin only)
        if (pathname === "/api/app/settings") return handleUpdateAppSettings(req, session);

        // CRM routes (admin only)
        const updateCrmCompanyMatch = pathname.match(/^\/api\/crm\/companies\/(\d+)$/);
        if (updateCrmCompanyMatch) return handleUpdateCompany(req, session, Number(updateCrmCompanyMatch[1]));
        const updateCrmContactMatch = pathname.match(/^\/api\/crm\/contacts\/(\d+)$/);
        if (updateCrmContactMatch) return handleUpdateContact(req, session, Number(updateCrmContactMatch[1]));
        const updateCrmOpportunityMatch = pathname.match(/^\/api\/crm\/opportunities\/(\d+)$/);
        if (updateCrmOpportunityMatch) return handleUpdateOpportunity(req, session, Number(updateCrmOpportunityMatch[1]));
      }

      if (req.method === "DELETE") {
        // Team routes
        const deleteTeamMatch = pathname.match(/^\/api\/teams\/(\d+)$/);
        if (deleteTeamMatch) return handleDeleteTeam(session, Number(deleteTeamMatch[1]));
        const removeTeamMemberMatch = pathname.match(/^\/api\/teams\/(\d+)\/members\/([^/]+)$/);
        if (removeTeamMemberMatch) {
          return handleRemoveTeamMember(
            session,
            Number(removeTeamMemberMatch[1]),
            decodeURIComponent(removeTeamMemberMatch[2])
          );
        }
        const deleteTeamInviteMatch = pathname.match(/^\/api\/teams\/(\d+)\/invitations\/(\d+)$/);
        if (deleteTeamInviteMatch) {
          return handleDeleteTeamInvitation(
            session,
            Number(deleteTeamInviteMatch[1]),
            Number(deleteTeamInviteMatch[2])
          );
        }

        // Team-scoped DELETE routes
        const teamDeleteMessageMatch = pathname.match(/^\/t\/([^/]+)\/chat\/messages\/(\d+)$/);
        if (teamDeleteMessageMatch) {
          return handleTeamDeleteMessage(session, teamDeleteMessageMatch[1], Number(teamDeleteMessageMatch[2]));
        }

        const teamDeleteChannelMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)$/);
        if (teamDeleteChannelMatch) {
          return handleTeamDeleteChannel(session, teamDeleteChannelMatch[1], Number(teamDeleteChannelMatch[2]));
        }

        const teamUnpinMessageMatch = pathname.match(/^\/t\/([^/]+)\/api\/channels\/(\d+)\/messages\/(\d+)\/pin$/);
        if (teamUnpinMessageMatch) {
          return handleTeamUnpinMessage(req, session, teamUnpinMessageMatch[1], Number(teamUnpinMessageMatch[2]), Number(teamUnpinMessageMatch[3]));
        }

        const teamRemoveChannelGroupMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels\/(\d+)\/groups\/(\d+)$/);
        if (teamRemoveChannelGroupMatch) {
          return handleTeamRemoveChannelGroup(
            session,
            teamRemoveChannelGroupMatch[1],
            Number(teamRemoveChannelGroupMatch[2]),
            Number(teamRemoveChannelGroupMatch[3])
          );
        }

        // Team-scoped group DELETE routes
        const teamDeleteGroupMatch = pathname.match(/^\/t\/([^/]+)\/groups\/(\d+)$/);
        if (teamDeleteGroupMatch) {
          return handleTeamDeleteGroup(session, teamDeleteGroupMatch[1], Number(teamDeleteGroupMatch[2]));
        }
        const teamRemoveGroupMemberMatch = pathname.match(/^\/t\/([^/]+)\/groups\/(\d+)\/members\/([^/]+)$/);
        if (teamRemoveGroupMemberMatch) {
          return handleTeamRemoveGroupMember(
            session,
            teamRemoveGroupMemberMatch[1],
            Number(teamRemoveGroupMemberMatch[2]),
            decodeURIComponent(teamRemoveGroupMemberMatch[3])
          );
        }

        // Team-scoped CRM DELETE routes
        const teamDeleteCrmCompanyMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/companies\/(\d+)$/);
        if (teamDeleteCrmCompanyMatch) {
          return handleTeamDeleteCompany(session, teamDeleteCrmCompanyMatch[1], Number(teamDeleteCrmCompanyMatch[2]));
        }
        const teamDeleteCrmContactMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/contacts\/(\d+)$/);
        if (teamDeleteCrmContactMatch) {
          return handleTeamDeleteContact(session, teamDeleteCrmContactMatch[1], Number(teamDeleteCrmContactMatch[2]));
        }
        const teamDeleteCrmOpportunityMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/opportunities\/(\d+)$/);
        if (teamDeleteCrmOpportunityMatch) {
          return handleTeamDeleteOpportunity(session, teamDeleteCrmOpportunityMatch[1], Number(teamDeleteCrmOpportunityMatch[2]));
        }
        const teamDeleteCrmActivityMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/activities\/(\d+)$/);
        if (teamDeleteCrmActivityMatch) {
          return handleTeamDeleteActivity(session, teamDeleteCrmActivityMatch[1], Number(teamDeleteCrmActivityMatch[2]));
        }

        // Team-scoped tasks DELETE routes
        const teamUnlinkThreadMatch = pathname.match(/^\/t\/([^/]+)\/api\/tasks\/(\d+)\/unlink\/(\d+)$/);
        if (teamUnlinkThreadMatch) {
          return handleTeamUnlinkThreadFromTask(
            session,
            teamUnlinkThreadMatch[1],
            Number(teamUnlinkThreadMatch[2]),
            Number(teamUnlinkThreadMatch[3])
          );
        }

        // Message delete (author or admin)
        const deleteMessageMatch = pathname.match(/^\/chat\/messages\/(\d+)$/);
        if (deleteMessageMatch) return handleDeleteMessage(session, Number(deleteMessageMatch[1]));

        // Channel delete (admin only)
        const deleteChannelMatch = pathname.match(/^\/chat\/channels\/(\d+)$/);
        if (deleteChannelMatch) return handleDeleteChannel(session, Number(deleteChannelMatch[1]));

        // Unpin message from channel
        const unpinMessageMatch = pathname.match(/^\/api\/channels\/(\d+)\/messages\/(\d+)\/pin$/);
        if (unpinMessageMatch) return handleUnpinMessage(req, session, Number(unpinMessageMatch[1]), Number(unpinMessageMatch[2]));

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

        // Task-CRM linking routes
        const unlinkCrmMatch = pathname.match(/^\/api\/tasks\/(\d+)\/crm-links\/(\d+)$/);
        if (unlinkCrmMatch) {
          return handleUnlinkTaskFromCrm(
            session,
            Number(unlinkCrmMatch[1]),
            Number(unlinkCrmMatch[2])
          );
        }

        // Community encryption routes
        const deleteInviteMatch = pathname.match(/^\/api\/invites\/(\d+)$/);
        if (deleteInviteMatch) return handleDeleteInvite(session, Number(deleteInviteMatch[1]));

        // CRM routes (admin only)
        const deleteCrmCompanyMatch = pathname.match(/^\/api\/crm\/companies\/(\d+)$/);
        if (deleteCrmCompanyMatch) return handleDeleteCompany(session, Number(deleteCrmCompanyMatch[1]));
        const deleteCrmContactMatch = pathname.match(/^\/api\/crm\/contacts\/(\d+)$/);
        if (deleteCrmContactMatch) return handleDeleteContact(session, Number(deleteCrmContactMatch[1]));
        const deleteCrmOpportunityMatch = pathname.match(/^\/api\/crm\/opportunities\/(\d+)$/);
        if (deleteCrmOpportunityMatch) return handleDeleteOpportunity(session, Number(deleteCrmOpportunityMatch[1]));
        const deleteCrmActivityMatch = pathname.match(/^\/api\/crm\/activities\/(\d+)$/);
        if (deleteCrmActivityMatch) return handleDeleteActivity(session, Number(deleteCrmActivityMatch[1]));

        // Wallet routes
        if (pathname === "/api/wallet/disconnect") return handleWalletDisconnect(req, session);
      }

      return new Response("Not found", { status: 404 });
    },
    (error) => logError("Request failed", error)
  ),
});

console.log(`${APP_NAME_DEFAULT} ready on http://localhost:${server.port}`);
