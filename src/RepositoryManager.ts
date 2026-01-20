import * as vscode from 'vscode';
import { GitRepository } from './types';
import {
    getAllWorkspaceFolders,
    findGitRepositories,
    getRepoForFile,
    log
} from './utils';

/**
 * Manages all git repositories in the workspace.
 * Handles multi-root workspaces and nested repositories/submodules.
 */
export class RepositoryManager implements vscode.Disposable {
    private repositories: Map<string, GitRepository> = new Map();
    private disposables: vscode.Disposable[] = [];

    private readonly _onDidChangeRepositories = new vscode.EventEmitter<void>();
    public readonly onDidChangeRepositories = this._onDidChangeRepositories.event;

    constructor() {
        this.setupWatchers();
    }

    /**
     * Initialize the repository manager by scanning all workspace folders
     */
    public async initialize(): Promise<void> {
        log('RepositoryManager: Initializing...');
        await this.scanRepositories();
        log(`RepositoryManager: Found ${this.repositories.size} repository(ies)`);
    }

    /**
     * Scan all workspace folders for git repositories
     */
    private async scanRepositories(): Promise<void> {
        this.repositories.clear();

        const workspaceFolders = getAllWorkspaceFolders();

        for (const folder of workspaceFolders) {
            const repos = findGitRepositories(folder.uri.fsPath);
            for (const repo of repos) {
                this.repositories.set(repo.path, repo);
                log(`RepositoryManager: Found repo: ${repo.name} at ${repo.path}${repo.isSubmodule ? ' (submodule)' : ''}`);
            }
        }
    }

    /**
     * Set up workspace folder change listeners
     */
    private setupWatchers(): void {
        // Listen for workspace folder changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
                log(`RepositoryManager: Workspace folders changed (added: ${e.added.length}, removed: ${e.removed.length})`);

                // Remove repositories from removed folders
                for (const folder of e.removed) {
                    const folderPath = folder.uri.fsPath;
                    for (const [repoPath] of this.repositories) {
                        if (repoPath.startsWith(folderPath)) {
                            this.repositories.delete(repoPath);
                            log(`RepositoryManager: Removed repo: ${repoPath}`);
                        }
                    }
                }

                // Scan added folders for repositories
                for (const folder of e.added) {
                    const repos = findGitRepositories(folder.uri.fsPath);
                    for (const repo of repos) {
                        this.repositories.set(repo.path, repo);
                        log(`RepositoryManager: Added repo: ${repo.name} at ${repo.path}`);
                    }
                }

                this._onDidChangeRepositories.fire();
            })
        );

        // Listen for .git folder creation/deletion within workspace
        const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git');
        this.disposables.push(
            gitWatcher,
            gitWatcher.onDidCreate(async (uri) => {
                // New .git directory created - rescan
                log(`RepositoryManager: .git created at ${uri.fsPath}`);
                await this.scanRepositories();
                this._onDidChangeRepositories.fire();
            }),
            gitWatcher.onDidDelete(async (uri) => {
                // .git directory deleted - rescan
                log(`RepositoryManager: .git deleted at ${uri.fsPath}`);
                await this.scanRepositories();
                this._onDidChangeRepositories.fire();
            })
        );
    }

    /**
     * Get all discovered repositories
     */
    public getRepositories(): GitRepository[] {
        return Array.from(this.repositories.values());
    }

    /**
     * Get a repository by its path
     */
    public getRepository(repoPath: string): GitRepository | undefined {
        return this.repositories.get(repoPath);
    }

    /**
     * Get the repository that contains a given file
     */
    public getRepositoryForFile(filePath: string): GitRepository | undefined {
        return getRepoForFile(filePath, this.getRepositories());
    }

    /**
     * Check if there are any repositories
     */
    public hasRepositories(): boolean {
        return this.repositories.size > 0;
    }

    /**
     * Check if there are multiple repositories
     */
    public hasMultipleRepositories(): boolean {
        return this.repositories.size > 1;
    }

    /**
     * Refresh repositories by rescanning
     */
    public async refresh(): Promise<void> {
        log('RepositoryManager: Refreshing...');
        await this.scanRepositories();
        this._onDidChangeRepositories.fire();
    }

    public dispose(): void {
        this._onDidChangeRepositories.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
