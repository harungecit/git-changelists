import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import { log, getWorkspaceRoot } from './utils';

/**
 * URI scheme for our git content provider
 */
export const GIT_CHANGELIST_SCHEME = 'gitcl';
export const SNAPSHOT_SCHEME = 'gitcl-snapshot';

// In-memory storage for snapshot content
const snapshotContent: Map<string, string> = new Map();

// Cache of git instances per repository
const gitInstances: Map<string, SimpleGit> = new Map();

/**
 * Get or create a git instance for a repository
 */
function getGitInstance(repoPath: string): SimpleGit {
    if (!gitInstances.has(repoPath)) {
        gitInstances.set(repoPath, simpleGit(repoPath));
    }
    return gitInstances.get(repoPath)!;
}

/**
 * Content provider for showing original file content from Git HEAD.
 * Supports multi-repo by including repoPath in the URI.
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this._onDidChange.event;

    /**
     * Provide content for a URI
     * URI format: gitcl:relativePath?ref=HEAD&repo=encodedRepoPath
     */
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        try {
            // Parse the URI to get file path, ref, and repo
            const relativePath = uri.path;
            const params = new URLSearchParams(uri.query);
            const ref = params.get('ref') || 'HEAD';
            const repoPath = params.get('repo');

            // Use provided repo path or fall back to workspace root
            const gitRepoPath = repoPath ? decodeURIComponent(repoPath) : getWorkspaceRoot();

            if (!gitRepoPath) {
                throw new Error('No repository path available');
            }

            const git = getGitInstance(gitRepoPath);

            log(`Getting content for ${relativePath} at ${ref} from ${gitRepoPath}`);

            // Get file content from git
            const content = await git.show([`${ref}:${relativePath}`]);
            return content;
        } catch (error) {
            // File might be new (untracked), return empty content
            log(`Could not get git content: ${error}`, 'warn');
            return '';
        }
    }

    /**
     * Notify that a document has changed
     */
    public refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    public dispose(): void {
        this._onDidChange.dispose();
        gitInstances.clear();
    }
}

/**
 * Content provider for showing snapshot content
 */
export class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: gitcl-snapshot:relativePath?id=changelistId_timestamp
        const params = new URLSearchParams(uri.query);
        const id = params.get('id') || '';

        const content = snapshotContent.get(id);
        return content || '';
    }

    public refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    public dispose(): void {
        this._onDidChange.dispose();
    }
}

/**
 * Create a URI for viewing original git content
 * @param relativePath - Path relative to repo root
 * @param ref - Git reference (e.g., 'HEAD')
 * @param repoPath - Optional repository path for multi-repo support
 */
export function createGitUri(relativePath: string, ref: string = 'HEAD', repoPath?: string): vscode.Uri {
    let query = `ref=${ref}`;
    if (repoPath) {
        query += `&repo=${encodeURIComponent(repoPath)}`;
    }
    return vscode.Uri.parse(`${GIT_CHANGELIST_SCHEME}:${relativePath}?${query}`);
}

/**
 * Create a URI for viewing snapshot content
 */
export function createSnapshotUri(
    relativePath: string,
    changelistId: string,
    content: string,
    timestamp: number,
    repoPath?: string
): vscode.Uri {
    const id = `${changelistId}_${timestamp}`;
    snapshotContent.set(id, content);

    let query = `id=${encodeURIComponent(id)}`;
    if (repoPath) {
        query += `&repo=${encodeURIComponent(repoPath)}`;
    }

    return vscode.Uri.parse(`${SNAPSHOT_SCHEME}:${relativePath}?${query}`);
}

/**
 * Register the git content provider
 */
export function registerGitContentProvider(context: vscode.ExtensionContext): GitContentProvider {
    const gitProvider = new GitContentProvider();
    const snapshotProvider = new SnapshotContentProvider();

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(GIT_CHANGELIST_SCHEME, gitProvider),
        vscode.workspace.registerTextDocumentContentProvider(SNAPSHOT_SCHEME, snapshotProvider),
        gitProvider,
        snapshotProvider
    );

    return gitProvider;
}
