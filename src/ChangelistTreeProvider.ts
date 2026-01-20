import * as vscode from 'vscode';
import * as path from 'path';
import { ChangelistService } from './ChangelistService';
import { Changelist, ChangedFile, ShelvedFile, STATUS_DECORATIONS, GitRepository } from './types';
import { getAbsolutePathFromRepo } from './utils';

/**
 * Tree item types
 */
type TreeItemType = 'repository' | 'working-header' | 'changelist' | 'working-file' | 'shelved-file' | 'no-repos';

/**
 * Custom tree item for changelists view
 */
export class ChangelistTreeItem extends vscode.TreeItem {
    constructor(
        public readonly itemType: TreeItemType,
        public readonly repository?: GitRepository,
        public readonly changelist?: Changelist,
        public readonly file?: ChangedFile,
        public readonly shelvedFile?: ShelvedFile,
        public readonly changelistId?: string,
        public readonly repoPath?: string
    ) {
        super(
            ChangelistTreeItem.getLabel(itemType, repository, changelist, file, shelvedFile),
            ChangelistTreeItem.getCollapsibleState(itemType)
        );

        this.setupItem();
    }

    private static getLabel(
        itemType: TreeItemType,
        repository?: GitRepository,
        changelist?: Changelist,
        file?: ChangedFile,
        shelvedFile?: ShelvedFile
    ): string {
        switch (itemType) {
            case 'repository':
                return repository!.name;
            case 'working-header':
                return 'Working Changes';
            case 'changelist':
                return changelist!.label;
            case 'working-file':
                return path.basename(file!.relativePath);
            case 'shelved-file':
                return path.basename(shelvedFile!.relativePath);
            case 'no-repos':
                return 'No Git Repository';
        }
    }

    private static getCollapsibleState(itemType: TreeItemType): vscode.TreeItemCollapsibleState {
        if (itemType === 'repository' || itemType === 'working-header' || itemType === 'changelist') {
            return vscode.TreeItemCollapsibleState.Expanded;
        }
        return vscode.TreeItemCollapsibleState.None;
    }

    private setupItem(): void {
        switch (this.itemType) {
            case 'repository':
                this.setupRepositoryItem();
                break;
            case 'working-header':
                this.setupWorkingHeader();
                break;
            case 'changelist':
                this.setupChangelistItem();
                break;
            case 'working-file':
                this.setupWorkingFileItem();
                break;
            case 'shelved-file':
                this.setupShelvedFileItem();
                break;
            case 'no-repos':
                this.setupNoReposItem();
                break;
        }
    }

    private setupRepositoryItem(): void {
        const repo = this.repository!;
        this.contextValue = 'repository';
        this.iconPath = new vscode.ThemeIcon('repo');

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${repo.name}**\n\n`);
        this.tooltip.appendMarkdown(`Path: ${repo.path}\n\n`);
        if (repo.isSubmodule) {
            this.tooltip.appendMarkdown('_Submodule_');
        }

        // Show submodule indicator
        if (repo.isSubmodule) {
            this.description = '(submodule)';
        }
    }

    private setupWorkingHeader(): void {
        this.contextValue = 'working-header';
        this.iconPath = new vscode.ThemeIcon('edit');
        this.tooltip = 'Current uncommitted changes in working directory';
    }

    private setupChangelistItem(): void {
        const changelist = this.changelist!;
        this.contextValue = changelist.isDefault ? 'changelist-default' : 'changelist';
        this.iconPath = changelist.isActive
            ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
            : new vscode.ThemeIcon('archive');

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${changelist.label}**\n\n`);
        this.tooltip.appendMarkdown(`Shelved files: ${changelist.shelvedFiles.length}\n\n`);
        if (changelist.isActive) {
            this.tooltip.appendMarkdown('★ _Active_\n\n');
        }
        this.tooltip.appendMarkdown('_Right-click for options_');

        this.description = `[Shelved] (${changelist.shelvedFiles.length})`;
    }

    private setupWorkingFileItem(): void {
        const file = this.file!;
        const decoration = STATUS_DECORATIONS[file.status];

        this.contextValue = 'working-file';

        const dirPath = path.dirname(file.relativePath);
        this.description = dirPath && dirPath !== '.' ? dirPath : '';

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${file.relativePath}**\n\n`);
        this.tooltip.appendMarkdown(`Status: ${decoration.tooltip}\n\n`);
        this.tooltip.appendMarkdown('_Click to view diff, right-click to save snapshot_');

        // Use resourceUri for proper file type icons from VS Code
        this.resourceUri = vscode.Uri.file(file.absolutePath);

        this.command = {
            command: 'smartChangelists.openDiff',
            title: 'Open Diff',
            arguments: [{ file, changelistId: 'working', repoPath: this.repoPath }]
        };
    }

    private setupShelvedFileItem(): void {
        const shelvedFile = this.shelvedFile!;
        const decoration = STATUS_DECORATIONS[shelvedFile.status];

        this.contextValue = 'shelved-file';

        const dirPath = path.dirname(shelvedFile.relativePath);
        const dateStr = new Date(shelvedFile.shelvedAt).toLocaleString();
        this.description = dirPath && dirPath !== '.' ? dirPath : '';

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${shelvedFile.relativePath}**\n\n`);
        this.tooltip.appendMarkdown(`Saved: ${dateStr}\n\n`);
        this.tooltip.appendMarkdown(`Original status: ${decoration.tooltip}\n\n`);
        this.tooltip.appendMarkdown('_Click to preview diff, right-click for options_');

        // Use resourceUri for proper file type icons from VS Code
        const repoPath = shelvedFile.repoPath || this.repoPath;
        if (repoPath) {
            this.resourceUri = vscode.Uri.file(getAbsolutePathFromRepo(shelvedFile.relativePath, repoPath));
        }

        this.command = {
            command: 'smartChangelists.previewShelved',
            title: 'Preview Shelved',
            arguments: [{ shelvedFile, changelistId: this.changelistId, repoPath: this.repoPath }]
        };
    }

    private setupNoReposItem(): void {
        this.contextValue = 'no-repos';
        this.iconPath = new vscode.ThemeIcon('warning');
        this.tooltip = 'No git repository found in the workspace. Initialize a git repository to use Smart Changelists.';
        this.description = 'Initialize a git repository';
    }
}

/**
 * Tree data provider for changelists with drag and drop support.
 * Supports both single-repo (flat) and multi-repo (hierarchical) views.
 */
export class ChangelistTreeProvider implements
    vscode.TreeDataProvider<ChangelistTreeItem>,
    vscode.TreeDragAndDropController<ChangelistTreeItem> {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ChangelistTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    readonly dragMimeTypes = ['application/vnd.code.tree.smartChangelistsView'];
    readonly dropMimeTypes = ['application/vnd.code.tree.smartChangelistsView'];

    /** Map of repository path to service */
    private services: Map<string, ChangelistService> = new Map();

    constructor() {
        // Services will be added via addService()
    }

    /**
     * Add a service for a repository
     */
    public addService(service: ChangelistService): void {
        this.services.set(service.repository.path, service);
        service.onDidChangeChangelists(() => this.refresh());
        service.onDidChangeFiles(() => this.refresh());
    }

    /**
     * Remove a service for a repository
     */
    public removeService(repoPath: string): void {
        this.services.delete(repoPath);
        this.refresh();
    }

    /**
     * Get service for a repository path
     */
    public getService(repoPath: string): ChangelistService | undefined {
        return this.services.get(repoPath);
    }

    /**
     * Get all services
     */
    public getServices(): ChangelistService[] {
        return Array.from(this.services.values());
    }

    /**
     * Check if we have multiple repositories
     */
    public hasMultipleRepositories(): boolean {
        return this.services.size > 1;
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChangelistTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ChangelistTreeItem): Thenable<ChangelistTreeItem[]> {
        // No services - show "No Git Repository" message
        if (this.services.size === 0) {
            if (!element) {
                return Promise.resolve([new ChangelistTreeItem('no-repos')]);
            }
            return Promise.resolve([]);
        }

        if (!element) {
            // Root level
            if (this.hasMultipleRepositories()) {
                // Multi-repo: show repository nodes at root
                return Promise.resolve(this.getRepositoryItems());
            } else {
                // Single repo: show flat structure (backward compat)
                const service = this.getServices()[0];
                return Promise.resolve(this.getRootItemsForService(service));
            }
        }

        // Handle children based on item type
        if (element.itemType === 'repository' && element.repoPath) {
            const service = this.getService(element.repoPath);
            if (service) {
                return Promise.resolve(this.getRootItemsForService(service));
            }
        }

        if (element.itemType === 'working-header' && element.repoPath) {
            const service = this.getService(element.repoPath);
            if (service) {
                return Promise.resolve(this.getWorkingFileItems(service));
            }
        }

        if (element.itemType === 'changelist' && element.changelist && element.repoPath) {
            return Promise.resolve(this.getShelvedFileItems(element.changelist, element.repoPath));
        }

        return Promise.resolve([]);
    }

    getParent(element: ChangelistTreeItem): vscode.ProviderResult<ChangelistTreeItem> {
        if (!element.repoPath) return undefined;

        const service = this.getService(element.repoPath);
        if (!service) return undefined;

        if (element.itemType === 'working-file') {
            if (this.hasMultipleRepositories()) {
                return new ChangelistTreeItem(
                    'working-header',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    element.repoPath
                );
            }
            return new ChangelistTreeItem('working-header');
        }

        if (element.itemType === 'shelved-file' && element.changelistId) {
            const changelist = service.getChangelist(element.changelistId);
            if (changelist) {
                return new ChangelistTreeItem(
                    'changelist',
                    undefined,
                    changelist,
                    undefined,
                    undefined,
                    undefined,
                    element.repoPath
                );
            }
        }

        if (element.itemType === 'working-header' || element.itemType === 'changelist') {
            if (this.hasMultipleRepositories()) {
                return new ChangelistTreeItem(
                    'repository',
                    service.repository,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    element.repoPath
                );
            }
        }

        return undefined;
    }

    /**
     * Get repository items for multi-repo view
     */
    private getRepositoryItems(): ChangelistTreeItem[] {
        const items: ChangelistTreeItem[] = [];

        for (const service of this.getServices()) {
            const changedCount = service.getChangedFiles().length;
            const shelvedCount = service.getChangelists()
                .reduce((sum, cl) => sum + cl.shelvedFiles.length, 0);

            const item = new ChangelistTreeItem(
                'repository',
                service.repository,
                undefined,
                undefined,
                undefined,
                undefined,
                service.repository.path
            );

            // Add count as description
            const counts: string[] = [];
            if (changedCount > 0) counts.push(`${changedCount} changed`);
            if (shelvedCount > 0) counts.push(`${shelvedCount} shelved`);
            if (counts.length > 0) {
                item.description = `(${counts.join(', ')})`;
            }

            items.push(item);
        }

        return items;
    }

    /**
     * Get root items for a single service (working header + changelists)
     */
    private getRootItemsForService(service: ChangelistService): ChangelistTreeItem[] {
        const items: ChangelistTreeItem[] = [];
        const repoPath = service.repository.path;

        // Working changes header
        items.push(new ChangelistTreeItem(
            'working-header',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            repoPath
        ));

        // Shelved changelists (non-default)
        const changelists = service.getChangelists().filter(cl => !cl.isDefault);
        for (const cl of changelists) {
            items.push(new ChangelistTreeItem(
                'changelist',
                undefined,
                cl,
                undefined,
                undefined,
                undefined,
                repoPath
            ));
        }

        return items;
    }

    /**
     * Get working file items for a service
     */
    private getWorkingFileItems(service: ChangelistService): ChangelistTreeItem[] {
        const files = service.getChangedFiles();
        return files.map(file =>
            new ChangelistTreeItem(
                'working-file',
                undefined,
                undefined,
                file,
                undefined,
                undefined,
                service.repository.path
            )
        );
    }

    /**
     * Get shelved file items for a changelist
     */
    private getShelvedFileItems(changelist: Changelist, repoPath: string): ChangelistTreeItem[] {
        return changelist.shelvedFiles.map(shelvedFile =>
            new ChangelistTreeItem(
                'shelved-file',
                undefined,
                undefined,
                undefined,
                shelvedFile,
                changelist.id,
                repoPath
            )
        );
    }

    // ========== Drag and Drop Implementation ==========

    handleDrag(
        source: readonly ChangelistTreeItem[],
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): void | Thenable<void> {
        // Only allow dragging working files
        const workingFiles = source.filter(item => item.itemType === 'working-file');
        if (workingFiles.length === 0) return;

        const dragData = workingFiles.map(item => ({
            relativePath: item.file!.relativePath,
            type: 'working-file',
            repoPath: item.repoPath
        }));

        dataTransfer.set(
            'application/vnd.code.tree.smartChangelistsView',
            new vscode.DataTransferItem(JSON.stringify(dragData))
        );
    }

    async handleDrop(
        target: ChangelistTreeItem | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Target must be a changelist (for shelving)
        if (!target || target.itemType !== 'changelist' || !target.changelist || !target.repoPath) {
            return;
        }

        const service = this.getService(target.repoPath);
        if (!service) return;

        const transferItem = dataTransfer.get('application/vnd.code.tree.smartChangelistsView');
        if (!transferItem) return;

        try {
            const dragData: Array<{ relativePath: string; type: string; repoPath?: string }> =
                JSON.parse(await transferItem.asString());

            // Only shelve files from the same repository
            const filesToShelve = dragData
                .filter(item => item.type === 'working-file' && item.repoPath === target.repoPath)
                .map(item => item.relativePath);

            if (filesToShelve.length > 0) {
                await service.shelveFiles(filesToShelve, target.changelist.id);
            }
        } catch (error) {
            console.error('Failed to handle drop:', error);
        }
    }
}

/**
 * Register the tree view
 */
export function registerChangelistTreeView(
    context: vscode.ExtensionContext,
    treeProvider: ChangelistTreeProvider
): vscode.TreeView<ChangelistTreeItem> {
    const treeView = vscode.window.createTreeView('smartChangelistsView', {
        treeDataProvider: treeProvider,
        dragAndDropController: treeProvider,
        showCollapseAll: true,
        canSelectMany: true
    });

    // Update badge when data changes
    const updateBadge = () => {
        const services = treeProvider.getServices();
        const totalSnapshots = services.reduce((total, service) => {
            return total + service.getChangelists().reduce((sum, cl) => sum + cl.shelvedFiles.length, 0);
        }, 0);

        if (totalSnapshots > 0) {
            treeView.badge = {
                value: totalSnapshots,
                tooltip: `${totalSnapshots} snapshot${totalSnapshots > 1 ? 's' : ''} saved`
            };
        } else {
            treeView.badge = undefined;
        }
    };

    // Initial badge update
    updateBadge();

    // Listen for changes from all services
    for (const service of treeProvider.getServices()) {
        service.onDidChangeChangelists(() => updateBadge());
    }

    context.subscriptions.push(treeView);

    return treeView;
}
