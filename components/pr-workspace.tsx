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
  ChevronLeft,
  CircleAlert,
  CircleDot,
  Clock3,
  Code2,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitFork,
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
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DiffLayout } from "./diff-workspace";
import { ThemeToggle, useThemePreference } from "./theme-toggle";
import { useAutoRefresh, useRefreshInterval } from "./use-refresh-interval";
import { createDemoInbox, demoDiffs } from "@/lib/demo-data";
import { GatewayError } from "@/lib/gateway-error";
import { beginWebConnection, gateway } from "@/lib/github-gateway";
import { buildMappedInbox, fetchInboxPage } from "@/lib/inbox-pages";
import type { InboxPage, InboxPageBucketPageInfoMap } from "@/lib/inbox-page-types";
import {
  clearInboxCache,
  readInboxCache,
  REFRESH_INTERVAL_OPTIONS,
  type RefreshIntervalId,
  writeInboxCache,
} from "@/lib/inbox-cache";
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

// The diff workspace pulls in Pierre Diffs and the Shiki highlighter, which is
// by far the heaviest thing the client loads. Nobody on the marketing or login
// screen needs it, so it stays out of the entry chunk until a pull request is
// actually selected.
const DiffWorkspace = lazy(async () => {
  const loaded = await import("./diff-workspace");
  return { default: loaded.DiffWorkspace };
});

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
    errorMessage?: string;
    pullRequestId: string;
    status: "loaded" | "error";
  }>({ diff: EMPTY_DIFF, pullRequestId: "", status: "loaded" });
  const [diffAttempt, setDiffAttempt] = useState(0);
  const [diffLayout, setDiffLayout] = useState<DiffLayout>("split");
  const [leftColumnsCollapsed, setLeftColumnsCollapsed] = useState(false);
  const [mobilePane, setMobilePane] = useState<"queue" | "detail">("queue");
  const [syncing, setSyncing] = useState(false);
  const [loadingFirstPage, setLoadingFirstPage] = useState(false);
  const [loadingSecondPage, setLoadingSecondPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connectionDialog, setConnectionDialog] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [themePreference, setThemePreference] = useThemePreference();
  const refreshInterval = useRefreshInterval();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // `inboxGenerationRef` is bumped on every fetch (refresh, auto-refresh, or
  // reconnect) so an in-flight response from a stale generation cannot write
  // into state after a newer request has started. The two pages are
  // sequential; the second page request reads the cursors that page 1
  // returned.
  const inboxGenerationRef = useRef(0);
  const inboxPagesRef = useRef<{
    pages: InboxPage[];
    cursors: InboxPageBucketPageInfoMap;
  }>({
    pages: [],
    cursors: {
      authored: { endCursor: null, hasNextPage: false },
      assigned: { endCursor: null, hasNextPage: false },
      reviewRequested: { endCursor: null, hasNextPage: false },
      reviewed: { endCursor: null, hasNextPage: false },
    },
  });

  const selectedFromInbox =
    inboxData.pullRequests.find(
      (pullRequest) => pullRequest.id === selectedId,
    ) ?? null;
  const selectedPullRequest =
    selectedFromInbox ?? inboxData.pullRequests[0] ?? null;
  // Latest live selection, readable from async work like `loadLiveInbox`
  // without going through a stale closure. Demo rows are never tracked: a
  // live refresh must not render a synthetic PR or fetch its diff against
  // the real API.
  const liveSelectionRef = useRef<PullRequestSummary | null>(null);
  useEffect(() => {
    liveSelectionRef.current = usingDemo ? null : selectedFromInbox;
  }, [selectedFromInbox, usingDemo]);
  // A live diff stays fresh as long as it belongs to the selected pull
  // request at its current head revision. The inbox `syncedAt` is
  // deliberately not part of this predicate: every refresh mints a new
  // timestamp (two for a two-page load) without changing any SHA, and the
  // server re-verifies the exact revisions at submit time anyway.
  const liveDiffFresh =
    !usingDemo &&
    Boolean(selectedPullRequest) &&
    liveDiffState.pullRequestId === selectedPullRequest?.id &&
    liveDiffState.diff.headSha === selectedPullRequest?.headSha;
  const diffLoadFailed = liveDiffFresh && liveDiffState.status === "error";
  const displayedDiff = usingDemo
    ? (demoDiffs[selectedPullRequest?.id ?? ""] ?? EMPTY_DIFF)
    : liveDiffFresh && liveDiffState.status === "loaded"
      ? liveDiffState.diff
      : EMPTY_DIFF;
  const diffLoading =
    !usingDemo && Boolean(selectedPullRequest) && !liveDiffFresh;
  const reviewReady =
    usingDemo ||
    (Boolean(selectedPullRequest) &&
      !diffLoading &&
      !diffLoadFailed &&
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

  // A live call answered with `not_connected` means the GitHub session is
  // gone (expired, revoked, or disconnected in another tab). An error banner
  // over the stale workspace would imply the data is still live, so drop the
  // workspace and return to the login screen instead. The cached inbox stays
  // in localStorage: hydration is keyed by viewer login, so the same viewer
  // gets an instant queue after signing back in.
  const handleSessionLoss = useCallback((nextError: unknown): boolean => {
    if (
      !(nextError instanceof GatewayError) ||
      nextError.code !== "not_connected"
    ) {
      return false;
    }
    // Bump the generation so in-flight page fetches stop writing into state.
    inboxGenerationRef.current += 1;
    setConnection((current) => ({
      ...current,
      connected: false,
      expiresAt: null,
      viewer: null,
    }));
    setUsingDemo(false);
    setInboxData(EMPTY_INBOX);
    setWarning(null);
    setSelectedId("");
    setLiveDiffState({ diff: EMPTY_DIFF, pullRequestId: "", status: "loaded" });
    setSyncing(false);
    setLoadingFirstPage(false);
    setLoadingSecondPage(false);
    setReviewOpen(false);
    setError("Your GitHub session ended. Sign in again to continue.");
    setLaunchView("login");
    return true;
  }, []);

  // Persist only the fully merged payload. Persisting after page 1 would
  // write a partial inbox that the next launch could hydrate as if it were
  // complete; the user would see a plausible but silently short list of PRs
  // with no signal that anything is missing.
  function applyMergedInbox(
    mapped: InboxPayload,
    generation: number,
    options: { resetSelection: boolean },
  ) {
    if (inboxGenerationRef.current !== generation) return;
    writeInboxCache(window.localStorage, mapped);
    setInboxData(mapped);
    setWarning(mapped.warnings?.[0] ?? null);
    setSelectedId((current) => {
      if (mapped.pullRequests.some((pullRequest) => pullRequest.id === current)) {
        return current;
      }
      return options.resetSelection
        ? (mapped.pullRequests[0]?.id ?? "")
        : current;
    });
    setError(null);
  }

  // Sequential two-page fetch. Page 1 is required and unblocks the inbox
  // render. Page 2 only runs if any bucket from page 1 reported
  // `hasNextPage`; otherwise the merged payload equals page 1. The
  // `resetSelection` flag controls what happens on the final merge when the
  // current selection is no longer in the live data. Bootstrap sets it to
  // `true` so the user does not get stuck reading a PR that has been removed
  // from the live queue; auto-refresh sets it to `false` so the user is not
  // silently moved off the PR they are currently reading.
  async function loadLiveInbox(options: { resetSelection: boolean } = {
    resetSelection: false,
  }) {
    // The function only runs when the workspace is connected to a live
    // session. The connection state is read here for the *current* render:
    // a refresh button click that just set `connection.connected` may still
    // see the old value because state updates are async, but the early
    // return would skip the fetch. We rely on the call sites (refresh
    // button, auto-refresh tick, bootstrap effect) to only invoke us when a
    // live fetch is wanted.
    const generation = inboxGenerationRef.current + 1;
    inboxGenerationRef.current = generation;
    inboxPagesRef.current = {
      pages: [],
      cursors: {
        authored: { endCursor: null, hasNextPage: false },
        assigned: { endCursor: null, hasNextPage: false },
        reviewRequested: { endCursor: null, hasNextPage: false },
        reviewed: { endCursor: null, hasNextPage: false },
      },
    };
    setSyncing(true);
    setLoadingFirstPage(true);
    setLoadingSecondPage(false);
    setError(null);

    let firstPage: InboxPage | null = null;
    try {
      firstPage = (await fetchInboxPage({ page: 1 })).page;
    } catch (nextError) {
      if (inboxGenerationRef.current === generation) {
        if (handleSessionLoss(nextError)) return;
        setError(messageFrom(nextError));
        setSyncing(false);
        setLoadingFirstPage(false);
      }
      return;
    }
    if (inboxGenerationRef.current !== generation) return;
    inboxPagesRef.current.pages = [firstPage];
    inboxPagesRef.current.cursors = firstPage.pageInfo;
    const partialMerged = buildMappedInbox({ pages: [firstPage] });
    const anyHasNextPage = Object.values(firstPage.pageInfo).some(
      (info) => info?.hasNextPage,
    );
    if (partialMerged) {
      // While page 2 is still in flight, a selection that lives on page 2
      // would vanish from the partial list and the detail pane would snap to
      // the first page-1 row (fetching its diff) until the merge lands. Keep
      // the currently selected PR in the rendered list through that window;
      // the final merge replaces it with the authoritative row.
      const retained = liveSelectionRef.current;
      const withRetainedSelection =
        anyHasNextPage &&
        retained &&
        !partialMerged.pullRequests.some(
          (pullRequest) => pullRequest.id === retained.id,
        )
          ? {
              ...partialMerged,
              pullRequests: [...partialMerged.pullRequests, retained],
            }
          : partialMerged;
      setInboxData(withRetainedSelection);
      setWarning(partialMerged.warnings?.[0] ?? null);
    }
    setLoadingFirstPage(false);

    if (!anyHasNextPage) {
      if (partialMerged && options.resetSelection) {
        setSelectedId((current) =>
          partialMerged.pullRequests.some(
            (pullRequest) => pullRequest.id === current,
          )
            ? current
            : (partialMerged.pullRequests[0]?.id ?? ""),
        );
      }
      if (partialMerged) {
        writeInboxCache(window.localStorage, partialMerged);
        setError(null);
      }
      setSyncing(false);
      return;
    }

    setLoadingSecondPage(true);
    let secondPage: InboxPage | null = null;
    try {
      secondPage = (
        await fetchInboxPage({
          page: 2,
          cursors: firstPage.pageInfo,
        })
      ).page;
    } catch (nextError) {
      if (inboxGenerationRef.current === generation) {
        if (handleSessionLoss(nextError)) return;
        setError(messageFrom(nextError));
        setSyncing(false);
        setLoadingSecondPage(false);
      }
      return;
    }
    if (inboxGenerationRef.current !== generation) return;
    inboxPagesRef.current.pages = [firstPage, secondPage];
    const merged = buildMappedInbox({ pages: [firstPage, secondPage] });
    if (merged) {
      applyMergedInbox(merged, generation, {
        resetSelection: options.resetSelection,
      });
    }
    setSyncing(false);
    setLoadingSecondPage(false);
  }

  const refreshInbox = useCallback(async () => {
    if (usingDemo || !connection.connected) {
      setInboxData({
        ...initialDemoInbox,
        syncedAt: new Date().toISOString(),
      });
      setWarning(null);
      setToast("Preview data refreshed");
      return;
    }
    // Manual refresh resets the selection if the current PR is gone. The
    // user explicitly asked for a refresh and would rather land on a live
    // PR than keep reading one that no longer exists.
    await loadLiveInbox({ resetSelection: true });
    // `loadLiveInbox` is intentionally not in the dependency array: it
    // closes over the current render's state and re-defining it on every
    // state change would cause the refresh button to fire a stale fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.connected, initialDemoInbox, usingDemo]);

  useAutoRefresh({
    enabled: !usingDemo && connection.connected && !syncing,
    intervalMs: refreshInterval.milliseconds,
    refresh: () => {
      void loadLiveInbox({ resetSelection: false });
    },
  });

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
          const cached = readInboxCache(window.localStorage);
          if (
            cached &&
            cached.viewer?.login &&
            status.viewer?.login &&
            cached.viewer.login === status.viewer.login
          ) {
            setInboxData(cached);
            setSelectedId(cached.pullRequests[0]?.id ?? "");
            setWarning(cached.warnings?.[0] ?? null);
            setError(null);
          } else {
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
          }
          setUsingDemo(false);
          setLaunchView("workspace");
          await loadLiveInbox({ resetSelection: true });
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
    // `loadLiveInbox` is intentionally not in the dependency array: the
    // bootstrap effect is meant to run once on mount, and re-running it
    // would re-issue the entire two-page fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The diff fetch is keyed on the selected pull request's identity and head
  // revision — not on the inbox payload object or its syncedAt. A refresh
  // that changes neither id nor head SHA must not abort and refetch an
  // identical diff (auto-refresh would otherwise blank the pane every tick).
  const selectedPrId = selectedPullRequest?.id ?? "";
  const selectedPrHeadSha = selectedPullRequest?.headSha ?? "";
  const selectedPrNumber = selectedPullRequest?.number ?? 0;
  const selectedPrRepository = selectedPullRequest?.repository ?? "";
  useEffect(() => {
    if (!selectedPrId || usingDemo) return;

    const [owner, repository] = selectedPrRepository.split("/");
    if (!owner || !repository) return;
    const controller = new AbortController();
    gateway()
      .getPullDiff({
        number: selectedPrNumber,
        owner,
        repository,
      }, controller.signal)
      .then((nextDiff) => {
        if (!controller.signal.aborted) {
          setLiveDiffState({
            diff: nextDiff,
            pullRequestId: selectedPrId,
            status: "loaded",
          });
        }
      })
      .catch((nextError) => {
        if (controller.signal.aborted) return;
        if (handleSessionLoss(nextError)) return;
        // The failure is stored on the diff state itself so the diff pane
        // can show a retryable load-failed panel; `truncated` is reserved
        // for diffs GitHub genuinely cannot render.
        setLiveDiffState({
          diff: { ...EMPTY_DIFF, headSha: selectedPrHeadSha },
          errorMessage: messageFrom(nextError),
          pullRequestId: selectedPrId,
          status: "error",
        });
      });
    return () => controller.abort();
  }, [
    diffAttempt,
    handleSessionLoss,
    selectedPrHeadSha,
    selectedPrId,
    selectedPrNumber,
    selectedPrRepository,
    usingDemo,
  ]);

  const retryDiffLoad = useCallback(() => {
    // Clearing the stored diff flips the pane back to its loading state
    // while the re-keyed effect issues a fresh request.
    setLiveDiffState({ diff: EMPTY_DIFF, pullRequestId: "", status: "loaded" });
    setDiffAttempt((attempt) => attempt + 1);
  }, []);

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
    // Bump the generation so any in-flight page fetches stop writing into
    // state. The cache is wiped because the next session may be a different
    // viewer, and stale pull-request data must not survive disconnect.
    inboxGenerationRef.current += 1;
    inboxPagesRef.current = {
      pages: [],
      cursors: {
        authored: { endCursor: null, hasNextPage: false },
        assigned: { endCursor: null, hasNextPage: false },
        reviewRequested: { endCursor: null, hasNextPage: false },
        reviewed: { endCursor: null, hasNextPage: false },
      },
    };
    clearInboxCache(window.localStorage);
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
        pullRequestId: "",
        status: "loaded",
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
    // Preview mode does not need the live inbox cache. Wipe it so a future
    // live session does not flash a stale card from another viewer.
    inboxGenerationRef.current += 1;
    inboxPagesRef.current = {
      pages: [],
      cursors: {
        authored: { endCursor: null, hasNextPage: false },
        assigned: { endCursor: null, hasNextPage: false },
        reviewRequested: { endCursor: null, hasNextPage: false },
        reviewed: { endCursor: null, hasNextPage: false },
      },
    };
    clearInboxCache(window.localStorage);
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
      setToast(`${reviewEventLabel(event)} saved in preview mode`);
      return;
    }

    if (
      !reviewReady ||
      displayedDiff.headSha !== selectedPullRequest.headSha ||
      !displayedDiff.baseSha
    ) {
      throw new Error(
        "The comparison is still loading or changed. Reload it before submitting.",
      );
    }

    const [owner, repository] = selectedPullRequest.repository.split("/");
    try {
      await gateway().submitReview({
        baseCommitId: displayedDiff.baseSha,
        body,
        commitId: displayedDiff.headSha,
        event,
        number: selectedPullRequest.number,
        owner,
        repository,
      });
    } catch (nextError) {
      // A lost session routes back to the login screen; anything else is the
      // review dialog's error to display.
      if (handleSessionLoss(nextError)) return;
      throw nextError;
    }
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
        data-mobile-pane={mobilePane}
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
              <strong>Hype PRs</strong>
              <small>Pull request pulse</small>
            </span>
          </div>

          <div className="sidebar-section-label">Triage</div>
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
              Hype PRs is another GitHub client. Your organization and
              managed-device policies still apply.
            </p>
          </div>
          {!connection.connected && (
            <button
              aria-label="Connect GitHub to load your live queue"
              className="connect-banner"
              onClick={() => void startConnection()}
              title="Connect GitHub"
              type="button"
            >
              <span className="live-dot" />
              <span>
                <strong>Connect GitHub</strong>
                Preview mode · Load your live queue with GitHub
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
                  : "Preview workspace"}
              </strong>
              <small>
                {connection.connected ? "Live GitHub data" : "Preview data"}
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
                  ? "Triage queue"
                  : "Current view"}
              </span>
              <h1>{currentView.label}</h1>
              <p>{currentView.description}</p>
            </div>
            <div className="queue-header-actions">
              <label
                className="refresh-interval-select"
                title={
                  usingDemo
                    ? "Preview mode keeps its own refresh cadence"
                    : "Auto-refresh while the tab is open"
                }
              >
                <Clock3 aria-hidden="true" size={13} />
                <span className="sr-only">Auto-refresh interval</span>
                <select
                  aria-label="Auto-refresh interval"
                  disabled={usingDemo}
                  value={refreshInterval.intervalId}
                  onChange={(event) =>
                    refreshInterval.setIntervalId(
                      event.target.value as typeof refreshInterval.intervalId,
                    )
                  }
                >
                  {REFRESH_INTERVAL_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      Auto: {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={13} />
              </label>
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
          </div>

          <div
            className="mobile-view-nav"
            role="tablist"
            aria-label="Quick views"
          >
            {viewDefinitions.map((view) => (
              <button
                key={view.id}
                aria-selected={activeView === view.id}
                className="mobile-view-pill"
                onClick={() => selectView(view.id)}
                role="tab"
                type="button"
              >
                <span>{view.shortLabel}</span>
                <span className="mobile-view-count">
                  {countForView(inboxData.pullRequests, view.id, viewNow)}
                </span>
              </button>
            ))}
          </div>

          <div className="queue-controls">
            <label className="queue-search">
              <Search aria-hidden="true" size={15} />
              <span className="sr-only">Search pull requests</span>
              <input
                ref={searchRef}
                placeholder="Search title, repository, author, or reason…"
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
                <option value="attention">Priority</option>
                <option value="recent">Recent activity</option>
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
              {inboxData.pullRequests.length > visiblePullRequests.length
                ? ` of ${inboxData.pullRequests.length}`
                : ""}
            </span>
            <span>
              {loadingFirstPage
                ? "Loading first page…"
                : loadingSecondPage
                  ? "Loading more pull requests…"
                  : `Synced ${relativeTime(inboxData.syncedAt, clockNow)}`}
              {usingDemo ? " · preview" : ""}
              {refreshInterval.intervalId !== "off"
                ? ` · auto ${refreshLabel(refreshInterval.intervalId)}`
                : ""}
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
                      onClick={() => {
                        setSelectedId(pullRequest.id);
                        setMobilePane("detail");
                      }}
                      pullRequest={pullRequest}
                    />
                  </Fragment>
                );
              })
            ) : (
              <div className="empty-queue">
                <CheckCircle2 aria-hidden="true" size={28} />
                <strong>No pull requests here</strong>
                <p>
                  {query
                    ? "Try a broader search."
                    : "Nothing needs your attention right now. Try another view for more context."}
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
                diffLoadFailed={diffLoadFailed}
                now={viewNow}
                onBackToQueue={() => setMobilePane("queue")}
                onOpenInGitHub={() => void openSelectedInGitHub()}
                onReview={() => setReviewOpen(true)}
                pullRequest={selectedPullRequest}
                reviewReady={reviewReady}
                usingDemo={usingDemo}
              />
              <Suspense
                fallback={
                  <DiffWorkspaceFallback
                    fileBrowserCollapsed={leftColumnsCollapsed}
                  />
                }
              >
                <DiffWorkspace
                  key={selectedPullRequest.id}
                  diff={displayedDiff}
                  fileBrowserCollapsed={leftColumnsCollapsed}
                  layout={diffLayout}
                  loadErrorMessage={
                    diffLoadFailed
                      ? (liveDiffState.errorMessage ??
                        "The diff could not be loaded.")
                      : null
                  }
                  loading={diffLoading}
                  onLayoutChange={setDiffLayout}
                  onOpenInGitHub={() => void openSelectedInGitHub()}
                  onRetryLoad={retryDiffLoad}
                  themePreference={themePreference ?? "system"}
                />
              </Suspense>
            </>
          ) : (
            <div className="empty-detail">
              <GitPullRequest aria-hidden="true" size={32} />
              <strong>Choose a pull request to see its files and diff</strong>
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
          <span className="window-shortcut">⌘K to search</span>
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

function DiffWorkspaceFallback({
  fileBrowserCollapsed,
}: {
  fileBrowserCollapsed: boolean;
}) {
  return (
    <div
      className="diff-workspace"
      data-file-browser-collapsed={fileBrowserCollapsed}
    >
      <aside
        aria-label="Changed files"
        className="file-browser"
        hidden={fileBrowserCollapsed}
      />
      <div className="diff-canvas">
        <div className="diff-loading" role="status">
          <span />
          <span />
          <span />
          <span />
          <p>Loading diff…</p>
        </div>
      </div>
    </div>
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
        <h1 id="launch-checking-title">Checking your GitHub connection…</h1>
      </div>
    </section>
  );
}

const MARKETING_FEATURES = [
  {
    body: "Open with the pull requests that need you now, ordered by urgency — review requests, failing checks, conflicts, and work ready to ship.",
    icon: Inbox,
    title: "A queue for what needs you",
  },
  {
    body: "Every row carries a reason, a plain-language explanation, and a timestamp. You always know why a pull request is here.",
    icon: Zap,
    title: "Explainable ranking",
  },
  {
    body: "A directory-first file tree, path filtering, and virtualized split or unified diffs — all in one surface, without leaving the queue.",
    icon: Layers,
    title: "Files and diffs together",
  },
  {
    body: "Comment, approve, or request changes with a summary. Hype PRs re-checks the exact commits before submitting a review.",
    icon: GitPullRequest,
    title: "Review without switching tools",
  },
  {
    body: "Skip the mouse. J/K to move, Option+Arrow to switch views, and Command or Control+K to jump to search.",
    icon: Activity,
    title: "Keyboard-first",
  },
  {
    body: "Works in the browser. Your GitHub token is encrypted with a server-only key and only ever used on the server to make GitHub requests.",
    icon: ShieldCheck,
    title: "Private by design",
  },
] as const;

const MARKETING_FAQ = [
  {
    answer:
      "Hype PRs is an action-first pull request inbox. Instead of an alphabetical repository list, it shows a queue of the pull requests that need you, explains why each one does, and lets you open the files, read the diff, and submit a review without switching tools.",
    question: "What exactly is Hype PRs?",
  },
  {
    answer:
      "Connect with GitHub and Hype PRs finds your open pull requests from four angles: ones you authored, ones assigned to you, ones requesting your review, and ones you have reviewed. It deduplicates the results into a single queue.",
    question: "Where do the pull requests in my inbox come from?",
  },
  {
    answer:
      "Hype PRs connects through an approved GitHub App, not a personal access token. Requested access is read-focused — pull requests, metadata, checks, and review submission — and your normal organization approval, SSO, and repository permissions still apply.",
    question: "What does Hype PRs need access to do?",
  },
  {
    answer:
      "Preview mode loads a full workspace with sample pull requests and diffs. You can explore every view, search, read diffs, and practice submitting reviews without a GitHub account. Reviews in preview mode stay local and are not sent to GitHub.",
    question: "Do I need a GitHub account to explore it now?",
  },
  {
    answer:
      "A selected diff is shown only while its base and head revisions stay stable. When a diff is oversized, binary, too many files, or cannot be parsed safely, Hype PRs gives you a clear explanation and an Open in GitHub fallback.",
    question: "How does Hype PRs handle large or unusual diffs?",
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
            <span className="eyebrow">Your pull request queue</span>
            <h1 id="launch-title">See what needs you now.</h1>
            <p>
              Hype PRs turns your GitHub pull requests — across every repository —
              into one focused queue. It explains why each one needs your
              attention, opens the files and diff for you, and lets you submit a
              review without leaving the app.
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
                Explore preview
              </button>
              <a
                className="repo-link"
                href="https://github.com/hypothetical-money-machine/hype-prs"
                rel="noopener noreferrer"
                target="_blank"
              >
                <GitFork aria-hidden="true" size={15} />
                See the code (and steal it legally!)
              </a>
            </div>

            <p className="hero-sub">
              No GitHub account needed for preview · Works in your browser
            </p>
          </div>

          <div className="marketing-mock" aria-hidden="true">
            <div className="mock-window">
              <div className="mock-bar">
                <span className="mock-dot red" />
                <span className="mock-dot amber" />
                <span className="mock-dot green" />
                <span className="mock-title">Hype PRs — triage queue</span>
              </div>
              <div className="mock-body">
                <div className="mock-eyebrow">Your triage queue</div>
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
                      <span className="mock-tag failed">checks failing</span>
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
            <span className="eyebrow">Why it works</span>
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
              Connect GitHub for your live queue, or explore the preview to see
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
              Open preview
            </button>
          </div>
          <p className="hero-sub">
            {checking
              ? "Checking your GitHub connection…"
              : configured
                ? "Live GitHub access is ready."
                : "Live GitHub access is not configured in this preview build."}
          </p>
        </section>

        <footer className="marketing-footer">
          <span>
            <ShieldCheck aria-hidden="true" size={14} />
            Hype PRs is another GitHub client. Organization approvals, SSO, and
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
  diffLoadFailed,
  now,
  onBackToQueue,
  onOpenInGitHub,
  onReview,
  pullRequest,
  reviewReady,
  usingDemo,
}: {
  diffLoadFailed: boolean;
  now: Date;
  onBackToQueue?(): void;
  onOpenInGitHub(): void;
  onReview(): void;
  pullRequest: PullRequestSummary;
  reviewReady: boolean;
  usingDemo: boolean;
}) {
  return (
    <header className="detail-header">
      <div className="detail-top-bar">
        {onBackToQueue && (
          <button
            aria-label="Back to queue"
            className="mobile-back-button"
            onClick={onBackToQueue}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={16} />
            <span>Back</span>
          </button>
        )}
        <div className="detail-breadcrumb">
          <span>{pullRequest.repository}</span>
          <span>/</span>
          <span>pull request</span>
          <span>/</span>
          <strong>#{pullRequest.number}</strong>
        </div>
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
            Open in GitHub
          </button>
          <button
            className="primary-button compact"
            disabled={!reviewReady}
            onClick={onReview}
            title={
              reviewReady
                ? "Review this pull request"
                : diffLoadFailed
                  ? "The comparison failed to load. Retry the diff before reviewing."
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
          {pullRequest.changedFiles} changed files
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
        {usingDemo && <span className="demo-pill">PREVIEW</span>}
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
        <span className="eyebrow">Live workspace</span>
        <h2 id="connection-title">Connect GitHub</h2>

        {!configured ? (
          <>
            <p>
              Live GitHub access is not configured in this preview build. You
              can still explore the complete workspace with preview data.
            </p>
            <div className="configuration-callout">
              <Code2 aria-hidden="true" size={18} />
              <span>
                Set up the GitHub App for this host. Personal access tokens are
                not supported.
              </span>
            </div>
          </>
        ) : (
          <>
            <p>
              Connect Hype PRs to GitHub. Your access still follows your
              account, App installation, organization approval, and SSO policy.
            </p>
            <ul className="permission-list">
              <li>
                <Check aria-hidden="true" size={15} />
                Pull requests: read and submit reviews
              </li>
              <li>
                <Check aria-hidden="true" size={15} />
                Checks and commit statuses: read
              </li>
              <li>
                <X aria-hidden="true" size={15} />
                No source edits, merges, or workflow controls
              </li>
            </ul>
            <button className="primary-button" onClick={onStart} type="button">
              Continue with GitHub
              <ArrowUpRight aria-hidden="true" size={15} />
            </button>
          </>
        )}

        <p className="modal-policy">
          Hype PRs cannot bypass your organization’s device or application
          policies. An administrator may need to approve the app.
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
  // GitHub rejects a self-approval at submit time, so never offer the option.
  const authored = pullRequest.viewerRelationship === "AUTHOR";
  const blocked = (option: ReviewEvent) => authored && option === "APPROVE";
  const valid = (!requiresBody || Boolean(body.trim())) && !blocked(event);

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

        <div className="review-options" role="radiogroup" aria-label="Review decision">
          {(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as ReviewEvent[]).map(
            (option) => (
              <button
                aria-checked={event === option}
                className="review-option"
                data-active={event === option}
                disabled={blocked(option)}
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
                  <small>
                    {blocked(option)
                      ? "You can't approve your own pull request"
                      : reviewEventDescription(option)}
                  </small>
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
                ? "Tell the author what to change…"
                : "Add a clear review summary…"
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
                ? "This stays in preview mode and is not sent to GitHub."
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
              Review submission
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
      <CircleDot aria-hidden="true" size={13} /> Review pending
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
  if (pullRequest.checkState === "PENDING") {
    return (
      <span className="status-pill pending">
        <Clock3 aria-hidden="true" size={13} /> Checks running
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
      <Clock3 aria-hidden="true" size={13} /> Review pending
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
  if (event === "APPROVE") return "Approve this pull request";
  if (event === "REQUEST_CHANGES") return "Request changes before approval";
  return "Leave feedback without approving or blocking";
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

function refreshLabel(id: RefreshIntervalId): string {
  return REFRESH_INTERVAL_OPTIONS.find((option) => option.id === id)?.label ?? "Off";
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
      () => reject(new Error("GitHub is taking too long to respond. Try again.")),
      timeoutMs,
    );
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}
