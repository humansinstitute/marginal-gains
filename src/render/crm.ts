import {
  getCrmPipelineSummary,
  getOutstandingCrmTasks,
  listCrmActivities,
  listCrmCompanies,
  listCrmContacts,
  listCrmOpportunities,
} from "../db";
import { getAppName, getFaviconUrl } from "../routes/app-settings";
import { escapeHtml } from "../utils/html";

import { renderAppMenu, renderPinModal } from "./components";

import type { Session } from "../types";

export function renderCrmPage(session: Session | null) {
  const companies = listCrmCompanies();
  const contacts = listCrmContacts();
  const opportunities = listCrmOpportunities();
  const activities = listCrmActivities().slice(0, 20);
  const pipelineSummary = getCrmPipelineSummary();
  const outstandingTasks = getOutstandingCrmTasks();

  return `<!doctype html>
<html lang="en">
${renderHead()}
<body class="chat-page">
  <main class="chat-app-shell">
    ${renderCrmHeader(session)}
    ${session ? renderCrmContent(companies, contacts, opportunities, activities, pipelineSummary, outstandingTasks) : renderAuthRequired()}
  </main>
  ${renderSessionSeed(session)}
  <script type="module" src="/crm.js?v=6"></script>
</body>
</html>`;
}

function renderHead() {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>CRM - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="stylesheet" href="/app.css?v=4" />
  <link rel="stylesheet" href="/crm.css?v=6" />
</head>`;
}

function renderCrmHeader(session: Session | null) {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<header class="chat-page-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <img src="${faviconUrl}" alt="" class="app-logo" />
      <h1 class="app-title">${appName}</h1>
    </div>
    <div class="header-right">
      ${session ? renderAvatarMenu(session) : ""}
    </div>
    ${renderAppMenu(session, "crm")}
  </header>`;
}

function renderAvatarMenu(session: Session) {
  return `<div class="session-controls" data-session-controls>
    <button class="avatar-chip" type="button" data-avatar title="Account menu">
      <span class="avatar-fallback" data-avatar-fallback>${formatAvatarFallback(session.npub)}</span>
      <img data-avatar-img alt="Profile photo" loading="lazy" hidden />
    </button>
    <div class="avatar-menu" data-avatar-menu hidden>
      <a href="/wallet" class="avatar-menu-link">Wallet</a>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}

function renderCrmContent(
  companies: ReturnType<typeof listCrmCompanies>,
  contacts: ReturnType<typeof listCrmContacts>,
  opportunities: ReturnType<typeof listCrmOpportunities>,
  activities: ReturnType<typeof listCrmActivities>,
  pipelineSummary: ReturnType<typeof getCrmPipelineSummary>,
  outstandingTasks: ReturnType<typeof getOutstandingCrmTasks>
) {
  return `<section class="chat-shell chat-shell-page" data-crm-shell>
    <div class="chat-layout crm-layout">
      <aside class="chat-channels-sidebar">
        <div class="chat-section-header">
          <h3>CRM</h3>
        </div>
        <nav class="crm-nav">
          <button type="button" class="crm-nav-item active" data-crm-view="dashboard">
            <span class="crm-nav-icon">📊</span> Dashboard
          </button>
          <button type="button" class="crm-nav-item" data-crm-view="pipeline">
            <span class="crm-nav-icon">📈</span> Pipeline
          </button>
          <button type="button" class="crm-nav-item" data-crm-view="contacts">
            <span class="crm-nav-icon">👤</span> Contacts
          </button>
          <button type="button" class="crm-nav-item" data-crm-view="companies">
            <span class="crm-nav-icon">🏢</span> Companies
          </button>
          <button type="button" class="crm-nav-item" data-crm-view="activities">
            <span class="crm-nav-icon">📅</span> Activities
          </button>
        </nav>
      </aside>
      <section class="chat-messages-area crm-main">
        <div class="crm-view" data-view="dashboard">
          ${renderDashboard(companies, opportunities, contacts, activities, pipelineSummary, outstandingTasks)}
        </div>
        <div class="crm-view" data-view="pipeline" hidden>
          ${renderPipelineView(opportunities)}
        </div>
        <div class="crm-view" data-view="contacts" hidden>
          ${renderContactsView(contacts)}
        </div>
        <div class="crm-view" data-view="companies" hidden>
          ${renderCompaniesView(companies)}
        </div>
        <div class="crm-view" data-view="activities" hidden>
          ${renderActivitiesView(activities)}
        </div>
      </section>
    </div>
    ${renderAddButton()}
    ${renderCompanyModal()}
    ${renderContactModal()}
    ${renderOpportunityModal()}
    ${renderActivityModal()}
    ${renderTaskLinkModal()}
    ${renderPinModal()}
  </section>`;
}

function renderDashboard(
  companies: ReturnType<typeof listCrmCompanies>,
  opportunities: ReturnType<typeof listCrmOpportunities>,
  contacts: ReturnType<typeof listCrmContacts>,
  activities: ReturnType<typeof listCrmActivities>,
  pipelineSummary: ReturnType<typeof getCrmPipelineSummary>,
  outstandingTasks: ReturnType<typeof getOutstandingCrmTasks>
) {
  const leads = opportunities.filter((o) => o.stage === "lead").slice(0, 5);
  const recentCompanies = companies.slice(0, 5);
  const recentContacts = contacts.slice(0, 5);
  const recentActivities = activities.slice(0, 5);
  const tasks = outstandingTasks.slice(0, 10);

  const summaryMap = new Map(pipelineSummary.map((s) => [s.stage, s]));
  const totalValue = pipelineSummary
    .filter((s) => s.stage !== "closed_lost")
    .reduce((sum, s) => sum + s.total_value, 0);
  const wonValue = summaryMap.get("closed_won")?.total_value || 0;

  return `<div class="crm-dashboard">
    <header class="crm-view-header">
      <h2>Dashboard</h2>
    </header>

    <div class="crm-stats">
      <div class="crm-stat-card">
        <div class="crm-stat-value">${opportunities.length}</div>
        <div class="crm-stat-label">Opportunities</div>
      </div>
      <div class="crm-stat-card">
        <div class="crm-stat-value">${contacts.length}</div>
        <div class="crm-stat-label">Contacts</div>
      </div>
      <div class="crm-stat-card accent">
        <div class="crm-stat-value">${formatCurrency(totalValue)}</div>
        <div class="crm-stat-label">Pipeline Value</div>
      </div>
      <div class="crm-stat-card success">
        <div class="crm-stat-value">${formatCurrency(wonValue)}</div>
        <div class="crm-stat-label">Won</div>
      </div>
    </div>

    <div class="crm-dashboard-grid">
      <div class="crm-card full-width">
        <div class="crm-card-header">
          <h3>Outstanding Tasks</h3>
          <a href="/todo" target="_blank" class="text-btn">View all</a>
        </div>
        <div class="crm-card-body">
          ${tasks.length === 0 ? '<p class="crm-empty">No outstanding tasks</p>' : tasks.map((t) => {
            const boardUrl = t.group_id ? `/todo?group=${t.group_id}` : "/todo";
            const linkedTo = t.contact_name || t.company_name || t.opportunity_title || "";
            return `
            <div class="crm-task-item">
              <a href="${boardUrl}" target="_blank" class="crm-task-link">
                <span class="badge badge-priority-${t.priority}">${t.priority}</span>
                <span class="crm-task-title">${escapeHtml(t.title)}</span>
              </a>
              ${linkedTo ? `<span class="crm-task-linked-to">${escapeHtml(linkedTo)}</span>` : ""}
              <span class="badge badge-state-${t.state}">${t.state.replace("_", " ")}</span>
            </div>
          `;
          }).join("")}
        </div>
      </div>

      <div class="crm-card">
        <div class="crm-card-header">
          <h3>Latest Leads</h3>
          <button type="button" class="text-btn" data-crm-view="pipeline">View all</button>
        </div>
        <div class="crm-card-body">
          ${leads.length === 0 ? '<p class="crm-empty">No leads yet</p>' : leads.map((l) => `
            <div class="crm-list-item" data-opp-id="${l.id}">
              <div class="crm-list-item-main">
                <span class="crm-list-item-title">${escapeHtml(l.title)}</span>
                ${l.company_name ? `<span class="crm-list-item-sub">${escapeHtml(l.company_name)}</span>` : ""}
              </div>
              ${l.value ? `<span class="crm-list-item-value">${formatCurrency(l.value)}</span>` : ""}
            </div>
          `).join("")}
        </div>
      </div>

      <div class="crm-card">
        <div class="crm-card-header">
          <h3>Recent Contacts</h3>
          <button type="button" class="text-btn" data-crm-view="contacts">View all</button>
        </div>
        <div class="crm-card-body">
          ${recentContacts.length === 0 ? '<p class="crm-empty">No contacts yet</p>' : recentContacts.map((c) => `
            <div class="crm-list-item" data-edit-contact="${c.id}">
              <div class="crm-list-item-main">
                <span class="crm-list-item-title">${escapeHtml(c.name)}</span>
                ${c.company_name ? `<span class="crm-list-item-sub">${escapeHtml(c.company_name)}</span>` : ""}
              </div>
              ${c.email ? `<span class="crm-list-item-meta">${escapeHtml(c.email)}</span>` : ""}
            </div>
          `).join("")}
        </div>
      </div>

      <div class="crm-card">
        <div class="crm-card-header">
          <h3>Latest Companies</h3>
          <button type="button" class="text-btn" data-crm-view="companies">View all</button>
        </div>
        <div class="crm-card-body">
          ${recentCompanies.length === 0 ? '<p class="crm-empty">No companies yet</p>' : recentCompanies.map((c) => `
            <div class="crm-list-item" data-edit-company="${c.id}">
              <div class="crm-list-item-main">
                <span class="crm-list-item-title">${escapeHtml(c.name)}</span>
                ${c.industry ? `<span class="crm-list-item-sub">${escapeHtml(c.industry)}</span>` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="crm-card full-width">
        <div class="crm-card-header">
          <h3>Recent Activity</h3>
          <button type="button" class="text-btn" data-crm-view="activities">View all</button>
        </div>
        <div class="crm-card-body">
          ${recentActivities.length === 0 ? '<p class="crm-empty">No activities yet</p>' : recentActivities.map((a) => `
            <div class="crm-activity-item">
              <span class="crm-activity-icon">${getActivityIcon(a.type)}</span>
              <div class="crm-activity-content">
                <span class="crm-activity-subject">${escapeHtml(a.subject)}</span>
                <span class="crm-activity-meta">${formatDate(a.activity_date)}${a.contact_name ? ` · ${escapeHtml(a.contact_name)}` : ""}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  </div>`;
}

function renderPipelineView(opportunities: ReturnType<typeof listCrmOpportunities>) {
  const stages = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"];
  const stageLabels: Record<string, string> = {
    lead: "Leads",
    qualified: "Qualified",
    proposal: "Proposal",
    negotiation: "Negotiation",
    closed_won: "Won",
    closed_lost: "Lost",
  };

  const opportunitiesByStage = new Map<string, typeof opportunities>();
  for (const stage of stages) {
    opportunitiesByStage.set(stage, []);
  }
  for (const opp of opportunities) {
    const list = opportunitiesByStage.get(opp.stage) || [];
    list.push(opp);
    opportunitiesByStage.set(opp.stage, list);
  }

  return `<div class="crm-pipeline">
    <header class="crm-view-header">
      <h2>Pipeline</h2>
    </header>
    <div class="crm-pipeline-board">
      ${stages.map((stage) => {
        const opps = opportunitiesByStage.get(stage) || [];
        return `<div class="crm-pipeline-column" data-stage="${stage}">
          <div class="crm-pipeline-column-header">
            <span class="crm-stage-name">${stageLabels[stage]}</span>
            <span class="crm-stage-count">${opps.length}</span>
          </div>
          <div class="crm-pipeline-cards">
            ${opps.length === 0 ? '<div class="crm-empty-column">No opportunities</div>' : opps.map((opp) => `
              <div class="crm-opp-card" data-opp-id="${opp.id}">
                <div class="crm-opp-title">${escapeHtml(opp.title)}</div>
                ${opp.company_name ? `<div class="crm-opp-company">${escapeHtml(opp.company_name)}</div>` : ""}
                ${opp.value ? `<div class="crm-opp-value">${formatCurrency(opp.value)}</div>` : ""}
              </div>
            `).join("")}
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function renderContactsView(contacts: ReturnType<typeof listCrmContacts>) {
  return `<div class="crm-list-view">
    <header class="crm-view-header">
      <h2>Contacts</h2>
    </header>
    <div class="crm-table-wrapper">
      ${contacts.length === 0 ? '<p class="crm-empty">No contacts yet. Click + to add your first contact.</p>' : `
        <table class="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Company</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${contacts.map((c) => `
              <tr>
                <td class="crm-cell-primary">${escapeHtml(c.name)}</td>
                <td>${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : "–"}</td>
                <td>${c.phone ? escapeHtml(c.phone) : "–"}</td>
                <td>${c.company_name ? escapeHtml(c.company_name) : "–"}</td>
                <td class="crm-cell-actions">
                  <button class="crm-icon-btn" data-link-task="contact" data-entity-id="${c.id}" title="Link Task">📌</button>
                  <button class="crm-icon-btn" data-edit-contact="${c.id}" title="Edit">✏️</button>
                  <button class="crm-icon-btn danger" data-delete-contact="${c.id}" title="Delete">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}
    </div>
  </div>`;
}

function renderCompaniesView(companies: ReturnType<typeof listCrmCompanies>) {
  return `<div class="crm-list-view">
    <header class="crm-view-header">
      <h2>Companies</h2>
    </header>
    <div class="crm-table-wrapper">
      ${companies.length === 0 ? '<p class="crm-empty">No companies yet. Click + to add your first company.</p>' : `
        <table class="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tags</th>
              <th>Website</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${companies.map((c) => `
              <tr>
                <td class="crm-cell-primary">${escapeHtml(c.name)}</td>
                <td>${c.industry ? renderIndustryTags(c.industry) : "–"}</td>
                <td>${c.website ? `<a href="${escapeHtml(c.website)}" target="_blank">${escapeHtml(c.website)}</a>` : "–"}</td>
                <td class="crm-cell-actions">
                  <button class="crm-icon-btn" data-link-task="company" data-entity-id="${c.id}" title="Link Task">📌</button>
                  <button class="crm-icon-btn" data-edit-company="${c.id}" title="Edit">✏️</button>
                  <button class="crm-icon-btn danger" data-delete-company="${c.id}" title="Delete">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}
    </div>
  </div>`;
}

function renderActivitiesView(activities: ReturnType<typeof listCrmActivities>) {
  return `<div class="crm-list-view">
    <header class="crm-view-header">
      <h2>Activities</h2>
    </header>
    <div class="crm-activities-list">
      ${activities.length === 0 ? '<p class="crm-empty">No activities yet. Click + to log your first activity.</p>' : activities.map((a) => `
        <div class="crm-activity-row">
          <span class="crm-activity-icon large">${getActivityIcon(a.type)}</span>
          <div class="crm-activity-details">
            <span class="crm-activity-subject">${escapeHtml(a.subject)}</span>
            <span class="crm-activity-meta">
              ${formatDate(a.activity_date)}
              ${a.contact_name ? ` · ${escapeHtml(a.contact_name)}` : ""}
              ${a.company_name ? ` · ${escapeHtml(a.company_name)}` : ""}
            </span>
            ${a.description ? `<p class="crm-activity-desc">${escapeHtml(a.description)}</p>` : ""}
          </div>
          <button class="crm-icon-btn" data-link-task="activity" data-entity-id="${a.id}" title="Link Task">📌</button>
          <button class="crm-icon-btn danger" data-delete-activity="${a.id}" title="Delete">🗑️</button>
        </div>
      `).join("")}
    </div>
  </div>`;
}

function renderAddButton() {
  return `<div class="crm-fab" data-fab>
    <button type="button" class="crm-fab-trigger" data-fab-trigger title="Add new">
      <span class="crm-fab-icon">+</span>
    </button>
    <div class="crm-fab-menu" data-fab-menu hidden>
      <button type="button" class="crm-fab-option" data-add-activity>
        <span>📅</span> Log Activity
      </button>
      <button type="button" class="crm-fab-option" data-add-opportunity>
        <span>📈</span> Add Lead
      </button>
      <button type="button" class="crm-fab-option" data-add-contact>
        <span>👤</span> Add Contact
      </button>
      <button type="button" class="crm-fab-option" data-add-company>
        <span>🏢</span> Add Company
      </button>
    </div>
  </div>`;
}

function renderCompanyModal() {
  return `<div class="chat-modal" data-company-modal hidden>
    <div class="chat-modal-body">
      <header class="chat-modal-header">
        <h3 data-modal-title>Add Company</h3>
        <button type="button" class="ghost" data-modal-close>&times;</button>
      </header>
      <form class="chat-form" data-company-form>
        <input type="hidden" name="id" data-company-id />
        <label>
          <span>Name *</span>
          <input name="name" required />
        </label>
        <label>
          <span>Website</span>
          <input type="url" name="website" placeholder="https://..." />
        </label>
        <label>
          <span>Industry Tags</span>
          <div class="tag-input-wrapper" data-industry-tags>
            <input type="hidden" name="industry" data-industry-hidden />
            <input type="text" placeholder="Add tag..." data-industry-input />
          </div>
          <div class="crm-tag-suggestions" data-tag-suggestions hidden></div>
        </label>
        <label>
          <span>Notes</span>
          <textarea name="notes" rows="3"></textarea>
        </label>
        <div class="crm-linked-tasks-section" data-linked-tasks-section hidden>
          <div class="crm-linked-tasks-header">
            <span>Linked Tasks</span>
            <button type="button" class="crm-link-task-btn" data-link-task="companies" data-entity-id="">+ Link Task</button>
          </div>
          <div class="crm-linked-tasks-list" data-linked-tasks-list></div>
        </div>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-modal-cancel>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderContactModal() {
  return `<div class="chat-modal" data-contact-modal hidden>
    <div class="chat-modal-body">
      <header class="chat-modal-header">
        <h3 data-modal-title>Add Contact</h3>
        <button type="button" class="ghost" data-modal-close>&times;</button>
      </header>
      <form class="chat-form" data-contact-form>
        <input type="hidden" name="id" data-contact-id />
        <label>
          <span>Name *</span>
          <input name="name" required />
        </label>
        <label>
          <span>Email</span>
          <input type="email" name="email" />
        </label>
        <label>
          <span>Phone</span>
          <input type="tel" name="phone" />
        </label>
        <label>
          <span>Company</span>
          <select name="company_id" data-company-select>
            <option value="">– No company –</option>
          </select>
        </label>
        <label>
          <span>Nostr npub</span>
          <input name="npub" placeholder="npub1..." />
        </label>
        <label>
          <span>Twitter</span>
          <input name="twitter" placeholder="@handle" />
        </label>
        <label>
          <span>LinkedIn</span>
          <input type="url" name="linkedin" placeholder="https://linkedin.com/in/..." />
        </label>
        <label>
          <span>Notes</span>
          <textarea name="notes" rows="3"></textarea>
        </label>
        <div class="crm-linked-tasks-section" data-linked-tasks-section hidden>
          <div class="crm-linked-tasks-header">
            <span>Linked Tasks</span>
            <button type="button" class="crm-link-task-btn" data-link-task="contacts" data-entity-id="">+ Link Task</button>
          </div>
          <div class="crm-linked-tasks-list" data-linked-tasks-list></div>
        </div>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-modal-cancel>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderOpportunityModal() {
  return `<div class="chat-modal" data-opportunity-modal hidden>
    <div class="chat-modal-body">
      <header class="chat-modal-header">
        <h3 data-modal-title>Add Lead</h3>
        <button type="button" class="ghost" data-modal-close>&times;</button>
      </header>
      <form class="chat-form" data-opportunity-form>
        <input type="hidden" name="id" data-opportunity-id />
        <label>
          <span>Title *</span>
          <input name="title" required />
        </label>
        <div class="crm-form-row">
          <label>
            <span>Value</span>
            <input type="number" name="value" step="0.01" min="0" />
          </label>
          <label>
            <span>Currency</span>
            <select name="currency">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="AUD">AUD</option>
              <option value="SATS">Sats</option>
            </select>
          </label>
        </div>
        <label>
          <span>Stage</span>
          <select name="stage">
            <option value="lead">Lead</option>
            <option value="qualified">Qualified</option>
            <option value="proposal">Proposal</option>
            <option value="negotiation">Negotiation</option>
            <option value="closed_won">Closed Won</option>
            <option value="closed_lost">Closed Lost</option>
          </select>
        </label>
        <label>
          <span>Probability (%)</span>
          <input type="number" name="probability" min="0" max="100" value="0" />
        </label>
        <label>
          <span>Expected Close</span>
          <input type="date" name="expected_close" />
        </label>
        <label>
          <span>Company</span>
          <select name="company_id" data-company-select>
            <option value="">– No company –</option>
          </select>
        </label>
        <label>
          <span>Contact</span>
          <select name="contact_id" data-contact-select>
            <option value="">– No contact –</option>
          </select>
        </label>
        <label>
          <span>Notes</span>
          <textarea name="notes" rows="3"></textarea>
        </label>
        <div class="crm-linked-tasks-section" data-linked-tasks-section hidden>
          <div class="crm-linked-tasks-header">
            <span>Linked Tasks</span>
            <button type="button" class="crm-link-task-btn" data-link-task="opportunities" data-entity-id="">+ Link Task</button>
          </div>
          <div class="crm-linked-tasks-list" data-linked-tasks-list></div>
        </div>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-modal-cancel>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderActivityModal() {
  return `<div class="chat-modal" data-activity-modal hidden>
    <div class="chat-modal-body">
      <header class="chat-modal-header">
        <h3>Log Activity</h3>
        <button type="button" class="ghost" data-modal-close>&times;</button>
      </header>
      <form class="chat-form" data-activity-form>
        <label>
          <span>Type *</span>
          <select name="type" required>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="note" selected>Note</option>
            <option value="task">Task</option>
          </select>
        </label>
        <label>
          <span>Subject *</span>
          <input name="subject" required />
        </label>
        <label>
          <span>Date *</span>
          <input type="date" name="activity_date" required />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="3"></textarea>
        </label>
        <label>
          <span>Company</span>
          <select name="company_id" data-company-select>
            <option value="">– No company –</option>
          </select>
        </label>
        <label>
          <span>Contact</span>
          <select name="contact_id" data-contact-select>
            <option value="">– No contact –</option>
          </select>
        </label>
        <label>
          <span>Opportunity</span>
          <select name="opportunity_id" data-opportunity-select>
            <option value="">– No opportunity –</option>
          </select>
        </label>
        <input type="hidden" name="id" data-activity-id />
        <div class="crm-linked-tasks-section" data-linked-tasks-section hidden>
          <div class="crm-linked-tasks-header">
            <span>Linked Tasks</span>
            <button type="button" class="crm-link-task-btn" data-link-task="activities" data-entity-id="">+ Link Task</button>
          </div>
          <div class="crm-linked-tasks-list" data-linked-tasks-list></div>
        </div>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-modal-cancel>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderAuthRequired() {
  return `<section class="chat-auth-section">
    <div class="chat-auth-container">
      <h2>CRM Access Required</h2>
      <p>Please sign in with an admin account to access the CRM.</p>
      <a href="/" class="primary">Go to Home</a>
    </div>
  </section>`;
}

function renderSessionSeed(session: Session | null) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__CRM_PAGE__ = true;
  </script>`;
}

function formatCurrency(value: number): string {
  if (!value) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "–";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function getActivityIcon(type: string): string {
  const icons: Record<string, string> = {
    call: "📞",
    email: "📧",
    meeting: "📅",
    note: "📝",
    task: "☑️",
  };
  return icons[type] || "📄";
}

function renderIndustryTags(industry: string): string {
  const tags = industry
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tags.length === 0) return "–";

  return tags
    .map((tag) => `<span class="crm-tag">${escapeHtml(tag)}</span>`)
    .join(" ");
}

function renderTaskLinkModal() {
  return `<div class="chat-modal" data-task-link-modal hidden>
    <div class="chat-modal-body">
      <header class="chat-modal-header">
        <h3 data-task-modal-title>Link Task</h3>
        <button type="button" class="ghost" data-modal-close>&times;</button>
      </header>
      <div class="crm-task-search">
        <div class="crm-task-search-row">
          <select class="crm-task-board-select" data-task-board-select>
            <option value="all">All Boards</option>
            <option value="">Personal</option>
          </select>
          <input
            type="text"
            class="crm-task-search-input"
            data-task-search-input
            placeholder="Search tasks..."
            autocomplete="off"
          />
        </div>
        <div class="crm-task-search-results" data-task-search-results hidden></div>
      </div>
      <div class="crm-task-create">
        <span class="crm-divider-text">or create new task on</span>
        <div class="crm-task-create-row">
          <select class="crm-task-board-select" data-task-create-board-select>
            <option value="">Personal</option>
          </select>
          <button type="button" class="primary" data-create-linked-task>Create Task</button>
        </div>
      </div>
      <input type="hidden" data-task-link-entity-type />
      <input type="hidden" data-task-link-entity-id />
    </div>
  </div>`;
}
