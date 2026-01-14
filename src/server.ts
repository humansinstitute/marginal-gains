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
import { createContext } from "./context";
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
  handleGetChannel,
  handleGetChannelKey,
  handleGetChannelKeysAll,
  handleGetMe,
  handleGetMessages,
  handleGetPendingKeyMembers,
  handleListChannels,
  handleListUsers,
  handleMarkChannelRead,
  handleSendMessage,
  handleStoreChannelKey,
  handleStoreChannelKeysBatch,
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
import { handleHome, handleTodos } from "./routes/home";
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
  handleGetTaskThreads,
  handleGetThreadTasks,
  handleLinkThreadToTask,
  handleSearchTasks,
  handleUnlinkThreadFromTask,
} from "./routes/tasks";
import {
  handleTeamAddChannelGroups,
  handleTeamChatPage,
  handleTeamCreateChannel,
  handleTeamCreateDm,
  handleTeamDeleteChannel,
  handleTeamDeleteMessage,
  handleTeamGetChannel,
  handleTeamGetChannelKey,
  handleTeamGetChannelKeysAll,
  handleTeamGetMe,
  handleTeamGetMessages,
  handleTeamGetPendingKeyMembers,
  handleTeamListChannelGroups,
  handleTeamListChannels,
  handleTeamListUsers,
  handleTeamMarkChannelRead,
  handleTeamRemoveChannelGroup,
  handleTeamSendMessage,
  handleTeamStoreChannelKey,
  handleTeamStoreChannelKeysBatch,
  handleTeamUpdateChannel,
  handleTeamUpdateUser,
} from "./routes/team-chat";
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
  handleTeamsPage,
  handleListTeams,
  handleSwitchTeam,
  handleCreateTeam,
  handleJoinTeam,
  handleJoinTeamPage,
  handleTeamSettingsPage,
  handleUpdateTeam,
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
} from "./routes/teams";
import { handleApiTodoState, handleTodoCreate, handleTodoDelete, handleTodoState, handleTodoUpdate } from "./routes/todos";
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

        const aiTasksMatch = pathname.match(/^\/ai\/tasks\/(\d+)(?:\/(yes|no))?$/);
        if (aiTasksMatch) return handleAiTasks(url, aiTasksMatch);
        if (pathname === "/ai/summary/latest") return handleLatestSummary(url);

        // Chat routes - support deep linking to channels/DMs
        if (pathname === "/chat") return handleChatPage(session);
        const chatChannelMatch = pathname.match(/^\/chat\/channel\/([^/]+)$/);
        if (chatChannelMatch) return handleChatPage(session, { type: "channel", slug: chatChannelMatch[1] });
        const chatDmMatch = pathname.match(/^\/chat\/dm\/(\d+)$/);
        if (chatDmMatch) return handleChatPage(session, { type: "dm", id: Number(chatDmMatch[1]) });
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

        if (pathname === "/") return handleHome(session);
        if (pathname === "/todo") return handleTodos(url, session);
        if (pathname === "/settings") return handleSettings(session);
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

        if (pathname === "/wallet") return handleWalletPage(session);

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

        // App settings routes (admin only)
        if (pathname === "/api/app/settings") return handleGetAppSettings(session);

        // Community encryption routes
        if (pathname === "/api/community/status") return handleCommunityStatus(session);
        if (pathname === "/api/community/key") return handleGetCommunityKey(session);
        if (pathname === "/api/invites") return handleListInvites(session);
        if (pathname === "/api/community/migration/pending") return handleGetPendingMigration(session);
        if (pathname === "/api/community/migration/messages") return handleGetMigrationMessages(session, url);

        // CRM routes (admin only)
        if (pathname === "/crm") return handleCrmPage(session);
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
      }

      if (req.method === "POST") {
        if (pathname === "/auth/login") return login(req);
        if (pathname === "/auth/logout") return logout(req);

        // Team routes
        if (pathname === "/api/teams") return handleCreateTeam(req, session);
        if (pathname === "/teams/switch") return handleSwitchTeam(req, session);
        if (pathname === "/teams/join") return handleJoinTeam(req, session);
        const addTeamMemberMatch = pathname.match(/^\/api\/teams\/(\d+)\/members$/);
        if (addTeamMemberMatch) return handleAddTeamMember(req, session, Number(addTeamMemberMatch[1]));
        const createTeamInviteMatch = pathname.match(/^\/api\/teams\/(\d+)\/invitations$/);
        if (createTeamInviteMatch) return handleCreateTeamInvitation(req, session, Number(createTeamInviteMatch[1]));
        if (pathname === "/api/team-managers") return handleAddTeamManager(req, session);

        // Team-scoped chat POST routes
        const teamCreateChannelMatch = pathname.match(/^\/t\/([^/]+)\/chat\/channels$/);
        if (teamCreateChannelMatch) return handleTeamCreateChannel(req, session, teamCreateChannelMatch[1]);

        const teamCreateDmMatch = pathname.match(/^\/t\/([^/]+)\/chat\/dm$/);
        if (teamCreateDmMatch) return handleTeamCreateDm(req, session, teamCreateDmMatch[1]);

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

        // Team-scoped group POST routes
        const teamCreateGroupMatch = pathname.match(/^\/t\/([^/]+)\/groups$/);
        if (teamCreateGroupMatch) return handleTeamCreateGroup(req, session, teamCreateGroupMatch[1]);
        const teamAddGroupMembersMatch = pathname.match(/^\/t\/([^/]+)\/groups\/(\d+)\/members$/);
        if (teamAddGroupMembersMatch) {
          return handleTeamAddGroupMembers(req, session, teamAddGroupMembersMatch[1], Number(teamAddGroupMembersMatch[2]));
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

        const deleteMatch = pathname.match(/^\/todos\/(\d+)\/delete$/);
        if (deleteMatch) return handleTodoDelete(req, session, Number(deleteMatch[1]));

        // Chat routes
        if (pathname === "/chat/channels") return handleCreateChannel(req, session);
        if (pathname === "/chat/dm") return handleCreateDm(req, session);
        if (pathname === "/chat/users") return handleUpdateUser(req, session);
        const sendMessageMatch = pathname.match(/^\/chat\/channels\/(\d+)\/messages$/);
        if (sendMessageMatch) return handleSendMessage(req, session, Number(sendMessageMatch[1]));
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

        // Community encryption routes
        if (pathname === "/api/community/bootstrap") return handleBootstrapCommunity(req, session);
        if (pathname === "/api/community/key") return handleStoreCommunityKey(req, session);
        if (pathname === "/api/invites") return handleCreateInvite(req, session);
        if (pathname === "/api/invites/redeem") return handleRedeemInvite(req, session);
        if (pathname === "/api/community/migration/batch") return handleMigrationBatch(req, session);
        if (pathname === "/api/community/migration/complete") return handleCompleteMigration(session);

        // CRM routes (admin only)
        if (pathname === "/api/crm/companies") return handleCreateCompany(req, session);
        if (pathname === "/api/crm/contacts") return handleCreateContact(req, session);
        if (pathname === "/api/crm/opportunities") return handleCreateOpportunity(req, session);
        if (pathname === "/api/crm/activities") return handleCreateActivity(req, session);

        // Wallet routes
        if (pathname === "/api/wallet/connect") return handleWalletConnect(req, session);
        if (pathname === "/api/wallet/invoice") return handleWalletInvoice(req, session);
        if (pathname === "/api/wallet/pay") return handleWalletPay(req, session);
      }

      if (req.method === "PATCH") {
        // Team routes
        const updateTeamMatch = pathname.match(/^\/api\/teams\/(\d+)$/);
        if (updateTeamMatch) return handleUpdateTeam(req, session, Number(updateTeamMatch[1]));
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
