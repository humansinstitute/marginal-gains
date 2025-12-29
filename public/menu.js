import { elements as el, show, hide } from "./dom.js";

export function initAppMenu() {
  el.hamburgerBtn?.addEventListener("click", openAppMenu);
  el.appMenuOverlay?.addEventListener("click", closeAppMenu);
  el.appMenuClose?.addEventListener("click", closeAppMenu);
}

function openAppMenu() {
  show(el.appMenu);
}

function closeAppMenu() {
  hide(el.appMenu);
}
