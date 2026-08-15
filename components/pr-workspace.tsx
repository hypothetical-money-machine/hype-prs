"use client";

import {
  Activity,
  Archive,
  ArrowUpRight,
  BellDot,
  Blocks,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Clock3,
  Code2,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  History,
  Inbox,
  Layers,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Users,
  WifiOff,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DiffWorkspace, type DiffLayout } from "./diff-workspace";
import { ThemeToggle, useThemePreference } from "./theme-toggle";
import { createDemoInbox, demoDiffs } from "@/lib/demo-data";
import { beginWebConnection, gateway } from "@/lib/github-gateway";
import {
  countForView,
  dominantReason,
  filterForView,
  groupLabel,
  searchPullRequests,
  sortForView,
  viewDefinitions,
  type SortId,
  type ViewId,
} from "@/lib/pr-views";
import type {
  ConnectionStatus,
  InboxPayload,
  PullRequestDiff,
  PullRequestSummary,
  ReviewEvent,
} from "@/lib/types";
import type { ThemePreference } from "@/lib/theme";

const EMPTY_DIFF: PullRequestDiff = {
  baseSha: "",
  files: [],
  headSha: "",
  patch: "",
  truncated: false,
};

const EMPTY_INBOX: InboxPayload = {
  pullRequests: [],
  rateLimit: null,
  syncedAt: "",
  viewer: { avatarUrl: null, login: "", name: null },
};

const CONNECTION_TIMEOUT_MS = 20 * 1000;

const INITIAL_CONNECTION: ConnectionStatus = {
  authKind: null,
  configured: false,
  connected: false,
  expiresAt: null,
  mode: "demo",
  viewer: null,
};

export function PrWorkspace({
  initialDemoInbox = createDemoInbox(),
  initialNow = Date.parse(initialDemoInbox.syncedAt),
}: {
  initialDemoInbox?: InboxPayload;
  initialNow?: number;
} = {}) {
  const [activeView, setActiveView] = useState<ViewId>("needs-attention");
  const [sort, setSort] = useState<SortId>("attention");
  const [query, setQuery] = useState("");
  const [inboxData, setInboxData] =
    useState<InboxPayload>(initialDemoInbox);
  const [connection, setConnection] =
    useState<ConnectionStatus>(INITIAL_CONNECTION);
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [launchView, setLaunchView] =
    useState<"checking" | "login" | "workspace">("checking");
  const [usingDemo, setUsingDemo] = useState(true);
  const [selectedId, setSelectedId] = useState(
    initialDemoInbox.pullRequests[0]?.id ?? "",
  );
  const [clockNow, setClockNow] = useState(initialNow);
  const [liveDiffState, setLiveDiffState] = useState<{
    diff: PullRequestDiff;
    inboxSyncedAt: string;
    pullRequestId: string;
  }>({ diff: EMPTY_DIFF, inboxSyncedAt: "", pullRequestId: "" });
  const [diffLayout, setDiffLayout] = useState<DiffLayout>("split");
  const [leftColumnsCollapsed, setLeftColumnsCollapsed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connectionDialog, setConnectionDialog] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [themePreference, setThemePreference] = useThemePreference();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedPullRequest =
    inboxData.pullRequests.find(
      (pullRequest) => pullRequest.id === selectedId,
    ) ??
    inboxData.pullRequests[0] ??
    null;
  const displayedDiff = usingDemo
    ? (demoDiffs[selectedPullRequest?.id ?? ""] ?? EMPTY_DIFF)
    : liveDiffState.pullRequestId === selectedPullRequest?.id &&
        liveDiffState.inboxSyncedAt === inboxData.syncedAt &&
        liveDiffState.diff.headSha === selectedPullRequest?.headSha
      ? liveDiffState.diff
      : EMPTY_DIFF;
  const diffLoading =
    !usingDemo &&
    Boolean(selectedPullRequest) &&
    (liveDiffState.pullRequestId !== selectedPullRequest?.id ||
      liveDiffState.inboxSyncedAt !== inboxData.syncedAt ||
      liveDiffState.diff.headSha !== selectedPullRequest?.headSha);
  const reviewReady =
    usingDemo ||
    (Boolean(selectedPullRequest) &&
      !diffLoading &&
      !displayedDiff.truncated &&
      Boolean(displayedDiff.baseSha) &&
      displayedDiff.headSha === selectedPullRequest?.headSha);
  const viewNow = useMemo(() => new Date(clockNow), [clockNow]);

  const visiblePullRequests = useMemo(() => {
    const viewed = filterForView(
      inboxData.pullRequests,
      activeView,
      viewNow,
    );
    const searched = searchPullRequests(viewed, query, viewNow);
    return sortForView(searched, activeView, sort, viewNow);
  }, [activeView, inboxData.pullRequests, query, sort, viewNow]);

  const selectView = useCallback((view: ViewId) => {
    setActiveView(view);
    setSort(
      view === "all" || view === "recently-updated"
        ? "recent"
        : "attention",
    );
  }, []);

  const refreshInbox = useCallback(async () => {
    if (usingDemo || !connection.connected) {
      setInboxData({
        ...initialDemoInbox,
        syncedAt: new Date().toISOString(),
      });
      setWarning(null);
      setToast("Demo data refreshed");
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      const next = await gateway().getInbox();
      setInboxData(next);
      setWarning(next.warnings?.[0] ?? null);
      setSelectedId((current) =>
        next.pullRequests.some((pullRequest) => pullRequest.id === current)
          ? current
          : (next.pullRequests[0]?.id ?? ""),
      );
    } catch (nextError) {
      setError(messageFrom(nextError));
    } finally {
      setSyncing(false);
    }
  }, [connection.connected, initialDemoInbox, usingDemo]);

  useEffect(() => {
    const tick = () => setClockNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    withTimeout(gateway().connectionStatus())
      .then(async (status) => {
        if (cancelled) return;
        setConnection(status);
        setConnectionChecked(true);
        if (status.connected) {
          setWarning(null);
          setInboxData({
            pullRequests: [],
            rateLimit: null,
            syncedAt: new Date().toISOString(),
            viewer: status.viewer ?? {
              avatarUrl: null,
              login: "",
              name: null,
            },
          });
          setSelectedId("");
          setUsingDemo(false);
          setSyncing(true);
          setLaunchView("workspace");
          try {
            const liveInbox = await gateway().getInbox();
            if (cancelled) return;
            setInboxData(liveInbox);
            setWarning(liveInbox.warnings?.[0] ?? null);
            setSelectedId(liveInbox.pullRequests[0]?.id ?? "");
            setError(null);
          } catch (nextError) {
            if (!cancelled) setError(messageFrom(nextError));
          } finally {
            if (!cancelled) {
              setSyncing(false);
            }
          }
        } else {
          setLaunchView("login");
        }
      })
      .catch(() => {
        // Preview mode remains available when the local API is absent or slow.
        if (!cancelled) {
          setConnectionChecked(true);
          setLaunchView("login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPullRequest || usingDemo) return;

    const [owner, repository] = selectedPullRequest.repository.split("/");
    if (!owner || !repository) return;
    const controller = new AbortController();
    const pullRequestId = selectedPullRequest.id;
    const inboxSyncedAt = inboxData.syncedAt;
    gateway()
      .getPullDiff({
        number: selectedPullRequest.number,
        owner,
        repository,
      }, controller.signal)
      .then((nextDiff) => {
        if (!controller.signal.aborted) {
          setLiveDiffState({ diff: nextDiff, inboxSyncedAt, pullRequestId });
        }
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) {
          setError(messageFrom(nextError));
          setLiveDiffState({
            diff: {
              ...EMPTY_DIFF,
              headSha: selectedPullRequest.headSha,
              truncated: true,
            },
            inboxSyncedAt,
            pullRequestId,
          });
        }
      });
    return () => controller.abort();
  }, [inboxData.syncedAt, selectedPullRequest, usingDemo]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (leftColumnsCollapsed) {
          setLeftColumnsCollapsed(false);
          window.requestAnimationFrame(() => searchRef.current?.focus());
        } else {
          searchRef.current?.focus();
        }
        return;
      }

      if (event.key === "Escape") {
        if (reviewOpen) {
          event.preventDefault();
          setReviewOpen(false);
          return;
        }
        if (connectionDialog) {
          event.preventDefault();
          setConnectionDialog(false);
          return;
        }
      }
      if (editing || reviewOpen || connectionDialog) return;

      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const currentIndex = visiblePullRequests.findIndex(
          (pullRequest) => pullRequest.id === selectedId,
        );
        const direction = event.key === "j" ? 1 : -1;
        const nextIndex = Math.min(
          Math.max(currentIndex + direction, 0),
          visiblePullRequests.length - 1,
        );
        const next = visiblePullRequests[nextIndex];
        if (next) setSelectedId(next.id);
      }

      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const currentIndex = viewDefinitions.findIndex(
          (view) => view.id === activeView,
        );
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (currentIndex + direction + viewDefinitions.length) %
          viewDefinitions.length;
        selectView(viewDefinitions[nextIndex].id);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeView,
    connectionDialog,
    leftColumnsCollapsed,
    reviewOpen,
    selectView,
    selectedId,
    visiblePullRequests,
  ]);

  useEffect(() => {
    const selectedRow = listRef.current?.querySelector<HTMLElement>(
      '.pr-row[aria-selected="true"]',
    );
    selectedRow?.scrollIntoView({ block: "nearest" });
  }, [selectedId, visiblePullRequests]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function startConnection() {
    if (!connectionChecked) return;
    if (!connection.configured) {
      setConnectionDialog(true);
      return;
    }
    beginWebConnection();
  }

  async function disconnect() {
    setError(null);
    setToast(null);
    setLaunchView("checking");
    try {
      await withTimeout(gateway().disconnect());
      const nextConnection = await withTimeout(gateway().connectionStatus());
      if (nextConnection.connected) {
        throw new Error("GitHub is still connected. Try disconnecting again.");
      }
      setConnection(nextConnection);
      setUsingDemo(false);
      // Demo pull requests must not load here: the workspace would treat them
      // as live and request their diffs against a session that is now gone.
      setInboxData(EMPTY_INBOX);
      setWarning(null);
      setSelectedId("");
      setLiveDiffState({
        diff: EMPTY_DIFF,
        inboxSyncedAt: "",
        pullRequestId: "",
      });
      setConnectionDialog(false);
      setLaunchView("login");
    } catch (nextError) {
      setError(messageFrom(nextError));
      setLaunchView("workspace");
    }
  }

  function enterPreview() {
    setError(null);
    setUsingDemo(true);
    setInboxData(initialDemoInbox);
    setWarning(null);
    setSelectedId(initialDemoInbox.pullRequests[0]?.id ?? "");
    setLaunchView("workspace");
  }

  async function openSelectedInGitHub() {
    if (!selectedPullRequest) return;
    try {
      await gateway().openExternal(selectedPullRequest.url);
    } catch (nextError) {
      setError(messageFrom(nextError));
    }
  }

  async function submitReview(event: ReviewEvent, body: string) {
    if (!selectedPullRequest) return;
    if (usingDemo) {
      setInboxData((current) => ({
        ...current,
        pullRequests: current.pullRequests.map((pullRequest) =>
          pullRequest.id === selectedPullRequest.id
            ? {
                ...pullRequest,
                reviewDecision:
                  event === "REQUEST_CHANGES"
                    ? "CHANGES_REQUESTED"
                    : pullRequest.reviewDecision,
                viewerRelationship: "PARTICIPATING",
                viewerReviewState:
                  event === "APPROVE"
                    ? "APPROVED"
                    : event === "REQUEST_CHANGES"
                      ? "CHANGES_REQUESTED"
                      : "COMMENTED",
              }
            : pullRequest,
        ),
      }));
      setReviewOpen(false);
      setToast(`${reviewEventLabel(event)} recorded in demo mode`);
      return;
    }

    if (
      !reviewReady ||
      displayedDiff.headSha !== selectedPullRequest.headSha ||
      !displayedDiff.baseSha
    ) {
      throw new Error(
        "The current comparison is still loading or changed. Review it again before submitting.",
      );
    }

    const [owner, repository] = selectedPullRequest.repository.split("/");
    await gateway().submitReview({
      baseCommitId: displayedDiff.baseSha,
      body,
      commitId: displayedDiff.headSha,
      event,
      number: selectedPullRequest.number,
      owner,
      repository,
    });
    setReviewOpen(false);
    setToast(`${reviewEventLabel(event)} submitted to GitHub`);
    await refreshInbox();
  }

  const currentView =
    viewDefinitions.find((view) => view.id === activeView) ??
    viewDefinitions[0];

  if (launchView !== "workspace") {
    return (
      <main className="app-shell launch-shell">
        <WindowBar
          onThemeChange={setThemePreference}
          themePreference={themePreference}
        />

        {launchView === "checking" ? (
          <LaunchChecking />
        ) : (
          <LaunchLogin
            checking={!connectionChecked}
            configured={connection.configured}
            error={error}
            onEnterPreview={enterPreview}
            onSignIn={() => void startConnection()}
          />
        )}

        {launchView === "login" && connectionDialog && (
          <ConnectionDialog
            configured={connection.configured}
            onClose={() => setConnectionDialog(false)}
            onStart={() => void startConnection()}
          />
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <WindowBar
        onThemeChange={setThemePreference}
        showSearchShortcut
        themePreference={themePreference}
      />

      <div
        className="app-grid"
        data-left-columns-collapsed={leftColumnsCollapsed}
      >
        <aside
          className="sidebar"
          hidden={leftColumnsCollapsed}
          id="workspace-navigation"
        >
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              H
            </span>
            <span>
              <strong>Hype</strong>
              <small>Pull request pulse</small>
            </span>
          </div>

          <div className="sidebar-section-label">Action</div>
          <nav className="view-nav" aria-label="Pull request views">
            {viewDefinitions.slice(0, 7).map((view) => (
              <ViewButton
                key={view.id}
                active={activeView === view.id}
                count={countForView(
                  inboxData.pullRequests,
                  view.id,
                  viewNow,
                )}
                icon={viewIcon(view.id)}
                label={view.shortLabel}
                onClick={() => selectView(view.id)}
              />
            ))}
          </nav>

          <div className="sidebar-section-label">Browse</div>
          <nav className="view-nav" aria-label="Browse pull requests">
            {viewDefinitions.slice(7).map((view) => (
              <ViewButton
                key={view.id}
                active={activeView === view.id}
                count={countForView(
                  inboxData.pullRequests,
                  view.id,
                  viewNow,
                )}
                icon={viewIcon(view.id)}
                label={view.shortLabel}
                onClick={() => selectView(view.id)}
              />
            ))}
          </nav>

          <div className="sidebar-spacer" />
          <div className="policy-note">
            <ShieldCheck aria-hidden="true" size={16} />
            <p>
              Hype is another GitHub client. Organization and managed-device
              policies still apply.
            </p>
          </div>
          {!connection.connected && (
            <button
              aria-label="Connect an approved GitHub App for your live queue"
              className="connect-banner"
              onClick={() => void startConnection()}
              title="Connect GitHub"
              type="button"
            >
              <span className="live-dot" />
              <span>
                <strong>Connect GitHub</strong>
                Demo mode · Use an approved GitHub App for your live queue
              </span>
              <ArrowUpRight aria-hidden="true" size={16} />
            </button>
          )}
          <div className="account-card">
            <Avatar
              avatarUrl={
                connection.connected ? connection.viewer?.avatarUrl : null
              }
              login={
                connection.connected
                  ? (connection.viewer?.login ?? "github")
                  : "demo"
              }
            />
            <span>
              <strong>
                {connection.connected
                  ? (connection.viewer?.login ?? "GitHub")
                  : "Demo workspace"}
              </strong>
              <small>
                {connection.connected ? "GitHub App" : "Synthetic data"}
              </small>
            </span>
            <button
              aria-label="Account actions"
              className="icon-button"
              onClick={
                connection.connected
                  ? disconnect
                  : () => void startConnection()
              }
              title={connection.connected ? "Disconnect GitHub" : "Connect GitHub"}
              type="button"
            >
              {connection.connected ? (
                <X aria-hidden="true" size={15} />
              ) : (
                <MoreHorizontal aria-hidden="true" size={16} />
              )}
            </button>
          </div>
        </aside>

        <section
          aria-label="Pull request queue"
          className="queue-pane"
          hidden={leftColumnsCollapsed}
          id="pull-request-queue"
        >
          <div className="queue-header">
            <div>
              <span className="eyebrow">
                {activeView === "needs-attention"
                  ? "Your action queue"
                  : "Pull request view"}
              </span>
              <h1>{currentView.label}</h1>
              <p>{currentView.description}</p>
            </div>
            <button
              aria-label="Refresh pull requests"
              className="refresh-button"
              disabled={syncing}
              onClick={() => void refreshInbox()}
              title="Refresh"
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={syncing ? "spin" : ""}
                size={16}
              />
            </button>
          </div>

          <div className="queue-controls">
            <label className="queue-search">
              <Search aria-hidden="true" size={15} />
              <span className="sr-only">Search pull requests</span>
              <input
                ref={searchRef}
                placeholder="Search title, repo, author, reason…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>⌘K</kbd>
            </label>
            <label className="sort-select">
              <ListFilter aria-hidden="true" size={14} />
              <span className="sr-only">Sort pull requests</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortId)}
              >
                <option value="attention">Action priority</option>
                <option value="recent">Recently active</option>
                <option value="oldest">Oldest created</option>
                <option value="updated">Last updated</option>
              </select>
              <ChevronDown aria-hidden="true" size={13} />
            </label>
          </div>

          <div className="queue-status-line">
            <span>
              {visiblePullRequests.length} pull request
              {visiblePullRequests.length === 1 ? "" : "s"}
            </span>
            <span>
              Last synced {relativeTime(inboxData.syncedAt, clockNow)}
              {usingDemo ? " · demo" : ""}
            </span>
          </div>

          {error && (
            <div className="inline-error" role="alert">
              <WifiOff aria-hidden="true" size={15} />
              <span>{error}</span>
              <button onClick={() => setError(null)} type="button">
                Dismiss
              </button>
            </div>
          )}
          {warning && (
            <div className="inline-warning" role="status">
              <TriangleAlert aria-hidden="true" size={15} />
              <span>{warning}</span>
              <button onClick={() => setWarning(null)} type="button">
                Dismiss
              </button>
            </div>
          )}

          <div
            className="pr-list"
            ref={listRef}
            role="listbox"
            aria-label={currentView.label}
          >
            {visiblePullRequests.length > 0 ? (
              visiblePullRequests.map((pullRequest, index) => {
                const group = groupLabel(pullRequest, activeView);
                const previousGroup =
                  index > 0
                    ? groupLabel(visiblePullRequests[index - 1], activeView)
                    : null;
                return (
                  <Fragment key={pullRequest.id}>
                    {group && group !== previousGroup && (
                      <div className="list-group-header">
                        <span>{group}</span>
                        <span>
                          {
                            visiblePullRequests.filter(
                              (candidate) =>
                                groupLabel(candidate, activeView) === group,
                            ).length
                          }
                        </span>
                      </div>
                    )}
                    <PullRequestRow
                      active={selectedPullRequest?.id === pullRequest.id}
                      now={viewNow}
                      onClick={() => setSelectedId(pullRequest.id)}
                      pullRequest={pullRequest}
                    />
                  </Fragment>
                );
              })
            ) : (
              <div className="empty-queue">
                <CheckCircle2 aria-hidden="true" size={28} />
                <strong>Nothing in this view</strong>
                <p>
                  {query
                    ? "Try a broader search."
                    : "You are clear for now. Another view may have context."}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="detail-pane" aria-label="Pull request detail">
          <PanelVisibilityToggle
            collapsed={leftColumnsCollapsed}
            controls={
              selectedPullRequest
                ? "workspace-navigation pull-request-queue changed-files"
                : "workspace-navigation pull-request-queue"
            }
            onToggle={() =>
              setLeftColumnsCollapsed((collapsed) => !collapsed)
            }
          />
          {selectedPullRequest ? (
            <>
              <PullRequestHeader
                now={viewNow}
                onOpenInGitHub={() => void openSelectedInGitHub()}
                onReview={() => setReviewOpen(true)}
                pullRequest={selectedPullRequest}
                reviewReady={reviewReady}
                usingDemo={usingDemo}
              />
              <DiffWorkspace
                key={selectedPullRequest.id}
                diff={displayedDiff}
                fileBrowserCollapsed={leftColumnsCollapsed}
                layout={diffLayout}
                loading={diffLoading}
                onLayoutChange={setDiffLayout}
                onOpenInGitHub={() => void openSelectedInGitHub()}
                themePreference={themePreference ?? "system"}
              />
            </>
          ) : (
            <div className="empty-detail">
              <GitPullRequest aria-hidden="true" size={32} />
              <strong>Select a pull request</strong>
            </div>
          )}
        </section>
      </div>

      {connectionDialog && (
        <ConnectionDialog
          configured={connection.configured}
          onClose={() => setConnectionDialog(false)}
          onStart={() => void startConnection()}
        />
      )}

      {reviewOpen && selectedPullRequest && (
        <ReviewDialog
          onClose={() => setReviewOpen(false)}
          onSubmit={submitReview}
          pullRequest={selectedPullRequest}
          usingDemo={usingDemo}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <Check aria-hidden="true" size={15} />
          {toast}
        </div>
      )}
    </main>
  );
}

function WindowBar({
  onThemeChange,
  showSearchShortcut = false,
  themePreference,
}: {
  onThemeChange(preference: ThemePreference): void;
  showSearchShortcut?: boolean;
  themePreference: ThemePreference | null;
}) {
  return (
    <header className="window-bar">
      <div className="traffic-light-space" aria-hidden="true" />
      <div className="window-title">
        <span className="window-title-dot" />
        <span>Hype PRs</span>
      </div>
      <div className="window-actions">
        {showSearchShortcut && (
          <span className="window-shortcut">⌘K search</span>
        )}
        <ThemeToggle
          onChange={onThemeChange}
          preference={themePreference}
        />
      </div>
    </header>
  );
}

function PanelVisibilityToggle({
  collapsed,
  controls,
  onToggle,
}: {
  collapsed: boolean;
  controls: string;
  onToggle(): void;
}) {
  const action = collapsed ? "Expand" : "Collapse";

  return (
    <button
      aria-controls={controls}
      aria-expanded={!collapsed}
      aria-label={`${action} panels`}
      className="panel-visibility-toggle"
      onClick={onToggle}
      title={`${action} panels`}
      type="button"
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden="true" size={16} />
      ) : (
        <PanelLeftClose aria-hidden="true" size={16} />
      )}
    </button>
  );
}

function LaunchChecking() {
  return (
    <section className="launch-stage" aria-labelledby="launch-checking-title">
      <div className="launch-glow" aria-hidden="true" />
      <div className="launch-card launch-checking" role="status">
        <div className="launch-brand" aria-hidden="true">
          H
        </div>
        <LoaderCircle aria-hidden="true" className="spin" size={22} />
        <h1 id="launch-checking-title">Restoring your session…</h1>
      </div>
    </section>
  );
}

const MARKETING_FEATURES = [
  {
    body: "Open with the pull requests that need you now, ordered by obligation — review requests, failing checks, conflicts, and work ready to ship.",
    icon: Inbox,
    title: "Action-first inbox",
  },
  {
    body: "Every row carries a reason chip, a plain-language explanation, and a timestamp. No mystery about why a pull request is where it is.",
    icon: Zap,
    title: "Explainable ranking",
  },
  {
    body: "A directory-first file tree, path filtering, and virtualized split or unified diffs — all in one surface, without leaving the queue.",
    icon: Layers,
    title: "Files and diffs in place",
  },
  {
    body: "Comment, approve, or request changes with a summary. Hype re-checks the exact commits before it submits, so reviews land safe.",
    icon: GitPullRequest,
    title: "Formal reviews",
  },
  {
    body: "Skip the mouse. J/K to move, Option+Arrow to switch views, and Command or Control+K to jump to search.",
    icon: Activity,
    title: "Keyboard-first",
  },
  {
    body: "Works in the browser. Credentials stay encrypted on the server, and Hype never bypasses your organization policy.",
    icon: ShieldCheck,
    title: "Private by design",
  },
] as const;

const MARKETING_FAQ = [
  {
    answer:
      "Hype is an action-first pull request inbox. Instead of an alphabetical repository list, it shows a queue of the pull requests that need you, explains why each one does, and lets you open the files, read the diff, and submit a review without switching tools.",
    question: "What exactly is Hype?",
  },
  {
    answer:
      "Connect with GitHub and Hype finds your open pull requests from four angles: ones you authored, ones assigned to you, ones requesting your review, and ones you have reviewed. It deduplicates the results into a single queue.",
    question: "Where do the pull requests in my inbox come from?",
  },
  {
    answer:
      "Hype connects through an approved GitHub App, not a personal access token. Requested access is read-focused — pull requests, metadata, checks, and review submission — and your normal organization approval, SSO, and repository permissions still apply.",
    question: "What does Hype need access to do?",
  },
  {
    answer:
      "Preview mode loads a full workspace with synthetic pull requests and diffs. You can explore every view, search, read diffs, and practice submitting reviews without any GitHub account. Reviews in preview mode change the local demo only.",
    question: "Do I need a GitHub account to explore it now?",
  },
  {
    answer:
      "A selected diff is accepted only while its base and head revisions stay stable. When a diff is oversized, binary, too many files, or cannot be parsed safely, Hype shows a clear degraded state with an Open in GitHub fallback instead of a blank pane.",
    question: "How does Hype handle large or unusual diffs?",
  },
  {
    answer:
      "Not in this release. The MVP focuses on read-focused triage and pull-request-level review. Line-level suggestions, local snooze or pinning, background sync, and merge or close mutations are on the roadmap but are not part of the current scope.",
    question: "What is not included yet?",
  },
] as const;

function LaunchLogin({
  checking,
  configured,
  error,
  onEnterPreview,
  onSignIn,
}: {
  checking: boolean;
  configured: boolean;
  error: string | null;
  onEnterPreview(): void;
  onSignIn(): void;
}) {
  return (
    <div className="launch-stage">
      <div className="launch-glow" aria-hidden="true" />
      <div className="marketing">
        <section className="marketing-hero" aria-labelledby="launch-title">
          <div className="marketing-copy">
            <div className="launch-brand" aria-hidden="true">
              H
            </div>
            <span className="eyebrow">Your pull request pulse</span>
            <h1 id="launch-title">See what needs you now.</h1>
            <p>
              Hype turns your GitHub pull requests — across every repository —
              into one action-first queue. It explains why each one needs
              attention, opens the files and diff for you, and lets you submit a
              formal review without leaving the app.
            </p>

            {error && (
              <div className="launch-error" role="alert">
                <WifiOff aria-hidden="true" size={15} />
                <span>{error}</span>
              </div>
            )}

            <div className="hero-actions">
              <button
                aria-busy={checking}
                className="primary-button launch-sign-in"
                disabled={checking}
                onClick={onSignIn}
                type="button"
              >
                {checking ? (
                  <LoaderCircle aria-hidden="true" className="spin" size={16} />
                ) : (
                  <LockKeyhole aria-hidden="true" size={16} />
                )}
                Continue with GitHub
                {!checking && <ArrowUpRight aria-hidden="true" size={15} />}
              </button>
              <button
                className="secondary-button"
                onClick={onEnterPreview}
                type="button"
              >
                <Code2 aria-hidden="true" size={15} />
                Explore preview mode
              </button>
            </div>

            <p className="hero-sub">
              No account needed to look around · Works in your browser · Never
              bypasses your organization policy
            </p>
          </div>

          <div className="marketing-mock" aria-hidden="true">
            <div className="mock-window">
              <div className="mock-bar">
                <span className="mock-dot red" />
                <span className="mock-dot amber" />
                <span className="mock-dot green" />
                <span className="mock-title">Hype — action queue</span>
              </div>
              <div className="mock-body">
                <div className="mock-eyebrow">Your action queue</div>
                <div className="mock-row mock-row-focus">
                  <span className="mock-repo">acme/console</span>
                  <span>
                    <strong>Keyboard review queue</strong>
                    <small>
                      Review requested 18h ago ·
                      <span className="mock-tag request">review requested</span>
                    </small>
                  </span>
                </div>
                <div className="mock-row">
                  <span className="mock-repo">acme/api</span>
                  <span>
                    <strong>Guard webhook retries</strong>
                    <small>
                      Checks failing 3h ago ·
                      <span className="mock-tag failed">ci failing</span>
                    </small>
                  </span>
                </div>
                <div className="mock-row">
                  <span className="mock-repo">acme/design-system</span>
                  <span>
                    <strong>Status badge contrast</strong>
                    <small>
                      Team review requested 45h ago ·
                      <span className="mock-tag approved">approved</span>
                    </small>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-section" aria-labelledby="marketing-features-title">
          <div className="marketing-head">
            <span className="eyebrow">Why Hype</span>
            <h2 id="marketing-features-title">
              Built around the moment you triage
            </h2>
            <p>
              One surface for the whole review loop — from noticing the
              pull request to reading the change to submitting a decision.
            </p>
          </div>
          <div className="feature-grid">
            {MARKETING_FEATURES.map((feature) => (
              <div className="feature-card" key={feature.title}>
                <span className="feature-icon">
                  <feature.icon aria-hidden="true" size={18} />
                </span>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="marketing-section" aria-labelledby="marketing-faq-title">
          <div className="marketing-head">
            <span className="eyebrow">Good to know</span>
            <h2 id="marketing-faq-title">Frequently asked questions</h2>
            <p>The short answers to the things people ask first.</p>
          </div>
          <div className="faq-list">
            {MARKETING_FAQ.map((item) => (
              <details className="faq-item" key={item.question}>
                <summary>
                  <span>{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="faq-chevron"
                    size={16}
                  />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="marketing-cta" aria-labelledby="marketing-cta-title">
          <div>
            <h2 id="marketing-cta-title">Ready when you are</h2>
            <p>
              Connect GitHub for your live queue, or explore preview mode to see
              the full interface right now.
            </p>
          </div>
          <div className="hero-actions">
            <button
              className="primary-button"
              disabled={checking}
              onClick={onSignIn}
              type="button"
            >
              {checking ? (
                <LoaderCircle aria-hidden="true" className="spin" size={16} />
              ) : (
                <LockKeyhole aria-hidden="true" size={16} />
              )}
              Continue with GitHub
            </button>
            <button
              className="secondary-button"
              onClick={onEnterPreview}
              type="button"
            >
              <Code2 aria-hidden="true" size={15} />
              Open preview mode
            </button>
          </div>
          <p className="hero-sub">
            {checking
              ? "Checking your session…"
              : configured
                ? "Live sign-in is ready."
                : "Live sign-in is not configured in this preview build."}
          </p>
        </section>

        <footer className="marketing-footer">
          <span>
            <ShieldCheck aria-hidden="true" size={14} />
            Hype is another GitHub client. Organization approvals, SSO, and
            managed-device policies still apply.
          </span>
        </footer>
      </div>
    </div>
  );
}

function PullRequestRow({
  active,
  now,
  onClick,
  pullRequest,
}: {
  active: boolean;
  now: Date;
  onClick(): void;
  pullRequest: PullRequestSummary;
}) {
  const reason = dominantReason(pullRequest, now);
  return (
    <button
      aria-selected={active}
      className="pr-row"
      data-active={active}
      onClick={onClick}
      role="option"
      type="button"
    >
      <div className="pr-row-topline">
        <span className="repo-name">{pullRequest.repository}</span>
        <span>#{pullRequest.number}</span>
        <span className={`reason-chip ${reason.tone}`}>{reason.label}</span>
      </div>
      <strong className="pr-title">{pullRequest.title}</strong>
      <div className="reason-line">
        {reasonIcon(reason.code)}
        <span>{reason.explanation}</span>
        <time dateTime={reason.timestamp}>
          {relativeTime(reason.timestamp, now.getTime())}
        </time>
      </div>
      <div className="pr-row-footer">
        <span className="author">
          <Avatar
            avatarUrl={pullRequest.author.avatarUrl}
            login={pullRequest.author.login}
            small
          />
          {pullRequest.author.login}
        </span>
        <StatusSummary pullRequest={pullRequest} />
        <span className="diff-stat">
          <span className="addition">+{pullRequest.additions}</span>
          <span className="deletion">−{pullRequest.deletions}</span>
        </span>
      </div>
    </button>
  );
}

function PullRequestHeader({
  now,
  onOpenInGitHub,
  onReview,
  pullRequest,
  reviewReady,
  usingDemo,
}: {
  now: Date;
  onOpenInGitHub(): void;
  onReview(): void;
  pullRequest: PullRequestSummary;
  reviewReady: boolean;
  usingDemo: boolean;
}) {
  return (
    <header className="detail-header">
      <div className="detail-breadcrumb">
        <span>{pullRequest.repository}</span>
        <span>/</span>
        <span>pull</span>
        <span>/</span>
        <strong>{pullRequest.number}</strong>
      </div>
      <div className="detail-heading">
        <div>
          <h2>{pullRequest.title}</h2>
          <div className="detail-byline">
            <Avatar
              avatarUrl={pullRequest.author.avatarUrl}
              login={pullRequest.author.login}
              small
            />
            <strong>{pullRequest.author.login}</strong>
            <span>
              opened {relativeTime(pullRequest.createdAt, now.getTime())}
            </span>
            <span>·</span>
            <GitBranch aria-hidden="true" size={13} />
            <code>{pullRequest.headRefName}</code>
            <span>→</span>
            <code>{pullRequest.baseRefName}</code>
          </div>
        </div>
        <div className="detail-actions">
          <button
            className="secondary-button compact"
            onClick={onOpenInGitHub}
            type="button"
          >
            <ExternalLink aria-hidden="true" size={14} />
            GitHub
          </button>
          <button
            className="primary-button compact"
            disabled={!reviewReady}
            onClick={onReview}
            title={
              reviewReady
                ? "Review this pull request"
                : "Wait for the current comparison to finish loading"
            }
            type="button"
          >
            <MessageSquare aria-hidden="true" size={14} />
            Review
          </button>
        </div>
      </div>
      <div className="detail-meta">
        <StatusPill pullRequest={pullRequest} />
        <span className="meta-pill">
          <FileCode2 aria-hidden="true" size={13} />
          {pullRequest.changedFiles} files
        </span>
        <span className="meta-pill">
          <MessageSquare aria-hidden="true" size={13} />
          {pullRequest.commentCount}
        </span>
        <span className="meta-pill additions">
          +{pullRequest.additions}
        </span>
        <span className="meta-pill deletions">
          −{pullRequest.deletions}
        </span>
        {pullRequest.labels.map((label) => (
          <span className="label-pill" key={label}>
            {label}
          </span>
        ))}
        {usingDemo && <span className="demo-pill">SYNTHETIC</span>}
      </div>
    </header>
  );
}

function ConnectionDialog({
  configured,
  onClose,
  onStart,
}: {
  configured: boolean;
  onClose(): void;
  onStart(): void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="connection-title"
        aria-modal="true"
        className="modal-card connection-modal"
        role="dialog"
      >
        <button
          aria-label="Close connection dialog"
          className="modal-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
        <div className="modal-icon">
          <LockKeyhole aria-hidden="true" size={24} />
        </div>
        <span className="eyebrow">Secure connection</span>
        <h2 id="connection-title">Connect your approved GitHub account</h2>

        {!configured ? (
          <>
            <p>
              Live GitHub authorization is not configured in this preview
              build. The complete interface remains available with synthetic
              data.
            </p>
            <div className="configuration-callout">
              <Code2 aria-hidden="true" size={18} />
              <span>
                Configure the GitHub App client for the web host. No personal
                access token is accepted by the UI.
              </span>
            </div>
          </>
        ) : (
          <>
            <p>
              Hype uses a GitHub App, so access remains limited by your account,
              App installation, organization approval, and SSO policy.
            </p>
            <ul className="permission-list">
              <li>
                <Check aria-hidden="true" size={15} />
                Pull requests: read and review
              </li>
              <li>
                <Check aria-hidden="true" size={15} />
                Checks and commit statuses: read
              </li>
              <li>
                <X aria-hidden="true" size={15} />
                No source writes, merges, or workflow control
              </li>
            </ul>
            <button className="primary-button" onClick={onStart} type="button">
              Continue with GitHub
              <ArrowUpRight aria-hidden="true" size={15} />
            </button>
          </>
        )}

        <p className="modal-policy">
          This app does not bypass employer device or application policy. Your
          organization may require an administrator to approve it.
        </p>
      </section>
    </div>
  );
}

function ReviewDialog({
  onClose,
  onSubmit,
  pullRequest,
  usingDemo,
}: {
  onClose(): void;
  onSubmit(event: ReviewEvent, body: string): Promise<void>;
  pullRequest: PullRequestSummary;
  usingDemo: boolean;
}) {
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requiresBody = event !== "APPROVE";
  const valid = !requiresBody || Boolean(body.trim());

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(event, body);
    } catch (nextError) {
      setSubmitError(messageFrom(nextError));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop review-backdrop" role="presentation">
      <section
        aria-labelledby="review-title"
        aria-modal="true"
        className="modal-card review-modal"
        role="dialog"
      >
        <button
          aria-label="Close review"
          className="modal-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
        <span className="eyebrow">{pullRequest.repository}</span>
        <h2 id="review-title">Review #{pullRequest.number}</h2>
        <p className="review-title-copy">{pullRequest.title}</p>

        <div className="review-options" role="radiogroup" aria-label="Review action">
          {(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as ReviewEvent[]).map(
            (option) => (
              <button
                aria-checked={event === option}
                className="review-option"
                data-active={event === option}
                key={option}
                onClick={() => {
                  setEvent(option);
                  setConfirming(false);
                }}
                role="radio"
                type="button"
              >
                {reviewOptionIcon(option)}
                <span>
                  <strong>{reviewEventLabel(option)}</strong>
                  <small>{reviewEventDescription(option)}</small>
                </span>
              </button>
            ),
          )}
        </div>

        <label className="review-body">
          <span>
            Review summary
            {requiresBody ? <strong>Required</strong> : <small>Optional</small>}
          </span>
          <textarea
            autoFocus
            placeholder={
              event === "REQUEST_CHANGES"
                ? "Explain what needs to change…"
                : "Leave a clear review summary…"
            }
            value={body}
            onChange={(inputEvent) => {
              setBody(inputEvent.target.value);
              setConfirming(false);
            }}
          />
        </label>

        {submitError && (
          <div className="inline-error review-error" role="alert">
            <TriangleAlert aria-hidden="true" size={15} />
            <span>{submitError}</span>
          </div>
        )}

        {confirming && (
          <div className="review-confirmation">
            <CircleAlert aria-hidden="true" size={18} />
            <span>
              <strong>Ready to submit {reviewEventLabel(event)}?</strong>
              {usingDemo
                ? "This changes the local demo only."
                : "GitHub will notify pull request participants."}
            </span>
          </div>
        )}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          {confirming ? (
            <button
              className="primary-button"
              disabled={submitting}
              onClick={() => void submit()}
              type="button"
            >
              {submitting && (
                <LoaderCircle aria-hidden="true" className="spin" size={15} />
              )}
              Submit {reviewEventLabel(event)}
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={!valid}
              onClick={() => setConfirming(true)}
              type="button"
            >
              Preview submission
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ViewButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-label={`${label}, ${count}`}
      aria-current={active ? "page" : undefined}
      className="view-button"
      data-active={active}
      onClick={onClick}
      title={`${label} (${count})`}
      type="button"
    >
      {icon}
      <span>{label}</span>
      <span className="view-count">{count}</span>
    </button>
  );
}

function Avatar({
  avatarUrl,
  login,
  small = false,
}: {
  avatarUrl?: string | null;
  login: string;
  small?: boolean;
}) {
  const initials = login
    .split(/[-_.]/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className="avatar"
      data-has-image={Boolean(avatarUrl)}
      data-small={small}
      aria-hidden="true"
      style={
        avatarUrl
          ? { backgroundImage: `url(${JSON.stringify(avatarUrl)})` }
          : undefined
      }
    >
      {initials || "?"}
    </span>
  );
}

function StatusSummary({ pullRequest }: { pullRequest: PullRequestSummary }) {
  if (pullRequest.checkState === "FAILURE") {
    return (
      <span className="status-summary failure">
        <XCircle aria-hidden="true" size={13} /> Checks failing
      </span>
    );
  }
  if (pullRequest.checkState === "PENDING") {
    return (
      <span className="status-summary pending">
        <Clock3 aria-hidden="true" size={13} /> Checks running
      </span>
    );
  }
  if (pullRequest.reviewDecision === "APPROVED") {
    return (
      <span className="status-summary success">
        <CheckCircle2 aria-hidden="true" size={13} /> Approved
      </span>
    );
  }
  return (
    <span className="status-summary neutral">
      <CircleDot aria-hidden="true" size={13} /> Review open
    </span>
  );
}

function StatusPill({ pullRequest }: { pullRequest: PullRequestSummary }) {
  if (pullRequest.isDraft) {
    return <span className="status-pill neutral">Draft</span>;
  }
  if (pullRequest.checkState === "FAILURE") {
    return (
      <span className="status-pill failure">
        <XCircle aria-hidden="true" size={13} /> Checks failing
      </span>
    );
  }
  if (pullRequest.reviewDecision === "APPROVED") {
    return (
      <span className="status-pill success">
        <CheckCircle2 aria-hidden="true" size={13} /> Approved
      </span>
    );
  }
  return (
    <span className="status-pill pending">
      <Clock3 aria-hidden="true" size={13} /> Review in progress
    </span>
  );
}

function viewIcon(view: ViewId) {
  const props = { "aria-hidden": true, size: 16, strokeWidth: 1.8 };
  switch (view) {
    case "needs-attention":
      return <Inbox {...props} />;
    case "review-requested":
      return <BellDot {...props} />;
    case "my-prs":
      return <GitPullRequest {...props} />;
    case "ci-failing":
      return <CircleAlert {...props} />;
    case "awaiting-response":
      return <Clock3 {...props} />;
    case "recently-updated":
      return <History {...props} />;
    case "stale":
      return <Archive {...props} />;
    case "repository":
      return <FolderGit2 {...props} />;
    case "author":
      return <Users {...props} />;
    case "all":
      return <Blocks {...props} />;
  }
}

function reasonIcon(code: ReturnType<typeof dominantReason>["code"]) {
  const props = { "aria-hidden": true, size: 13 };
  if (code === "ci-failed" || code === "merge-conflict") {
    return <CircleAlert {...props} />;
  }
  if (code === "ready") return <CheckCircle2 {...props} />;
  if (code === "review-requested" || code === "team-review") {
    return <BellDot {...props} />;
  }
  if (code === "updated" || code === "rereview") {
    return <Activity {...props} />;
  }
  return <Clock3 {...props} />;
}

function reviewOptionIcon(event: ReviewEvent) {
  if (event === "APPROVE") {
    return <CheckCircle2 aria-hidden="true" size={19} />;
  }
  if (event === "REQUEST_CHANGES") {
    return <XCircle aria-hidden="true" size={19} />;
  }
  return <MessageSquare aria-hidden="true" size={19} />;
}

function reviewEventLabel(event: ReviewEvent) {
  if (event === "APPROVE") return "Approve";
  if (event === "REQUEST_CHANGES") return "Request changes";
  return "Comment";
}

function reviewEventDescription(event: ReviewEvent) {
  if (event === "APPROVE") return "Looks good to merge";
  if (event === "REQUEST_CHANGES") return "Block until updates land";
  return "Feedback without a decision";
}

function relativeTime(value: string, now: number): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "just now";
  const difference = timestamp - now;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const absolute = Math.abs(difference);
  if (absolute < 60 * 60 * 1000) {
    return formatter.format(Math.round(difference / (60 * 1000)), "minute");
  }
  if (absolute < 24 * 60 * 60 * 1000) {
    return formatter.format(Math.round(difference / (60 * 60 * 1000)), "hour");
  }
  return formatter.format(
    Math.round(difference / (24 * 60 * 60 * 1000)),
    "day",
  );
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}

// A stalled request never settles on its own, so bound the calls that gate the
// launch screen. Without this the app can sit on the session check forever.
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = CONNECTION_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("The GitHub connection check timed out.")),
      timeoutMs,
    );
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}
