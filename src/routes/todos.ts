import { redirect, unauthorized } from "../http";
import { quickAddTodo, removeTodo, transitionTodoState, updateTodoFromForm } from "../services/todos";
import { normalizeStateInput } from "../validation";

import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

export async function handleTodoCreate(req: Request, session: Session | null) {
  if (!session) return unauthorized();
  const form = await req.formData();
  const title = String(form.get("title") ?? "");
  const tags = String(form.get("tags") ?? "");
  quickAddTodo(session.npub, title, tags);
  return redirect("/");
}

export async function handleTodoUpdate(req: Request, session: Session | null, id: number) {
  if (!session) return unauthorized();
  const form = await req.formData();
  updateTodoFromForm(session.npub, id, form);
  return redirect("/");
}

export async function handleTodoState(req: Request, session: Session | null, id: number) {
  if (!session) return unauthorized();
  const form = await req.formData();
  const nextState = normalizeStateInput(String(form.get("state") ?? "ready"));
  transitionTodoState(session.npub, id, nextState);
  return redirect("/");
}

export function handleTodoDelete(session: Session | null, id: number) {
  if (!session) return unauthorized();
  removeTodo(session.npub, id);
  return redirect("/");
}

// JSON API endpoint for state updates (used by Kanban drag-drop)
export async function handleApiTodoState(req: Request, session: Session | null, id: number) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  try {
    const body = await req.json();
    const nextState = normalizeStateInput(String(body.state ?? "ready"));
    const updated = transitionTodoState(session.npub, id, nextState);

    if (!updated) {
      return new Response(JSON.stringify({ error: "Invalid state transition or todo not found" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, state: nextState }), { status: 200, headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: jsonHeaders });
  }
}
