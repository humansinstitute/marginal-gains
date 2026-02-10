/**
 * Team-scoped chat route handlers
 *
 * These handlers are the team-aware versions of the chat routes.
 * They use the RequestContext pattern to access the team database.
 */

// Pages
export { handleTeamChatPage } from "./pages";

// Channels
export {
  handleTeamListChannels,
  handleTeamGetChannel,
  handleTeamCreateChannel,
  handleTeamDeleteChannel,
  handleTeamUpdateChannel,
  handleTeamMarkChannelRead,
} from "./channels";

// Messages
export {
  handleTeamGetMessages,
  handleTeamSendMessage,
  handleTeamDeleteMessage,
} from "./messages";

// Users
export {
  handleTeamListUsers,
  handleTeamGetMe,
  handleTeamUpdateUser,
  handleTeamCreateDm,
  handleTeamArchiveDm,
} from "./users";

// Encryption
export {
  handleTeamGetChannelKey,
  handleTeamStoreChannelKey,
  handleTeamStoreChannelKeysBatch,
  handleTeamGetChannelKeysAll,
  handleTeamGetPendingKeyMembers,
  handleTeamGetAllPendingKeys,
  handleTeamListChannelGroups,
  handleTeamAddChannelGroups,
  handleTeamRemoveChannelGroup,
} from "./encryption";

// Reactions
export { handleTeamToggleReaction } from "./reactions";

// Pins
export {
  handleTeamPinMessage,
  handleTeamUnpinMessage,
  handleTeamGetPinnedMessages,
  handleTeamCheckMessagePinned,
} from "./pins";

// Channel Layout
export {
  handleTeamGetChannelLayout,
  handleTeamPutChannelLayout,
} from "./layout";
