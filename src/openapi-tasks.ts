/**
 * OpenAPI 3.1 specification for Marginal Gains Task APIs
 *
 * Served at GET /api/openapi/tasks.json
 * Covers team-scoped todo CRUD, subtasks, state management, and task-thread linking.
 */

export const taskOpenApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Marginal Gains — Task & Activities API",
    version: "1.0.0",
    description:
      "Team-scoped task management API for Marginal Gains. Authenticate with NIP-98 (Authorization: Nostr <base64 event>) or session cookie.",
  },
  servers: [{ url: "/", description: "Same origin" }],
  components: {
    securitySchemes: {
      nip98: {
        type: "http",
        scheme: "Nostr",
        description:
          "NIP-98 auth. Value is a base64-encoded signed Nostr event (kind 27235) with `u` (request URL) and `method` (HTTP verb) tags.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "nostr_session",
      },
    },
    schemas: {
      Todo: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["rock", "pebble", "sand"] },
          state: {
            type: "string",
            enum: ["new", "ready", "in_progress", "review", "done", "archived"],
          },
          owner: { type: "string", description: "npub of the task creator" },
          assigned_to: { type: ["string", "null"], description: "npub of assignee" },
          group_id: { type: ["integer", "null"] },
          parent_id: { type: ["integer", "null"] },
          tags: { type: "string", description: "Comma-separated tags" },
          scheduled_for: { type: ["string", "null"], format: "date" },
          position: { type: ["integer", "null"] },
          created_at: { type: "string" },
          done: { type: "integer", enum: [0, 1] },
          deleted: { type: "integer", enum: [0, 1] },
        },
      },
      TodoSummary: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          state: { type: "string" },
          priority: { type: "string" },
          group_id: { type: ["integer", "null"] },
          group_name: { type: ["string", "null"] },
        },
      },
      Activity: {
        type: "object",
        properties: {
          id: { type: "integer" },
          target_npub: { type: "string" },
          type: { type: "string", enum: ["mention", "dm", "task_update", "task_assigned"] },
          source_npub: { type: "string" },
          message_id: { type: ["integer", "null"] },
          channel_id: { type: ["integer", "null"] },
          todo_id: { type: ["integer", "null"] },
          summary: { type: "string" },
          is_read: { type: "integer", enum: [0, 1] },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
    },
  },
  security: [{ nip98: [] }, { cookieAuth: [] }],
  paths: {
    "/t/{slug}/api/todos": {
      post: {
        summary: "Create a task",
        operationId: "createTodo",
        tags: ["Todos"],
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Team slug",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  tags: { type: "string", description: "Comma-separated" },
                  group_id: { type: ["integer", "null"], description: "Assign to a group" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    todo: { $ref: "#/components/schemas/Todo" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid input" },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden (not a group member)" },
        },
      },
    },
    "/t/{slug}/api/todos/{id}": {
      get: {
        summary: "Get a task by ID",
        operationId: "getTodo",
        tags: ["Todos"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Task details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Todo" },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
      patch: {
        summary: "Update a task",
        operationId: "updateTodo",
        tags: ["Todos"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string", enum: ["rock", "pebble", "sand"] },
                  state: {
                    type: "string",
                    enum: ["new", "ready", "in_progress", "review", "done", "archived"],
                  },
                  scheduled_for: { type: ["string", "null"], format: "date" },
                  tags: { type: "string" },
                  assigned_to: { type: ["string", "null"], description: "npub of assignee" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    todo: { $ref: "#/components/schemas/Todo" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid input" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        summary: "Delete a task",
        operationId: "deleteTodo",
        tags: ["Todos"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    id: { type: "integer" },
                  },
                },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
    },
    "/t/{slug}/api/todos/{id}/state": {
      post: {
        summary: "Change task state (kanban drag-drop)",
        operationId: "setTodoState",
        tags: ["Todos"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state"],
                properties: {
                  state: {
                    type: "string",
                    enum: ["new", "ready", "in_progress", "review", "done", "archived"],
                  },
                  position: { type: ["integer", "null"], description: "Ordering position within the column" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "State updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    state: { type: "string" },
                    position: { type: ["integer", "null"] },
                  },
                },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
    },
    "/t/{slug}/api/todos/{id}/position": {
      post: {
        summary: "Reorder a task within its column",
        operationId: "setTodoPosition",
        tags: ["Todos"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["position"],
                properties: {
                  position: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Position updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    position: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/todos/{id}/subtasks": {
      get: {
        summary: "List subtasks of a task",
        operationId: "getSubtasks",
        tags: ["Subtasks"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Subtasks list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    subtasks: { type: "array", items: { $ref: "#/components/schemas/Todo" } },
                    canAddSubtask: { type: "boolean" },
                    parent: {
                      type: ["object", "null"],
                      properties: {
                        id: { type: "integer" },
                        title: { type: "string" },
                      },
                    },
                    hasSubtasks: { type: "boolean" },
                  },
                },
              },
            },
          },
          "404": { description: "Parent task not found" },
        },
      },
      post: {
        summary: "Create a subtask (2 levels max)",
        operationId: "createSubtask",
        tags: ["Subtasks"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" }, description: "Parent task ID" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Subtask created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    subtask: { $ref: "#/components/schemas/Todo" },
                    parentState: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          "400": { description: "Cannot add subtask (2-level limit)" },
          "404": { description: "Parent not found" },
        },
      },
    },
    "/t/{slug}/api/todos/{id}/parent": {
      patch: {
        summary: "Set a task's parent (make it a subtask)",
        operationId: "setParent",
        tags: ["Subtasks"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["parent_id"],
                properties: {
                  parent_id: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Parent set",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    task: { $ref: "#/components/schemas/Todo" },
                    parent: {
                      type: ["object", "null"],
                      properties: {
                        id: { type: "integer" },
                        title: { type: "string" },
                        state: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Cannot set parent" },
        },
      },
      delete: {
        summary: "Detach a subtask from its parent",
        operationId: "detachFromParent",
        tags: ["Subtasks"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Detached",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    task: { $ref: "#/components/schemas/Todo" },
                    formerParentId: { type: ["integer", "null"] },
                    formerParentHasChildren: { type: "boolean" },
                    formerParentState: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          "400": { description: "Task is not a subtask" },
        },
      },
    },
    "/t/{slug}/api/todos/{id}/potential-parents": {
      get: {
        summary: "List tasks that can be a parent for this task",
        operationId: "listPotentialParents",
        tags: ["Subtasks"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Potential parents",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    potentialParents: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "integer" },
                          title: { type: "string" },
                          state: { type: "string" },
                          priority: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/tasks/search": {
      get: {
        summary: "Search tasks by title/description",
        operationId: "searchTasks",
        tags: ["Search"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" }, description: "Search query" },
          { name: "group_id", in: "query", schema: { type: "string" }, description: "Group ID or 'all'" },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 50 } },
        ],
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tasks: {
                      type: "array",
                      items: { $ref: "#/components/schemas/TodoSummary" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/tasks": {
      post: {
        summary: "Create a task with optional thread/CRM links",
        operationId: "createTask",
        tags: ["Tasks"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string", enum: ["rock", "pebble", "sand"] },
                  state: {
                    type: "string",
                    enum: ["new", "ready", "in_progress", "review", "done"],
                  },
                  scheduled_for: { type: ["string", "null"], format: "date" },
                  tags: { type: "string" },
                  group_id: { type: ["integer", "null"] },
                  thread_id: { type: ["integer", "null"], description: "Message ID to link" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created with optional links",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    task: { $ref: "#/components/schemas/Todo" },
                    threadLink: { type: ["object", "null"] },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/tasks/{id}/threads": {
      get: {
        summary: "List threads linked to a task",
        operationId: "getTaskThreads",
        tags: ["Task-Thread Links"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Linked threads",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    threads: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/tasks/{id}/link": {
      post: {
        summary: "Link a chat thread to a task",
        operationId: "linkThreadToTask",
        tags: ["Task-Thread Links"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" }, description: "Task ID" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["threadId"],
                properties: {
                  threadId: { type: "integer", description: "Root message ID of the thread" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Linked",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    link: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/tasks/{id}/unlink/{threadId}": {
      delete: {
        summary: "Unlink a thread from a task",
        operationId: "unlinkThreadFromTask",
        tags: ["Task-Thread Links"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "threadId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Unlinked",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { success: { type: "boolean" } },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/threads/{messageId}/tasks": {
      get: {
        summary: "List tasks linked to a chat thread",
        operationId: "getThreadTasks",
        tags: ["Task-Thread Links"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "messageId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Linked tasks",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tasks: { type: "array", items: { $ref: "#/components/schemas/Todo" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/t/{slug}/api/activities": {
      get: {
        summary: "List activities for the authenticated user",
        operationId: "listActivities",
        tags: ["Activities"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" }, description: "Team slug" },
          { name: "since", in: "query", schema: { type: "string", format: "date-time" }, description: "Only return activities created after this ISO timestamp" },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 }, description: "Max activities to return" },
        ],
        responses: {
          "200": {
            description: "Activities list with unread count",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    activities: { type: "array", items: { $ref: "#/components/schemas/Activity" } },
                    unreadCount: { type: "integer" },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/t/{slug}/api/activities/read": {
      post: {
        summary: "Mark activities as read",
        operationId: "markActivitiesRead",
        tags: ["Activities"],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" }, description: "Team slug" },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "integer", description: "Activity ID to mark as read. Omit to mark all as read." },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
};
