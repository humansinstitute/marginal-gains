# CRM & Tasks Team Migration Plan

## Current State

Both CRM and Tasks are currently using the **global database** (`src/db.ts`), meaning all data is shared across the entire application rather than being isolated per team.

- **CRM Routes**: `src/routes/crm.ts` - imports from `../db`
- **Tasks Routes**: `src/routes/tasks.ts` - imports from `../db`
- **Client CRM**: `public/crm.js` - uses global `/api/crm/*` endpoints

## Target State

CRM and Tasks should be **team-scoped**, meaning:
- Each team has its own isolated CRM data (companies, contacts, opportunities, activities)
- Each team has its own isolated Tasks data
- Users can only see/edit data within their current team context

## Migration Steps

### 1. Server-Side Route Handlers

#### CRM Routes (`src/routes/team-crm.ts` - new file)

Create team-scoped versions of all CRM handlers:

```
/t/:slug/api/crm/companies      GET, POST
/t/:slug/api/crm/companies/:id  GET, PATCH, DELETE
/t/:slug/api/crm/contacts       GET, POST
/t/:slug/api/crm/contacts/:id   GET, PATCH, DELETE
/t/:slug/api/crm/opportunities  GET, POST
/t/:slug/api/crm/opportunities/:id  GET, PATCH, DELETE
/t/:slug/api/crm/activities     GET, POST
/t/:slug/api/crm/activities/:id GET, DELETE
/t/:slug/api/crm/pipeline       GET
```

Each handler should:
1. Use `requireTeamContext(session, teamSlug)` for auth
2. Create `new TeamDatabase(ctx.teamDb)` for data access
3. Use the team database methods instead of global db functions

#### Tasks Routes (`src/routes/team-tasks.ts` - new file)

Create team-scoped versions:

```
/t/:slug/api/tasks/search       GET
/t/:slug/api/tasks/:id/threads  GET
/t/:slug/api/threads/:id/tasks  GET
/t/:slug/api/tasks              POST
/t/:slug/api/tasks/:id/link     POST
/t/:slug/api/tasks/:id/unlink   DELETE
```

### 2. Add Routes to Server (`src/server.ts`)

Import new handlers and add route patterns for both GET and POST methods:

```typescript
import { handleTeamCrm* } from "./routes/team-crm";
import { handleTeamTask* } from "./routes/team-tasks";

// In GET section:
const teamCrmCompaniesMatch = pathname.match(/^\/t\/([^/]+)\/api\/crm\/companies$/);
// ... etc

// In POST section:
// ... etc
```

### 3. CRM Page (`src/routes/crm.ts`)

Update `handleCrmPage` to require team context and redirect to `/t/:slug/crm`:

```typescript
export function handleTeamCrmPage(session: Session | null, teamSlug: string): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;
  // ... render CRM page with team context
}
```

### 4. Client-Side Updates

#### Update `public/crm.js`

Replace all API calls to use team-scoped URLs:

```javascript
// Before:
fetch('/api/crm/companies')

// After:
import { teamUrl } from './api.js';
fetch(teamUrl('/api/crm/companies'))
```

The `teamUrl()` helper from `api.js` automatically prefixes with `/t/{currentTeamSlug}`.

#### Update `public/api.js` (if needed)

Ensure `teamUrl()` helper exists and works for CRM paths.

### 5. Database Schema

The team schema (`src/team-schema.ts`) already includes CRM tables:
- `crm_companies`
- `crm_contacts`
- `crm_opportunities`
- `crm_activities`

The `TeamDatabase` class (`src/team-db.ts`) already has all CRM methods:
- `createCompany`, `getCompany`, `updateCompany`, `deleteCompany`, `listCompanies`
- `createContact`, `getContact`, `updateContact`, `deleteContact`, `listContacts`
- `createOpportunity`, `getOpportunity`, `updateOpportunity`, `deleteOpportunity`, `listOpportunities`
- `createActivity`, `getActivity`, `deleteActivity`, `listActivities`
- `getPipelineSummary`

**No schema changes needed** - just need to wire up the routes.

### 6. Navigation Updates

Update app menu to link to team-scoped CRM:
- Change `/crm` links to `/t/{teamSlug}/crm`

## Files to Modify

| File | Changes |
|------|---------|
| `src/routes/team-crm.ts` | NEW - Team-scoped CRM handlers |
| `src/routes/team-tasks.ts` | NEW - Team-scoped Tasks handlers |
| `src/server.ts` | Add new route patterns |
| `src/render/components.ts` | Update CRM nav link |
| `public/crm.js` | Use `teamUrl()` for API calls |

## Files to Keep (Global)

- `src/routes/crm.ts` - Can be removed or kept for backwards compatibility
- `src/routes/tasks.ts` - Can be removed or kept for backwards compatibility

## Testing Checklist

- [ ] CRM page loads at `/t/{slug}/crm`
- [ ] Companies CRUD works within team context
- [ ] Contacts CRUD works within team context
- [ ] Opportunities CRUD works within team context
- [ ] Activities CRUD works within team context
- [ ] Pipeline summary shows team-specific data
- [ ] Different teams have isolated CRM data
- [ ] Tasks link/unlink works within team context
- [ ] Admin can access CRM in any team they belong to

## Notes

- Wallet remains **global** (not team-scoped) per requirements
- Existing global CRM data will NOT be migrated - teams start fresh
- Consider adding a data export feature before migration if needed
