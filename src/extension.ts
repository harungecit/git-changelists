import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChangelistService } from './ChangelistService';
import { RepositoryManager } from './RepositoryManager';
import { ChangelistTreeProvider, registerChangelistTreeView } from './ChangelistTreeProvider';
import { registerGitContentProvider, createGitUri, createSnapshotUri } from './GitContentProvider';
import { ChangelistExport, ShelvedFile, GitRepository } from './types';
import {
    getWorkspaceRoot,
    initLogger,
    log,
    promptInput,
    promptSelect,
    promptConfirm,
    showInfo,
    showError,
    showWarning,
    getConfig,
    getAbsolutePathFromRepo
} from './utils';

let repoManager: RepositoryManager | undefined;
let treeProvider: ChangelistTreeProvider | undefined;
let outputChannel: vscode.OutputChannel | undefined;

// Map of repository path to service
const services: Map<string, ChangelistService> = new Map();

/**
 * Activate the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Smart Changelists');
    initLogger(outputChannel);

    log('Activating Smart Changelists extension v2.0.0');

    // Always enable the extension - Activity Bar should always be visible
    vscode.commands.executeCommand('setContext', 'smartChangelists.enabled', true);

    // Initialize repository manager
    repoManager = new RepositoryManager();
    await repoManager.initialize();

    // Create tree provider
    treeProvider = new ChangelistTreeProvider();

    // Create services for each repository
    for (const repo of repoManager.getRepositories()) {
        await createServiceForRepo(context, repo);
    }

    // Register tree view
    registerChangelistTreeView(context, treeProvider);

    // Register git content provider
    registerGitContentProvider(context);

    // Register commands
    registerCommands(context);

    // Listen for repository changes
    repoManager.onDidChangeRepositories(async () => {
        log('Repositories changed, updating services...');
        await syncServicesWithRepos(context);
        treeProvider?.refresh();
    });

    // Refresh all services
    await refreshAllServices();

    log(`Smart Changelists extension activated with ${services.size} repository(ies)`);

    context.subscriptions.push(
        repoManager,
        outputChannel!,
        { dispose: () => disposeAllServices() }
    );
}

/**
 * Create a service for a repository
 */
async function createServiceForRepo(context: vscode.ExtensionContext, repo: GitRepository): Promise<void> {
    if (services.has(repo.path)) {
        return; // Already exists
    }

    const service = new ChangelistService(context, repo);
    services.set(repo.path, service);
    treeProvider?.addService(service);

    log(`Created service for repository: ${repo.name} at ${repo.path}`);
}

/**
 * Sync services with current repositories
 */
async function syncServicesWithRepos(context: vscode.ExtensionContext): Promise<void> {
    if (!repoManager) return;

    const currentRepos = new Set(repoManager.getRepositories().map(r => r.path));

    // Remove services for repos that no longer exist
    for (const [repoPath, service] of services) {
        if (!currentRepos.has(repoPath)) {
            service.dispose();
            services.delete(repoPath);
            treeProvider?.removeService(repoPath);
            log(`Removed service for repository: ${repoPath}`);
        }
    }

    // Add services for new repos
    for (const repo of repoManager.getRepositories()) {
        if (!services.has(repo.path)) {
            await createServiceForRepo(context, repo);
        }
    }
}

/**
 * Refresh all services
 */
async function refreshAllServices(): Promise<void> {
    for (const service of services.values()) {
        await service.refresh();
    }
}

/**
 * Dispose all services
 */
function disposeAllServices(): void {
    for (const service of services.values()) {
        service.dispose();
    }
    services.clear();
}

/**
 * Get the appropriate service for an argument (from tree item or command)
 */
function getServiceFromArg(arg: unknown): ChangelistService | undefined {
    if (!arg || typeof arg !== 'object') {
        // Return first service if only one repo
        if (services.size === 1) {
            return services.values().next().value;
        }
        return undefined;
    }

    const obj = arg as Record<string, unknown>;

    // Try to get repoPath from the argument
    let repoPath = obj.repoPath as string | undefined;

    // Try to get from file
    if (!repoPath && obj.file && typeof obj.file === 'object') {
        repoPath = (obj.file as Record<string, unknown>).repoPath as string | undefined;
    }

    // Try to get from shelvedFile
    if (!repoPath && obj.shelvedFile && typeof obj.shelvedFile === 'object') {
        repoPath = (obj.shelvedFile as Record<string, unknown>).repoPath as string | undefined;
    }

    // Try to get from changelist
    if (!repoPath && obj.changelist && typeof obj.changelist === 'object') {
        repoPath = (obj.changelist as Record<string, unknown>).repoPath as string | undefined;
    }

    if (repoPath) {
        return services.get(repoPath);
    }

    // Fall back to first service if only one repo
    if (services.size === 1) {
        return services.values().next().value;
    }

    return undefined;
}

/**
 * Register all extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
    const commands: Array<[string, (...args: unknown[]) => Promise<void>]> = [
        // Changelist management
        ['smartChangelists.createChangelist', (arg) => createChangelist(arg)],
        ['smartChangelists.deleteChangelist', (arg) => deleteChangelist(arg)],
        ['smartChangelists.renameChangelist', (arg) => renameChangelist(arg)],
        ['smartChangelists.setActiveChangelist', (arg) => setActiveChangelist(arg)],

        // Shelve/Unshelve operations
        ['smartChangelists.shelveFile', (arg, ...args) => shelveFile(arg, args)],
        ['smartChangelists.unshelveFile', (arg) => unshelveFile(arg)],
        ['smartChangelists.unshelveAll', (arg) => unshelveAll(arg)],
        ['smartChangelists.applyAndStage', (arg) => applyAndStage(arg)],
        ['smartChangelists.applyAllAndStage', (arg) => applyAllAndStage(arg)],
        ['smartChangelists.deleteShelvedFile', (arg, ...args) => deleteShelvedFile(arg, args)],

        // Commit operations
        ['smartChangelists.commitChangelist', (arg) => commitChangelist(arg)],
        ['smartChangelists.commitWorkingChanges', () => commitWorkingChanges()],

        // File operations
        ['smartChangelists.openFile', (arg) => openFile(arg)],
        ['smartChangelists.openDiff', (arg) => openDiff(arg)],
        ['smartChangelists.previewShelved', (arg) => previewShelved(arg)],
        ['smartChangelists.revertFile', (arg) => revertFile(arg)],

        // Chat integration
        ['smartChangelists.addToChat', (arg) => addToChat(arg)],
        ['smartChangelists.addWorkingFileToChat', (arg) => addWorkingFileToChat(arg)],

        // Version comparison
        ['smartChangelists.compareWith', (arg) => compareWith(arg)],
        ['smartChangelists.compareAllVersions', (arg) => compareAllVersions(arg)],

        // Other
        ['smartChangelists.refreshAll', () => refreshAll()],
        ['smartChangelists.exportChangelists', () => exportChangelists()],
        ['smartChangelists.importChangelists', () => importChangelists()],

        // Legacy command mapping
        ['smartChangelists.moveToChangelist', (arg, ...args) => shelveFile(arg, args)],
    ];

    for (const [commandId, handler] of commands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, handler)
        );
    }
}

// ========== Changelist Management ==========

/**
 * Generate smart suggestion for next changelist name based on existing names
 */
function generateChangelistNameSuggestion(service: ChangelistService): string {
    const changelists = service.getChangelists().filter(cl => !cl.isDefault);

    if (changelists.length === 0) {
        return 'v1';
    }

    // Get the last created changelist name
    const lastChangelist = changelists[changelists.length - 1];
    const lastName = lastChangelist.label;

    // Try to find a number pattern at the end and increment it
    // Patterns: "v1" -> "v2", "version 1" -> "version 2", "name_1" -> "name_2", "test-3" -> "test-4"
    const patterns = [
        /^(v)(\d+)$/i,                    // v1, V1, v2, etc.
        /^(.+?)(\d+)$/,                   // anything ending with number: version1, test2
        /^(.+?[_\-\s])(\d+)$/,            // with separator: version_1, test-2, name 3
    ];

    for (const pattern of patterns) {
        const match = lastName.match(pattern);
        if (match) {
            const prefix = match[1];
            const num = parseInt(match[2], 10);
            return `${prefix}${num + 1}`;
        }
    }

    // No number pattern found, append "2" to the name
    return `${lastName}2`;
}

async function createChangelist(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    if (!service) {
        // If multiple repos, ask user to select
        if (services.size > 1) {
            const selected = await selectRepository('Create changelist in which repository?');
            if (!selected) return;
            return createChangelist({ repoPath: selected.path });
        }
        showWarning('No git repository available');
        return;
    }

    const suggestion = generateChangelistNameSuggestion(service);

    const name = await vscode.window.showInputBox({
        prompt: 'Enter changelist name (press Enter for suggested name)',
        value: suggestion,
        valueSelection: [0, suggestion.length], // Select all so user can easily override
        validateInput: (value) => {
            if (!value.trim()) return 'Name cannot be empty';
            return undefined;
        }
    });

    if (name) {
        await service.createChangelist(name.trim());
        showInfo(`Created changelist: ${name}`);
    }
}

async function deleteChangelist(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const changelistId = getChangelistIdFromArg(arg);

    if (!service && !changelistId) {
        // Need to select a changelist from all repos
        const { selectedService, selectedChangelist } = await selectChangelistFromAllRepos('Select changelist to delete');
        if (!selectedService || !selectedChangelist) return;
        return deleteChangelist({ repoPath: selectedService.repository.path, changelist: selectedChangelist });
    }

    if (!service) {
        showError('Could not determine repository');
        return;
    }

    let clId = changelistId;
    if (!clId) {
        const changelists = service.getChangelists().filter(cl => !cl.isDefault);
        if (changelists.length === 0) {
            showWarning('No custom changelists to delete');
            return;
        }

        const selected = await promptSelect(
            changelists.map(cl => ({
                label: cl.label,
                description: `${cl.shelvedFiles.length} shelved file(s)`,
                id: cl.id
            })),
            { placeholder: 'Select changelist to delete' }
        );

        if (!selected || Array.isArray(selected)) return;
        clId = (selected as { id: string }).id;
    }

    const changelist = service.getChangelist(clId);
    if (!changelist) {
        showError('Changelist not found');
        return;
    }

    if (changelist.isDefault) {
        showError('Cannot delete the default changelist');
        return;
    }

    const message = changelist.shelvedFiles.length > 0
        ? `Delete "${changelist.label}"? ${changelist.shelvedFiles.length} shelved file(s) will be unshelved back to working directory.`
        : `Delete "${changelist.label}"?`;

    if (await promptConfirm(message)) {
        await service.deleteChangelist(clId);
        showInfo(`Deleted changelist: ${changelist.label}`);
    }
}

async function renameChangelist(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const changelistId = getChangelistIdFromArg(arg);

    if (!service) {
        if (services.size > 1) {
            const { selectedService, selectedChangelist } = await selectChangelistFromAllRepos('Select changelist to rename');
            if (!selectedService || !selectedChangelist) return;
            return renameChangelist({ repoPath: selectedService.repository.path, changelist: selectedChangelist });
        }
        showWarning('No git repository available');
        return;
    }

    let clId = changelistId;
    if (!clId) {
        const changelists = service.getChangelists();
        const selected = await promptSelect(
            changelists.map(cl => ({ label: cl.label, id: cl.id })),
            { placeholder: 'Select changelist to rename' }
        );

        if (!selected || Array.isArray(selected)) return;
        clId = (selected as { id: string }).id;
    }

    const changelist = service.getChangelist(clId);
    if (!changelist) {
        showError('Changelist not found');
        return;
    }

    const newName = await promptInput({
        prompt: 'Enter new name',
        value: changelist.label,
        validateInput: (value) => {
            if (!value.trim()) return 'Name cannot be empty';
            return undefined;
        }
    });

    if (newName && newName.trim() !== changelist.label) {
        await service.renameChangelist(clId, newName.trim());
        showInfo(`Renamed changelist to: ${newName}`);
    }
}

async function setActiveChangelist(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const changelistId = getChangelistIdFromArg(arg);

    if (!service) {
        showWarning('No git repository available');
        return;
    }

    let clId = changelistId;
    if (!clId) {
        const changelists = service.getChangelists();
        const selected = await promptSelect(
            changelists.map(cl => ({
                label: cl.label,
                description: cl.isActive ? '(Current)' : '',
                id: cl.id
            })),
            { placeholder: 'Select active changelist' }
        );

        if (!selected || Array.isArray(selected)) return;
        clId = (selected as { id: string }).id;
    }

    await service.setActiveChangelist(clId);
    const changelist = service.getChangelist(clId);
    if (changelist) {
        showInfo(`Active changelist: ${changelist.label}`);
    }
}

// ========== Shelve/Unshelve Operations ==========

async function shelveFile(arg: unknown, additionalArgs: unknown[]): Promise<void> {
    const service = getServiceFromArg(arg);
    const files: string[] = [];
    let repoPath: string | undefined;

    const extractFile = (item: unknown) => {
        if (!item) return;
        if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>;

            // Extract repoPath if available
            if (!repoPath && obj.repoPath) {
                repoPath = obj.repoPath as string;
            }

            if (obj.file && typeof obj.file === 'object') {
                const file = obj.file as { relativePath?: string; repoPath?: string };
                if (file.relativePath) {
                    files.push(file.relativePath);
                    if (!repoPath && file.repoPath) {
                        repoPath = file.repoPath;
                    }
                    return;
                }
            }
            if (obj.resourceUri && typeof obj.resourceUri === 'object') {
                const uri = obj.resourceUri as { fsPath?: string };
                if (uri.fsPath && repoPath) {
                    const relativePath = path.relative(repoPath, uri.fsPath).replace(/\\/g, '/');
                    files.push(relativePath);
                    return;
                }
            }
        }
    };

    extractFile(arg);
    if (Array.isArray(additionalArgs) && Array.isArray(additionalArgs[0])) {
        (additionalArgs[0] as unknown[]).forEach(extractFile);
    }

    // If no files from args, try to use active text editor (for command palette usage)
    if (files.length === 0 && vscode.window.activeTextEditor) {
        const activeDoc = vscode.window.activeTextEditor.document;
        if (!activeDoc.isUntitled && repoManager) {
            const repo = repoManager.getRepositoryForFile(activeDoc.uri.fsPath);
            if (repo) {
                const relativePath = path.relative(repo.path, activeDoc.uri.fsPath).replace(/\\/g, '/');
                files.push(relativePath);
                if (!repoPath) {
                    repoPath = repo.path;
                }
            }
        }
    }

    // Get the service for this repo
    const targetService = repoPath ? services.get(repoPath) : service;

    if (!targetService) {
        showWarning('No git repository available');
        return;
    }

    if (files.length === 0) {
        showWarning('No files selected');
        return;
    }

    // Show changelist picker (only non-default)
    const changelists = targetService.getChangelists().filter(cl => !cl.isDefault);

    if (changelists.length === 0) {
        const create = await promptConfirm('No changelists found. Create a new one?');
        if (create) {
            await createChangelist({ repoPath: targetService.repository.path });
            // Try again
            return shelveFile(arg, additionalArgs);
        }
        return;
    }

    const items = changelists.map(cl => ({
        label: cl.label,
        description: cl.isActive ? '(Active)' : '',
        id: cl.id
    }));

    const selected = await promptSelect(items, {
        placeholder: `Shelve ${files.length} file(s) to changelist`
    });

    if (!selected || Array.isArray(selected)) return;

    try {
        await targetService.shelveFiles(files, (selected as { id: string }).id);
        showInfo(`Shelved ${files.length} file(s) to ${(selected as { label: string }).label}`);
    } catch (error) {
        showError(`Shelve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function unshelveFile(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const { changelistId, relativePath } = getShelvedFileFromArg(arg);

    if (!service || !changelistId || !relativePath) {
        showWarning('No shelved file selected');
        return;
    }

    try {
        await service.unshelveFile(changelistId, relativePath);
        showInfo(`Unshelved: ${path.basename(relativePath)}`);
    } catch (error) {
        showError(`Unshelve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function unshelveAll(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const changelistId = getChangelistIdFromArg(arg);

    if (!service || !changelistId) {
        showWarning('No changelist selected');
        return;
    }

    const changelist = service.getChangelist(changelistId);
    if (!changelist) {
        showError('Changelist not found');
        return;
    }

    if (changelist.shelvedFiles.length === 0) {
        showWarning('No shelved files in this changelist');
        return;
    }

    const proceed = await promptConfirm(
        `Unshelve all ${changelist.shelvedFiles.length} file(s) from "${changelist.label}"?`
    );

    if (proceed) {
        try {
            await service.unshelveAll(changelistId);
            showInfo(`Unshelved all files from ${changelist.label}`);
        } catch (error) {
            showError(`Unshelve failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

async function deleteShelvedFile(arg: unknown, additionalArgs: unknown[]): Promise<void> {
    // Collect all selected files
    const files: Array<{ changelistId: string; relativePath: string; service: ChangelistService }> = [];

    const extractFile = (item: unknown) => {
        const service = getServiceFromArg(item);
        const { changelistId, relativePath } = getShelvedFileFromArg(item);
        if (service && changelistId && relativePath) {
            files.push({ changelistId, relativePath, service });
        }
    };

    // Extract first selected item
    extractFile(arg);

    // Extract additional selected items (multi-select)
    if (Array.isArray(additionalArgs) && Array.isArray(additionalArgs[0])) {
        (additionalArgs[0] as unknown[]).forEach(extractFile);
    }

    if (files.length === 0) {
        showWarning('No shelved file selected');
        return;
    }

    // Show confirmation dialog
    const proceed = await promptConfirm(
        files.length === 1
            ? `Delete snapshot "${path.basename(files[0].relativePath)}"? This cannot be undone.`
            : `Delete ${files.length} snapshots? This cannot be undone.`
    );

    if (!proceed) return;

    // Delete all selected files
    for (const file of files) {
        await file.service.deleteShelvedFile(file.changelistId, file.relativePath);
    }

    showInfo(
        files.length === 1
            ? `Deleted snapshot: ${path.basename(files[0].relativePath)}`
            : `Deleted ${files.length} snapshots`
    );
}

async function applyAndStage(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const { changelistId, relativePath } = getShelvedFileFromArg(arg);

    if (!service || !changelistId || !relativePath) {
        showWarning('No snapshot selected');
        return;
    }

    try {
        await service.applyAndStage(changelistId, relativePath);
        showInfo(`Applied & staged: ${path.basename(relativePath)}`);
    } catch (error) {
        showError(`Apply failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function applyAllAndStage(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const changelistId = getChangelistIdFromArg(arg);

    if (!service || !changelistId) {
        showWarning('No changelist selected');
        return;
    }

    const changelist = service.getChangelist(changelistId);
    if (!changelist) {
        showError('Changelist not found');
        return;
    }

    if (changelist.shelvedFiles.length === 0) {
        showWarning('No snapshots in this changelist');
        return;
    }

    const proceed = await promptConfirm(
        `Apply & stage all ${changelist.shelvedFiles.length} file(s) from "${changelist.label}"?`
    );

    if (proceed) {
        try {
            await service.applyAllAndStage(changelistId);
            showInfo(`Applied & staged all files from ${changelist.label}`);
        } catch (error) {
            showError(`Apply failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// ========== Commit Operations ==========

async function commitChangelist(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const changelistId = getChangelistIdFromArg(arg);

    if (!service || !changelistId) {
        showError('No changelist selected');
        return;
    }

    const changelist = service.getChangelist(changelistId);
    if (!changelist) {
        showError('Changelist not found');
        return;
    }

    if (changelist.isDefault) {
        showWarning('Use "Commit Working Changes" for the default changelist');
        return;
    }

    if (changelist.shelvedFiles.length === 0) {
        showWarning('No shelved files to commit');
        return;
    }

    const config = getConfig();
    if (config.confirmBeforeCommit) {
        const proceed = await promptConfirm(
            `Commit ${changelist.shelvedFiles.length} shelved file(s) from "${changelist.label}"?`
        );
        if (!proceed) return;
    }

    const message = await promptInput({
        prompt: 'Enter commit message',
        placeholder: 'Commit message',
        validateInput: (value) => {
            if (!value.trim()) return 'Message cannot be empty';
            return undefined;
        }
    });

    if (!message) return;

    try {
        await service.commitChangelist(changelistId, message.trim());
        showInfo(`Committed ${changelist.shelvedFiles.length} file(s) from ${changelist.label}`);
    } catch (error) {
        showError(`Commit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function commitWorkingChanges(): Promise<void> {
    // If multiple repos, ask user to select
    let service: ChangelistService | undefined;

    if (services.size === 1) {
        service = services.values().next().value;
    } else if (services.size > 1) {
        const selected = await selectRepository('Commit working changes from which repository?');
        if (!selected) return;
        service = services.get(selected.path);
    }

    if (!service) {
        showWarning('No git repository available');
        return;
    }

    const files = service.getChangedFiles();

    if (files.length === 0) {
        showWarning('No working changes to commit');
        return;
    }

    const message = await promptInput({
        prompt: 'Enter commit message',
        placeholder: 'Commit message',
        validateInput: (value) => {
            if (!value.trim()) return 'Message cannot be empty';
            return undefined;
        }
    });

    if (!message) return;

    const config = getConfig();
    if (config.confirmBeforeCommit) {
        const proceed = await promptConfirm(`Commit ${files.length} working change(s)?`);
        if (!proceed) return;
    }

    try {
        await service.commitWorkingChanges(message.trim());
        showInfo(`Committed ${files.length} file(s)`);
    } catch (error) {
        showError(`Commit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ========== File Operations ==========

async function openFile(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const filePath = getFilePathFromArg(arg);

    if (!filePath) {
        showWarning('No file selected');
        return;
    }

    const repoPath = service?.repository.path || getWorkspaceRoot();
    if (!repoPath) return;

    const absolutePath = getAbsolutePathFromRepo(filePath, repoPath);
    const uri = vscode.Uri.file(absolutePath);
    await vscode.window.showTextDocument(uri);
}

async function openDiff(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const filePath = getFilePathFromArg(arg);

    if (!filePath) return;

    const repoPath = service?.repository.path || getRepoPathFromArg(arg) || getWorkspaceRoot();
    if (!repoPath) return;

    const absolutePath = getAbsolutePathFromRepo(filePath, repoPath);
    const workingUri = vscode.Uri.file(absolutePath);

    const fileStatus = getFileStatusFromArg(arg);

    if (fileStatus === 'untracked') {
        await vscode.window.showTextDocument(workingUri);
        return;
    }

    const headUri = createGitUri(filePath, 'HEAD', repoPath);

    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            headUri,
            workingUri,
            `${path.basename(filePath)} (HEAD ↔ Working Tree)`
        );
    } catch (error) {
        log(`Diff failed: ${error}`, 'warn');
        await vscode.window.showTextDocument(workingUri);
    }
}

async function previewShelved(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const { shelvedFile, changelistId } = getShelvedFileInfoFromArg(arg);

    if (!shelvedFile || !changelistId) {
        showWarning('No snapshot selected');
        return;
    }

    if (!shelvedFile.originalContent) {
        showWarning('No content available for this snapshot');
        return;
    }

    const repoPath = shelvedFile.repoPath || service?.repository.path || getRepoPathFromArg(arg);

    // Create URIs for diff view
    // Left side: HEAD version (original)
    // Right side: Snapshot version (saved)
    const headUri = createGitUri(shelvedFile.relativePath, 'HEAD', repoPath);
    const snapshotUri = createSnapshotUri(
        shelvedFile.relativePath,
        changelistId,
        shelvedFile.originalContent,
        shelvedFile.shelvedAt,
        repoPath
    );

    const fileName = path.basename(shelvedFile.relativePath);
    const changelist = service?.getChangelist(changelistId);
    const changelistName = changelist?.label || 'Snapshot';

    try {
        // Show diff: HEAD (left) vs Snapshot (right)
        await vscode.commands.executeCommand(
            'vscode.diff',
            headUri,
            snapshotUri,
            `${fileName} (HEAD ↔ ${changelistName})`
        );
    } catch (error) {
        log(`Diff failed: ${error}`, 'warn');
        // Fallback: just show the snapshot content
        const doc = await vscode.workspace.openTextDocument({
            content: shelvedFile.originalContent,
            language: getLanguageId(shelvedFile.relativePath)
        });
        await vscode.window.showTextDocument(doc);
    }
}

async function revertFile(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const filePath = getFilePathFromArg(arg);

    if (!service || !filePath) {
        showWarning('No file selected');
        return;
    }

    const config = getConfig();
    if (config.confirmBeforeRevert) {
        const proceed = await promptConfirm(
            `Revert changes to "${path.basename(filePath)}"? This cannot be undone.`
        );
        if (!proceed) return;
    }

    try {
        await service.revertFile(filePath);
        showInfo(`Reverted: ${path.basename(filePath)}`);
    } catch (error) {
        showError(`Revert failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ========== Chat Integration ==========

async function addToChat(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const { shelvedFile, changelistId } = getShelvedFileInfoFromArg(arg);

    if (!service || !shelvedFile || !changelistId) {
        showWarning('No snapshot selected');
        return;
    }

    const changelist = service.getChangelist(changelistId);
    if (!changelist) {
        showError('Changelist not found');
        return;
    }

    const config = getConfig();
    let snapshotPath: string;

    if (config.saveSnapshotsToFile) {
        // Use the file from .smartchangelists/
        snapshotPath = service.getSnapshotFilePath(shelvedFile, changelist);

        // Check if file exists
        if (!fs.existsSync(snapshotPath)) {
            showError('Snapshot file not found. Enable "Save Snapshots to File" in settings and save the snapshot again.');
            return;
        }
    } else {
        // Create a temporary file for the snapshot
        const tempDir = path.join(service.repository.path, '.smartchangelists', '.temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const fileName = path.basename(shelvedFile.relativePath);
        snapshotPath = path.join(tempDir, `${changelist.label.replace(/[<>:"/\\|?*]/g, '_')}_${fileName}`);

        if (shelvedFile.originalContent) {
            fs.writeFileSync(snapshotPath, shelvedFile.originalContent, 'utf8');
        } else {
            showError('No content available for this snapshot');
            return;
        }
    }

    const snapshotUri = vscode.Uri.file(snapshotPath);

    try {
        // Try to use VS Code's chat API to add the file as context
        await vscode.commands.executeCommand('workbench.action.chat.attachFile', snapshotUri);
        showInfo(`Added snapshot to chat: ${path.basename(shelvedFile.relativePath)}`);
    } catch {
        // Fallback: Copy the path to clipboard and show message
        await vscode.env.clipboard.writeText(snapshotPath);
        showInfo(`Snapshot path copied to clipboard: ${snapshotPath}\nYou can paste this in any AI chat tool.`);
    }
}

async function addWorkingFileToChat(arg: unknown): Promise<void> {
    const service = getServiceFromArg(arg);
    const filePath = getFilePathFromArg(arg);

    if (!filePath) {
        showWarning('No file selected');
        return;
    }

    const repoPath = service?.repository.path || getWorkspaceRoot();
    if (!repoPath) return;

    const absolutePath = getAbsolutePathFromRepo(filePath, repoPath);
    const fileUri = vscode.Uri.file(absolutePath);

    try {
        await vscode.commands.executeCommand('workbench.action.chat.attachFile', fileUri);
        showInfo(`Added to chat: ${path.basename(filePath)}`);
    } catch {
        await vscode.env.clipboard.writeText(absolutePath);
        showInfo(`File path copied to clipboard: ${absolutePath}`);
    }
}

// ========== Version Comparison ==========

async function compareWith(arg: unknown): Promise<void> {
    const config = getConfig();
    if (!config.enableVersionComparison) {
        showWarning('Version comparison is disabled. Enable it in settings: smartChangelists.enableVersionComparison');
        return;
    }

    const service = getServiceFromArg(arg);
    const { shelvedFile, changelistId } = getShelvedFileInfoFromArg(arg);

    if (!service || !shelvedFile || !changelistId) {
        showWarning('No snapshot selected');
        return;
    }

    const currentChangelist = service.getChangelist(changelistId);
    if (!currentChangelist) {
        showError('Changelist not found');
        return;
    }

    const repoPath = service.repository.path;

    // Get all versions of this file
    const allVersions = service.getFileVersions(shelvedFile.relativePath);

    // Build QuickPick items
    const items: Array<vscode.QuickPickItem & { type: string; version?: typeof allVersions[0] }> = [];

    // Add HEAD option
    items.push({
        label: '$(git-commit) HEAD',
        description: 'Latest committed version',
        type: 'head'
    });

    // Add Working option (if file exists)
    const workingPath = getAbsolutePathFromRepo(shelvedFile.relativePath, repoPath);
    if (fs.existsSync(workingPath)) {
        items.push({
            label: '$(file) Working',
            description: 'Current working directory version',
            type: 'working'
        });
    }

    // Add separator
    if (allVersions.length > 1) {
        items.push({
            label: 'Other Snapshots',
            kind: vscode.QuickPickItemKind.Separator,
            type: 'separator'
        });
    }

    // Add other snapshots (exclude current)
    for (const version of allVersions) {
        if (version.changelist.id === changelistId && version.timestamp === shelvedFile.shelvedAt) {
            continue; // Skip current snapshot
        }
        const date = new Date(version.timestamp).toLocaleString();
        items.push({
            label: `$(archive) ${version.label}`,
            description: date,
            type: 'snapshot',
            version
        });
    }

    const selected = await vscode.window.showQuickPick(items.filter(i => i.type !== 'separator'), {
        placeHolder: `Compare "${currentChangelist.label}" snapshot with...`
    });

    if (!selected) return;

    // Create URI for current snapshot (right side)
    const currentSnapshotUri = createSnapshotUri(
        shelvedFile.relativePath,
        changelistId,
        shelvedFile.originalContent || '',
        shelvedFile.shelvedAt,
        repoPath
    );

    let leftUri: vscode.Uri;
    let leftLabel: string;

    if (selected.type === 'head') {
        leftUri = createGitUri(shelvedFile.relativePath, 'HEAD', repoPath);
        leftLabel = 'HEAD';
    } else if (selected.type === 'working') {
        leftUri = vscode.Uri.file(workingPath);
        leftLabel = 'Working';
    } else if (selected.type === 'snapshot' && selected.version) {
        leftUri = createSnapshotUri(
            selected.version.shelvedFile.relativePath,
            selected.version.changelist.id,
            selected.version.shelvedFile.originalContent || '',
            selected.version.timestamp,
            repoPath
        );
        leftLabel = selected.version.label;
    } else {
        return;
    }

    const fileName = path.basename(shelvedFile.relativePath);

    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            leftUri,
            currentSnapshotUri,
            `${fileName} (${leftLabel} ↔ ${currentChangelist.label})`
        );
    } catch (error) {
        showError(`Failed to open diff: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function compareAllVersions(arg: unknown): Promise<void> {
    const config = getConfig();
    if (!config.enableVersionComparison) {
        showWarning('Version comparison is disabled. Enable it in settings: smartChangelists.enableVersionComparison');
        return;
    }

    const service = getServiceFromArg(arg);
    const { shelvedFile } = getShelvedFileInfoFromArg(arg);

    if (!service || !shelvedFile) {
        showWarning('No snapshot selected');
        return;
    }

    const repoPath = service.repository.path;

    // Get all versions of this file
    const allVersions = service.getFileVersions(shelvedFile.relativePath);

    if (allVersions.length < 2) {
        showInfo('Only one version exists. Use "Compare with..." to compare with HEAD or Working.');
        return;
    }

    const items = allVersions.map((v, index) => ({
        label: `${index + 1}. ${v.label}`,
        description: new Date(v.timestamp).toLocaleString(),
        version: v
    }));

    // First selection
    const first = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select first version to compare'
    });
    if (!first) return;

    // Second selection (exclude first)
    const remainingItems = items.filter(i => i.version !== first.version);
    const second = await vscode.window.showQuickPick(remainingItems, {
        placeHolder: 'Select second version to compare'
    });
    if (!second) return;

    // Create diff
    const firstUri = createSnapshotUri(
        first.version.shelvedFile.relativePath,
        first.version.changelist.id,
        first.version.shelvedFile.originalContent || '',
        first.version.timestamp,
        repoPath
    );

    const secondUri = createSnapshotUri(
        second.version.shelvedFile.relativePath,
        second.version.changelist.id,
        second.version.shelvedFile.originalContent || '',
        second.version.timestamp,
        repoPath
    );

    const fileName = path.basename(shelvedFile.relativePath);

    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            firstUri,
            secondUri,
            `${fileName} (${first.version.label} ↔ ${second.version.label})`
        );
    } catch (error) {
        showError(`Failed to open diff: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ========== Other Operations ==========

async function refreshAll(): Promise<void> {
    await refreshAllServices();
    treeProvider?.refresh();
    log('Refreshed all changelists');
}

async function exportChangelists(): Promise<void> {
    // Combine exports from all services
    const allChangelists: Array<{ label: string; shelvedFiles: ShelvedFile[] }> = [];

    for (const service of services.values()) {
        const exportData = service.exportChangelists();
        allChangelists.push(...exportData.changelists);
    }

    if (allChangelists.length === 0) {
        showWarning('No changelists with shelved files to export');
        return;
    }

    const exportData: ChangelistExport = {
        version: 2,
        changelists: allChangelists,
        exportedAt: new Date().toISOString()
    };

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('changelists.json'),
        filters: { 'JSON': ['json'] },
        title: 'Export Changelists'
    });

    if (uri) {
        const content = JSON.stringify(exportData, null, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        showInfo(`Exported ${allChangelists.length} changelist(s)`);
    }
}

async function importChangelists(): Promise<void> {
    // Select which repo to import into
    let service: ChangelistService | undefined;

    if (services.size === 1) {
        service = services.values().next().value;
    } else if (services.size > 1) {
        const selected = await selectRepository('Import changelists to which repository?');
        if (!selected) return;
        service = services.get(selected.path);
    }

    if (!service) {
        showWarning('No git repository available');
        return;
    }

    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'JSON': ['json'] },
        title: 'Import Changelists'
    });

    if (!uris || uris.length === 0) return;

    try {
        const content = await vscode.workspace.fs.readFile(uris[0]);
        const data: ChangelistExport = JSON.parse(Buffer.from(content).toString('utf8'));

        const imported = await service.importChangelists(data);
        showInfo(`Imported ${imported} changelist(s)`);
    } catch (error) {
        showError(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ========== Helper Functions ==========

async function selectRepository(placeholder: string): Promise<GitRepository | undefined> {
    const items = Array.from(services.values()).map(s => ({
        label: s.repository.name,
        description: s.repository.path,
        repo: s.repository
    }));

    const selected = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
    return selected?.repo;
}

async function selectChangelistFromAllRepos(placeholder: string): Promise<{ selectedService?: ChangelistService; selectedChangelist?: { id: string } }> {
    const items: Array<{ label: string; description?: string; service: ChangelistService; id: string }> = [];

    for (const service of services.values()) {
        const changelists = service.getChangelists().filter(cl => !cl.isDefault);
        for (const cl of changelists) {
            items.push({
                label: cl.label,
                description: services.size > 1 ? service.repository.name : undefined,
                service,
                id: cl.id
            });
        }
    }

    if (items.length === 0) {
        showWarning('No custom changelists available');
        return {};
    }

    const selected = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
    if (!selected) return {};

    return { selectedService: selected.service, selectedChangelist: { id: selected.id } };
}

function getChangelistIdFromArg(arg: unknown): string | undefined {
    if (!arg) return undefined;
    if (typeof arg === 'string') return arg;

    if (typeof arg === 'object' && arg !== null) {
        const obj = arg as Record<string, unknown>;
        if (obj.id && typeof obj.id === 'string') return obj.id;
        if (obj.changelist && typeof obj.changelist === 'object') {
            const changelist = obj.changelist as { id?: string };
            if (changelist.id) return changelist.id;
        }
        if (obj.changelistId && typeof obj.changelistId === 'string') {
            return obj.changelistId;
        }
    }

    return undefined;
}

function getFilePathFromArg(arg: unknown): string | undefined {
    if (!arg) return undefined;
    if (typeof arg === 'string') return arg;

    if (typeof arg === 'object' && arg !== null) {
        const obj = arg as Record<string, unknown>;

        if (obj.file && typeof obj.file === 'object') {
            const file = obj.file as { relativePath?: string };
            if (file.relativePath) return file.relativePath;
        }

        if (obj.shelvedFile && typeof obj.shelvedFile === 'object') {
            const shelvedFile = obj.shelvedFile as { relativePath?: string };
            if (shelvedFile.relativePath) return shelvedFile.relativePath;
        }

        if (obj.relativePath && typeof obj.relativePath === 'string') {
            return obj.relativePath;
        }
    }

    return undefined;
}

function getRepoPathFromArg(arg: unknown): string | undefined {
    if (!arg || typeof arg !== 'object') return undefined;

    const obj = arg as Record<string, unknown>;
    if (obj.repoPath && typeof obj.repoPath === 'string') {
        return obj.repoPath;
    }

    return undefined;
}

function getFileStatusFromArg(arg: unknown): string | undefined {
    if (!arg || typeof arg !== 'object') return undefined;

    const obj = arg as Record<string, unknown>;

    if (obj.file && typeof obj.file === 'object') {
        const file = obj.file as { status?: string };
        return file.status;
    }

    return undefined;
}

function getShelvedFileFromArg(arg: unknown): { changelistId?: string; relativePath?: string } {
    if (!arg || typeof arg !== 'object') return {};

    const obj = arg as Record<string, unknown>;

    if (obj.shelvedFile && typeof obj.shelvedFile === 'object') {
        const shelvedFile = obj.shelvedFile as { relativePath?: string };
        const changelistId = obj.changelistId as string | undefined;
        return {
            changelistId,
            relativePath: shelvedFile.relativePath
        };
    }

    return {};
}

function getShelvedFileInfoFromArg(arg: unknown): { shelvedFile?: ShelvedFile; changelistId?: string } {
    if (!arg || typeof arg !== 'object') return {};

    const obj = arg as Record<string, unknown>;

    if (obj.shelvedFile) {
        return {
            shelvedFile: obj.shelvedFile as ShelvedFile,
            changelistId: obj.changelistId as string | undefined
        };
    }

    return {};
}

function getLanguageId(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
        '.ts': 'typescript',
        '.tsx': 'typescriptreact',
        '.js': 'javascript',
        '.jsx': 'javascriptreact',
        '.json': 'json',
        '.md': 'markdown',
        '.py': 'python',
        '.java': 'java',
        '.c': 'c',
        '.cpp': 'cpp',
        '.h': 'c',
        '.hpp': 'cpp',
        '.cs': 'csharp',
        '.go': 'go',
        '.rs': 'rust',
        '.rb': 'ruby',
        '.php': 'php',
        '.html': 'html',
        '.css': 'css',
        '.scss': 'scss',
        '.less': 'less',
        '.xml': 'xml',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.sh': 'shellscript',
        '.bash': 'shellscript',
        '.sql': 'sql',
    };
    return languageMap[ext] || 'plaintext';
}

export function deactivate(): void {
    log('Deactivating Smart Changelists extension');
    vscode.commands.executeCommand('setContext', 'smartChangelists.enabled', false);
}
