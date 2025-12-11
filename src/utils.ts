import * as vscode from 'vscode';
import * as path from 'path';
import { ChangelistConfig, GitFileStatus } from './types';

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
    const config = vscode.workspace.getConfiguration('gitChangelists');
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
    return vscode.window.showErrorMessage(`Git Changelists: ${message}`, ...actions);
}

/**
 * Show info message
 */
export async function showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showInformationMessage(`Git Changelists: ${message}`, ...actions);
}

/**
 * Show warning message
 */
export async function showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showWarningMessage(`Git Changelists: ${message}`, ...actions);
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
