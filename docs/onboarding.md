# Onboarding flow

New users land on `/onboarding`, a checklist that walks them through inviting
co-owners, adding a property, adding a tenant and creating a lease, then offers
optional extras like connecting a bank account.

The flow is registry-driven: the steps are data, not hard-coded screens, so
adding one when a new feature lands is a small, contained change.

## How it fits together

| Piece | File | Responsibility |
| --- | --- | --- |
| Step registry | `shared/onboarding/steps.ts` | Which steps exist, their order, titles, sections, dependencies and flags. Shared by client and server. |
| Completion checks | `server/src/services/onboarding.service.ts` | For a given user, is each step done? |
| API | `server/src/routes/onboarding.ts` | `GET /api/onboarding` plus skip / un-skip / complete / dismiss / restart. |
| Client state | `client/src/contexts/OnboardingContext.tsx` | Fetches status, exposes the actions, merges definitions with progress. |
| Wizard page | `client/src/pages/Onboarding.tsx` | Renders whatever the registry contains. |
| Inline forms | `client/src/components/composed/Onboarding/stepComponents.tsx` | Optional per-step forms; anything unregistered falls back to a link. |
| Dashboard card | `client/src/components/composed/Onboarding/OnboardingChecklist.tsx` | Compact progress card, hidden once done or dismissed. |
| First-run redirect | `client/src/components/OnboardingGate.tsx` | Sends a genuinely empty install to the flow, once. |

## Completion is derived, not clicked

A step is complete because the data exists — a property was created, a bank
account was linked — not because someone pressed "next". That means:

- Users who set things up before finding the flow see it already ticked off.
- Seeded and imported installs look correct.
- Nothing goes stale if a user deletes what they made.

The `onboarding_step_overrides` table records only the two things data can't
express: a user skipping a step, and ticking off a step whose completion isn't
derivable (`manual` in the registry). Data beats a skip — skip "add a tenant",
add one anyway, and it shows as complete.

Progress and completion are measured against the **essential** steps only
(`section: 'essentials'`). Optional extras never hold up the "you're set up"
state.

### Scope of the counts

Properties, tenants and leases are counted install-wide rather than per user.
Cohold is one household's install, so a co-owner invited after setup sees the
property step as done instead of being nudged into creating a duplicate.

## Adding a step

1. **Add it to the registry** (`shared/onboarding/steps.ts`): a new id in
   `OnboardingStepId` and an entry in `ONBOARDING_STEPS`. Most flags have
   sensible defaults — steps in the `enhancements` section are optional
   automatically.

   ```ts
   defineStep({
     id: 'insurance',
     section: 'enhancements',
     title: 'Add your insurance policy',
     description: 'Keep renewal dates and cover details next to the property.',
     icon: 'folder',
     ctaLabel: 'Add a policy',
     route: '/insurance',
     dependsOn: ['property'],
   }),
   ```

2. **Add its completion check** in `server/src/services/onboarding.service.ts`.
   `STEP_CHECKS` is a `Record<OnboardingStepId, StepCheck>`, so a forgotten
   check is a compile error, not a silently broken step. If the check needs a
   new count, add a field to `loadCounts`.

   ```ts
   insurance: ({ counts }) => ({
     complete: counts.policies > 0,
     detail: counts.policies > 0 ? plural(counts.policies, 'policy', 'policies') : undefined,
   }),
   ```

That's enough. The step now appears in the wizard, the dashboard card and the
progress count, and links to its own page.

3. **Optionally add an inline form** so the step can be completed without
   leaving the flow: write a component taking `OnboardingStepFormProps` and
   register it in `stepComponents.tsx`. Steps without one render `LinkStepForm`,
   which is the right answer for most optional extras.

### Flags worth knowing

- `dependsOn` — only list a genuine data dependency (a lease needs a property
  and a tenant). A dependency that is merely *skipped* does not unlock the
  dependent step, because the data still isn't there.
- `skippable: false` — for steps with no meaningful way round them. The API
  refuses to skip these, not just the UI.
- `adminOnly: true` — hidden entirely from non-admins, and excluded from their
  progress count.
- `requiresWrite` — defaults to true, which hides the step from VIEWERs. Every
  current step creates something, so a VIEWER gets an empty (and therefore
  already complete) checklist rather than one that ends in a 403.
- `manual: true` — completion can't be derived, so the user ticks it off. Only
  these accept `POST /api/onboarding/steps/:id/complete`.

## The first-run redirect

`OnboardingGate` is deliberately timid. The server sets `shouldRedirect` only
for an install with no properties, tenants, leases or co-owners and no prior
dismissal; the client only acts on it from `/dashboard`, and only once per
browser session. Anyone who navigates away is not dragged back.

The e2e smoke user is seeded with `onboardingDismissedAt` set
(`prisma/seed.smoke.ts`) so the redirect never intercepts the smoke run.
