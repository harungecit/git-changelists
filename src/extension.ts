import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChangelistService } from './ChangelistService';
import { ChangelistProvider, ChangelistDecorationProvider } from './ChangelistProvider';
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
let provider: ChangelistProvider | undefined;
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
    provider = new ChangelistProvider(service);

    const decorationProvider = new ChangelistDecorationProvider(service);
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(decorationProvider)
    );

    registerChangelistTreeView(context, service);
    registerGitContentProvider(context);

    vscode.commands.executeCommand('setContext', 'gitChangelists.enabled', true);

    registerCommands(context, service, provider);

    await service.refresh();

    log('Git Changelists extension activated');

    context.subscriptions.push(service, provider, outputChannel);
}

/**
 * Register all extension commands
 */
function registerCommands(
    context: vscode.ExtensionContext,
    service: ChangelistService,
    provider: ChangelistProvider
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
        ['gitChangelist.commitWorkingChanges', () => commitWorkingChanges(service, provider)],

        // File operations
        ['gitChangelist.openFile', (arg) => openFile(arg)],
        ['gitChangelist.openDiff', (arg) => openDiff(arg)],
        ['gitChangelist.previewShelved', (arg) => previewShelved(arg)],
        ['gitChangelist.revertFile', (arg) => revertFile(service, arg)],

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

async function createChangelist(service: ChangelistService): Promise<void> {
    const name = await promptInput({
        prompt: 'Enter changelist name',
        placeholder: 'My Changelist',
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

async function commitWorkingChanges(
    service: ChangelistService,
    provider: ChangelistProvider
): Promise<void> {
    const files = service.getChangedFiles();

    if (files.length === 0) {
        showWarning('No working changes to commit');
        return;
    }

    const message = provider.getSourceControl().inputBox.value;
    if (!message.trim()) {
        showWarning('Please enter a commit message');
        return;
    }

    const config = getConfig();
    if (config.confirmBeforeCommit) {
        const proceed = await promptConfirm(`Commit ${files.length} working change(s)?`);
        if (!proceed) return;
    }

    try {
        await service.commitWorkingChanges(message.trim());
        provider.getSourceControl().inputBox.value = '';
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
