import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ChangelistConfig, GitFileStatus, GitRepository } from './types';

/**
 * Generate a unique ID for changelists
 */
export function generateId(): string {
    return `cl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get the workspace root path
 */
export function getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return undefined;
}

/**
 * Convert absolute path to relative path from workspace root
 */
export function toRelativePath(absolutePath: string): string {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return absolutePath;
    }
    return path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
}

/**
 * Convert relative path to absolute path
 */
export function toAbsolutePath(relativePath: string): string {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return relativePath;
    }
    return path.join(workspaceRoot, relativePath);
}

/**
 * Normalize path separators to forward slashes
 */
export function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

/**
 * Get file name from path
 */
export function getFileName(filePath: string): string {
    return path.basename(filePath);
}

/**
 * Get directory name from path
 */
export function getDirName(filePath: string): string {
    return path.dirname(filePath);
}

/**
 * Map simple-git status to our GitFileStatus
 */
export function mapGitStatus(index: string, workingDir: string): GitFileStatus {
    // Prioritize working directory status
    if (workingDir === 'M' || index === 'M') return 'modified';
    if (workingDir === 'D' || index === 'D') return 'deleted';
    if (workingDir === 'A' || index === 'A') return 'added';
    if (workingDir === 'R' || index === 'R') return 'renamed';
    if (workingDir === 'C' || index === 'C') return 'copied';
    if (workingDir === '?' || index === '?') return 'untracked';
    if (workingDir === '!' || index === '!') return 'ignored';
    if (workingDir === 'U' || index === 'U') return 'conflicted';

    // Default to modified
    return 'modified';
}

/**
 * Get extension configuration
 */
export function getConfig(): ChangelistConfig {
    const config = vscode.workspace.getConfiguration('smartChangelists');
    return {
        showEmptyChangelists: config.get('showEmptyChangelists', true),
        autoRefreshOnSave: config.get('autoRefreshOnSave', true),
        confirmBeforeCommit: config.get('confirmBeforeCommit', true),
        confirmBeforeRevert: config.get('confirmBeforeRevert', true),
        saveSnapshotsToFile: config.get('saveSnapshotsToFile', false),
        enableVersionComparison: config.get('enableVersionComparison', false)
    };
}

/**
 * Show error message with optional actions
 */
export async function showError(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showErrorMessage(`Smart Changelists: ${message}`, ...actions);
}

/**
 * Show info message
 */
export async function showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showInformationMessage(`Smart Changelists: ${message}`, ...actions);
}

/**
 * Show warning message
 */
export async function showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showWarningMessage(`Smart Changelists: ${message}`, ...actions);
}

/**
 * Prompt for text input
 */
export async function promptInput(options: {
    prompt: string;
    placeholder?: string;
    value?: string;
    validateInput?: (value: string) => string | undefined;
}): Promise<string | undefined> {
    return vscode.window.showInputBox({
        prompt: options.prompt,
        placeHolder: options.placeholder,
        value: options.value,
        validateInput: options.validateInput
    });
}

/**
 * Prompt for selection from list
 */
export async function promptSelect<T extends vscode.QuickPickItem>(
    items: T[],
    options: {
        placeholder?: string;
        canPickMany?: boolean;
    } = {}
): Promise<T | T[] | undefined> {
    if (options.canPickMany) {
        return vscode.window.showQuickPick(items, {
            placeHolder: options.placeholder,
            canPickMany: true
        });
    }
    return vscode.window.showQuickPick(items, {
        placeHolder: options.placeholder
    });
}

/**
 * Prompt for confirmation
 */
export async function promptConfirm(message: string): Promise<boolean> {
    const result = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Yes',
        'No'
    );
    return result === 'Yes';
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: unknown[]) => void>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | undefined;
    return (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: unknown[]) => void>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let lastCall = 0;
    return (...args: Parameters<T>) => {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            fn(...args);
        }
    };
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Check if path is inside workspace
 */
export function isInWorkspace(filePath: string): boolean {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return false;

    const normalizedPath = normalizePath(path.resolve(filePath));
    const normalizedRoot = normalizePath(path.resolve(workspaceRoot));

    return normalizedPath.startsWith(normalizedRoot);
}

/**
 * Log message to output channel
 */
let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(channel: vscode.OutputChannel): void {
    outputChannel = channel;
}

export function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const timestamp = formatDate(new Date());
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    outputChannel?.appendLine(formattedMessage);

    if (level === 'error') {
        console.error(formattedMessage);
    }
}

// ========== Multi-Repository Utilities ==========

/**
 * Get all workspace folders
 */
export function getAllWorkspaceFolders(): vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders || [];
}

/**
 * Check if a directory contains a .git folder
 */
export function hasGitDir(dirPath: string): boolean {
    const gitPath = path.join(dirPath, '.git');
    return fs.existsSync(gitPath);
}

/**
 * Check if a .git path is a file (submodule) or directory (regular repo)
 */
export function isGitSubmodule(dirPath: string): boolean {
    const gitPath = path.join(dirPath, '.git');
    if (!fs.existsSync(gitPath)) return false;

    const stats = fs.statSync(gitPath);
    return stats.isFile(); // Submodules have .git as a file pointing to the parent's .git
}

/**
 * Find all git repositories in a directory (including nested repos/submodules)
 */
export function findGitRepositories(rootPath: string, parentRepoPath?: string): GitRepository[] {
    const repos: GitRepository[] = [];

    // Check if the root itself is a git repo
    if (hasGitDir(rootPath)) {
        const isSubmodule = isGitSubmodule(rootPath);
        repos.push({
            path: rootPath,
            name: path.basename(rootPath),
            isSubmodule,
            parentRepoPath
        });

        // Look for submodules/nested repos inside
        findNestedRepos(rootPath, rootPath, repos);
    }

    return repos;
}

/**
 * Recursively find nested git repositories (submodules)
 */
function findNestedRepos(searchPath: string, parentRepoPath: string, repos: GitRepository[]): void {
    try {
        const entries = fs.readdirSync(searchPath, { withFileTypes: true });

        for (const entry of entries) {
            // Skip .git directory, node_modules, and other common directories
            if (entry.name === '.git' ||
                entry.name === 'node_modules' ||
                entry.name === '.smartchangelists' ||
                entry.name === 'vendor' ||
                entry.name === 'dist' ||
                entry.name === 'build') {
                continue;
            }

            if (entry.isDirectory()) {
                const fullPath = path.join(searchPath, entry.name);

                // Check if this directory is a git repo
                if (hasGitDir(fullPath)) {
                    const isSubmodule = isGitSubmodule(fullPath);
                    repos.push({
                        path: fullPath,
                        name: entry.name,
                        isSubmodule,
                        parentRepoPath
                    });

                    // Recursively search inside for nested repos
                    findNestedRepos(fullPath, fullPath, repos);
                } else {
                    // Not a git repo, continue searching deeper (but limit depth)
                    const depth = fullPath.split(path.sep).length - parentRepoPath.split(path.sep).length;
                    if (depth < 5) { // Limit recursion depth
                        findNestedRepos(fullPath, parentRepoPath, repos);
                    }
                }
            }
        }
    } catch (error) {
        // Ignore permission errors and continue
        log(`Error scanning ${searchPath}: ${error}`, 'warn');
    }
}

/**
 * Find the git repository that contains a given file
 */
export function getRepoForFile(filePath: string, repositories: GitRepository[]): GitRepository | undefined {
    const normalizedFilePath = normalizePath(path.resolve(filePath));

    // Sort repositories by path length (descending) to find the most specific match
    const sortedRepos = [...repositories].sort((a, b) => b.path.length - a.path.length);

    for (const repo of sortedRepos) {
        const normalizedRepoPath = normalizePath(path.resolve(repo.path));
        if (normalizedFilePath.startsWith(normalizedRepoPath + '/') ||
            normalizedFilePath === normalizedRepoPath) {
            return repo;
        }
    }

    return undefined;
}

/**
 * Get relative path from a repository root
 */
export function getRelativePathFromRepo(filePath: string, repoPath: string): string {
    return path.relative(repoPath, filePath).replace(/\\/g, '/');
}

/**
 * Get absolute path from a repository-relative path
 */
export function getAbsolutePathFromRepo(relativePath: string, repoPath: string): string {
    return path.join(repoPath, relativePath);
}

/**
 * Generate a unique hash for a repository path (for state key)
 */
export function getRepoHash(repoPath: string): string {
    const normalizedPath = normalizePath(path.resolve(repoPath));
    return crypto.createHash('md5').update(normalizedPath).digest('hex').substring(0, 8);
}

/**
 * Get the state key for a repository
 */
export function getRepoStateKey(repoPath: string): string {
    return `smartChangelists.state.${getRepoHash(repoPath)}`;
}
