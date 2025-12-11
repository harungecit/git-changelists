import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChangelistService } from './ChangelistService';
// SCM Provider removed - using only Tree View
import { registerChangelistTreeView } from './ChangelistTreeProvider';
import { registerGitContentProvider, createGitUri, createSnapshotUri } from './GitContentProvider';
import { ChangelistExport, ShelvedFile } from './types';
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
    toAbsolutePath
} from './utils';

let service: ChangelistService | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Activate the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Git Changelists');
    initLogger(outputChannel);

    log('Activating Git Changelists extension');

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        log('No workspace folder found', 'warn');
        return;
    }

    const gitDir = path.join(workspaceRoot, '.git');
    if (!fs.existsSync(gitDir)) {
        log('No .git directory found', 'warn');
        return;
    }

    service = new ChangelistService(context);

    // Only use Tree View - no SCM Provider, no extra decorations
    registerChangelistTreeView(context, service);
    registerGitContentProvider(context);

    vscode.commands.executeCommand('setContext', 'gitChangelists.enabled', true);

    registerCommands(context, service);

    await service.refresh();

    log('Git Changelists extension activated');

    context.subscriptions.push(service, outputChannel!);
}

/**
 * Register all extension commands
 */
function registerCommands(
    context: vscode.ExtensionContext,
    service: ChangelistService
): void {
    const commands: Array<[string, (...args: unknown[]) => Promise<void>]> = [
        // Changelist management
        ['gitChangelist.createChangelist', () => createChangelist(service)],
        ['gitChangelist.deleteChangelist', (arg) => deleteChangelist(service, arg)],
        ['gitChangelist.renameChangelist', (arg) => renameChangelist(service, arg)],
        ['gitChangelist.setActiveChangelist', (arg) => setActiveChangelist(service, arg)],

        // Shelve/Unshelve operations
        ['gitChangelist.shelveFile', (arg, ...args) => shelveFile(service, arg, args)],
        ['gitChangelist.unshelveFile', (arg) => unshelveFile(service, arg)],
        ['gitChangelist.unshelveAll', (arg) => unshelveAll(service, arg)],
        ['gitChangelist.applyAndStage', (arg) => applyAndStage(service, arg)],
        ['gitChangelist.applyAllAndStage', (arg) => applyAllAndStage(service, arg)],
        ['gitChangelist.deleteShelvedFile', (arg) => deleteShelvedFile(service, arg)],

        // Commit operations
        ['gitChangelist.commitChangelist', (arg) => commitChangelist(service, arg)],
        ['gitChangelist.commitWorkingChanges', () => commitWorkingChanges(service)],

        // File operations
        ['gitChangelist.openFile', (arg) => openFile(arg)],
        ['gitChangelist.openDiff', (arg) => openDiff(arg)],
        ['gitChangelist.previewShelved', (arg) => previewShelved(arg)],
        ['gitChangelist.revertFile', (arg) => revertFile(service, arg)],

        // Chat integration
        ['gitChangelist.addToChat', (arg) => addToChat(service, arg)],
        ['gitChangelist.addWorkingFileToChat', (arg) => addWorkingFileToChat(arg)],

        // Version comparison
        ['gitChangelist.compareWith', (arg) => compareWith(service, arg)],
        ['gitChangelist.compareAllVersions', (arg) => compareAllVersions(service, arg)],

        // Other
        ['gitChangelist.refreshAll', () => refreshAll(service)],
        ['gitChangelist.exportChangelists', () => exportChangelists(service)],
        ['gitChangelist.importChangelists', () => importChangelists(service)],

        // Legacy command mapping
        ['gitChangelist.moveToChangelist', (arg, ...args) => shelveFile(service, arg, args)],
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

async function createChangelist(service: ChangelistService): Promise<void> {
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

async function deleteChangelist(service: ChangelistService, arg: unknown): Promise<void> {
    const changelistId = getChangelistIdFromArg(arg);
    if (!changelistId) {
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
        return deleteChangelist(service, { id: (selected as { id: string }).id });
    }

    const changelist = service.getChangelist(changelistId);
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
        await service.deleteChangelist(changelistId);
        showInfo(`Deleted changelist: ${changelist.label}`);
    }
}

async function renameChangelist(service: ChangelistService, arg: unknown): Promise<void> {
    const changelistId = getChangelistIdFromArg(arg);
    if (!changelistId) {
        const changelists = service.getChangelists();
        const selected = await promptSelect(
            changelists.map(cl => ({ label: cl.label, id: cl.id })),
            { placeholder: 'Select changelist to rename' }
        );

        if (!selected || Array.isArray(selected)) return;
        return renameChangelist(service, { id: (selected as { id: string }).id });
    }

    const changelist = service.getChangelist(changelistId);
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
        await service.renameChangelist(changelistId, newName.trim());
        showInfo(`Renamed changelist to: ${newName}`);
    }
}

async function setActiveChangelist(service: ChangelistService, arg: unknown): Promise<void> {
    const changelistId = getChangelistIdFromArg(arg);
    if (!changelistId) {
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
        return setActiveChangelist(service, { id: (selected as { id: string }).id });
    }

    await service.setActiveChangelist(changelistId);
    const changelist = service.getChangelist(changelistId);
    if (changelist) {
        showInfo(`Active changelist: ${changelist.label}`);
    }
}

// ========== Shelve/Unshelve Operations ==========

async function shelveFile(
    service: ChangelistService,
    arg: unknown,
    additionalArgs: unknown[]
): Promise<void> {
    const files: string[] = [];

    const extractFile = (item: unknown) => {
        if (!item) return;
        if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>;
            if (obj.file && typeof obj.file === 'object') {
                const file = obj.file as { relativePath?: string };
                if (file.relativePath) {
                    files.push(file.relativePath);
                    return;
                }
            }
            if (obj.resourceUri && typeof obj.resourceUri === 'object') {
                const uri = obj.resourceUri as { fsPath?: string };
                if (uri.fsPath) {
                    const workspaceRoot = getWorkspaceRoot();
                    if (workspaceRoot) {
                        const relativePath = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');
                        files.push(relativePath);
                        return;
                    }
                }
            }
        }
    };

    extractFile(arg);
    if (Array.isArray(additionalArgs) && Array.isArray(additionalArgs[0])) {
        (additionalArgs[0] as unknown[]).forEach(extractFile);
    }

    if (files.length === 0) {
        showWarning('No files selected');
        return;
    }

    // Show changelist picker (only non-default)
    const changelists = service.getChangelists().filter(cl => !cl.isDefault);

    if (changelists.length === 0) {
        const create = await promptConfirm('No changelists found. Create a new one?');
        if (create) {
            await createChangelist(service);
            // Try again
            return shelveFile(service, arg, additionalArgs);
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
        await service.shelveFiles(files, (selected as { id: string }).id);
        showInfo(`Shelved ${files.length} file(s) to ${(selected as { label: string }).label}`);
    } catch (error) {
        showError(`Shelve failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function unshelveFile(service: ChangelistService, arg: unknown): Promise<void> {
    const { changelistId, relativePath } = getShelvedFileFromArg(arg);

    if (!changelistId || !relativePath) {
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

async function unshelveAll(service: ChangelistService, arg: unknown): Promise<void> {
    const changelistId = getChangelistIdFromArg(arg);
    if (!changelistId) {
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

async function deleteShelvedFile(service: ChangelistService, arg: unknown): Promise<void> {
    const { changelistId, relativePath } = getShelvedFileFromArg(arg);

    if (!changelistId || !relativePath) {
        showWarning('No shelved file selected');
        return;
    }

    const proceed = await promptConfirm(
        `Delete snapshot "${path.basename(relativePath)}"? This cannot be undone.`
    );

    if (proceed) {
        await service.deleteShelvedFile(changelistId, relativePath);
        showInfo(`Deleted snapshot: ${path.basename(relativePath)}`);
    }
}

async function applyAndStage(service: ChangelistService, arg: unknown): Promise<void> {
    const { changelistId, relativePath } = getShelvedFileFromArg(arg);

    if (!changelistId || !relativePath) {
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

async function applyAllAndStage(service: ChangelistService, arg: unknown): Promise<void> {
    const changelistId = getChangelistIdFromArg(arg);
    if (!changelistId) {
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

async function commitChangelist(service: ChangelistService, arg: unknown): Promise<void> {
    const changelistId = getChangelistIdFromArg(arg);
    if (!changelistId) {
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

async function commitWorkingChanges(service: ChangelistService): Promise<void> {
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
    const filePath = getFilePathFromArg(arg);
    if (filePath) {
        const uri = vscode.Uri.file(toAbsolutePath(filePath));
        await vscode.window.showTextDocument(uri);
    }
}

async function openDiff(arg: unknown): Promise<void> {
    const filePath = getFilePathFromArg(arg);
    if (!filePath) return;

    const absolutePath = toAbsolutePath(filePath);
    const workingUri = vscode.Uri.file(absolutePath);

    const fileStatus = getFileStatusFromArg(arg);

    if (fileStatus === 'untracked') {
        await vscode.window.showTextDocument(workingUri);
        return;
    }

    const headUri = createGitUri(filePath, 'HEAD');

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
    const { shelvedFile, changelistId } = getShelvedFileInfoFromArg(arg);

    if (!shelvedFile || !changelistId) {
        showWarning('No snapshot selected');
        return;
    }

    if (!shelvedFile.originalContent) {
        showWarning('No content available for this snapshot');
        return;
    }

    // Create URIs for diff view
    // Left side: HEAD version (original)
    // Right side: Snapshot version (saved)
    const headUri = createGitUri(shelvedFile.relativePath, 'HEAD');
    const snapshotUri = createSnapshotUri(
        shelvedFile.relativePath,
        changelistId,
        shelvedFile.originalContent,
        shelvedFile.shelvedAt
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

async function revertFile(service: ChangelistService, arg: unknown): Promise<void> {
    const filePath = getFilePathFromArg(arg);
    if (!filePath) {
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

/**
 * Add a snapshot to VS Code Chat (Copilot, etc.)
 * If saveSnapshotsToFile is enabled, uses the file from .gitchangelists/
 * Otherwise, creates a temporary file or uses the snapshot content directly
 */
async function addToChat(service: ChangelistService, arg: unknown): Promise<void> {
    const { shelvedFile, changelistId } = getShelvedFileInfoFromArg(arg);

    if (!shelvedFile || !changelistId) {
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
        // Use the file from .gitchangelists/
        snapshotPath = service.getSnapshotFilePath(shelvedFile, changelist);

        // Check if file exists
        if (!fs.existsSync(snapshotPath)) {
            showError('Snapshot file not found. Enable "Save Snapshots to File" in settings and save the snapshot again.');
            return;
        }
    } else {
        // Create a temporary file for the snapshot
        const workspaceRoot = getWorkspaceRoot()!;
        const tempDir = path.join(workspaceRoot, '.gitchangelists', '.temp');
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
        // This works with GitHub Copilot Chat and other chat extensions
        await vscode.commands.executeCommand('workbench.action.chat.attachFile', snapshotUri);
        showInfo(`Added snapshot to chat: ${path.basename(shelvedFile.relativePath)}`);
    } catch {
        // Fallback: Copy the path to clipboard and show message
        await vscode.env.clipboard.writeText(snapshotPath);
        showInfo(`Snapshot path copied to clipboard: ${snapshotPath}\nYou can paste this in any AI chat tool.`);
    }
}

/**
 * Add a working file to VS Code Chat
 */
async function addWorkingFileToChat(arg: unknown): Promise<void> {
    const filePath = getFilePathFromArg(arg);
    if (!filePath) {
        showWarning('No file selected');
        return;
    }

    const absolutePath = toAbsolutePath(filePath);
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

/**
 * Compare a snapshot with another version (HEAD, Working, or other snapshot)
 */
async function compareWith(service: ChangelistService, arg: unknown): Promise<void> {
    const config = getConfig();
    if (!config.enableVersionComparison) {
        showWarning('Version comparison is disabled. Enable it in settings: gitChangelists.enableVersionComparison');
        return;
    }

    const { shelvedFile, changelistId } = getShelvedFileInfoFromArg(arg);

    if (!shelvedFile || !changelistId) {
        showWarning('No snapshot selected');
        return;
    }

    const currentChangelist = service.getChangelist(changelistId);
    if (!currentChangelist) {
        showError('Changelist not found');
        return;
    }

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
    const workingPath = toAbsolutePath(shelvedFile.relativePath);
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
        shelvedFile.shelvedAt
    );

    let leftUri: vscode.Uri;
    let leftLabel: string;

    if (selected.type === 'head') {
        leftUri = createGitUri(shelvedFile.relativePath, 'HEAD');
        leftLabel = 'HEAD';
    } else if (selected.type === 'working') {
        leftUri = vscode.Uri.file(workingPath);
        leftLabel = 'Working';
    } else if (selected.type === 'snapshot' && selected.version) {
        leftUri = createSnapshotUri(
            selected.version.shelvedFile.relativePath,
            selected.version.changelist.id,
            selected.version.shelvedFile.originalContent || '',
            selected.version.timestamp
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

/**
 * Compare all versions of a file (opens WebView panel)
 */
async function compareAllVersions(service: ChangelistService, arg: unknown): Promise<void> {
    const config = getConfig();
    if (!config.enableVersionComparison) {
        showWarning('Version comparison is disabled. Enable it in settings: gitChangelists.enableVersionComparison');
        return;
    }

    const { shelvedFile } = getShelvedFileInfoFromArg(arg);

    if (!shelvedFile) {
        showWarning('No snapshot selected');
        return;
    }

    // Get all versions of this file
    const allVersions = service.getFileVersions(shelvedFile.relativePath);

    if (allVersions.length < 2) {
        showInfo('Only one version exists. Use "Compare with..." to compare with HEAD or Working.');
        return;
    }

    // For now, show a QuickPick to select two versions to compare
    // TODO: In Phase 3, replace with WebView panel

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
        first.version.timestamp
    );

    const secondUri = createSnapshotUri(
        second.version.shelvedFile.relativePath,
        second.version.changelist.id,
        second.version.shelvedFile.originalContent || '',
        second.version.timestamp
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

async function refreshAll(service: ChangelistService): Promise<void> {
    await service.refresh();
    log('Refreshed changelists');
}

async function exportChangelists(service: ChangelistService): Promise<void> {
    const exportData = service.exportChangelists();

    if (exportData.changelists.length === 0) {
        showWarning('No changelists with shelved files to export');
        return;
    }

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('changelists.json'),
        filters: { 'JSON': ['json'] },
        title: 'Export Changelists'
    });

    if (uri) {
        const content = JSON.stringify(exportData, null, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        showInfo(`Exported ${exportData.changelists.length} changelist(s)`);
    }
}

async function importChangelists(service: ChangelistService): Promise<void> {
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

        if (obj.resourceUri && typeof obj.resourceUri === 'object') {
            const uri = obj.resourceUri as { fsPath?: string };
            if (uri.fsPath) {
                const workspaceRoot = getWorkspaceRoot();
                if (workspaceRoot) {
                    return path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');
                }
            }
        }

        if (obj.relativePath && typeof obj.relativePath === 'string') {
            return obj.relativePath;
        }
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
    log('Deactivating Git Changelists extension');
    vscode.commands.executeCommand('setContext', 'gitChangelists.enabled', false);
}
