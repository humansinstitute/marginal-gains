import { initAuth } from "./auth.js";
import { initAvatarMenu } from "./avatar.js";
import { focusHeroInput } from "./dom.js";
import { initTagInputs } from "./tag-inputs.js";
import { initUI } from "./ui.js";
import { initChat } from "./chat.js";
import { initAppMenu } from "./menu.js";
import { initSettings } from "./settings.js";
import { initKanban } from "./kanban.js";
import { initTaskModal } from "./taskModal.js";
import { initOnboarding } from "./onboarding.js";

window.addEventListener("load", focusHeroInput);

initAppMenu();
initAvatarMenu();
initUI();
initAuth();
initTagInputs();
initOnboarding();
initChat();
initSettings();
initKanban();
initTaskModal();
