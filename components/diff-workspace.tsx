"use client";

import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileX2,
  Folder,
  FolderOpen,
  Minus,
  Plus,
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
import { useDiffFontSize } from "./use-diff-font-size";
import { getDiffLineHeightPt } from "@/lib/diff-font-size";
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
  const {
    canDecrease,
    canIncrease,
    decreaseFontSize,
    fontSizePt,
    increaseFontSize,
  } = useDiffFontSize();
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [splitViewAvailable, setSplitViewAvailable] = useState(true);
  const [mobileTab, setMobileTab] = useState<"diff" | "files">("diff");
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
    setMobileTab("diff");
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
      data-font-size-pt={fontSizePt}
      data-mobile-tab={mobileTab}
    >
      <div
        className="diff-mobile-tabs"
        role="tablist"
        aria-label="Diff workspace views"
      >
        <button
          aria-selected={mobileTab === "diff"}
          className="diff-mobile-tab"
          onClick={() => setMobileTab("diff")}
          role="tab"
          type="button"
        >
          Diff
        </button>
        <button
          aria-selected={mobileTab === "files"}
          className="diff-mobile-tab"
          onClick={() => setMobileTab("files")}
          role="tab"
          type="button"
        >
          Files ({diff.files.length})
        </button>
      </div>
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
            placeholder="Search changed files"
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
          <div className="diff-toolbar-controls">
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
            <div className="point-picker" aria-label="Text size" role="group">
              <button
                aria-label="Decrease text size"
                disabled={!canDecrease}
                onClick={decreaseFontSize}
                title={`Decrease text size (current: ${fontSizePt}pt)`}
                type="button"
              >
                <Minus aria-hidden="true" size={13} />
              </button>
              <span className="point-picker-value" aria-live="polite">
                {fontSizePt} pt
              </span>
              <button
                aria-label="Increase text size"
                disabled={!canIncrease}
                onClick={increaseFontSize}
                title={`Increase text size (current: ${fontSizePt}pt)`}
                type="button"
              >
                <Plus aria-hidden="true" size={13} />
              </button>
            </div>
          </div>
          <span className="diff-engine">
            Powered by <strong>Pierre Diffs</strong>
          </span>
        </div>

        <div className="diff-canvas" ref={viewerSurfaceRef} tabIndex={-1}>
          {loading ? (
            <DiffLoading />
          ) : diff.truncated || !diff.patch ? (
            <DiffFallback
              reason={
                diff.truncated
                  ? "This diff includes a binary file, is truncated, or is too large to render here."
                  : "GitHub didn't return a text diff for this pull request."
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
              reason={`GitHub didn't return a text diff for ${selectedFile.filename}. Other text files are still available in Files.`}
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
                  "--diffs-font-size": `${fontSizePt}pt`,
                  "--diffs-line-height": `${getDiffLineHeightPt(fontSizePt)}pt`,
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
      <strong>This diff isn’t available here</strong>
      <p>{reason}</p>
      <button className="secondary-button" onClick={onOpenInGitHub} type="button">
        Open in GitHub
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
      <p>Loading diff…</p>
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
        error: "This patch does not contain a text diff we can display.",
        itemIdByName,
        items,
      };
    }
    return { error: null, itemIdByName, items };
  } catch {
    return {
      error: "This diff could not be displayed safely.",
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
