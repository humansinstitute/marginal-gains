/**
 * Kanban board store for Alpine.js
 * Used by both personal and team kanban boards
 *
 * IMPORTANT: This is NOT an ES module - it must load synchronously before Alpine.js
 * to ensure createKanbanStore is available when Alpine parses x-data attributes.
 */

// Helper functions
window.formatAvatarInitials = function(npub) {
  if (!npub) return '...';
  return npub.replace(/^npub1/, '').slice(0, 2).toUpperCase();
};

window.formatPriority = function(priority) {
  var labels = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', rock: 'Rock', pebble: 'Pebble', sand: 'Sand' };
  return labels[priority] || priority;
};

window.formatProgressSquares = function(progress) {
  if (!progress || progress.total === 0) return '';
  var squares = [];
  // Each state gets its own color class
  for (var i = 0; i < (progress.new || 0); i++) {
    squares.push('<span class="progress-square new"></span>');
  }
  for (var i = 0; i < (progress.ready || 0); i++) {
    squares.push('<span class="progress-square ready"></span>');
  }
  for (var i = 0; i < (progress.inProgress || 0); i++) {
    squares.push('<span class="progress-square in-progress"></span>');
  }
  for (var i = 0; i < (progress.review || 0); i++) {
    squares.push('<span class="progress-square review"></span>');
  }
  for (var i = 0; i < (progress.done || 0); i++) {
    squares.push('<span class="progress-square done"></span>');
  }
  return squares.join('');
};

/**
 * Kanban store factory - creates Alpine reactive store
 * Initializes columns immediately (before Alpine parses x-for)
 * @param {Array} initialTodos - Server-provided initial todos
 * @param {number|null} groupId - Group ID or null for personal board
 * @param {string|null} teamSlug - Team slug for team-scoped API calls
 * @returns {Object} Alpine reactive store
 */
window.createKanbanStore = function(initialTodos, groupId, teamSlug) {
  // First pass: identify which todos are parents (have children)
  var parentIds = {};
  (initialTodos || []).forEach(function(todo) {
    if (todo && todo.parent_id) {
      parentIds[todo.parent_id] = true;
    }
  });

  // Pre-process todos into columns
  // Parent tasks go to 'summary' column, others go to their state column
  var cols = { summary: [], 'new': [], ready: [], in_progress: [], review: [], done: [] };
  (initialTodos || []).forEach(function(todo) {
    if (todo && todo.id != null) {
      var isParent = !!parentIds[todo.id];
      todo.isParent = isParent;
      if (isParent) {
        // Parent tasks always go to summary column
        cols.summary.push(todo);
      } else if (cols[todo.state]) {
        cols[todo.state].push(todo);
      }
    }
  });

  // Sort each column by position
  ['summary', 'new', 'ready', 'in_progress', 'review', 'done'].forEach(function(state) {
    cols[state].sort(function(a, b) {
      if (a.position == null && b.position == null) return 0;
      if (a.position == null) return 1;
      if (b.position == null) return -1;
      return a.position - b.position;
    });
  });

  console.log('[KanbanStore] Creating store with', (initialTodos || []).length, 'todos,', cols.summary.length, 'parent tasks');

  return {
    columns: cols,
    groupId: groupId,
    teamSlug: teamSlug,
    loading: false,
    syncing: false,
    error: null,
    draggedCard: null,
    draggedFromColumn: null,
    textFilter: '',

    // Parent/subtask relationship tracking
    parentMap: {},
    childMap: {},

    init: function() {
      var self = this;

      // Expose store globally for other modules (e.g., taskModal)
      window.__kanbanStore = this;

      // Build parent/child relationships for progress tracking
      this.buildRelationships();

      // Intercept hero form submission for live updates
      this.setupHeroForm();

      // Intercept state button forms for live updates
      this.setupStateButtonForms();

      console.log('[KanbanStore] Initialized - columns:', {
        summary: this.columns.summary.length,
        'new': this.columns['new'].length,
        ready: this.columns.ready.length,
        in_progress: this.columns.in_progress.length,
        review: this.columns.review.length,
        done: this.columns.done.length
      });
    },

    // Set up hero form interception for live task creation
    setupHeroForm: function() {
      var self = this;
      var heroForm = document.querySelector('.todo-form');
      var heroInput = document.querySelector('[data-hero-input]');

      if (!heroForm || !heroInput) {
        console.log('[KanbanStore] Hero form not found, skipping setup');
        return;
      }

      heroForm.addEventListener('submit', function(event) {
        event.preventDefault();
        var title = heroInput.value.trim();
        if (!title) return;

        // Clear input immediately for better UX
        heroInput.value = '';
        heroInput.focus();

        // Add task via API
        self.addTask(title);
      });

      console.log('[KanbanStore] Hero form intercepted for live updates');
    },

    // Set up state button form interception for live state changes
    setupStateButtonForms: function() {
      var self = this;

      // Find all state change forms (matching the pattern /todos/:id/state or /t/:slug/todos/:id/state)
      var stateForms = document.querySelectorAll('form[action*="/todos/"][action*="/state"]');

      if (stateForms.length === 0) {
        console.log('[KanbanStore] No state forms found, skipping setup');
        return;
      }

      stateForms.forEach(function(form) {
        form.addEventListener('submit', function(event) {
          event.preventDefault();

          // Extract task ID from form action URL
          var actionUrl = form.getAttribute('action');
          var match = actionUrl.match(/\/todos\/(\d+)\/state/);
          if (!match) {
            console.error('[KanbanStore] Could not extract task ID from:', actionUrl);
            form.submit(); // Fallback to normal submit
            return;
          }

          var taskId = Number(match[1]);
          var stateInput = form.querySelector('input[name="state"]');
          var newState = stateInput ? stateInput.value : null;

          if (!newState) {
            console.error('[KanbanStore] Could not find state input');
            form.submit();
            return;
          }

          console.log('[KanbanStore] Intercepted state form:', { taskId: taskId, newState: newState });

          // Use moveTask for live update
          self.moveTask(taskId, newState).then(function(success) {
            if (!success) {
              // Fallback to form submit if live update failed
              form.submit();
            }
          });
        });
      });

      console.log('[KanbanStore] Intercepted', stateForms.length, 'state button forms');
    },

    // Add a new task via API and update the board
    addTask: async function(title, tags) {
      var self = this;
      tags = tags || '';

      // Generate temporary ID for optimistic update
      var tempId = 'temp-' + Date.now();
      var optimisticTask = {
        id: tempId,
        title: title,
        owner: '', // Will be set by server
        description: '',
        priority: 'sand',
        state: 'new',
        done: 0,
        deleted: 0,
        created_at: new Date().toISOString(),
        scheduled_for: null,
        tags: tags,
        group_id: self.groupId,
        assigned_to: null,
        position: null,
        parent_id: null,
        isParent: false,
        _optimistic: true
      };

      // Optimistically add to 'new' column
      self.columns['new'].unshift(optimisticTask);
      console.log('[KanbanStore] Optimistically added task:', title);

      // Sync to server
      self.syncing = true;
      try {
        var apiUrl = self.teamSlug
          ? '/t/' + self.teamSlug + '/api/todos'
          : '/api/todos';

        var body = { title: title, tags: tags };
        if (self.groupId) body.group_id = self.groupId;

        var res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          var errorData = await res.json().catch(function() { return { error: 'Unknown error' }; });
          console.error('[KanbanStore] Failed to create task:', errorData);
          throw new Error(errorData.error || 'Failed to create task');
        }

        var data = await res.json();
        console.log('[KanbanStore] Task created on server:', data.todo);

        // Replace optimistic task with real one
        var idx = self.columns['new'].findIndex(function(c) { return c.id === tempId; });
        if (idx > -1) {
          self.columns['new'][idx] = data.todo;
        }
      } catch (err) {
        console.error('[KanbanStore] Error creating task:', err);
        // Remove optimistic task on error
        var idx = self.columns['new'].findIndex(function(c) { return c.id === tempId; });
        if (idx > -1) {
          self.columns['new'].splice(idx, 1);
        }
        self.error = err.message || 'Failed to create task';
        // Clear error after a few seconds
        setTimeout(function() { self.error = null; }, 3000);
      }
      self.syncing = false;
    },

    // Update an existing task via API and update the board
    updateTask: async function(id, fields) {
      var self = this;

      // Find the task in the board
      var task = self.findTodoById(id);
      if (!task) {
        console.error('[KanbanStore] Task not found for update:', id);
        return false;
      }

      // Store old values for rollback
      var oldValues = {};
      Object.keys(fields).forEach(function(key) {
        oldValues[key] = task[key];
      });

      // Optimistic update
      Object.keys(fields).forEach(function(key) {
        task[key] = fields[key];
      });
      console.log('[KanbanStore] Optimistically updated task:', id, fields);

      // If state changed, move the card to the new column
      if (fields.state && fields.state !== oldValues.state) {
        self.moveTaskInBoard(id, oldValues.state, fields.state);
      }

      // Sync to server
      self.syncing = true;
      try {
        var apiUrl = self.teamSlug
          ? '/t/' + self.teamSlug + '/api/todos/' + id
          : '/api/todos/' + id;

        var res = await fetch(apiUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields)
        });

        if (!res.ok) {
          var errorData = await res.json().catch(function() { return { error: 'Unknown error' }; });
          console.error('[KanbanStore] Failed to update task:', errorData);
          throw new Error(errorData.error || 'Failed to update task');
        }

        var data = await res.json();
        console.log('[KanbanStore] Task updated on server:', data.todo);

        // Update with server response
        if (data.todo) {
          Object.keys(data.todo).forEach(function(key) {
            task[key] = data.todo[key];
          });
        }
        return true;
      } catch (err) {
        console.error('[KanbanStore] Error updating task:', err);
        // Rollback optimistic update
        Object.keys(oldValues).forEach(function(key) {
          task[key] = oldValues[key];
        });
        // Rollback column move if state changed
        if (fields.state && fields.state !== oldValues.state) {
          self.moveTaskInBoard(id, fields.state, oldValues.state);
        }
        self.error = err.message || 'Failed to update task';
        setTimeout(function() { self.error = null; }, 3000);
        return false;
      } finally {
        self.syncing = false;
      }
    },

    // Remove a task via API and remove from the board
    removeTask: async function(id) {
      var self = this;

      // Find the task and its column
      var task = self.findTodoById(id);
      if (!task) {
        console.error('[KanbanStore] Task not found for removal:', id);
        return false;
      }

      var columnName = task.isParent ? 'summary' : task.state;
      var column = self.columns[columnName];
      var taskIndex = column.findIndex(function(c) { return c.id === id; });

      if (taskIndex === -1) {
        console.error('[KanbanStore] Task not found in column:', columnName);
        return false;
      }

      // Optimistically remove from board
      var removedTask = column.splice(taskIndex, 1)[0];
      console.log('[KanbanStore] Optimistically removed task:', id);

      // Sync to server
      self.syncing = true;
      try {
        var apiUrl = self.teamSlug
          ? '/t/' + self.teamSlug + '/api/todos/' + id
          : '/api/todos/' + id;

        var res = await fetch(apiUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
          var errorData = await res.json().catch(function() { return { error: 'Unknown error' }; });
          console.error('[KanbanStore] Failed to delete task:', errorData);
          throw new Error(errorData.error || 'Failed to delete task');
        }

        console.log('[KanbanStore] Task deleted on server:', id);

        // If this was a parent task, also remove subtasks from the board
        if (removedTask.isParent && self.parentMap[id]) {
          self.parentMap[id].forEach(function(childId) {
            self.removeTaskFromBoard(childId);
          });
        }
        return true;
      } catch (err) {
        console.error('[KanbanStore] Error deleting task:', err);
        // Rollback: add task back to column
        column.splice(taskIndex, 0, removedTask);
        self.error = err.message || 'Failed to delete task';
        setTimeout(function() { self.error = null; }, 3000);
        return false;
      } finally {
        self.syncing = false;
      }
    },

    // Move a task to a new state column via API
    moveTask: async function(id, newState) {
      var self = this;

      var task = self.findTodoById(id);
      if (!task) {
        console.error('[KanbanStore] Task not found for move:', id);
        return false;
      }

      var oldState = task.state;
      if (oldState === newState) return true;

      // Optimistic update
      self.moveTaskInBoard(id, task.isParent ? 'summary' : oldState, task.isParent ? 'summary' : newState);
      task.state = newState;
      console.log('[KanbanStore] Optimistically moved task:', id, 'from', oldState, 'to', newState);

      // Sync to server
      self.syncing = true;
      try {
        var apiUrl = self.teamSlug
          ? '/t/' + self.teamSlug + '/api/todos/' + id + '/state'
          : '/api/todos/' + id + '/state';

        var body = { state: newState };
        if (self.groupId) body.group_id = self.groupId;

        var res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          var errorData = await res.json().catch(function() { return { error: 'Unknown error' }; });
          console.error('[KanbanStore] Failed to move task:', errorData);
          throw new Error(errorData.error || 'Failed to change state');
        }

        console.log('[KanbanStore] Task state changed on server:', id, newState);

        // Update parent progress if this is a subtask
        if (task.parent_id) {
          self.updateParentProgress(task.parent_id);
        }
        return true;
      } catch (err) {
        console.error('[KanbanStore] Error moving task:', err);
        // Rollback
        self.moveTaskInBoard(id, task.isParent ? 'summary' : newState, task.isParent ? 'summary' : oldState);
        task.state = oldState;
        self.error = err.message || 'Failed to change state';
        setTimeout(function() { self.error = null; }, 3000);
        return false;
      } finally {
        self.syncing = false;
      }
    },

    // Helper: move task between columns in the board (no API call)
    moveTaskInBoard: function(id, fromColumn, toColumn) {
      var self = this;
      if (fromColumn === toColumn) return;

      var fromCol = self.columns[fromColumn];
      var toCol = self.columns[toColumn];
      if (!fromCol || !toCol) return;

      var idx = fromCol.findIndex(function(c) { return c.id === id; });
      if (idx > -1) {
        var task = fromCol.splice(idx, 1)[0];
        toCol.unshift(task);
      }
    },

    // Helper: remove task from board without API call (for cascading deletes)
    removeTaskFromBoard: function(id) {
      var self = this;
      ['summary', 'new', 'ready', 'in_progress', 'review', 'done'].some(function(col) {
        var column = self.columns[col];
        var idx = column.findIndex(function(c) { return c.id === id; });
        if (idx > -1) {
          column.splice(idx, 1);
          return true;
        }
        return false;
      });
    },

    // Drag and drop handlers
    onDragStart: function(event, card, columnName) {
      // Summary cards can only be reordered within summary column
      this.draggedCard = card;
      this.draggedFromColumn = columnName;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.id);
      event.target.classList.add('dragging');
    },

    onDragEnd: function(event) {
      event.target.classList.remove('dragging');
      this.draggedCard = null;
      this.draggedFromColumn = null;
      document.querySelectorAll('.drop-target').forEach(function(el) { el.classList.remove('drop-target'); });
      document.querySelectorAll('.drop-placeholder').forEach(function(el) { el.remove(); });
    },

    onDragOver: function(event, columnName) {
      if (!this.draggedCard) return;
      // Summary cards can only be dropped in summary column
      if (this.draggedFromColumn === 'summary' && columnName !== 'summary') return;
      // Regular cards cannot be dropped in summary column
      if (this.draggedFromColumn !== 'summary' && columnName === 'summary') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      var container = event.currentTarget;
      container.classList.add('drop-target');

      var cards = Array.from(container.querySelectorAll('.kanban-card:not(.dragging)'));
      var afterCard = this.getCardAfterCursor(cards, event.clientY);
      var placeholder = container.querySelector('.drop-placeholder');
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'drop-placeholder';
      }
      if (afterCard) {
        container.insertBefore(placeholder, afterCard);
      } else {
        container.appendChild(placeholder);
      }
    },

    onDragLeave: function(event) {
      var container = event.currentTarget;
      if (!container.contains(event.relatedTarget)) {
        container.classList.remove('drop-target');
        var placeholder = container.querySelector('.drop-placeholder');
        if (placeholder) placeholder.remove();
      }
    },

    onDrop: async function(event, targetColumn) {
      event.preventDefault();
      var container = event.currentTarget;
      container.classList.remove('drop-target');

      if (!this.draggedCard) return;

      var self = this;
      var card = this.draggedCard;
      var oldColumn = this.draggedFromColumn;
      var newColumn = targetColumn;

      // Validate drop: summary cards stay in summary, regular cards stay out of summary
      if (oldColumn === 'summary' && newColumn !== 'summary') return;
      if (oldColumn !== 'summary' && newColumn === 'summary') return;

      var cards = Array.from(container.querySelectorAll('.kanban-card:not(.dragging)'));
      var afterCard = this.getCardAfterCursor(cards, event.clientY);
      var dropIndex = afterCard ? cards.indexOf(afterCard) : cards.length;
      var position = this.calculatePosition(this.columns[newColumn], dropIndex);

      container.querySelectorAll('.drop-placeholder').forEach(function(el) { el.remove(); });

      // Check for no-op
      if (oldColumn === newColumn) {
        var currentIndex = this.columns[oldColumn].findIndex(function(c) { return c.id === card.id; });
        var adjustedIndex = currentIndex < dropIndex ? dropIndex - 1 : dropIndex;
        if (currentIndex === adjustedIndex || currentIndex === dropIndex) return;
      }

      // Optimistic UI update
      var oldIndex = this.columns[oldColumn].findIndex(function(c) { return c.id === card.id; });
      if (oldIndex > -1) this.columns[oldColumn].splice(oldIndex, 1);

      // Only update state if not summary column (summary cards keep their computed state)
      if (newColumn !== 'summary') {
        card.state = newColumn;
      }
      card.position = position;

      var insertIndex = oldColumn === newColumn && oldIndex < dropIndex ? dropIndex - 1 : dropIndex;
      this.columns[newColumn].splice(insertIndex, 0, card);

      // If this is a subtask, update the parent's progress squares
      if (card.parent_id) {
        this.updateParentProgress(card.parent_id);
      }

      // Sync to server
      this.syncing = true;
      try {
        var body, apiUrl;
        if (newColumn === 'summary') {
          // Summary cards: only update position
          body = { position: position };
          apiUrl = this.teamSlug
            ? '/t/' + this.teamSlug + '/api/todos/' + card.id + '/position'
            : '/api/todos/' + card.id + '/position';
        } else {
          // Regular cards: update state and position
          body = { state: newColumn, position: position };
          if (this.groupId) body.group_id = this.groupId;
          apiUrl = this.teamSlug
            ? '/t/' + this.teamSlug + '/api/todos/' + card.id + '/state'
            : '/api/todos/' + card.id + '/state';
        }
        var res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          var errorData = await res.json().catch(function() { return { error: 'Unknown error' }; });
          console.error('[KanbanStore] Server error:', res.status, errorData);
          throw new Error('Sync failed: ' + (errorData.error || res.status));
        }
      } catch (err) {
        console.error('[KanbanStore] Sync error:', err);
        window.location.reload();
      }
      this.syncing = false;
    },

    // Helper: find card element after cursor position
    getCardAfterCursor: function(cards, y) {
      var closestCard = null;
      var closestOffset = Number.NEGATIVE_INFINITY;
      cards.forEach(function(card) {
        var box = card.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closestOffset) {
          closestOffset = offset;
          closestCard = card;
        }
      });
      return closestCard;
    },

    // Helper: calculate fractional position for ordering
    calculatePosition: function(column, dropIndex) {
      var BASE = 65536;
      if (column.length === 0) return BASE;
      var positions = column.map(function(c, i) { return c.position != null ? c.position : (i + 1) * BASE; });
      if (dropIndex === 0) return Math.floor(positions[0] / 2);
      if (dropIndex >= column.length) return positions[positions.length - 1] + BASE;
      return Math.floor((positions[dropIndex - 1] + positions[dropIndex]) / 2);
    },

    // Column helpers
    getFilteredCards: function(columnName) {
      var cards = this.columns[columnName] || [];
      if (!this.textFilter || this.textFilter.trim() === '') {
        return cards;
      }
      var filterText = this.textFilter.toLowerCase().trim();
      return cards.filter(function(card) {
        return card.title && card.title.toLowerCase().indexOf(filterText) !== -1;
      });
    },

    getColumnCount: function(columnName) {
      return this.getFilteredCards(columnName).length;
    },

    isColumnEmpty: function(columnName) {
      return this.getFilteredCards(columnName).length === 0;
    },

    // Card helpers
    getCardTags: function(card) {
      if (!card || !card.tags) return [];
      return card.tags.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t.length > 0; });
    },

    canDragCard: function(card) {
      // Parent cards (in summary column) cannot be dragged
      return !card.isParent;
    },

    // Parent/subtask relationship methods
    buildRelationships: function() {
      var self = this;
      self.parentMap = {};
      self.childMap = {};

      // Collect all todos from all columns including summary
      var allTodos = [];
      ['summary', 'new', 'ready', 'in_progress', 'review', 'done'].forEach(function(state) {
        allTodos = allTodos.concat(self.columns[state] || []);
      });

      // Build parent-child maps
      allTodos.forEach(function(todo) {
        if (todo.parent_id) {
          self.childMap[todo.id] = todo.parent_id;
          if (!self.parentMap[todo.parent_id]) {
            self.parentMap[todo.parent_id] = [];
          }
          self.parentMap[todo.parent_id].push(todo.id);
        }
      });

      // Move any tasks that are now parents to the summary column
      var parentIds = Object.keys(self.parentMap);
      parentIds.forEach(function(parentId) {
        var id = Number(parentId);
        // Check if parent is not already in summary
        var inSummary = self.columns.summary.some(function(t) { return t.id === id; });
        if (!inSummary) {
          // Find and move the parent task to summary
          self.promoteToParent(id);
        }
      });

      // Calculate progress for parent tasks
      self.columns.summary.forEach(function(parent) {
        parent.subtaskProgress = self.getSubtaskProgress(parent.id);
      });
    },

    // Promote a task to parent status (move to summary column)
    promoteToParent: function(taskId) {
      var self = this;
      var task = null;
      var sourceColumn = null;

      // Find the task in non-summary columns
      ['new', 'ready', 'in_progress', 'review', 'done'].some(function(col) {
        var column = self.columns[col];
        var idx = column.findIndex(function(t) { return t.id === taskId; });
        if (idx > -1) {
          task = column.splice(idx, 1)[0];
          sourceColumn = col;
          return true;
        }
        return false;
      });

      if (task) {
        task.isParent = true;
        self.columns.summary.unshift(task);
        console.log('[KanbanStore] Promoted task to parent:', taskId, 'from', sourceColumn);
      }
    },

    // Demote a parent back to regular task (move from summary to state column)
    demoteFromParent: function(parentId) {
      var self = this;
      var idx = self.columns.summary.findIndex(function(t) { return t.id === parentId; });
      if (idx === -1) return;

      var task = self.columns.summary.splice(idx, 1)[0];
      task.isParent = false;

      // Move to the appropriate state column
      var targetColumn = task.state || 'new';
      if (self.columns[targetColumn]) {
        self.columns[targetColumn].unshift(task);
        console.log('[KanbanStore] Demoted parent to regular task:', parentId, 'to', targetColumn);
      }
    },

    // Detach a subtask from its parent via API
    detachFromParent: async function(taskId) {
      var self = this;

      var task = self.findTodoById(taskId);
      if (!task || !task.parent_id) {
        console.error('[KanbanStore] Task not found or not a subtask:', taskId);
        return false;
      }

      var formerParentId = task.parent_id;

      // Optimistic update
      task.parent_id = null;
      console.log('[KanbanStore] Optimistically detached task from parent:', taskId);

      // Sync to server
      self.syncing = true;
      try {
        var apiUrl = self.teamSlug
          ? '/t/' + self.teamSlug + '/api/todos/' + taskId + '/parent'
          : '/api/todos/' + taskId + '/parent';

        var res = await fetch(apiUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
          var errorData = await res.json().catch(function() { return { error: 'Unknown error' }; });
          console.error('[KanbanStore] Failed to detach from parent:', errorData);
          throw new Error(errorData.error || 'Failed to detach from parent');
        }

        var data = await res.json();
        console.log('[KanbanStore] Task detached on server:', data);

        // Update relationships and check if parent needs demotion
        self.buildRelationships();

        // If former parent has no more children, demote it
        if (formerParentId && !data.formerParentHasChildren) {
          self.demoteFromParent(formerParentId);
        } else if (formerParentId && data.formerParentHasChildren) {
          // Parent still has children - update its state from server response
          var parent = self.columns.summary.find(function(p) { return p.id === formerParentId; });
          if (parent) {
            if (data.formerParentState) {
              var oldState = parent.state;
              parent.state = data.formerParentState;
              console.log('[KanbanStore] Updated parent state after subtask detach:', { parentId: formerParentId, oldState: oldState, newState: data.formerParentState });
            }
            // Update progress squares
            parent.subtaskProgress = self.getSubtaskProgress(formerParentId);
          }
        }

        return true;
      } catch (err) {
        console.error('[KanbanStore] Error detaching from parent:', err);
        // Rollback
        task.parent_id = formerParentId;
        self.error = err.message || 'Failed to detach from parent';
        setTimeout(function() { self.error = null; }, 3000);
        return false;
      } finally {
        self.syncing = false;
      }
    },

    // Set a task's parent, making it a subtask
    setParent: async function(taskId, parentId) {
      var self = this;

      var task = self.findTodoById(taskId);
      if (!task) {
        console.error('[KanbanStore] Task not found:', taskId);
        return false;
      }

      if (task.parent_id) {
        console.error('[KanbanStore] Task already has a parent:', taskId);
        return false;
      }

      // Optimistic update
      task.parent_id = parentId;
      console.log('[KanbanStore] Optimistically set parent:', { taskId: taskId, parentId: parentId });

      // Sync to server
      self.syncing = true;
      try {
        var apiUrl = self.teamSlug
          ? '/t/' + self.teamSlug + '/api/todos/' + taskId + '/parent'
          : '/api/todos/' + taskId + '/parent';

        var res = await fetch(apiUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parent_id: parentId })
        });

        if (!res.ok) {
          var errorData = await res.json().catch(function() { return { error: 'Unknown error' }; });
          console.error('[KanbanStore] Failed to set parent:', errorData);
          throw new Error(errorData.error || 'Failed to set parent');
        }

        var data = await res.json();
        console.log('[KanbanStore] Parent set on server:', data);

        // Rebuild relationships to update parentMap
        self.buildRelationships();

        // Promote the parent to the summary column if not already there
        self.promoteToParent(parentId);

        // Update parent's progress squares
        self.updateParentProgress(parentId);

        return true;
      } catch (err) {
        console.error('[KanbanStore] Error setting parent:', err);
        // Rollback
        task.parent_id = null;
        self.error = err.message || 'Failed to set parent';
        setTimeout(function() { self.error = null; }, 3000);
        return false;
      } finally {
        self.syncing = false;
      }
    },

    getSubtaskProgress: function(parentId) {
      var self = this;
      var childIds = self.parentMap[parentId] || [];
      var children = [];
      childIds.forEach(function(id) {
        var found = self.findTodoById(id);
        if (found) children.push(found);
      });

      return {
        total: children.length,
        new: children.filter(function(c) { return c.state === 'new'; }).length,
        ready: children.filter(function(c) { return c.state === 'ready'; }).length,
        inProgress: children.filter(function(c) { return c.state === 'in_progress'; }).length,
        review: children.filter(function(c) { return c.state === 'review'; }).length,
        done: children.filter(function(c) { return c.state === 'done'; }).length
      };
    },

    // Update parent's progress squares and state after subtask state change
    updateParentProgress: function(parentId) {
      var self = this;
      var parent = self.columns.summary.find(function(p) { return p.id === parentId; });
      if (parent) {
        var oldState = parent.state;
        parent.subtaskProgress = self.getSubtaskProgress(parentId);
        // Also update parent state based on subtask states
        var newState = self.computeParentState(parentId);
        parent.state = newState;
        console.log('[KanbanStore] updateParentProgress:', { parentId: parentId, oldState: oldState, newState: newState, progress: parent.subtaskProgress });
      }
    },

    // Compute parent state based on subtask states (min/slowest state)
    computeParentState: function(parentId) {
      var self = this;
      var stateOrder = { 'new': 0, 'ready': 1, 'in_progress': 2, 'review': 3, 'done': 4, 'archived': 5 };
      var stateByOrder = ['new', 'ready', 'in_progress', 'review', 'done', 'archived'];

      var childIds = self.parentMap[parentId] || [];
      if (childIds.length === 0) return 'new';

      var minOrder = stateOrder.done; // Start with highest active state
      var childStates = [];
      childIds.forEach(function(id) {
        var child = self.findTodoById(id);
        if (child) {
          childStates.push({ id: id, state: child.state });
          var order = stateOrder[child.state];
          if (order !== undefined && order < minOrder) {
            minOrder = order;
          }
        }
      });

      var computedState = stateByOrder[minOrder] || 'new';
      console.log('[KanbanStore] computeParentState:', { parentId: parentId, childStates: childStates, minOrder: minOrder, computedState: computedState });
      return computedState;
    },

    findTodoById: function(id) {
      var self = this;
      var found = null;
      ['summary', 'new', 'ready', 'in_progress', 'review', 'done'].some(function(state) {
        var cards = self.columns[state] || [];
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].id === id) {
            found = cards[i];
            return true;
          }
        }
        return false;
      });
      return found;
    },

    // Get parent task title for display on child cards
    getParentTitle: function(parentId) {
      var parent = this.findTodoById(parentId);
      if (parent && parent.title) {
        // Truncate long titles
        var title = parent.title;
        if (title.length > 30) {
          return title.slice(0, 27) + '...';
        }
        return title;
      }
      return 'Parent Task';
    }
  };
};
