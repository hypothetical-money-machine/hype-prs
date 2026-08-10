"use client";

import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileX2,
  Folder,
  FolderOpen,
  Search,
  TriangleAlert,
} from "lucide-react";
import { parsePatchFiles, type CodeViewItem } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
} from "@pierre/diffs/react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildFileTree,
  filterFileTree,
  type FileTreeNode,
} from "@/lib/file-tree";
import type { ChangedFile, PullRequestDiff } from "@/lib/types";
import type { ThemePreference } from "@/lib/theme";

export type DiffLayout = "split" | "unified";

interface DiffWorkspaceProps {
  diff: PullRequestDiff;
  fileBrowserCollapsed: boolean;
  layout: DiffLayout;
  loading: boolean;
  onLayoutChange(layout: DiffLayout): void;
  onOpenInGitHub(): void;
  themePreference: ThemePreference;
}

interface ParsedDiff {
  error: string | null;
  itemIdByName: Map<string, string>;
  items: CodeViewItem[];
}

export function DiffWorkspace({
  diff,
  fileBrowserCollapsed,
  layout,
  loading,
  onLayoutChange,
  onOpenInGitHub,
  themePreference,
}: DiffWorkspaceProps) {
  const viewerRef = useRef<CodeViewHandle<undefined>>(null);
  const viewerPaneRef = useRef<HTMLElement>(null);
  const viewerSurfaceRef = useRef<HTMLDivElement>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [splitViewAvailable, setSplitViewAvailable] = useState(true);
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(
    new Set(),
  );
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const tree = useMemo(
    () => filterFileTree(buildFileTree(diff.files), fileQuery),
    [diff.files, fileQuery],
  );
  const selectedFile = selectedFilename
    ? diff.files.find((file) => file.filename === selectedFilename) ?? null
    : null;
  const selectedFileUnavailable =
    selectedFile !== null && !parsed.itemIdByName.has(selectedFile.filename);
  const renderedLayout = splitViewAvailable ? layout : "unified";

  function scrollToFile(filename: string) {
    setSelectedFilename(filename);
  }

  useEffect(() => {
    if (!selectedFilename || selectedFileUnavailable) return;
    const id = parsed.itemIdByName.get(selectedFilename);
    if (!id) return;
    const frame = window.requestAnimationFrame(() => {
      viewerRef.current?.scrollTo({
        align: "start",
        behavior: "smooth-auto",
        id,
        type: "item",
      });
      viewerSurfaceRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [parsed.itemIdByName, selectedFileUnavailable, selectedFilename]);

  useEffect(() => {
    const viewerPane = viewerPaneRef.current;
    if (!viewerPane) return;

    const updateAvailability = (width: number) => {
      setSplitViewAvailable(width >= 1000);
    };
    updateAvailability(viewerPane.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateAvailability(entry.contentRect.width);
    });
    observer.observe(viewerPane);
    return () => observer.disconnect();
  }, []);

  function toggleDirectory(id: string) {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="diff-workspace"
      data-file-browser-collapsed={fileBrowserCollapsed}
    >
      <aside
        aria-label="Changed files"
        className="file-browser"
        hidden={fileBrowserCollapsed}
        id="changed-files"
      >
        <div className="file-browser-header">
          <div>
            <span className="eyebrow">Changed files</span>
            <strong>{diff.files.length}</strong>
          </div>
          <span className="file-browser-summary">
            <span className="addition">+
              {diff.files.reduce((total, file) => total + file.additions, 0)}
            </span>
            <span className="deletion">−
              {diff.files.reduce((total, file) => total + file.deletions, 0)}
            </span>
          </span>
        </div>
        <label className="file-search">
          <Search aria-hidden="true" size={14} strokeWidth={2} />
          <span className="sr-only">Filter changed files</span>
          <input
            value={fileQuery}
            onChange={(event) => setFileQuery(event.target.value)}
            placeholder="Filter paths"
          />
        </label>
        <div className="file-tree" role="tree" aria-label="Changed file tree">
          {tree.length > 0 ? (
            tree.map((node) => (
              <FileTreeRow
                key={node.id}
                collapsedDirectories={collapsedDirectories}
                depth={0}
                node={node}
                onFileClick={scrollToFile}
                onToggleDirectory={toggleDirectory}
                selectedFilename={selectedFilename}
              />
            ))
          ) : (
            <div className="file-tree-empty">No matching paths</div>
          )}
        </div>
      </aside>

      <section
        className="diff-viewer"
        aria-label="Pull request diff"
        ref={viewerPaneRef}
      >
        <div className="diff-toolbar">
          <div className="segmented-control" aria-label="Diff layout">
            <button
              aria-pressed={renderedLayout === "split"}
              disabled={!splitViewAvailable}
              onClick={() => onLayoutChange("split")}
              title={
                splitViewAvailable
                  ? "Show the diff side by side"
                  : "Split view is available when the diff pane is wider"
              }
              type="button"
            >
              Split
            </button>
            <button
              aria-pressed={renderedLayout === "unified"}
              onClick={() => onLayoutChange("unified")}
              type="button"
            >
              Unified
            </button>
          </div>
          <span className="diff-engine">
            Rendered with <strong>Pierre Diffs</strong>
          </span>
        </div>

        <div className="diff-canvas" ref={viewerSurfaceRef} tabIndex={-1}>
          {loading ? (
            <DiffLoading />
          ) : diff.truncated || !diff.patch ? (
            <DiffFallback
              reason={
                diff.truncated
                  ? "This diff is binary, truncated, or larger than the safe in-app rendering limit."
                  : "GitHub did not provide a textual patch for this pull request."
              }
              onOpenInGitHub={onOpenInGitHub}
            />
          ) : parsed.error ? (
            <DiffFallback
              reason={parsed.error}
              onOpenInGitHub={onOpenInGitHub}
            />
          ) : selectedFileUnavailable ? (
            <DiffFallback
              reason={`GitHub did not provide a textual patch for ${selectedFile.filename}. Other text files remain available in the changed-file tree.`}
              onOpenInGitHub={onOpenInGitHub}
            />
          ) : (
            <CodeView
              key={`${diff.baseSha}:${diff.headSha}`}
              ref={viewerRef}
              disableWorkerPool
              items={parsed.items}
              options={{
                diffIndicators: "bars",
                diffStyle: renderedLayout,
                layout: {
                  gap: 1,
                  paddingBottom: 24,
                  paddingTop: 0,
                },
                overflow: "scroll",
                stickyHeaders: true,
                theme: {
                  dark: "github-dark-default",
                  light: "github-light-default",
                },
                themeType: themePreference,
              }}
              style={
                {
                  "--diffs-font-size": "14px",
                  "--diffs-line-height": "22px",
                  height: "100%",
                  overflow: "auto",
                } as CSSProperties
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}

function FileTreeRow({
  node,
  depth,
  collapsedDirectories,
  onFileClick,
  onToggleDirectory,
  selectedFilename,
}: {
  collapsedDirectories: Set<string>;
  depth: number;
  node: FileTreeNode;
  onFileClick(filename: string): void;
  onToggleDirectory(id: string): void;
  selectedFilename: string | null;
}) {
  const style = { "--tree-depth": depth } as React.CSSProperties;

  if (node.type === "directory") {
    const collapsed = collapsedDirectories.has(node.id);
    return (
      <>
        <button
          aria-expanded={!collapsed}
          aria-selected="false"
          className="file-tree-row directory"
          onClick={() => onToggleDirectory(node.id)}
          role="treeitem"
          style={style}
          type="button"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" size={13} />
          ) : (
            <ChevronDown aria-hidden="true" size={13} />
          )}
          {collapsed ? (
            <Folder aria-hidden="true" size={15} />
          ) : (
            <FolderOpen aria-hidden="true" size={15} />
          )}
          <span>{node.name}</span>
        </button>
        {!collapsed &&
          node.children.map((child) => (
            <FileTreeRow
              key={child.id}
              collapsedDirectories={collapsedDirectories}
              depth={depth + 1}
              node={child}
              onFileClick={onFileClick}
              onToggleDirectory={onToggleDirectory}
              selectedFilename={selectedFilename}
            />
          ))}
      </>
    );
  }

  return (
    <button
      className="file-tree-row file"
      aria-selected={selectedFilename === node.file.filename}
      onClick={() => onFileClick(node.file.filename)}
      role="treeitem"
      style={style}
      title={node.file.filename}
      type="button"
    >
      <span className={`file-status ${statusClass(node.file)}`}>
        {fileIcon(node.file)}
      </span>
      <span className="file-name">{node.name}</span>
      <span className="file-churn">{node.file.changes}</span>
    </button>
  );
}

function DiffFallback({
  onOpenInGitHub,
  reason,
}: {
  onOpenInGitHub(): void;
  reason: string;
}) {
  return (
    <div className="diff-fallback">
      <TriangleAlert aria-hidden="true" size={28} />
      <strong>Diff unavailable in Hype</strong>
      <p>{reason}</p>
      <button className="secondary-button" onClick={onOpenInGitHub} type="button">
        Open this diff on GitHub
      </button>
    </div>
  );
}

function DiffLoading() {
  return (
    <div className="diff-loading" role="status">
      <span />
      <span />
      <span />
      <span />
      <p>Loading changed files…</p>
    </div>
  );
}

function parseDiff(diff: PullRequestDiff): ParsedDiff {
  if (!diff.patch) {
    return { error: null, itemIdByName: new Map(), items: [] };
  }
  try {
    const itemIdByName = new Map<string, string>();
    const items = parsePatchFiles(
      diff.patch,
      `${diff.baseSha}:${diff.headSha}`,
    ).flatMap(
      (patch, patchIndex) =>
        patch.files.map((fileDiff, fileIndex): CodeViewItem => {
          const id = `${patchIndex}:${fileIndex}:${fileDiff.name}`;
          itemIdByName.set(fileDiff.name, id);
          return { fileDiff, id, type: "diff", version: 1 };
        }),
    );
    if (items.length === 0) {
      return {
        error: "The patch did not contain a renderable text diff.",
        itemIdByName,
        items,
      };
    }
    return { error: null, itemIdByName, items };
  } catch {
    return {
      error: "The diff could not be parsed safely.",
      itemIdByName: new Map(),
      items: [],
    };
  }
}

function fileIcon(file: ChangedFile) {
  if (file.status === "added") {
    return <FilePlus2 aria-label="Added" size={14} />;
  }
  if (file.status === "removed" || file.status === "deleted") {
    return <FileX2 aria-label="Deleted" size={14} />;
  }
  return <FileCode2 aria-label="Modified" size={14} />;
}

function statusClass(file: ChangedFile): string {
  if (file.status === "added") return "added";
  if (file.status === "removed" || file.status === "deleted") return "deleted";
  if (file.status === "renamed") return "renamed";
  return "modified";
}
