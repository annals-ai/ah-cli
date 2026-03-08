# Local Web UI Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the local Web UI so operators can create or continue sessions, manage task groups, and control the local daemon without dropping back to the CLI.

**Architecture:** Reuse existing daemon methods wherever they already exist (`runtime.chat`, `session.attach`, `task.create`, `task.archive`) and expose them through the local UI HTTP API. Add a small set of shadcn-based control surfaces to the existing dashboard rather than introducing a new page or router. For daemon stop/restart, add explicit HTTP actions that coordinate a graceful shutdown and background restart from the current process model.

**Tech Stack:** TypeScript, React 19, Vite, shadcn/ui, agent-mesh local daemon, Vitest, agent-browser, pnpm

---

### Task 1: Session Create And Continue

**Files:**
- Modify: `packages/cli/src/ui/api-routes.ts`
- Modify: `packages/ui/src/api.ts`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/components/TranscriptPanel.tsx`
- Modify: `packages/ui/src/lib/i18n.tsx`
- Test: `tests/cli/ui-api.test.ts`

**Step 1: Write the failing test**

Add a UI API test that:
- creates an agent
- POSTs a new session chat request with `agentRef` + `message`
- POSTs an attach chat request with `sessionId` + `message`
- verifies the session transcript contains the new user and assistant messages

**Step 2: Run test to verify it fails**

Run: `pnpm -C agent-mesh test -- tests/cli/ui-api.test.ts`

**Step 3: Write minimal implementation**

- Add UI API endpoints for local runtime chat/create and attach/send
- Add frontend API helpers for those endpoints
- Add a composer to the transcript pane that can:
  - start a new session from a selected agent when no session is selected
  - continue the selected session when one is selected
- Refresh dashboard and transcript state after send completes

**Step 4: Run tests to verify it passes**

Run:
- `pnpm -C agent-mesh test -- tests/cli/ui-api.test.ts`
- `pnpm -C agent-mesh build`

**Step 5: Commit**

```bash
git -C agent-mesh add tests/cli/ui-api.test.ts packages/cli/src/ui/api-routes.ts packages/ui/src/api.ts packages/ui/src/App.tsx packages/ui/src/components/TranscriptPanel.tsx packages/ui/src/lib/i18n.tsx
git -C agent-mesh commit -m "feat: add local ui session composer"
```

### Task 2: Task Group Actions

**Files:**
- Modify: `packages/cli/src/ui/api-routes.ts`
- Modify: `packages/ui/src/api.ts`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/components/TasksPanel.tsx`
- Modify: `packages/ui/src/lib/i18n.tsx`
- Test: `tests/cli/ui-api.test.ts`

**Step 1: Write the failing test**

Add a UI API test that:
- creates a task group through the UI API
- archives the same task group through the UI API
- verifies the task list reflects the new status

**Step 2: Run test to verify it fails**

Run: `pnpm -C agent-mesh test -- tests/cli/ui-api.test.ts`

**Step 3: Write minimal implementation**

- Add UI API routes for `task.create` and `task.archive`
- Add frontend helpers
- Add a task creation dialog and archive action in the tasks panel
- Preserve the current dashboard information layout

**Step 4: Run tests to verify it passes**

Run:
- `pnpm -C agent-mesh test -- tests/cli/ui-api.test.ts`
- `pnpm -C agent-mesh build`

**Step 5: Commit**

```bash
git -C agent-mesh add tests/cli/ui-api.test.ts packages/cli/src/ui/api-routes.ts packages/ui/src/api.ts packages/ui/src/App.tsx packages/ui/src/components/TasksPanel.tsx packages/ui/src/lib/i18n.tsx
git -C agent-mesh commit -m "feat: add local ui task actions"
```

### Task 3: Daemon Stop And Restart Controls

**Files:**
- Modify: `packages/cli/src/ui/api-routes.ts`
- Modify: `packages/cli/src/daemon/process.ts`
- Modify: `packages/ui/src/api.ts`
- Modify: `packages/ui/src/components/AppShell.tsx`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/lib/i18n.tsx`
- Test: `tests/cli/ui-api.test.ts`
- Test: `tests/cli/daemon-ui.test.ts`

**Step 1: Write the failing test**

Add focused tests that:
- POST a UI daemon action request for stop/restart
- verify stop clears the background process state
- verify restart returns a reachable daemon with a UI URL

**Step 2: Run test to verify it fails**

Run:
- `pnpm -C agent-mesh test -- tests/cli/ui-api.test.ts tests/cli/daemon-ui.test.ts`

**Step 3: Write minimal implementation**

- Add local-only UI endpoints for `daemon.stop` and `daemon.restart`
- Reuse the background daemon helpers rather than shelling out
- Add AppShell controls for stop/restart with clear pending states
- Handle temporary disconnects after restart by polling until the new UI becomes reachable

**Step 4: Run tests to verify it passes**

Run:
- `pnpm -C agent-mesh test -- tests/cli/ui-api.test.ts tests/cli/daemon-ui.test.ts`
- `pnpm -C agent-mesh build`

**Step 5: Commit**

```bash
git -C agent-mesh add tests/cli/ui-api.test.ts tests/cli/daemon-ui.test.ts packages/cli/src/ui/api-routes.ts packages/cli/src/daemon/process.ts packages/ui/src/api.ts packages/ui/src/components/AppShell.tsx packages/ui/src/App.tsx packages/ui/src/lib/i18n.tsx
git -C agent-mesh commit -m "feat: add local ui daemon controls"
```

### Task 4: Browser Smoke Validation

**Files:**
- Test only: no product files required unless a bug is found during validation

**Step 1: Run the browser smoke**

Use `agent-browser` against the running local UI to verify:
- create an agent
- create a task group
- start a new session and send the first message
- send another message to the same session
- archive the task group
- stop and restart the daemon from the UI

**Step 2: Fix regressions if found**

- If a bug appears, add the smallest fix and rerun the relevant test
- Re-run `pnpm -C agent-mesh build`

**Step 3: Final verification**

Run:
- `pnpm -C agent-mesh build`
- `pnpm -C agent-mesh test -- tests/cli/ui-api.test.ts tests/cli/daemon-ui.test.ts`

**Step 4: Commit**

```bash
git -C agent-mesh commit --allow-empty -m "test: verify local ui action flows"
```
