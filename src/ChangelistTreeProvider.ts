import * as vscode from 'vscode';
import * as path from 'path';
import { ChangelistService } from './ChangelistService';
import { Changelist, ChangedFile, ShelvedFile, STATUS_DECORATIONS, SHELVED_DECORATION } from './types';
import { getWorkspaceRoot, toAbsolutePath } from './utils';

/**
 * Tree item types
 */
type TreeItemType = 'working-header' | 'changelist' | 'working-file' | 'shelved-file';

/**
 * Custom tree item for changelists view
 */
export class ChangelistTreeItem extends vscode.TreeItem {
    constructor(
        public readonly itemType: TreeItemType,
        public readonly changelist?: Changelist,
        public readonly file?: ChangedFile,
        public readonly shelvedFile?: ShelvedFile,
        public readonly changelistId?: string
    ) {
        super(
            ChangelistTreeItem.getLabel(itemType, changelist, file, shelvedFile),
            ChangelistTreeItem.getCollapsibleState(itemType)
        );

        this.setupItem();
    }

    private static getLabel(
        itemType: TreeItemType,
        changelist?: Changelist,
        file?: ChangedFile,
        shelvedFile?: ShelvedFile
    ): string {
        switch (itemType) {
            case 'working-header':
                return 'Working Changes';
            case 'changelist':
                return changelist!.label;
            case 'working-file':
                return path.basename(file!.relativePath);
            case 'shelved-file':
                return path.basename(shelvedFile!.relativePath);
        }
    }

    private static getCollapsibleState(itemType: TreeItemType): vscode.TreeItemCollapsibleState {
        if (itemType === 'working-header' || itemType === 'changelist') {
            return vscode.TreeItemCollapsibleState.Expanded;
        }
        return vscode.TreeItemCollapsibleState.None;
    }

    private setupItem(): void {
        switch (this.itemType) {
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
            command: 'gitChangelist.openDiff',
            title: 'Open Diff',
            arguments: [{ file, changelistId: 'working' }]
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
        this.resourceUri = vscode.Uri.file(toAbsolutePath(shelvedFile.relativePath));

        this.command = {
            command: 'gitChangelist.previewShelved',
            title: 'Preview Shelved',
            arguments: [{ shelvedFile, changelistId: this.changelistId }]
        };
    }
}

/**
 * Tree data provider for changelists with drag and drop support
 */
export class ChangelistTreeProvider implements
    vscode.TreeDataProvider<ChangelistTreeItem>,
    vscode.TreeDragAndDropController<ChangelistTreeItem> {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ChangelistTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    readonly dragMimeTypes = ['application/vnd.code.tree.gitChangelistsView'];
    readonly dropMimeTypes = ['application/vnd.code.tree.gitChangelistsView'];

    constructor(private readonly service: ChangelistService) {
        service.onDidChangeChangelists(() => this.refresh());
        service.onDidChangeFiles(() => this.refresh());
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChangelistTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ChangelistTreeItem): Thenable<ChangelistTreeItem[]> {
        if (!element) {
            // Root level - return working header and changelists
            return Promise.resolve(this.getRootItems());
        }

        if (element.itemType === 'working-header') {
            // Working changes - return current git changes
            return Promise.resolve(this.getWorkingFileItems());
        }

        if (element.itemType === 'changelist' && element.changelist) {
            // Changelist - return shelved files
            return Promise.resolve(this.getShelvedFileItems(element.changelist));
        }

        return Promise.resolve([]);
    }

    getParent(element: ChangelistTreeItem): vscode.ProviderResult<ChangelistTreeItem> {
        if (element.itemType === 'working-file') {
            return new ChangelistTreeItem('working-header');
        }
        if (element.itemType === 'shelved-file' && element.changelistId) {
            const changelist = this.service.getChangelist(element.changelistId);
            if (changelist) {
                return new ChangelistTreeItem('changelist', changelist);
            }
        }
        return undefined;
    }

    private getRootItems(): ChangelistTreeItem[] {
        const items: ChangelistTreeItem[] = [];

        // Working changes header
        items.push(new ChangelistTreeItem('working-header'));

        // Shelved changelists (non-default)
        const changelists = this.service.getChangelists().filter(cl => !cl.isDefault);
        for (const cl of changelists) {
            items.push(new ChangelistTreeItem('changelist', cl));
        }

        return items;
    }

    private getWorkingFileItems(): ChangelistTreeItem[] {
        const files = this.service.getChangedFiles();
        return files.map(file =>
            new ChangelistTreeItem('working-file', undefined, file)
        );
    }

    private getShelvedFileItems(changelist: Changelist): ChangelistTreeItem[] {
        return changelist.shelvedFiles.map(shelvedFile =>
            new ChangelistTreeItem('shelved-file', undefined, undefined, shelvedFile, changelist.id)
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
            type: 'working-file'
        }));

        dataTransfer.set(
            'application/vnd.code.tree.gitChangelistsView',
            new vscode.DataTransferItem(JSON.stringify(dragData))
        );
    }

    async handleDrop(
        target: ChangelistTreeItem | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Target must be a changelist (for shelving)
        if (!target || target.itemType !== 'changelist' || !target.changelist) {
            return;
        }

        const transferItem = dataTransfer.get('application/vnd.code.tree.gitChangelistsView');
        if (!transferItem) return;

        try {
            const dragData: Array<{ relativePath: string; type: string }> =
                JSON.parse(await transferItem.asString());

            const filesToShelve = dragData
                .filter(item => item.type === 'working-file')
                .map(item => item.relativePath);

            if (filesToShelve.length > 0) {
                await this.service.shelveFiles(filesToShelve, target.changelist.id);
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
    service: ChangelistService
): ChangelistTreeProvider {
    const treeProvider = new ChangelistTreeProvider(service);

    const treeView = vscode.window.createTreeView('gitChangelistsView', {
        treeDataProvider: treeProvider,
        dragAndDropController: treeProvider,
        showCollapseAll: true,
        canSelectMany: true
    });

    // Update badge when data changes
    const updateBadge = () => {
        const changelists = service.getChangelists();
        const totalSnapshots = changelists.reduce((sum, cl) => sum + cl.shelvedFiles.length, 0);

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

    // Update badge when changelists change
    service.onDidChangeChangelists(() => updateBadge());

    context.subscriptions.push(treeView);

    return treeProvider;
}
