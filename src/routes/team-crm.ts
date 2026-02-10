/**
 * Team-scoped CRM Routes
 *
 * These routes handle CRM operations within a team context.
 * CRM data is stored in the team's database, not the main database.
 */

import { createTeamRouteContext, isTeamManager } from "../context";
import { jsonResponse } from "../http";
import { renderTeamCrmPage } from "../render/crm";
import { TeamDatabase } from "../team-db";

import { getTeamBranding } from "./app-settings";

import type { CrmOpportunityStage } from "../db";
import type { Session } from "../types";

// Valid CRM stages and activity types
const VALID_STAGES: CrmOpportunityStage[] = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

const VALID_ACTIVITY_TYPES = ["call", "email", "meeting", "note", "task"];

// Helper to create and validate team context
// When no returnPath is given (API routes), use isApi mode for proper 401 JSON responses
function requireTeamContext(session: Session | null, teamSlug: string, returnPath?: string) {
  return createTeamRouteContext(session, teamSlug, returnPath ?? { isApi: true });
}

// ==================== CRM Page ====================

export function handleTeamCrmPage(session: Session | null, teamSlug: string) {
  const result = requireTeamContext(session, teamSlug, `/t/${teamSlug}/crm`);
  if (!result.ok) return result.response;

  // Only managers and owners can access CRM
  if (!isTeamManager(result.ctx)) {
    return new Response("CRM access requires manager role", { status: 403 });
  }

  const branding = getTeamBranding(teamSlug);
  return new Response(renderTeamCrmPage(result.ctx.session, teamSlug, result.ctx.teamDb, branding), {
    headers: { "Content-Type": "text/html" },
  });
}

// ==================== Companies ====================

export function handleTeamListCompanies(session: Session | null, teamSlug: string) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const companies = db.listCrmCompanies();
  return jsonResponse(companies);
}

export function handleTeamGetCompany(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const company = db.getCrmCompany(id);
  if (!company) {
    return jsonResponse({ error: "Company not found" }, 404);
  }

  // Include contacts for this company
  const contacts = db.listCrmContactsByCompany(id);
  return jsonResponse({ ...company, contacts });
}

export async function handleTeamCreateCompany(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const body = await req.json();
  const { name, website, industry, notes } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const company = db.createCrmCompany(
    name.trim(),
    result.ctx.session.npub,
    website?.trim() || undefined,
    industry?.trim() || undefined,
    notes?.trim() || undefined
  );

  if (!company) {
    return jsonResponse({ error: "Failed to create company" }, 500);
  }

  return jsonResponse(company, 201);
}

export async function handleTeamUpdateCompany(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getCrmCompany(id);
  if (!existing) {
    return jsonResponse({ error: "Company not found" }, 404);
  }

  const body = await req.json();
  const { name, website, industry, notes } = body;

  const company = db.updateCrmCompany(
    id,
    name?.trim() || existing.name,
    website !== undefined ? (website?.trim() || undefined) : existing.website || undefined,
    industry !== undefined ? (industry?.trim() || undefined) : existing.industry || undefined,
    notes !== undefined ? (notes?.trim() || undefined) : existing.notes || undefined
  );

  return jsonResponse(company);
}

export function handleTeamDeleteCompany(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getCrmCompany(id);
  if (!existing) {
    return jsonResponse({ error: "Company not found" }, 404);
  }

  db.deleteCrmCompany(id);
  return jsonResponse({ success: true });
}

// ==================== Contacts ====================

export function handleTeamListContacts(
  session: Session | null,
  teamSlug: string,
  companyId?: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const contacts = companyId ? db.listCrmContactsByCompany(companyId) : db.listCrmContacts();
  return jsonResponse(contacts);
}

export function handleTeamGetContact(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const contact = db.getCrmContact(id);
  if (!contact) {
    return jsonResponse({ error: "Contact not found" }, 404);
  }

  // Include activities for this contact
  const activities = db.listCrmActivitiesByContact(id);
  return jsonResponse({ ...contact, activities });
}

export async function handleTeamCreateContact(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const body = await req.json();
  const { company_id, name, email, phone, npub, twitter, linkedin, notes } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  const db = new TeamDatabase(result.ctx.teamDb);

  // Validate company exists if provided
  if (company_id) {
    const company = db.getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  const contact = db.createCrmContact({
    name: name.trim(),
    createdBy: result.ctx.session.npub,
    companyId: company_id || undefined,
    email: email?.trim() || undefined,
    phone: phone?.trim() || undefined,
    npub: npub?.trim() || undefined,
    twitter: twitter?.trim() || undefined,
    linkedin: linkedin?.trim() || undefined,
    notes: notes?.trim() || undefined,
  });

  if (!contact) {
    return jsonResponse({ error: "Failed to create contact" }, 500);
  }

  return jsonResponse(contact, 201);
}

export async function handleTeamUpdateContact(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getCrmContact(id);
  if (!existing) {
    return jsonResponse({ error: "Contact not found" }, 404);
  }

  const body = await req.json();
  const { company_id, name, email, phone, npub, twitter, linkedin, notes } = body;

  // Validate company exists if provided
  if (company_id) {
    const company = db.getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  const contact = db.updateCrmContact({
    id,
    name: name?.trim() || existing.name,
    companyId: company_id !== undefined ? (company_id || undefined) : existing.company_id || undefined,
    email: email !== undefined ? (email?.trim() || undefined) : existing.email || undefined,
    phone: phone !== undefined ? (phone?.trim() || undefined) : existing.phone || undefined,
    npub: npub !== undefined ? (npub?.trim() || undefined) : existing.npub || undefined,
    twitter: twitter !== undefined ? (twitter?.trim() || undefined) : existing.twitter || undefined,
    linkedin: linkedin !== undefined ? (linkedin?.trim() || undefined) : existing.linkedin || undefined,
    notes: notes !== undefined ? (notes?.trim() || undefined) : existing.notes || undefined,
  });

  return jsonResponse(contact);
}

export function handleTeamDeleteContact(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getCrmContact(id);
  if (!existing) {
    return jsonResponse({ error: "Contact not found" }, 404);
  }

  db.deleteCrmContact(id);
  return jsonResponse({ success: true });
}

// ==================== Opportunities ====================

export function handleTeamListOpportunities(
  session: Session | null,
  teamSlug: string,
  stage?: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);

  if (stage && VALID_STAGES.includes(stage as CrmOpportunityStage)) {
    return jsonResponse(db.listCrmOpportunitiesByStage(stage as CrmOpportunityStage));
  }

  const opportunities = db.listCrmOpportunities();
  return jsonResponse(opportunities);
}

export function handleTeamGetOpportunity(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const opportunity = db.getCrmOpportunity(id);
  if (!opportunity) {
    return jsonResponse({ error: "Opportunity not found" }, 404);
  }

  // Include activities for this opportunity
  const activities = db.listCrmActivitiesByOpportunity(id);
  return jsonResponse({ ...opportunity, activities });
}

export async function handleTeamCreateOpportunity(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const body = await req.json();
  const {
    company_id,
    contact_id,
    title,
    value,
    currency,
    stage,
    probability,
    expected_close,
    notes,
  } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return jsonResponse({ error: "Title is required" }, 400);
  }

  const opportunityStage = stage || "lead";
  if (!VALID_STAGES.includes(opportunityStage)) {
    return jsonResponse({ error: "Invalid stage" }, 400);
  }

  const db = new TeamDatabase(result.ctx.teamDb);

  // Validate company exists if provided
  if (company_id) {
    const company = db.getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  // Validate contact exists if provided
  if (contact_id) {
    const contact = db.getCrmContact(contact_id);
    if (!contact) {
      return jsonResponse({ error: "Contact not found" }, 400);
    }
  }

  const opportunity = db.createCrmOpportunity({
    title: title.trim(),
    createdBy: result.ctx.session.npub,
    companyId: company_id || undefined,
    contactId: contact_id || undefined,
    value: value ? Number(value) : undefined,
    currency: currency?.trim() || "USD",
    stage: opportunityStage as CrmOpportunityStage,
    probability: probability ? Math.min(100, Math.max(0, Number(probability))) : 0,
    expectedClose: expected_close?.trim() || undefined,
    notes: notes?.trim() || undefined,
  });

  if (!opportunity) {
    return jsonResponse({ error: "Failed to create opportunity" }, 500);
  }

  return jsonResponse(opportunity, 201);
}

export async function handleTeamUpdateOpportunity(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getCrmOpportunity(id);
  if (!existing) {
    return jsonResponse({ error: "Opportunity not found" }, 404);
  }

  const body = await req.json();
  const {
    company_id,
    contact_id,
    title,
    value,
    currency,
    stage,
    probability,
    expected_close,
    notes,
  } = body;

  if (stage && !VALID_STAGES.includes(stage)) {
    return jsonResponse({ error: "Invalid stage" }, 400);
  }

  // Validate company exists if provided
  if (company_id) {
    const company = db.getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  // Validate contact exists if provided
  if (contact_id) {
    const contact = db.getCrmContact(contact_id);
    if (!contact) {
      return jsonResponse({ error: "Contact not found" }, 400);
    }
  }

  const opportunity = db.updateCrmOpportunity({
    id,
    title: title?.trim() || existing.title,
    companyId: company_id !== undefined ? (company_id || undefined) : existing.company_id || undefined,
    contactId: contact_id !== undefined ? (contact_id || undefined) : existing.contact_id || undefined,
    value: value !== undefined ? (value ? Number(value) : undefined) : existing.value || undefined,
    currency: currency?.trim() || existing.currency,
    stage: (stage as CrmOpportunityStage) || existing.stage,
    probability:
      probability !== undefined
        ? Math.min(100, Math.max(0, Number(probability)))
        : existing.probability,
    expectedClose:
      expected_close !== undefined
        ? expected_close?.trim() || undefined
        : existing.expected_close || undefined,
    notes: notes !== undefined ? (notes?.trim() || undefined) : existing.notes || undefined,
  });

  return jsonResponse(opportunity);
}

export function handleTeamDeleteOpportunity(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getCrmOpportunity(id);
  if (!existing) {
    return jsonResponse({ error: "Opportunity not found" }, 404);
  }

  db.deleteCrmOpportunity(id);
  return jsonResponse({ success: true });
}

// ==================== Activities ====================

export function handleTeamListActivities(
  session: Session | null,
  teamSlug: string,
  filters?: { contact_id?: number; opportunity_id?: number; company_id?: number }
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);

  if (filters?.contact_id) {
    return jsonResponse(db.listCrmActivitiesByContact(filters.contact_id));
  }
  if (filters?.opportunity_id) {
    return jsonResponse(db.listCrmActivitiesByOpportunity(filters.opportunity_id));
  }
  if (filters?.company_id) {
    return jsonResponse(db.listCrmActivitiesByCompany(filters.company_id));
  }

  const activities = db.listCrmActivities();
  return jsonResponse(activities);
}

export function handleTeamGetActivity(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const activity = db.getCrmActivity(id);
  if (!activity) {
    return jsonResponse({ error: "Activity not found" }, 404);
  }

  return jsonResponse(activity);
}

export async function handleTeamCreateActivity(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const body = await req.json();
  const { contact_id, opportunity_id, company_id, type, subject, description, activity_date } =
    body;

  if (!subject || typeof subject !== "string" || !subject.trim()) {
    return jsonResponse({ error: "Subject is required" }, 400);
  }

  if (!type || !VALID_ACTIVITY_TYPES.includes(type)) {
    return jsonResponse(
      { error: "Valid type is required (call, email, meeting, note, task)" },
      400
    );
  }

  if (!activity_date) {
    return jsonResponse({ error: "Activity date is required" }, 400);
  }

  const db = new TeamDatabase(result.ctx.teamDb);

  // Validate related entities exist if provided
  if (contact_id) {
    const contact = db.getCrmContact(contact_id);
    if (!contact) {
      return jsonResponse({ error: "Contact not found" }, 400);
    }
  }

  if (opportunity_id) {
    const opportunity = db.getCrmOpportunity(opportunity_id);
    if (!opportunity) {
      return jsonResponse({ error: "Opportunity not found" }, 400);
    }
  }

  if (company_id) {
    const company = db.getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  const activity = db.createCrmActivity({
    type,
    subject: subject.trim(),
    activityDate: activity_date,
    createdBy: result.ctx.session.npub,
    contactId: contact_id || undefined,
    opportunityId: opportunity_id || undefined,
    companyId: company_id || undefined,
    description: description?.trim() || undefined,
  });

  if (!activity) {
    return jsonResponse({ error: "Failed to create activity" }, 500);
  }

  return jsonResponse(activity, 201);
}

export function handleTeamDeleteActivity(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getCrmActivity(id);
  if (!existing) {
    return jsonResponse({ error: "Activity not found" }, 404);
  }

  db.deleteCrmActivity(id);
  return jsonResponse({ success: true });
}

// ==================== Pipeline Summary ====================

export function handleTeamPipelineSummary(session: Session | null, teamSlug: string) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  if (!isTeamManager(result.ctx)) {
    return jsonResponse({ error: "CRM access requires manager role" }, 403);
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const summary = db.getCrmPipelineSummary();
  return jsonResponse(summary);
}
