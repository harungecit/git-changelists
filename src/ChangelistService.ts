import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import {
    Changelist,
    ChangelistState,
    ChangedFile,
    ShelvedFile,
    ChangelistExport,
    GitFileStatus,
    FileVersion,
    GitRepository
} from './types';
import {
    generateId,
    getWorkspaceRoot,
    mapGitStatus,
    getConfig,
    log,
    normalizePath,
    getRepoStateKey,
    getAbsolutePathFromRepo
} from './utils';

const LEGACY_STATE_KEY = 'smartChangelists.state';
const STATE_VERSION = 4; // Bumped for multi-repo support
const SNAPSHOTS_DIR = '.smartchangelists';

/**
 * Service for managing changelists with shelve/unshelve functionality.
 * Each instance manages changelists for a single git repository.
 */
export class ChangelistService implements vscode.Disposable {
    private readonly _onDidChangeChangelists = new vscode.EventEmitter<void>();
    private readonly _onDidChangeFiles = new vscode.EventEmitter<void>();

    public readonly onDidChangeChangelists = this._onDidChangeChangelists.event;
    public readonly onDidChangeFiles = this._onDidChangeFiles.event;

    private git: SimpleGit | undefined;
    private state: ChangelistState;
    private changedFiles: Map<string, ChangedFile> = new Map();
    private disposables: vscode.Disposable[] = [];

    /** Repository this service manages */
    public readonly repository: GitRepository;
    /** State key for this repository */
    private readonly stateKey: string;

    constructor(
        private readonly context: vscode.ExtensionContext,
        repository: GitRepository
    ) {
        this.repository = repository;
        this.stateKey = getRepoStateKey(repository.path);
        this.state = this.loadState();
        this.initGit();
        this.setupWatchers();
        this.ensureSnapshotsDir();
    }

    private ensureSnapshotsDir(): void {
        const config = getConfig();
        if (!config.saveSnapshotsToFile) return;

        const snapshotsDir = path.join(this.repository.path, SNAPSHOTS_DIR);
        if (!fs.existsSync(snapshotsDir)) {
            fs.mkdirSync(snapshotsDir, { recursive: true });
            // Add .gitignore to exclude snapshots from git
            const gitignorePath = path.join(snapshotsDir, '.gitignore');
            fs.writeFileSync(gitignorePath, '*\n!.gitignore\n', 'utf8');
            log(`Created snapshots directory: ${snapshotsDir}`);
        }
    }

    /**
     * Get the file path for a snapshot in .smartchangelists/
     * Format: .smartchangelists/{changelist-name}/{filename}
     */
    public getSnapshotFilePath(shelvedFile: ShelvedFile, changelist: Changelist): string {
        // Sanitize changelist name for folder use
        const sanitizedName = changelist.label.replace(/[<>:"/\\|?*]/g, '_');
        const fileName = path.basename(shelvedFile.relativePath);
        return path.join(this.repository.path, SNAPSHOTS_DIR, sanitizedName, fileName);
    }

    /**
     * Save snapshot content to file for CLI tool access (Claude Code, Gemini, etc.)
     */
    private async saveSnapshotToFile(shelvedFile: ShelvedFile, changelist: Changelist): Promise<void> {
        const config = getConfig();
        if (!config.saveSnapshotsToFile) return;
        if (!shelvedFile.originalContent) return;

        const snapshotPath = this.getSnapshotFilePath(shelvedFile, changelist);
        const snapshotDir = path.dirname(snapshotPath);

        try {
            if (!fs.existsSync(snapshotDir)) {
                fs.mkdirSync(snapshotDir, { recursive: true });
            }
            fs.writeFileSync(snapshotPath, shelvedFile.originalContent, 'utf8');
            log(`Saved snapshot file: ${snapshotPath}`);
        } catch (error) {
            log(`Failed to save snapshot file: ${error}`, 'warn');
        }
    }

    /**
     * Delete snapshot file when snapshot is deleted
     */
    private deleteSnapshotFile(shelvedFile: ShelvedFile, changelist: Changelist): void {
        const config = getConfig();
        if (!config.saveSnapshotsToFile) return;

        const snapshotPath = this.getSnapshotFilePath(shelvedFile, changelist);
        try {
            if (fs.existsSync(snapshotPath)) {
                fs.unlinkSync(snapshotPath);
                log(`Deleted snapshot file: ${snapshotPath}`);
            }
        } catch (error) {
            log(`Failed to delete snapshot file: ${error}`, 'warn');
        }
    }

    private initGit(): void {
        this.git = simpleGit(this.repository.path);
        log(`Git initialized at: ${this.repository.path} (${this.repository.name})`);
    }

    private setupWatchers(): void {
        const config = getConfig();

        if (config.autoRefreshOnSave) {
            const watcher = vscode.workspace.createFileSystemWatcher('**/*');
            this.disposables.push(
                watcher.onDidChange(() => this.refresh()),
                watcher.onDidCreate(() => this.refresh()),
                watcher.onDidDelete(() => this.refresh()),
                watcher
            );
            this.disposables.push(
                vscode.workspace.onDidSaveTextDocument(() => this.refresh())
            );
        }

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smartChangelists')) {
                    this._onDidChangeChangelists.fire();
                }
            })
        );
    }

    private loadState(): ChangelistState {
        // Try to load repo-specific state
        const stored = this.context.workspaceState.get<ChangelistState>(this.stateKey);

        if (stored && stored.version === STATE_VERSION) {
            log(`State loaded from workspaceState for ${this.repository.name}`);
            return stored;
        }

        // Try migration from legacy state (single-repo format)
        const migratedState = this.tryMigrateLegacyState();
        if (migratedState) {
            log(`Migrated legacy state to repo-specific state for ${this.repository.name}`);
            this.saveState(migratedState);
            return migratedState;
        }

        // Try migration from older version of repo-specific state
        if (stored && stored.version < STATE_VERSION) {
            const upgradedState = this.upgradeState(stored);
            log(`Upgraded state from v${stored.version} to v${STATE_VERSION} for ${this.repository.name}`);
            this.saveState(upgradedState);
            return upgradedState;
        }

        // Initialize default state
        const defaultId = generateId();
        const defaultState: ChangelistState = {
            version: STATE_VERSION,
            activeChangelistId: defaultId,
            changelists: [
                {
                    id: defaultId,
                    label: 'Default Changelist',
                    shelvedFiles: [],
                    isDefault: true,
                    isActive: true,
                    repoPath: this.repository.path
                }
            ]
        };

        log(`Created default state for ${this.repository.name}`);
        this.saveState(defaultState);
        return defaultState;
    }

    /**
     * Try to migrate legacy single-repo state to new multi-repo format.
     * Only migrates if this is the first/primary workspace folder.
     */
    private tryMigrateLegacyState(): ChangelistState | null {
        const legacyState = this.context.workspaceState.get<ChangelistState>(LEGACY_STATE_KEY);
        if (!legacyState) return null;

        // Only migrate if this is the workspace root (backward compat)
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot || normalizePath(this.repository.path) !== normalizePath(workspaceRoot)) {
            return null;
        }

        log(`Migrating legacy state to repo-specific format for ${this.repository.name}`);

        // Add repoPath to all changelists and shelved files
        const migratedChangelists = legacyState.changelists.map(cl => ({
            ...cl,
            repoPath: this.repository.path,
            shelvedFiles: cl.shelvedFiles.map(sf => ({
                ...sf,
                repoPath: this.repository.path
            }))
        }));

        return {
            version: STATE_VERSION,
            activeChangelistId: legacyState.activeChangelistId,
            changelists: migratedChangelists
        };
    }

    /**
     * Upgrade state from older version
     */
    private upgradeState(oldState: ChangelistState): ChangelistState {
        // Add repoPath to changelists if missing
        const upgradedChangelists = oldState.changelists.map(cl => ({
            ...cl,
            repoPath: cl.repoPath || this.repository.path,
            shelvedFiles: cl.shelvedFiles.map(sf => ({
                ...sf,
                repoPath: sf.repoPath || this.repository.path
            }))
        }));

        return {
            version: STATE_VERSION,
            activeChangelistId: oldState.activeChangelistId,
            changelists: upgradedChangelists
        };
    }

    private async saveState(state?: ChangelistState): Promise<void> {
        const stateToSave = state || this.state;
        await this.context.workspaceState.update(this.stateKey, stateToSave);
        log(`State saved for ${this.repository.name}`);
    }

    public async refresh(): Promise<void> {
        if (!this.git) {
            log('Git not initialized', 'warn');
            return;
        }

        try {
            const status = await this.git.status();
            this.updateChangedFiles(status);
            this._onDidChangeFiles.fire();
            log(`Refreshed: ${this.changedFiles.size} changed files`);
        } catch (error) {
            log(`Error refreshing git status: ${error}`, 'error');
        }
    }

    private updateChangedFiles(status: StatusResult): void {
        this.changedFiles.clear();

        const processFile = (filePath: string, gitStatus: GitFileStatus, originalPath?: string) => {
            const relativePath = normalizePath(filePath);
            const absolutePath = getAbsolutePathFromRepo(relativePath, this.repository.path);

            this.changedFiles.set(relativePath, {
                absolutePath,
                relativePath,
                status: gitStatus,
                originalPath: originalPath ? normalizePath(originalPath) : undefined,
                repoPath: this.repository.path
            });
        };

        status.modified.forEach(f => processFile(f, 'modified'));
        status.not_added.forEach(f => processFile(f, 'untracked'));
        status.created.forEach(f => processFile(f, 'added'));
        status.deleted.forEach(f => processFile(f, 'deleted'));
        status.renamed.forEach(r => processFile(r.to, 'renamed', r.from));
        status.conflicted.forEach(f => processFile(f, 'conflicted'));

        status.files.forEach(f => {
            const relativePath = normalizePath(f.path);
            if (!this.changedFiles.has(relativePath)) {
                const gitStatus = mapGitStatus(f.index, f.working_dir);
                processFile(f.path, gitStatus);
            }
        });
    }

    // ========== Changelist CRUD Operations ==========

    public getChangelists(): Changelist[] {
        return [...this.state.changelists];
    }

    public getChangelist(id: string): Changelist | undefined {
        return this.state.changelists.find(cl => cl.id === id);
    }

    public getDefaultChangelist(): Changelist {
        const defaultCl = this.state.changelists.find(cl => cl.isDefault);
        if (!defaultCl) {
            throw new Error('Default changelist not found');
        }
        return defaultCl;
    }

    public getActiveChangelist(): Changelist {
        const activeCl = this.state.changelists.find(cl => cl.isActive);
        return activeCl || this.getDefaultChangelist();
    }

    public async createChangelist(label: string): Promise<Changelist> {
        const id = generateId();
        const changelist: Changelist = {
            id,
            label,
            shelvedFiles: [],
            isDefault: false,
            isActive: false,
            repoPath: this.repository.path
        };

        this.state.changelists.push(changelist);
        await this.saveState();
        this._onDidChangeChangelists.fire();

        log(`Created changelist: ${label} in ${this.repository.name}`);
        return changelist;
    }

    public async renameChangelist(id: string, newLabel: string): Promise<void> {
        const changelist = this.getChangelist(id);
        if (!changelist) {
            throw new Error(`Changelist not found: ${id}`);
        }

        changelist.label = newLabel;
        await this.saveState();
        this._onDidChangeChangelists.fire();

        log(`Renamed changelist to: ${newLabel}`);
    }

    public async deleteChangelist(id: string): Promise<void> {
        const changelist = this.getChangelist(id);
        if (!changelist) {
            throw new Error(`Changelist not found: ${id}`);
        }

        if (changelist.isDefault) {
            throw new Error('Cannot delete default changelist');
        }

        // Unshelve all files back to working directory before deleting
        if (changelist.shelvedFiles.length > 0) {
            for (const shelvedFile of changelist.shelvedFiles) {
                await this.unshelveFileInternal(shelvedFile);
            }
        }

        this.state.changelists = this.state.changelists.filter(cl => cl.id !== id);

        if (changelist.isActive) {
            const defaultCl = this.getDefaultChangelist();
            defaultCl.isActive = true;
            this.state.activeChangelistId = defaultCl.id;
        }

        await this.saveState();
        await this.refresh();
        this._onDidChangeChangelists.fire();

        log(`Deleted changelist: ${changelist.label}`);
    }

    public async setActiveChangelist(id: string): Promise<void> {
        const changelist = this.getChangelist(id);
        if (!changelist) {
            throw new Error(`Changelist not found: ${id}`);
        }

        for (const cl of this.state.changelists) {
            cl.isActive = false;
        }

        changelist.isActive = true;
        this.state.activeChangelistId = id;

        await this.saveState();
        this._onDidChangeChangelists.fire();

        log(`Set active changelist: ${changelist.label}`);
    }

    // ========== File Operations ==========

    public getChangedFiles(): ChangedFile[] {
        return Array.from(this.changedFiles.values());
    }

    public getShelvedFilesForChangelist(changelistId: string): ShelvedFile[] {
        const changelist = this.getChangelist(changelistId);
        if (!changelist) return [];
        return changelist.shelvedFiles;
    }

    /**
     * Get all versions of a specific file across all changelists.
     * Returns versions sorted by timestamp (newest first).
     */
    public getFileVersions(relativePath: string): FileVersion[] {
        const versions: FileVersion[] = [];
        const normalizedPath = normalizePath(relativePath);

        for (const changelist of this.state.changelists) {
            for (const shelvedFile of changelist.shelvedFiles) {
                if (normalizePath(shelvedFile.relativePath) === normalizedPath) {
                    versions.push({
                        changelist,
                        shelvedFile,
                        label: changelist.label,
                        timestamp: shelvedFile.shelvedAt
                    });
                }
            }
        }

        // Sort by timestamp (newest first)
        return versions.sort((a, b) => b.timestamp - a.timestamp);
    }

    // ========== Shelve/Unshelve Operations ==========

    /**
     * Save a snapshot of the file to a changelist.
     * This saves the FULL CONTENT of the file WITHOUT reverting it.
     * The file stays as-is in the working directory so you can continue editing.
     */
    public async shelveFile(relativePath: string, targetChangelistId: string): Promise<void> {
        if (!this.git) {
            throw new Error('Git not initialized');
        }

        const normalizedPath = normalizePath(relativePath);
        const file = this.changedFiles.get(normalizedPath);
        if (!file) {
            throw new Error(`File not found in changes: ${relativePath}`);
        }

        const changelist = this.getChangelist(targetChangelistId);
        if (!changelist) {
            throw new Error(`Changelist not found: ${targetChangelistId}`);
        }

        if (changelist.isDefault) {
            throw new Error('Cannot save to default changelist');
        }

        const absolutePath = getAbsolutePathFromRepo(normalizedPath, this.repository.path);

        try {
            // Save the full current content of the file
            let currentContent: string | undefined;
            let headContent: string | undefined;

            if (file.status === 'deleted') {
                // File was deleted, no current content
                currentContent = undefined;
            } else if (fs.existsSync(absolutePath)) {
                currentContent = fs.readFileSync(absolutePath, 'utf8');
            }

            // Get HEAD content for tracked files
            if (file.status !== 'untracked') {
                try {
                    headContent = await this.git.show([`HEAD:${normalizedPath}`]);
                } catch {
                    // File doesn't exist in HEAD (newly added)
                    headContent = undefined;
                }
            }

            // Check if this file already exists in the changelist
            const existingIndex = changelist.shelvedFiles.findIndex(
                f => normalizePath(f.relativePath) === normalizedPath
            );

            // Create snapshot entry with FULL content
            const shelvedFile: ShelvedFile = {
                relativePath: normalizedPath,
                status: file.status,
                patch: '', // Not used anymore
                originalContent: currentContent, // This is the saved version
                headContent, // This is what HEAD has
                shelvedAt: Date.now(),
                originalPath: file.originalPath,
                repoPath: this.repository.path
            };

            if (existingIndex >= 0) {
                // Replace existing snapshot
                changelist.shelvedFiles[existingIndex] = shelvedFile;
                log(`Updated snapshot: ${relativePath} in ${changelist.label}`);
            } else {
                // Add new snapshot
                changelist.shelvedFiles.push(shelvedFile);
                log(`Saved snapshot: ${relativePath} to ${changelist.label}`);
            }

            // Save snapshot to file for CLI tool access
            await this.saveSnapshotToFile(shelvedFile, changelist);

            // DO NOT revert the file - leave it as-is so user can continue working
            // The file stays in working directory with current changes

            await this.saveState();
            this._onDidChangeChangelists.fire();
        } catch (error) {
            log(`Failed to save snapshot: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Shelve multiple files
     */
    public async shelveFiles(relativePaths: string[], targetChangelistId: string): Promise<void> {
        for (const path of relativePaths) {
            await this.shelveFile(path, targetChangelistId);
        }
    }

    /**
     * Restore a file from a snapshot: replace working file with saved version.
     * The snapshot is KEPT in the changelist (not removed) so you can restore again.
     */
    public async unshelveFile(changelistId: string, relativePath: string): Promise<void> {
        const changelist = this.getChangelist(changelistId);
        if (!changelist) {
            throw new Error(`Changelist not found: ${changelistId}`);
        }

        const normalizedPath = normalizePath(relativePath);
        const shelvedFile = changelist.shelvedFiles.find(
            f => normalizePath(f.relativePath) === normalizedPath
        );

        if (!shelvedFile) {
            throw new Error(`File not found in changelist: ${relativePath}`);
        }

        // Restore the saved content to working directory
        await this.unshelveFileInternal(shelvedFile);

        // DO NOT remove from changelist - keep the snapshot for future restores
        // User can manually delete if they don't need it anymore

        await this.refresh();
        this._onDidChangeChangelists.fire();

        log(`Restored file: ${relativePath} from ${changelist.label}`);
    }

    /**
     * Apply a snapshot and stage it for commit.
     * This restores the file AND runs git add on it.
     */
    public async applyAndStage(changelistId: string, relativePath: string): Promise<void> {
        if (!this.git) {
            throw new Error('Git not initialized');
        }

        const changelist = this.getChangelist(changelistId);
        if (!changelist) {
            throw new Error(`Changelist not found: ${changelistId}`);
        }

        const normalizedPath = normalizePath(relativePath);
        const shelvedFile = changelist.shelvedFiles.find(
            f => normalizePath(f.relativePath) === normalizedPath
        );

        if (!shelvedFile) {
            throw new Error(`File not found in changelist: ${relativePath}`);
        }

        // Restore the saved content to working directory
        await this.unshelveFileInternal(shelvedFile);

        // Stage the file for commit
        await this.git.add([normalizedPath]);

        await this.refresh();
        this._onDidChangeChangelists.fire();

        log(`Applied and staged: ${relativePath} from ${changelist.label}`);
    }

    /**
     * Apply all snapshots from a changelist and stage them for commit.
     */
    public async applyAllAndStage(changelistId: string): Promise<void> {
        if (!this.git) {
            throw new Error('Git not initialized');
        }

        const changelist = this.getChangelist(changelistId);
        if (!changelist) {
            throw new Error(`Changelist not found: ${changelistId}`);
        }

        if (changelist.shelvedFiles.length === 0) {
            throw new Error('No files in changelist');
        }

        // Restore all files
        for (const shelvedFile of changelist.shelvedFiles) {
            await this.unshelveFileInternal(shelvedFile);
        }

        // Stage all files
        const filePaths = changelist.shelvedFiles.map(f => f.relativePath);
        await this.git.add(filePaths);

        await this.refresh();
        this._onDidChangeChangelists.fire();

        log(`Applied and staged all from: ${changelist.label}`);
    }

    /**
     * Internal unshelve logic - restores the shelved content directly
     */
    private async unshelveFileInternal(shelvedFile: ShelvedFile): Promise<void> {
        // Use shelved file's repo path if available, otherwise use this service's repo
        const repoPath = shelvedFile.repoPath || this.repository.path;
        const absolutePath = getAbsolutePathFromRepo(shelvedFile.relativePath, repoPath);

        try {
            if (shelvedFile.status === 'deleted') {
                // File was deleted - delete it again
                if (fs.existsSync(absolutePath)) {
                    fs.unlinkSync(absolutePath);
                }
            } else if (shelvedFile.originalContent !== undefined) {
                // Restore the full content of the shelved file
                const dir = path.dirname(absolutePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(absolutePath, shelvedFile.originalContent, 'utf8');
            } else if (shelvedFile.patch) {
                // Legacy: apply patch for old shelved files
                if (!this.git) {
                    throw new Error('Git not initialized');
                }
                const patchPath = path.join(this.repository.path, '.git', 'temp-patch.patch');
                fs.writeFileSync(patchPath, shelvedFile.patch, 'utf8');

                try {
                    await this.git.raw(['apply', patchPath]);
                } finally {
                    if (fs.existsSync(patchPath)) {
                        fs.unlinkSync(patchPath);
                    }
                }
            }
        } catch (error) {
            log(`Failed to unshelve file: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Restore all files from a changelist to working directory.
     * Snapshots are KEPT in the changelist.
     */
    public async unshelveAll(changelistId: string): Promise<void> {
        const changelist = this.getChangelist(changelistId);
        if (!changelist) {
            throw new Error(`Changelist not found: ${changelistId}`);
        }

        for (const shelvedFile of changelist.shelvedFiles) {
            await this.unshelveFileInternal(shelvedFile);
        }

        // DO NOT clear shelvedFiles - keep snapshots for future restores

        await this.refresh();
        this._onDidChangeChangelists.fire();

        log(`Restored all files from: ${changelist.label}`);
    }

    // ========== Git Operations ==========

    /**
     * Commit working directory changes (default changelist)
     */
    public async commitWorkingChanges(message: string): Promise<void> {
        if (!this.git) {
            throw new Error('Git not initialized');
        }

        const files = this.getChangedFiles();
        if (files.length === 0) {
            throw new Error('No files to commit');
        }

        try {
            const filePaths = files.map(f => f.relativePath);
            await this.git.add(filePaths);
            await this.git.commit(message);

            log(`Committed ${files.length} files`);
            await this.refresh();
        } catch (error) {
            log(`Commit failed: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Commit a shelved changelist: unshelve, commit, done
     */
    public async commitChangelist(changelistId: string, message: string): Promise<void> {
        if (!this.git) {
            throw new Error('Git not initialized');
        }

        const changelist = this.getChangelist(changelistId);
        if (!changelist) {
            throw new Error(`Changelist not found: ${changelistId}`);
        }

        if (changelist.isDefault) {
            // Commit current working changes
            return this.commitWorkingChanges(message);
        }

        if (changelist.shelvedFiles.length === 0) {
            throw new Error('No shelved files to commit');
        }

        try {
            // First, stash current working changes if any
            const hasWorkingChanges = this.changedFiles.size > 0;
            if (hasWorkingChanges) {
                await this.git.stash(['push', '-m', 'git-changelists-temp']);
            }

            // Unshelve the changelist files
            for (const shelvedFile of changelist.shelvedFiles) {
                await this.unshelveFileInternal(shelvedFile);
            }

            // Stage and commit
            const filePaths = changelist.shelvedFiles.map(f => f.relativePath);
            await this.git.add(filePaths);
            await this.git.commit(message);

            // Clear the shelved files
            changelist.shelvedFiles = [];

            // Restore working changes
            if (hasWorkingChanges) {
                await this.git.stash(['pop']);
            }

            await this.saveState();
            await this.refresh();
            this._onDidChangeChangelists.fire();

            log(`Committed changelist: ${changelist.label}`);
        } catch (error) {
            log(`Commit changelist failed: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Revert a file in working directory
     */
    public async revertFile(relativePath: string): Promise<void> {
        if (!this.git) {
            throw new Error('Git not initialized');
        }

        const normalizedPath = normalizePath(relativePath);
        const file = this.changedFiles.get(normalizedPath);
        if (!file) {
            throw new Error(`File not found: ${relativePath}`);
        }

        try {
            if (file.status === 'untracked') {
                const absolutePath = getAbsolutePathFromRepo(normalizedPath, this.repository.path);
                fs.unlinkSync(absolutePath);
            } else {
                await this.git.checkout(['--', normalizedPath]);
            }

            log(`Reverted file: ${relativePath}`);
            await this.refresh();
        } catch (error) {
            log(`Revert failed: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Delete a shelved file (discard without unshelving)
     */
    public async deleteShelvedFile(changelistId: string, relativePath: string): Promise<void> {
        const changelist = this.getChangelist(changelistId);
        if (!changelist) {
            throw new Error(`Changelist not found: ${changelistId}`);
        }

        const normalizedPath = normalizePath(relativePath);
        const shelvedFile = changelist.shelvedFiles.find(
            f => normalizePath(f.relativePath) === normalizedPath
        );

        // Delete snapshot file
        if (shelvedFile) {
            this.deleteSnapshotFile(shelvedFile, changelist);
        }

        changelist.shelvedFiles = changelist.shelvedFiles.filter(
            f => normalizePath(f.relativePath) !== normalizedPath
        );

        await this.saveState();
        this._onDidChangeChangelists.fire();

        log(`Deleted shelved file: ${relativePath}`);
    }

    // ========== Export/Import ==========

    public exportChangelists(): ChangelistExport {
        return {
            version: 2,
            changelists: this.state.changelists
                .filter(cl => !cl.isDefault && cl.shelvedFiles.length > 0)
                .map(cl => ({
                    label: cl.label,
                    shelvedFiles: cl.shelvedFiles
                })),
            exportedAt: new Date().toISOString()
        };
    }

    public async importChangelists(data: ChangelistExport): Promise<number> {
        if (!data.changelists || !Array.isArray(data.changelists)) {
            throw new Error('Invalid import data');
        }

        let imported = 0;

        for (const item of data.changelists) {
            if (item.label && Array.isArray(item.shelvedFiles)) {
                const changelist = await this.createChangelist(item.label);
                changelist.shelvedFiles = item.shelvedFiles;
                imported++;
            }
        }

        await this.saveState();
        this._onDidChangeChangelists.fire();

        log(`Imported ${imported} changelists`);
        return imported;
    }

    public dispose(): void {
        this._onDidChangeChangelists.dispose();
        this._onDidChangeFiles.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
