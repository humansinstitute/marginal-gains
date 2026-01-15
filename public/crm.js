// CRM Client-Side Module
import { crmUrl } from "./api.js";

class CrmApp {
  constructor() {
    this.init();
  }

  init() {
    this.allIndustryTags = new Set();
    this.setupNavigation();
    this.setupFab();
    this.setupModals();
    this.setupCompanyHandlers();
    this.setupContactHandlers();
    this.setupOpportunityHandlers();
    this.setupActivityHandlers();
    this.setupTaskHandlers();
    this.setupAvatarMenu();
    this.setupHamburgerMenu();
    this.setupIndustryTagInput();
    this.collectExistingTags();
    this.restoreViewFromHash();
  }

  // Collect existing industry tags from the page for suggestions
  collectExistingTags() {
    document.querySelectorAll(".crm-tag").forEach((tag) => {
      this.allIndustryTags.add(tag.textContent.trim().toLowerCase());
    });
  }

  // Industry tag input with autocomplete
  setupIndustryTagInput() {
    const wrapper = document.querySelector("[data-industry-tags]");
    const input = document.querySelector("[data-industry-input]");
    const hidden = document.querySelector("[data-industry-hidden]");
    const suggestions = document.querySelector("[data-tag-suggestions]");

    if (!wrapper || !input || !hidden) return;

    const syncTags = () => {
      const chips = wrapper.querySelectorAll(".tag-chip");
      const tags = Array.from(chips).map((c) => c.dataset.tag).filter(Boolean);
      hidden.value = tags.join(", ");
    };

    const addTag = (text) => {
      const tag = text.trim().toLowerCase().replace(/,/g, "");
      if (!tag) return;

      // Check for duplicates
      const existing = wrapper.querySelectorAll(".tag-chip");
      for (const chip of existing) {
        if (chip.dataset.tag === tag) return;
      }

      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.dataset.tag = tag;
      chip.innerHTML = `${tag}<span class="remove-tag">&times;</span>`;
      chip.querySelector(".remove-tag").addEventListener("click", () => {
        chip.remove();
        syncTags();
      });
      wrapper.insertBefore(chip, input);
      syncTags();

      // Add to suggestions set
      this.allIndustryTags.add(tag);
    };

    const removeLastTag = () => {
      const chips = wrapper.querySelectorAll(".tag-chip");
      if (chips.length > 0) {
        chips[chips.length - 1].remove();
        syncTags();
      }
    };

    const showSuggestions = (query) => {
      if (!query || query.length < 1) {
        suggestions.hidden = true;
        return;
      }

      const matches = Array.from(this.allIndustryTags)
        .filter((t) => t.includes(query.toLowerCase()))
        .slice(0, 5);

      if (matches.length === 0) {
        suggestions.hidden = true;
        return;
      }

      suggestions.innerHTML = matches
        .map((t) => `<button type="button" class="crm-tag-suggestion" data-suggest="${t}">${t}</button>`)
        .join("");
      suggestions.hidden = false;
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "," || e.key === "Enter") {
        e.preventDefault();
        addTag(input.value);
        input.value = "";
        suggestions.hidden = true;
      } else if (e.key === "Backspace" && input.value === "") {
        removeLastTag();
      } else if (e.key === "Escape") {
        suggestions.hidden = true;
      }
    });

    input.addEventListener("input", () => {
      showSuggestions(input.value);
    });

    input.addEventListener("blur", () => {
      // Delay to allow click on suggestion
      setTimeout(() => {
        if (input.value.trim()) {
          addTag(input.value);
          input.value = "";
        }
        suggestions.hidden = true;
      }, 150);
    });

    suggestions.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-suggest]");
      if (btn) {
        addTag(btn.dataset.suggest);
        input.value = "";
        suggestions.hidden = true;
        input.focus();
      }
    });

    wrapper.addEventListener("click", () => input.focus());

    // Store reference for later use
    this.industryTagInput = { wrapper, input, hidden, addTag, syncTags };
  }

  // Clear and set industry tags (for edit modal)
  setIndustryTags(tagsString) {
    if (!this.industryTagInput) return;

    const { wrapper, input, addTag } = this.industryTagInput;

    // Clear existing chips
    wrapper.querySelectorAll(".tag-chip").forEach((chip) => chip.remove());

    // Add tags from string
    if (tagsString) {
      tagsString.split(",").forEach((t) => addTag(t.trim()));
    }
  }

  // Sidebar navigation
  setupNavigation() {
    document.querySelectorAll("[data-crm-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const viewId = btn.dataset.crmView;
        this.switchView(viewId);
      });
    });

    // Handle browser back/forward
    window.addEventListener("hashchange", () => {
      this.restoreViewFromHash();
    });
  }

  // Restore view from URL hash on page load
  restoreViewFromHash() {
    const hash = window.location.hash.slice(1); // Remove #
    if (hash) {
      // Verify the view exists
      const viewPanel = document.querySelector(`.crm-view[data-view="${hash}"]`);
      if (viewPanel) {
        this.switchView(hash, false); // Don't update hash again
      }
    }
  }

  switchView(viewId, updateHash = true) {
    // Update nav items
    document.querySelectorAll(".crm-nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.crmView === viewId);
    });

    // Update view panels
    document.querySelectorAll(".crm-view").forEach((view) => {
      view.hidden = view.dataset.view !== viewId;
    });

    // Update URL hash to persist view across reloads
    if (updateHash && viewId) {
      window.location.hash = viewId;
    }
  }

  // Floating Action Button - context-aware
  setupFab() {
    const fabTrigger = document.querySelector("[data-fab-trigger]");
    const fabMenu = document.querySelector("[data-fab-menu]");

    if (fabTrigger && fabMenu) {
      fabTrigger.addEventListener("click", async () => {
        const activeView = this.getActiveView();

        // On dashboard, show menu. On other pages, direct action.
        if (activeView === "dashboard") {
          const isOpen = !fabMenu.hidden;
          fabMenu.hidden = isOpen;
          fabTrigger.classList.toggle("active", !isOpen);
        } else {
          // Direct action based on current view
          this.closeFab();
          switch (activeView) {
            case "contacts":
              await this.loadCompanyOptions("[data-contact-modal]");
              this.openContactModal();
              break;
            case "companies":
              this.openCompanyModal();
              break;
            case "pipeline":
              await this.loadCompanyOptions("[data-opportunity-modal]");
              await this.loadContactOptions("[data-opportunity-modal]");
              this.openOpportunityModal();
              break;
            case "activities":
              await this.loadCompanyOptions("[data-activity-modal]");
              await this.loadContactOptions("[data-activity-modal]");
              await this.loadOpportunityOptions("[data-activity-modal]");
              this.openActivityModal();
              break;
          }
        }
      });

      // Close menu when clicking outside
      document.addEventListener("click", (e) => {
        if (!e.target.closest("[data-fab]")) {
          fabMenu.hidden = true;
          fabTrigger.classList.remove("active");
        }
      });
    }
  }

  getActiveView() {
    const activeNav = document.querySelector(".crm-nav-item.active");
    return activeNav?.dataset.crmView || "dashboard";
  }

  // Modal management
  setupModals() {
    // Close modals on close button or cancel
    document.querySelectorAll("[data-modal-close], [data-modal-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modal = btn.closest(".chat-modal");
        if (modal) modal.hidden = true;
      });
    });

    // Close on backdrop click (chat-modal pattern)
    document.querySelectorAll(".chat-modal").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          modal.hidden = true;
        }
      });
    });
  }

  // Company handlers
  setupCompanyHandlers() {
    // Add company button (from FAB)
    document.querySelector("[data-add-company]")?.addEventListener("click", () => {
      this.closeFab();
      this.openCompanyModal();
    });

    // Edit company buttons (delegated)
    document.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-edit-company]");
      if (editBtn) {
        this.editCompany(Number(editBtn.dataset.editCompany));
      }

      const deleteBtn = e.target.closest("[data-delete-company]");
      if (deleteBtn) {
        this.deleteCompany(Number(deleteBtn.dataset.deleteCompany));
      }
    });

    // Company form submission
    document.querySelector("[data-company-form]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.saveCompany(e.target);
    });
  }

  closeFab() {
    const fabMenu = document.querySelector("[data-fab-menu]");
    const fabTrigger = document.querySelector("[data-fab-trigger]");
    if (fabMenu) fabMenu.hidden = true;
    if (fabTrigger) fabTrigger.classList.remove("active");
  }

  openCompanyModal(company = null) {
    const modal = document.querySelector("[data-company-modal]");
    const form = modal.querySelector("form");
    const title = modal.querySelector("[data-modal-title]");
    const linkedTasksSection = modal.querySelector("[data-linked-tasks-section]");

    form.reset();
    form.querySelector("[data-company-id]").value = company?.id || "";

    // Clear and set industry tags
    this.setIndustryTags(company?.industry || "");

    if (company) {
      form.querySelector("[name=name]").value = company.name || "";
      form.querySelector("[name=website]").value = company.website || "";
      form.querySelector("[name=notes]").value = company.notes || "";
      title.textContent = "Edit Company";
    } else {
      title.textContent = "Add Company";
      // Hide linked tasks for new companies
      if (linkedTasksSection) linkedTasksSection.hidden = true;
    }

    modal.hidden = false;
  }

  async editCompany(id) {
    try {
      const res = await fetch(crmUrl(`/companies/${id}`));
      if (!res.ok) throw new Error("Failed to fetch company");
      const company = await res.json();
      this.openCompanyModal(company);
      await this.loadLinkedTasksForModal("[data-company-modal]", "companies", id);
    } catch (err) {
      console.error(err);
      alert("Failed to load company");
    }
  }

  async saveCompany(form) {
    const formData = new FormData(form);
    const id = formData.get("id");
    const data = {
      name: formData.get("name"),
      website: formData.get("website") || null,
      industry: formData.get("industry") || null,
      notes: formData.get("notes") || null,
    };

    try {
      const method = id ? "PATCH" : "POST";
      const url = id ? crmUrl(`/companies/${id}`) : crmUrl("/companies");
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save company");
      }

      location.reload();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  async deleteCompany(id) {
    if (!confirm("Are you sure you want to delete this company?")) return;

    try {
      const res = await fetch(crmUrl(`/companies/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete company");
      location.reload();
    } catch (err) {
      console.error(err);
      alert("Failed to delete company");
    }
  }

  // Contact handlers
  setupContactHandlers() {
    document.querySelector("[data-add-contact]")?.addEventListener("click", async () => {
      this.closeFab();
      await this.loadCompanyOptions("[data-contact-modal]");
      this.openContactModal();
    });

    document.addEventListener("click", async (e) => {
      const editBtn = e.target.closest("[data-edit-contact]");
      if (editBtn) {
        await this.editContact(Number(editBtn.dataset.editContact));
      }

      const deleteBtn = e.target.closest("[data-delete-contact]");
      if (deleteBtn) {
        await this.deleteContact(Number(deleteBtn.dataset.deleteContact));
      }
    });

    document.querySelector("[data-contact-form]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.saveContact(e.target);
    });
  }

  openContactModal(contact = null) {
    const modal = document.querySelector("[data-contact-modal]");
    const form = modal.querySelector("form");
    const title = modal.querySelector("[data-modal-title]");
    const linkedTasksSection = modal.querySelector("[data-linked-tasks-section]");

    form.reset();
    form.querySelector("[data-contact-id]").value = contact?.id || "";
    if (contact) {
      form.querySelector("[name=name]").value = contact.name || "";
      form.querySelector("[name=email]").value = contact.email || "";
      form.querySelector("[name=phone]").value = contact.phone || "";
      form.querySelector("[name=company_id]").value = contact.company_id || "";
      form.querySelector("[name=npub]").value = contact.npub || "";
      form.querySelector("[name=twitter]").value = contact.twitter || "";
      form.querySelector("[name=linkedin]").value = contact.linkedin || "";
      form.querySelector("[name=notes]").value = contact.notes || "";
      title.textContent = "Edit Contact";
    } else {
      title.textContent = "Add Contact";
      // Hide linked tasks for new contacts
      if (linkedTasksSection) linkedTasksSection.hidden = true;
    }

    modal.hidden = false;
  }

  async editContact(id) {
    try {
      await this.loadCompanyOptions("[data-contact-modal]");
      const res = await fetch(crmUrl(`/contacts/${id}`));
      if (!res.ok) throw new Error("Failed to fetch contact");
      const contact = await res.json();
      this.openContactModal(contact);
      await this.loadLinkedTasksForModal("[data-contact-modal]", "contacts", id);
    } catch (err) {
      console.error(err);
      alert("Failed to load contact");
    }
  }

  async saveContact(form) {
    const formData = new FormData(form);
    const id = formData.get("id");
    const data = {
      name: formData.get("name"),
      email: formData.get("email") || null,
      phone: formData.get("phone") || null,
      company_id: formData.get("company_id") ? Number(formData.get("company_id")) : null,
      npub: formData.get("npub") || null,
      twitter: formData.get("twitter") || null,
      linkedin: formData.get("linkedin") || null,
      notes: formData.get("notes") || null,
    };

    try {
      const method = id ? "PATCH" : "POST";
      const url = id ? crmUrl(`/contacts/${id}`) : crmUrl("/contacts");
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save contact");
      }

      location.reload();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  async deleteContact(id) {
    if (!confirm("Are you sure you want to delete this contact?")) return;

    try {
      const res = await fetch(crmUrl(`/contacts/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete contact");
      location.reload();
    } catch (err) {
      console.error(err);
      alert("Failed to delete contact");
    }
  }

  // Opportunity handlers
  setupOpportunityHandlers() {
    document.querySelector("[data-add-opportunity]")?.addEventListener("click", async () => {
      this.closeFab();
      await this.loadCompanyOptions("[data-opportunity-modal]");
      await this.loadContactOptions("[data-opportunity-modal]");
      this.openOpportunityModal();
    });

    // Click on opportunity cards
    document.addEventListener("click", async (e) => {
      const oppCard = e.target.closest("[data-opp-id]");
      if (oppCard) {
        await this.editOpportunity(Number(oppCard.dataset.oppId));
      }
    });

    document.querySelector("[data-opportunity-form]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.saveOpportunity(e.target);
    });
  }

  openOpportunityModal(opportunity = null) {
    const modal = document.querySelector("[data-opportunity-modal]");
    const form = modal.querySelector("form");
    const title = modal.querySelector("[data-modal-title]");
    const linkedTasksSection = modal.querySelector("[data-linked-tasks-section]");

    form.reset();
    form.querySelector("[data-opportunity-id]").value = opportunity?.id || "";
    if (opportunity) {
      form.querySelector("[name=title]").value = opportunity.title || "";
      form.querySelector("[name=value]").value = opportunity.value || "";
      form.querySelector("[name=currency]").value = opportunity.currency || "USD";
      form.querySelector("[name=stage]").value = opportunity.stage || "lead";
      form.querySelector("[name=probability]").value = opportunity.probability || 0;
      form.querySelector("[name=expected_close]").value = opportunity.expected_close || "";
      form.querySelector("[name=company_id]").value = opportunity.company_id || "";
      form.querySelector("[name=contact_id]").value = opportunity.contact_id || "";
      form.querySelector("[name=notes]").value = opportunity.notes || "";
      title.textContent = "Edit Opportunity";
    } else {
      title.textContent = "Add Lead";
      // Hide linked tasks for new opportunities
      if (linkedTasksSection) linkedTasksSection.hidden = true;
    }

    modal.hidden = false;
  }

  async editOpportunity(id) {
    try {
      await this.loadCompanyOptions("[data-opportunity-modal]");
      await this.loadContactOptions("[data-opportunity-modal]");
      const res = await fetch(crmUrl(`/opportunities/${id}`));
      if (!res.ok) throw new Error("Failed to fetch opportunity");
      const opportunity = await res.json();
      this.openOpportunityModal(opportunity);
      await this.loadLinkedTasksForModal("[data-opportunity-modal]", "opportunities", id);
    } catch (err) {
      console.error(err);
      alert("Failed to load opportunity");
    }
  }

  async saveOpportunity(form) {
    const formData = new FormData(form);
    const id = formData.get("id");
    const data = {
      title: formData.get("title"),
      value: formData.get("value") ? Number(formData.get("value")) : null,
      currency: formData.get("currency") || "USD",
      stage: formData.get("stage") || "lead",
      probability: formData.get("probability") ? Number(formData.get("probability")) : 0,
      expected_close: formData.get("expected_close") || null,
      company_id: formData.get("company_id") ? Number(formData.get("company_id")) : null,
      contact_id: formData.get("contact_id") ? Number(formData.get("contact_id")) : null,
      notes: formData.get("notes") || null,
    };

    try {
      const method = id ? "PATCH" : "POST";
      const url = id ? crmUrl(`/opportunities/${id}`) : crmUrl("/opportunities");
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save opportunity");
      }

      location.reload();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  // Activity handlers
  setupActivityHandlers() {
    document.querySelector("[data-add-activity]")?.addEventListener("click", async () => {
      this.closeFab();
      await this.loadCompanyOptions("[data-activity-modal]");
      await this.loadContactOptions("[data-activity-modal]");
      await this.loadOpportunityOptions("[data-activity-modal]");
      this.openActivityModal();
    });

    document.addEventListener("click", async (e) => {
      const deleteBtn = e.target.closest("[data-delete-activity]");
      if (deleteBtn) {
        await this.deleteActivity(Number(deleteBtn.dataset.deleteActivity));
      }
    });

    document.querySelector("[data-activity-form]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.saveActivity(e.target);
    });
  }

  openActivityModal() {
    const modal = document.querySelector("[data-activity-modal]");
    const form = modal.querySelector("form");

    form.reset();
    // Set default date to today
    form.querySelector("[name=activity_date]").value = new Date().toISOString().split("T")[0];

    modal.hidden = false;
  }

  async saveActivity(form) {
    const formData = new FormData(form);
    const data = {
      type: formData.get("type"),
      subject: formData.get("subject"),
      activity_date: formData.get("activity_date"),
      description: formData.get("description") || null,
      company_id: formData.get("company_id") ? Number(formData.get("company_id")) : null,
      contact_id: formData.get("contact_id") ? Number(formData.get("contact_id")) : null,
      opportunity_id: formData.get("opportunity_id") ? Number(formData.get("opportunity_id")) : null,
    };

    try {
      const res = await fetch(crmUrl("/activities"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save activity");
      }

      location.reload();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  async deleteActivity(id) {
    if (!confirm("Are you sure you want to delete this activity?")) return;

    try {
      const res = await fetch(crmUrl(`/activities/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete activity");
      location.reload();
    } catch (err) {
      console.error(err);
      alert("Failed to delete activity");
    }
  }

  // Helper: Load company options into select
  async loadCompanyOptions(modalSelector) {
    try {
      const res = await fetch(crmUrl("/companies"));
      if (!res.ok) return;
      const companies = await res.json();

      const select = document.querySelector(`${modalSelector} [data-company-select]`);
      if (!select) return;

      // Keep the first option
      const firstOption = select.querySelector("option");
      select.innerHTML = "";
      select.appendChild(firstOption);

      companies.forEach((c) => {
        const option = document.createElement("option");
        option.value = c.id;
        option.textContent = c.name;
        select.appendChild(option);
      });
    } catch (err) {
      console.error("Failed to load companies", err);
    }
  }

  // Helper: Load contact options into select
  async loadContactOptions(modalSelector) {
    try {
      const res = await fetch(crmUrl("/contacts"));
      if (!res.ok) return;
      const contacts = await res.json();

      const select = document.querySelector(`${modalSelector} [data-contact-select]`);
      if (!select) return;

      const firstOption = select.querySelector("option");
      select.innerHTML = "";
      select.appendChild(firstOption);

      contacts.forEach((c) => {
        const option = document.createElement("option");
        option.value = c.id;
        option.textContent = c.name;
        select.appendChild(option);
      });
    } catch (err) {
      console.error("Failed to load contacts", err);
    }
  }

  // Helper: Load opportunity options into select
  async loadOpportunityOptions(modalSelector) {
    try {
      const res = await fetch(crmUrl("/opportunities"));
      if (!res.ok) return;
      const opportunities = await res.json();

      const select = document.querySelector(`${modalSelector} [data-opportunity-select]`);
      if (!select) return;

      const firstOption = select.querySelector("option");
      select.innerHTML = "";
      select.appendChild(firstOption);

      opportunities.forEach((o) => {
        const option = document.createElement("option");
        option.value = o.id;
        option.textContent = o.title;
        select.appendChild(option);
      });
    } catch (err) {
      console.error("Failed to load opportunities", err);
    }
  }

  // Task linking handlers
  setupTaskHandlers() {
    const modal = document.querySelector("[data-task-link-modal]");
    const searchInput = document.querySelector("[data-task-search-input]");
    const searchResults = document.querySelector("[data-task-search-results]");
    const createBtn = document.querySelector("[data-create-linked-task]");
    const boardSelect = document.querySelector("[data-task-board-select]");

    if (!modal || !searchInput) return;

    // Debounced search
    let searchTimeout = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      const query = searchInput.value.trim();
      if (query.length < 2) {
        searchResults.hidden = true;
        return;
      }
      searchTimeout = setTimeout(() => this.searchTasks(query), 300);
    });

    // Re-search when board selection changes
    boardSelect?.addEventListener("change", () => {
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        this.searchTasks(query);
      }
    });

    // Handle clicking on a search result
    searchResults?.addEventListener("click", async (e) => {
      const item = e.target.closest("[data-task-id]");
      if (!item) return;
      await this.linkExistingTask(Number(item.dataset.taskId));
    });

    // Handle create new task button
    createBtn?.addEventListener("click", () => this.createLinkedTask());

    // Handle clicking on task action buttons (in edit modals)
    document.addEventListener("click", async (e) => {
      const linkBtn = e.target.closest("[data-link-task]");
      if (linkBtn) {
        const entityType = linkBtn.dataset.linkTask;
        const entityId = linkBtn.dataset.entityId;
        if (entityType && entityId) {
          this.openTaskLinkModal(entityType, Number(entityId));
        }
      }

      const unlinkBtn = e.target.closest("[data-unlink-task]");
      if (unlinkBtn) {
        const linkId = unlinkBtn.dataset.unlinkTask;
        const todoId = unlinkBtn.dataset.todoId;
        if (linkId && todoId) {
          await this.unlinkTask(Number(linkId), Number(todoId));
        }
      }

      // Handle unlink from CRM modal linked tasks section
      const unlinkCrmBtn = e.target.closest("[data-unlink-crm-task]");
      if (unlinkCrmBtn) {
        const linkId = unlinkCrmBtn.dataset.linkId;
        const todoId = unlinkCrmBtn.dataset.todoId;
        if (linkId && todoId) {
          await this.unlinkTask(Number(linkId), Number(todoId));
        }
      }
    });
  }

  async openTaskLinkModal(entityType, entityId) {
    const modal = document.querySelector("[data-task-link-modal]");
    const title = modal?.querySelector("[data-task-modal-title]");
    const entityTypeInput = modal?.querySelector("[data-task-link-entity-type]");
    const entityIdInput = modal?.querySelector("[data-task-link-entity-id]");
    const searchInput = modal?.querySelector("[data-task-search-input]");
    const searchResults = modal?.querySelector("[data-task-search-results]");
    const boardSelect = modal?.querySelector("[data-task-board-select]");
    const createBoardSelect = modal?.querySelector("[data-task-create-board-select]");

    if (!modal) return;

    // Store entity info
    if (entityTypeInput) entityTypeInput.value = entityType;
    if (entityIdInput) entityIdInput.value = entityId;

    // Update title based on entity type
    const labels = { contact: "Contact", company: "Company", activity: "Activity", opportunity: "Opportunity" };
    if (title) title.textContent = `Link Task to ${labels[entityType] || "Entity"}`;

    // Reset search
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.hidden = true;

    // Load groups for board selectors
    await this.loadBoardOptions(boardSelect, createBoardSelect);

    modal.hidden = false;
    searchInput?.focus();
  }

  async loadBoardOptions(boardSelect, createBoardSelect) {
    try {
      const res = await fetch("/chat/groups");
      if (!res.ok) return;
      const groups = await res.json();

      // Update search board select (includes "All Boards" option)
      if (boardSelect) {
        // Keep the first two options (All Boards, Personal)
        while (boardSelect.options.length > 2) {
          boardSelect.remove(2);
        }
        groups.forEach((g) => {
          const option = document.createElement("option");
          option.value = g.id;
          option.textContent = g.name;
          boardSelect.appendChild(option);
        });
        boardSelect.value = "all"; // Default to all boards
      }

      // Update create board select (no "All Boards" option)
      if (createBoardSelect) {
        // Keep the first option (Personal)
        while (createBoardSelect.options.length > 1) {
          createBoardSelect.remove(1);
        }
        groups.forEach((g) => {
          const option = document.createElement("option");
          option.value = g.id;
          option.textContent = g.name;
          createBoardSelect.appendChild(option);
        });
      }
    } catch (err) {
      console.error("Failed to load groups:", err);
    }
  }

  async searchTasks(query) {
    const modal = document.querySelector("[data-task-link-modal]");
    const searchResults = modal?.querySelector("[data-task-search-results]");
    const boardSelect = modal?.querySelector("[data-task-board-select]");
    if (!searchResults) return;

    const groupId = boardSelect?.value || "all";
    const groupParam = groupId ? `&group_id=${encodeURIComponent(groupId)}` : "";

    try {
      const res = await fetch(`/api/tasks/search?q=${encodeURIComponent(query)}&limit=15${groupParam}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();

      if (data.tasks.length === 0) {
        searchResults.innerHTML = '<div class="crm-task-search-empty">No tasks found</div>';
      } else {
        searchResults.innerHTML = data.tasks.map((t) => `
          <div class="crm-task-search-item" data-task-id="${t.id}">
            <span class="crm-task-title">${this.escapeHtml(t.title)}</span>
            <span class="crm-task-meta">
              ${t.group_name ? `<span class="crm-task-board">${this.escapeHtml(t.group_name)}</span>` : '<span class="crm-task-board">Personal</span>'}
              <span class="badge badge-state-${t.state}">${t.state.replace("_", " ")}</span>
            </span>
          </div>
        `).join("");
      }
      searchResults.hidden = false;
    } catch (err) {
      console.error("Task search failed:", err);
      searchResults.innerHTML = '<div class="crm-task-search-empty">Search failed</div>';
      searchResults.hidden = false;
    }
  }

  async linkExistingTask(todoId) {
    const modal = document.querySelector("[data-task-link-modal]");
    const entityType = modal?.querySelector("[data-task-link-entity-type]")?.value;
    const entityId = modal?.querySelector("[data-task-link-entity-id]")?.value;

    if (!entityType || !entityId) return;

    try {
      const body = {
        include_related: true, // Automatically link to parent entities
      };
      body[`${entityType}_id`] = Number(entityId);

      const res = await fetch(`/api/tasks/${todoId}/crm-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to link task");

      modal.hidden = true;
      location.reload(); // Refresh to show linked task
    } catch (err) {
      console.error("Failed to link task:", err);
      alert("Failed to link task");
    }
  }

  async createLinkedTask() {
    const modal = document.querySelector("[data-task-link-modal]");
    const entityType = modal?.querySelector("[data-task-link-entity-type]")?.value;
    const entityId = modal?.querySelector("[data-task-link-entity-id]")?.value;
    const createBoardSelect = modal?.querySelector("[data-task-create-board-select]");

    if (!entityType || !entityId) return;

    // Prompt for task title
    const title = prompt("Enter task title:");
    if (!title?.trim()) return;

    try {
      const body = {
        title: title.trim(),
        state: "ready",
        priority: "pebble",
        include_related: true, // Automatically link to parent entities
      };
      body[`${entityType}_id`] = Number(entityId);

      // Add group_id if a board is selected
      const groupId = createBoardSelect?.value;
      if (groupId) {
        body.group_id = Number(groupId);
      }

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to create task");

      modal.hidden = true;
      location.reload(); // Refresh to show linked task
    } catch (err) {
      console.error("Failed to create task:", err);
      alert("Failed to create task");
    }
  }

  async unlinkTask(linkId, todoId) {
    if (!confirm("Unlink this task?")) return;

    try {
      const res = await fetch(`/api/tasks/${todoId}/crm-links/${linkId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to unlink task");
      location.reload();
    } catch (err) {
      console.error("Failed to unlink task:", err);
      alert("Failed to unlink task");
    }
  }

  async loadLinkedTasksForModal(modalSelector, entityType, entityId) {
    const modal = document.querySelector(modalSelector);
    if (!modal) return;

    const section = modal.querySelector("[data-linked-tasks-section]");
    const list = modal.querySelector("[data-linked-tasks-list]");
    const linkTaskBtn = section?.querySelector("[data-link-task]");
    if (!section || !list) return;

    // Hide section if no entity ID (new entity)
    if (!entityId) {
      section.hidden = true;
      return;
    }

    // Set entity ID on link task button (convert plural to singular)
    if (linkTaskBtn) {
      const singularType = entityType.replace(/ies$/, "y").replace(/s$/, "");
      linkTaskBtn.dataset.linkTask = singularType;
      linkTaskBtn.dataset.entityId = entityId;
    }

    // Always show section when editing (so user can link tasks even if none exist)
    section.hidden = false;

    try {
      const res = await fetch(`/api/crm/${entityType}/${entityId}/tasks`);
      if (!res.ok) {
        list.innerHTML = '<div class="crm-linked-tasks-empty">No linked tasks</div>';
        return;
      }

      const data = await res.json();
      const tasks = data.tasks || [];

      if (tasks.length === 0) {
        list.innerHTML = '<div class="crm-linked-tasks-empty">No linked tasks</div>';
        return;
      }

      // Render linked tasks with clickable links to board
      list.innerHTML = tasks
        .map((task) => {
          const boardUrl = task.group_id ? `/todo?group=${task.group_id}` : "/todo";
          return `
            <div class="crm-linked-task-item">
              <a href="${boardUrl}" target="_blank" class="crm-linked-task-link" title="Open task board">
                <span class="crm-linked-task-title">${this.escapeHtml(task.title)}</span>
              </a>
              <span class="badge badge-state-${task.state}">${task.state.replace("_", " ")}</span>
              <button type="button" class="crm-linked-task-unlink" data-unlink-crm-task data-link-id="${task.link_id}" data-todo-id="${task.id}" title="Unlink">&times;</button>
            </div>
          `;
        })
        .join("");
    } catch (err) {
      console.error("Failed to load linked tasks:", err);
      list.innerHTML = '<div class="crm-linked-tasks-empty">Failed to load tasks</div>';
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Avatar menu
  setupAvatarMenu() {
    const avatar = document.querySelector("[data-avatar]");
    const menu = document.querySelector("[data-avatar-menu]");

    if (avatar && menu) {
      avatar.addEventListener("click", () => {
        menu.hidden = !menu.hidden;
      });

      document.addEventListener("click", (e) => {
        if (!avatar.contains(e.target) && !menu.contains(e.target)) {
          menu.hidden = true;
        }
      });
    }

    document.querySelector("[data-logout]")?.addEventListener("click", async () => {
      await fetch("/auth/logout", { method: "POST" });
      location.href = "/";
    });

    // Load avatar from server database
    this.loadCurrentUserAvatar();
  }

  async loadCurrentUserAvatar() {
    const session = window.__NOSTR_SESSION__;
    if (!session?.npub) return;

    const avatarImg = document.querySelector("[data-avatar-img]");
    const avatarFallback = document.querySelector("[data-avatar-fallback]");
    if (!avatarImg) return;

    try {
      // Fetch user from local database cache
      const res = await fetch("/chat/users");
      if (!res.ok) return;

      const users = await res.json();
      const currentUser = users.find((u) => u.npub === session.npub);

      if (currentUser?.picture) {
        avatarImg.src = currentUser.picture;
        avatarImg.hidden = false;
        if (avatarFallback) avatarFallback.hidden = true;
      } else {
        // Fall back to RoboHash
        const identifier = currentUser?.pubkey || session.pubkey || session.npub;
        avatarImg.src = `https://robohash.org/${identifier}.png?set=set3`;
        avatarImg.hidden = false;
        if (avatarFallback) avatarFallback.hidden = true;
      }
    } catch (err) {
      console.error("Failed to load avatar:", err);
    }
  }

  // Hamburger menu
  setupHamburgerMenu() {
    const hamburger = document.querySelector("[data-hamburger-toggle]");
    const menu = document.querySelector("[data-app-menu]");
    const overlay = document.querySelector("[data-app-menu-overlay]");
    const closeBtn = document.querySelector("[data-app-menu-close]");

    if (hamburger && menu) {
      hamburger.addEventListener("click", () => {
        menu.hidden = false;
      });

      overlay?.addEventListener("click", () => {
        menu.hidden = true;
      });

      closeBtn?.addEventListener("click", () => {
        menu.hidden = true;
      });
    }
  }
}

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  new CrmApp();
});
