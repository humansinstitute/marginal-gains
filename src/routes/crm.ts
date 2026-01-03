import { isAdmin } from "../config";
import {
  createCrmActivity,
  createCrmCompany,
  createCrmContact,
  createCrmOpportunity,
  deleteCrmActivity,
  deleteCrmCompany,
  deleteCrmContact,
  deleteCrmOpportunity,
  getCrmActivity,
  getCrmCompany,
  getCrmContact,
  getCrmOpportunity,
  getCrmPipelineSummary,
  listCrmActivities,
  listCrmActivitiesByCompany,
  listCrmActivitiesByContact,
  listCrmActivitiesByOpportunity,
  listCrmCompanies,
  listCrmContacts,
  listCrmContactsByCompany,
  listCrmOpportunities,
  listCrmOpportunitiesByStage,
  updateCrmCompany,
  updateCrmContact,
  updateCrmOpportunity,
} from "../db";
import { jsonResponse, unauthorized } from "../http";
import { renderCrmPage } from "../render/crm";

import type { CrmActivityType, CrmOpportunityStage } from "../db";
import type { Session } from "../types";

function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

function requireAdmin(session: Session | null): Response | null {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Admin access required");
  return null;
}

// Render CRM dashboard page
export function handleCrmPage(session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;
  return new Response(renderCrmPage(session), {
    headers: { "Content-Type": "text/html" },
  });
}

// ==================== Companies ====================

export function handleListCompanies(session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;
  const companies = listCrmCompanies();
  return jsonResponse(companies);
}

export function handleGetCompany(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;
  const company = getCrmCompany(id);
  if (!company) {
    return jsonResponse({ error: "Company not found" }, 404);
  }
  // Include contacts for this company
  const contacts = listCrmContactsByCompany(id);
  return jsonResponse({ ...company, contacts });
}

export async function handleCreateCompany(req: Request, session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;

  const body = await req.json();
  const { name, website, industry, notes } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  const company = createCrmCompany(
    name.trim(),
    website?.trim() || null,
    industry?.trim() || null,
    notes?.trim() || null,
    session!.npub
  );

  if (!company) {
    return jsonResponse({ error: "Failed to create company" }, 500);
  }

  return jsonResponse(company, 201);
}

export async function handleUpdateCompany(req: Request, session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getCrmCompany(id);
  if (!existing) {
    return jsonResponse({ error: "Company not found" }, 404);
  }

  const body = await req.json();
  const { name, website, industry, notes } = body;

  const company = updateCrmCompany(
    id,
    name?.trim() || existing.name,
    website !== undefined ? (website?.trim() || null) : existing.website,
    industry !== undefined ? (industry?.trim() || null) : existing.industry,
    notes !== undefined ? (notes?.trim() || null) : existing.notes
  );

  return jsonResponse(company);
}

export function handleDeleteCompany(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getCrmCompany(id);
  if (!existing) {
    return jsonResponse({ error: "Company not found" }, 404);
  }

  deleteCrmCompany(id);
  return jsonResponse({ success: true });
}

// ==================== Contacts ====================

export function handleListContacts(session: Session | null, companyId?: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const contacts = companyId ? listCrmContactsByCompany(companyId) : listCrmContacts();
  return jsonResponse(contacts);
}

export function handleGetContact(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const contact = getCrmContact(id);
  if (!contact) {
    return jsonResponse({ error: "Contact not found" }, 404);
  }

  // Include activities for this contact
  const activities = listCrmActivitiesByContact(id);
  return jsonResponse({ ...contact, activities });
}

export async function handleCreateContact(req: Request, session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;

  const body = await req.json();
  const { company_id, name, email, phone, npub, twitter, linkedin, notes } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  // Validate company exists if provided
  if (company_id) {
    const company = getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  const contact = createCrmContact(
    company_id || null,
    name.trim(),
    email?.trim() || null,
    phone?.trim() || null,
    npub?.trim() || null,
    twitter?.trim() || null,
    linkedin?.trim() || null,
    notes?.trim() || null,
    session!.npub
  );

  if (!contact) {
    return jsonResponse({ error: "Failed to create contact" }, 500);
  }

  return jsonResponse(contact, 201);
}

export async function handleUpdateContact(req: Request, session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getCrmContact(id);
  if (!existing) {
    return jsonResponse({ error: "Contact not found" }, 404);
  }

  const body = await req.json();
  const { company_id, name, email, phone, npub, twitter, linkedin, notes } = body;

  // Validate company exists if provided
  if (company_id) {
    const company = getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  const contact = updateCrmContact(
    id,
    company_id !== undefined ? (company_id || null) : existing.company_id,
    name?.trim() || existing.name,
    email !== undefined ? (email?.trim() || null) : existing.email,
    phone !== undefined ? (phone?.trim() || null) : existing.phone,
    npub !== undefined ? (npub?.trim() || null) : existing.npub,
    twitter !== undefined ? (twitter?.trim() || null) : existing.twitter,
    linkedin !== undefined ? (linkedin?.trim() || null) : existing.linkedin,
    notes !== undefined ? (notes?.trim() || null) : existing.notes
  );

  return jsonResponse(contact);
}

export function handleDeleteContact(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getCrmContact(id);
  if (!existing) {
    return jsonResponse({ error: "Contact not found" }, 404);
  }

  deleteCrmContact(id);
  return jsonResponse({ success: true });
}

// ==================== Opportunities ====================

const VALID_STAGES: CrmOpportunityStage[] = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

export function handleListOpportunities(session: Session | null, stage?: string) {
  const error = requireAdmin(session);
  if (error) return error;

  if (stage && VALID_STAGES.includes(stage as CrmOpportunityStage)) {
    return jsonResponse(listCrmOpportunitiesByStage(stage as CrmOpportunityStage));
  }

  const opportunities = listCrmOpportunities();
  return jsonResponse(opportunities);
}

export function handleGetOpportunity(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const opportunity = getCrmOpportunity(id);
  if (!opportunity) {
    return jsonResponse({ error: "Opportunity not found" }, 404);
  }

  // Include activities for this opportunity
  const activities = listCrmActivitiesByOpportunity(id);
  return jsonResponse({ ...opportunity, activities });
}

export async function handleCreateOpportunity(req: Request, session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;

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

  // Validate company exists if provided
  if (company_id) {
    const company = getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  // Validate contact exists if provided
  if (contact_id) {
    const contact = getCrmContact(contact_id);
    if (!contact) {
      return jsonResponse({ error: "Contact not found" }, 400);
    }
  }

  const opportunity = createCrmOpportunity(
    company_id || null,
    contact_id || null,
    title.trim(),
    value ? Number(value) : null,
    currency?.trim() || "USD",
    opportunityStage as CrmOpportunityStage,
    probability ? Math.min(100, Math.max(0, Number(probability))) : 0,
    expected_close?.trim() || null,
    notes?.trim() || null,
    session!.npub
  );

  if (!opportunity) {
    return jsonResponse({ error: "Failed to create opportunity" }, 500);
  }

  return jsonResponse(opportunity, 201);
}

export async function handleUpdateOpportunity(req: Request, session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getCrmOpportunity(id);
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
    const company = getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  // Validate contact exists if provided
  if (contact_id) {
    const contact = getCrmContact(contact_id);
    if (!contact) {
      return jsonResponse({ error: "Contact not found" }, 400);
    }
  }

  const opportunity = updateCrmOpportunity(
    id,
    company_id !== undefined ? (company_id || null) : existing.company_id,
    contact_id !== undefined ? (contact_id || null) : existing.contact_id,
    title?.trim() || existing.title,
    value !== undefined ? (value ? Number(value) : null) : existing.value,
    currency?.trim() || existing.currency,
    (stage as CrmOpportunityStage) || existing.stage,
    probability !== undefined
      ? Math.min(100, Math.max(0, Number(probability)))
      : existing.probability,
    expected_close !== undefined ? (expected_close?.trim() || null) : existing.expected_close,
    notes !== undefined ? (notes?.trim() || null) : existing.notes
  );

  return jsonResponse(opportunity);
}

export function handleDeleteOpportunity(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getCrmOpportunity(id);
  if (!existing) {
    return jsonResponse({ error: "Opportunity not found" }, 404);
  }

  deleteCrmOpportunity(id);
  return jsonResponse({ success: true });
}

// ==================== Activities ====================

const VALID_ACTIVITY_TYPES: CrmActivityType[] = ["call", "email", "meeting", "note", "task"];

export function handleListActivities(
  session: Session | null,
  filters?: { contact_id?: number; opportunity_id?: number; company_id?: number }
) {
  const error = requireAdmin(session);
  if (error) return error;

  if (filters?.contact_id) {
    return jsonResponse(listCrmActivitiesByContact(filters.contact_id));
  }
  if (filters?.opportunity_id) {
    return jsonResponse(listCrmActivitiesByOpportunity(filters.opportunity_id));
  }
  if (filters?.company_id) {
    return jsonResponse(listCrmActivitiesByCompany(filters.company_id));
  }

  const activities = listCrmActivities();
  return jsonResponse(activities);
}

export function handleGetActivity(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const activity = getCrmActivity(id);
  if (!activity) {
    return jsonResponse({ error: "Activity not found" }, 404);
  }

  return jsonResponse(activity);
}

export async function handleCreateActivity(req: Request, session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;

  const body = await req.json();
  const { contact_id, opportunity_id, company_id, type, subject, description, activity_date } =
    body;

  if (!subject || typeof subject !== "string" || !subject.trim()) {
    return jsonResponse({ error: "Subject is required" }, 400);
  }

  if (!type || !VALID_ACTIVITY_TYPES.includes(type)) {
    return jsonResponse({ error: "Valid type is required (call, email, meeting, note, task)" }, 400);
  }

  if (!activity_date) {
    return jsonResponse({ error: "Activity date is required" }, 400);
  }

  // Validate related entities exist if provided
  if (contact_id) {
    const contact = getCrmContact(contact_id);
    if (!contact) {
      return jsonResponse({ error: "Contact not found" }, 400);
    }
  }

  if (opportunity_id) {
    const opportunity = getCrmOpportunity(opportunity_id);
    if (!opportunity) {
      return jsonResponse({ error: "Opportunity not found" }, 400);
    }
  }

  if (company_id) {
    const company = getCrmCompany(company_id);
    if (!company) {
      return jsonResponse({ error: "Company not found" }, 400);
    }
  }

  const activity = createCrmActivity(
    contact_id || null,
    opportunity_id || null,
    company_id || null,
    type as CrmActivityType,
    subject.trim(),
    description?.trim() || null,
    activity_date,
    session!.npub
  );

  if (!activity) {
    return jsonResponse({ error: "Failed to create activity" }, 500);
  }

  return jsonResponse(activity, 201);
}

export function handleDeleteActivity(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getCrmActivity(id);
  if (!existing) {
    return jsonResponse({ error: "Activity not found" }, 404);
  }

  deleteCrmActivity(id);
  return jsonResponse({ success: true });
}

// ==================== Pipeline Summary ====================

export function handlePipelineSummary(session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;

  const summary = getCrmPipelineSummary();
  return jsonResponse(summary);
}
