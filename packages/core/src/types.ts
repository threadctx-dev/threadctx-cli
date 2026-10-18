// Canonical Context Model (spec §6.1). Every adapter parses into these types;
// the resolver, rule engine, compiler and manifest all read from them.

export type ToolId = "agents-md" | "claude-code" | "cursor" | "copilot" | "gemini" | (string & {});

export type ArtifactKind =
  | "instructions"
  | "rule"
  | "skill"
  | "memory"
  | "mcp-config"
  | "command"
  | "subagent";

export type ArtifactOrigin = "repo" | "user" | "managed-policy" | "org-cloud" | "third-party";

export interface ContextArtifact {
  /** Stable: hash(tool + path). */
  id: string;
  /** Repo-relative, or ~/ for user scope. */
  path: string;
  tool: ToolId | "neutral";
  kind: ArtifactKind;
  origin: ArtifactOrigin;
  scope: { directory?: string; globs?: string[]; alwaysApply: boolean };
  /** sha256 of normalised bytes. */
  contentHash: string;
  /** Always labelled as an estimate in user-facing output. */
  tokenEstimate: number;
  /** Canonical source id when compiled by threadctx. */
  generatedFrom?: string;
  /** Tool-specific fields, namespaced by tool id. */
  ext: Record<string, unknown>;
}

export type DirectiveKind =
  | "command"
  | "convention"
  | "prohibition"
  | "requirement"
  | "architecture"
  | "pointer"
  | "prose";

export type ClaimType =
  | "path"
  | "command"
  | "package-manager"
  | "dependency"
  | "version"
  | "url"
  | "glob"
  | "import";

export interface Claim {
  type: ClaimType;
  value: string;
  /** 1-based line in the artifact where the claim appears. */
  line: number;
  /** Where the claim was found; precision rules use this to skip weak evidence. */
  source: "code-span" | "fence" | "link" | "text";
  /** Set by drift checks against the code. */
  resolved?: boolean;
}

/** A normalised fact. Two artifacts with the same topicKey and different values conflict. */
export interface Fact {
  topicKey: string;
  value: string;
  line: number;
  /** True when inferred (e.g. package manager from a command) rather than stated outright. */
  derived: boolean;
}

export interface Directive {
  id: string;
  artifactId: string;
  span: { startLine: number; endLine: number };
  text: string;
  kind: DirectiveKind;
  /** Primary normalised fact key, e.g. 'cmd.test', 'pkg.manager', 'lang.node.version'. */
  topicKey?: string;
  /** All facts in this directive; a directive can state several. */
  facts: Fact[];
  claims: Claim[];
  /** Heading path above the directive, e.g. "Development > Testing". */
  section?: string;
  /** Fenced code language when the directive is a code block. */
  fenceLang?: string;
}

export type LoadMode =
  /** Loaded at session start. */
  | "always"
  /** Loaded when the agent reads or edits files in that directory. */
  | "on-demand"
  /** Loaded when the target file matches the artifact's globs. */
  | "conditional"
  /** Only a description is loaded; the agent decides whether to read the rest. */
  | "agent-decides";

export interface EffectiveLayer {
  artifactId: string;
  path: string;
  /** Higher loads later and wins ties. */
  precedence: number;
  loading: LoadMode;
  reason: string;
  /** Estimated tokens this layer adds for this tool (may be a description only). */
  tokenEstimate: number;
}

export interface EffectiveContext {
  tool: ToolId;
  targetPath: string;
  layers: EffectiveLayer[];
  tokenEstimate: number;
  /** Always-loaded tokens only: what every session pays. */
  alwaysTokenEstimate: number;
  /** What the manifest attests: hash over ordered layer content hashes. */
  hash: string;
  /** Caveats the user should know (version requirements, unverified behaviour). */
  notes: string[];
}

export interface ArtifactRef {
  tool: ToolId | "neutral";
  path: string;
  kind: ArtifactKind;
  origin: ArtifactOrigin;
}

/** Synchronous read-only filesystem view; the engine stays a pure function of its inputs. */
export interface FsView {
  root: string;
  /** Repo-relative POSIX paths of every non-ignored file, sorted. */
  files: readonly string[];
  /** Directories containing at least one listed file, plus "". */
  dirs: ReadonlySet<string>;
  readFile(path: string): string | undefined;
  exists(path: string): boolean;
  symlinkTarget(path: string): string | undefined;
}
