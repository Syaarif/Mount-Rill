import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

const CONFIG_FILE = "default.project.json";
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_BYTES = 10 * 1024 * 1024;
const MAX_SEARCH_FILES = 2000;
const MAX_TREE_ENTRIES = 3000;
const MAX_TREE_DEPTH = 12;
const COMMAND_TIMEOUT_MS = 5000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".lua",
  ".luau",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const IGNORED_DIRECTORY_NAMES = new Set([
  ".aws",
  ".azure",
  ".config",
  ".git",
  ".idea",
  ".ssh",
  ".vscode",
  ".vs",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const SENSITIVE_NAME =
  /(^\.env(?:\.|$)|(^|[._-])(secret|secrets|credential|credentials|token|private[-_.]?key)([._-]|$)|(^|[._-])id_(rsa|ed25519)([._-]|$)|\.(pem|p12|pfx|key)$)/i;

export type RojoArguments = ["--version"] | ["sourcemap", typeof CONFIG_FILE];

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  args: RojoArguments,
  cwd: string,
  timeoutMs: number,
) => Promise<CommandResult>;

export type ProjectTreeEntry = {
  path: string;
  type: "file" | "directory";
  sizeBytes?: number;
};

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSensitivePath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).some((segment) => {
    const normalized = segment.toLowerCase();
    return (
      normalized.startsWith(".") ||
      IGNORED_DIRECTORY_NAMES.has(normalized) ||
      SENSITIVE_NAME.test(normalized)
    );
  });
}

function decodeUtf8(buffer: Buffer, displayPath: string): string {
  if (buffer.includes(0)) {
    throw new Error(`Binary files are not readable: ${displayPath}`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`File is not valid UTF-8 text: ${displayPath}`);
  }
}

function collectMappedPaths(tree: unknown): Array<{ key: "$path" | "$project"; value: string }> {
  const result: Array<{ key: "$path" | "$project"; value: string }> = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if ((key === "$path" || key === "$project") && typeof child === "string") {
        result.push({ key, value: child });
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  };

  visit(tree);
  return result;
}

function countSourcemapFiles(tree: unknown): number {
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
    return 0;
  }

  const record = tree as Record<string, unknown>;
  const ownCount = Array.isArray(record.filePaths) ? record.filePaths.length : 0;
  const children = Array.isArray(record.children) ? record.children : [];
  return ownCount + children.reduce<number>((count, child) => count + countSourcemapFiles(child), 0);
}

function runRojo(args: RojoArguments, cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("rojo", args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new Error(`Could not start the fixed Rojo command: ${errorMessage(error)}`));
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error, result?: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      }
    };
    const append = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("Rojo output exceeded the 1 MiB safety limit."));
        return;
      }
      target.push(chunk);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Rojo command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
    child.once("error", (error) => {
      finish(new Error(`Could not run Rojo: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (code !== 0) {
        finish(
          new Error(
            `Rojo exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}: ${Buffer.concat(stderr).toString("utf8").trim() || "no error details"}`,
          ),
        );
        return;
      }
      finish(undefined, {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ProjectTools {
  readonly root: string;
  private readonly commandRunner: CommandRunner;

  constructor(root: string, commandRunner: CommandRunner = runRojo) {
    this.root = realpathSync(root);
    if (!statSync(this.root).isDirectory()) {
      throw new Error("Configured workspace root is not a directory.");
    }
    this.commandRunner = commandRunner;
  }

  private resolveSafePath(relativePath: string, label: string): string {
    if (
      typeof relativePath !== "string" ||
      relativePath.length === 0 ||
      relativePath.includes("\0") ||
      /^[a-zA-Z]:/.test(relativePath) ||
      /^[\\/]/.test(relativePath)
    ) {
      throw new Error(`${label} must be a non-empty workspace-relative path.`);
    }

    const segments = relativePath.replaceAll("\\", "/").split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`${label} must not contain empty, "." or ".." path segments.`);
    }
    if (isSensitivePath(relativePath)) {
      throw new Error(`Access denied for a hidden, generated, or sensitive project path: ${relativePath}`);
    }

    const candidate = path.resolve(this.root, ...segments);
    if (!pathIsInside(this.root, candidate)) {
      throw new Error(`${label} resolves outside the allowed workspace.`);
    }
    if (!existsSync(candidate)) {
      throw new Error(`Project path does not exist: ${relativePath}`);
    }

    const canonical = realpathSync(candidate);
    if (!pathIsInside(this.root, canonical)) {
      throw new Error(`Access denied: ${relativePath} resolves outside the allowed workspace.`);
    }
    return canonical;
  }

  private readTextFile(relativePath: string, maximumBytes = MAX_FILE_BYTES): string {
    const filePath = this.resolveSafePath(relativePath, "File path");
    const metadata = statSync(filePath);
    if (!metadata.isFile()) {
      throw new Error(`Project path is not a regular file: ${relativePath}`);
    }
    if (metadata.size > maximumBytes) {
      throw new Error(`File exceeds the ${maximumBytes}-byte read limit: ${relativePath}`);
    }
    return decodeUtf8(readFileSync(filePath), relativePath);
  }

  readProjectFile(relativePath: string): { path: string; sizeBytes: number; content: string } {
    const content = this.readTextFile(relativePath);
    return { path: relativePath.replaceAll("\\", "/"), sizeBytes: Buffer.byteLength(content), content };
  }

  getProjectTree(relativePath?: string): {
    root: string;
    entries: ProjectTreeEntry[];
    truncated: boolean;
  } {
    const requestedPath = relativePath ?? ".";
    const startPath =
      requestedPath === "."
        ? this.root
        : this.resolveSafePath(requestedPath, "Tree path");
    if (!statSync(startPath).isDirectory()) {
      throw new Error(`Tree path is not a directory: ${requestedPath}`);
    }

    const entries: ProjectTreeEntry[] = [];
    let truncated = false;
    const visit = (directory: string, depth: number): void => {
      if (depth > MAX_TREE_DEPTH || entries.length >= MAX_TREE_ENTRIES) {
        truncated = true;
        return;
      }

      const children = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const child of children) {
        if (child.isSymbolicLink()) {
          continue;
        }
        const absolutePath = path.join(directory, child.name);
        const relative = path.relative(this.root, absolutePath).split(path.sep).join("/");
        if (isSensitivePath(relative)) {
          continue;
        }
        if (entries.length >= MAX_TREE_ENTRIES) {
          truncated = true;
          return;
        }
        if (child.isDirectory()) {
          entries.push({ path: relative, type: "directory" });
          visit(absolutePath, depth + 1);
        } else if (child.isFile()) {
          entries.push({ path: relative, type: "file", sizeBytes: lstatSync(absolutePath).size });
        }
      }
    };

    visit(startPath, 0);
    return {
      root: requestedPath === "." ? "" : requestedPath.replaceAll("\\", "/"),
      entries,
      truncated,
    };
  }

  searchProjectCode(query: string, caseSensitive = false): {
    query: string;
    filesScanned: number;
    bytesScanned: number;
    skippedFiles: number;
    truncated: boolean;
    matches: Array<{ path: string; line: number; text: string }>;
  } {
    if (query.length === 0 || query.length > 200 || query.trim().length === 0) {
      throw new Error("Search query must contain 1 to 200 non-whitespace characters.");
    }

    const matches: Array<{ path: string; line: number; text: string }> = [];
    let filesScanned = 0;
    let bytesScanned = 0;
    let skippedFiles = 0;
    let truncated = false;
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const visit = (directory: string): void => {
      if (truncated) {
        return;
      }
      const children = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const child of children) {
        if (child.isSymbolicLink()) {
          continue;
        }
        const absolutePath = path.join(directory, child.name);
        const relative = path.relative(this.root, absolutePath).split(path.sep).join("/");
        if (isSensitivePath(relative)) {
          continue;
        }
        if (child.isDirectory()) {
          visit(absolutePath);
          if (truncated) {
            return;
          }
          continue;
        }
        if (!child.isFile() || !TEXT_EXTENSIONS.has(path.extname(child.name).toLowerCase())) {
          continue;
        }
        const fileSize = lstatSync(absolutePath).size;
        if (filesScanned >= MAX_SEARCH_FILES || bytesScanned + fileSize > MAX_SEARCH_BYTES) {
          truncated = true;
          return;
        }
        if (fileSize > MAX_FILE_BYTES) {
          skippedFiles += 1;
          continue;
        }

        filesScanned += 1;
        let content: string;
        try {
          content = this.readTextFile(relative, MAX_FILE_BYTES);
        } catch {
          skippedFiles += 1;
          continue;
        }
        bytesScanned += Buffer.byteLength(content);

        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const lineText = lines[index] ?? "";
          const haystack = caseSensitive ? lineText : lineText.toLocaleLowerCase();
          if (haystack.includes(needle)) {
            matches.push({
              path: relative,
              line: index + 1,
              text: lineText.length > 240 ? `${lineText.slice(0, 237)}...` : lineText,
            });
            if (matches.length >= 100) {
              truncated = true;
              return;
            }
          }
        }
      }
    };

    visit(this.root);
    return { query, filesScanned, bytesScanned, skippedFiles, truncated, matches };
  }

  getProjectInfo(): {
    name: string;
    workspace: string;
    configFile: string;
    mappings: Array<{ key: "$path" | "$project"; path: string }>;
    files: number;
  } {
    const project = this.readProjectConfig();
    const tree = this.getProjectTree();
    const fileCount = tree.entries.filter((entry) => entry.type === "file").length;
    return {
      name: typeof project.name === "string" ? project.name : path.basename(this.root),
      workspace: path.basename(this.root),
      configFile: CONFIG_FILE,
      mappings: collectMappedPaths(project.tree).map(({ key, value }) => ({
        key,
        path: value.replaceAll("\\", "/"),
      })),
      files: fileCount,
    };
  }

  async getRojoStatus(): Promise<{
    available: true;
    version: string;
    configFile: string;
  }> {
    const result = await this.commandRunner(["--version"], this.root, COMMAND_TIMEOUT_MS);
    return { available: true, version: result.stdout.trim(), configFile: CONFIG_FILE };
  }

  async validateRojoConfig(): Promise<{
    valid: boolean;
    configFile: string;
    projectName?: string;
    mappedSources?: number;
    issues: string[];
  }> {
    const issues: string[] = [];
    let project: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(this.readTextFile(CONFIG_FILE));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { valid: false, configFile: CONFIG_FILE, issues: ["Project configuration must be a JSON object."] };
      }
      project = parsed as Record<string, unknown>;
    } catch (error) {
      return { valid: false, configFile: CONFIG_FILE, issues: [errorMessage(error)] };
    }

    if (typeof project.name !== "string" || project.name.trim().length === 0) {
      issues.push("Project configuration must contain a non-empty string name.");
    }
    if (!project.tree || typeof project.tree !== "object" || Array.isArray(project.tree)) {
      issues.push("Project configuration must contain a tree object.");
    } else {
      const mappings = collectMappedPaths(project.tree);
      for (const mapping of mappings) {
        try {
          const resolved = this.resolveSafePath(mapping.value, `${mapping.key} mapping`);
          const metadata = statSync(resolved);
          if (mapping.key === "$path" && !metadata.isDirectory()) {
            issues.push(`${mapping.key} mapping must point to a directory: ${mapping.value}`);
          }
          if (mapping.key === "$project" && !metadata.isFile()) {
            issues.push(`${mapping.key} mapping must point to a file: ${mapping.value}`);
          }
        } catch (error) {
          issues.push(errorMessage(error));
        }
      }
      if (mappings.length === 0) {
        issues.push("Project tree does not contain a $path or $project source mapping.");
      }
    }
    if (issues.length > 0) {
      return {
        valid: false,
        configFile: CONFIG_FILE,
        ...(typeof project.name === "string" ? { projectName: project.name } : {}),
        issues,
      };
    }

    try {
      const result = await this.commandRunner(["sourcemap", CONFIG_FILE], this.root, COMMAND_TIMEOUT_MS);
      const sourcemap: unknown = JSON.parse(result.stdout);
      return {
        valid: true,
        configFile: CONFIG_FILE,
        ...(typeof project.name === "string" ? { projectName: project.name } : {}),
        mappedSources: countSourcemapFiles(sourcemap),
        issues: [],
      };
    } catch (error) {
      return {
        valid: false,
        configFile: CONFIG_FILE,
        ...(typeof project.name === "string" ? { projectName: project.name } : {}),
        issues: [errorMessage(error)],
      };
    }
  }

  private readProjectConfig(): Record<string, unknown> {
    const parsed: unknown = JSON.parse(this.readTextFile(CONFIG_FILE));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${CONFIG_FILE} must contain a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  }
}
