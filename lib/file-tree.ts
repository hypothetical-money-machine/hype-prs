import type { ChangedFile } from "./types";

export interface FileTreeDirectory {
  children: FileTreeNode[];
  id: string;
  name: string;
  type: "directory";
}

export interface FileTreeFile {
  file: ChangedFile;
  id: string;
  name: string;
  type: "file";
}

export type FileTreeNode = FileTreeDirectory | FileTreeFile;

export function buildFileTree(files: ChangedFile[]): FileTreeNode[] {
  const root: FileTreeDirectory = {
    children: [],
    id: "",
    name: "",
    type: "directory",
  };

  for (const file of [...files].sort((left, right) =>
    left.filename.localeCompare(right.filename),
  )) {
    const segments = file.filename.split("/").filter(Boolean);
    let directory = root;

    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index];
      const id = segments.slice(0, index + 1).join("/");
      let child = directory.children.find(
        (node): node is FileTreeDirectory =>
          node.type === "directory" && node.name === name,
      );
      if (!child) {
        child = { children: [], id, name, type: "directory" };
        directory.children.push(child);
      }
      directory = child;
    }

    directory.children.push({
      file,
      id: file.filename,
      name: segments.at(-1) ?? file.filename,
      type: "file",
    });
  }

  sortNodes(root.children);
  return root.children;
}

export function filterFileTree(
  nodes: FileTreeNode[],
  rawQuery: string,
): FileTreeNode[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return nodes;

  return nodes.flatMap((node): FileTreeNode[] => {
    if (node.type === "file") {
      return node.file.filename.toLocaleLowerCase().includes(query)
        ? [node]
        : [];
    }
    const children = filterFileTree(node.children, query);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

function sortNodes(nodes: FileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) {
    if (node.type === "directory") sortNodes(node.children);
  }
}
