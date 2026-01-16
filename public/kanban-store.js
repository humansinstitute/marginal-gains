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

    // Parent/subtask relationship tracking
    parentMap: {},
    childMap: {},

    init: function() {
      // Build parent/child relationships for progress tracking
      this.buildRelationships();

      console.log('[KanbanStore] Initialized - columns:', {
        summary: this.columns.summary.length,
        'new': this.columns['new'].length,
        ready: this.columns.ready.length,
        in_progress: this.columns.in_progress.length,
        review: this.columns.review.length,
        done: this.columns.done.length
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
    getColumnCount: function(columnName) {
      return this.columns[columnName] ? this.columns[columnName].length : 0;
    },

    isColumnEmpty: function(columnName) {
      return !this.columns[columnName] || this.columns[columnName].length === 0;
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

      // Calculate progress for parent tasks
      self.columns.summary.forEach(function(parent) {
        parent.subtaskProgress = self.getSubtaskProgress(parent.id);
      });
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
    }
  };
};
