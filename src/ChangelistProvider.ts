import * as vscode from 'vscode';
import * as path from 'path';
import { ChangelistService } from './ChangelistService';
import {
    Changelist,
    ChangedFile,
    ShelvedFile,
    ChangelistResourceState,
    STATUS_DECORATIONS,
    SHELVED_DECORATION
} from './types';
import { getConfig, toAbsolutePath, getWorkspaceRoot, log } from './utils';

/**
 * SCM Provider for Smart Changelists with Shelve support
 */
export class ChangelistProvider implements vscode.Disposable {
    private sourceControl: vscode.SourceControl;
    private workingChangesGroup: vscode.SourceControlResourceGroup;
    private shelvedGroups: Map<string, vscode.SourceControlResourceGroup> = new Map();
    private disposables: vscode.Disposable[] = [];

    constructor(private readonly service: ChangelistService) {
        // Create the source control
        this.sourceControl = vscode.scm.createSourceControl(
            'smartChangelists',
            'Smart Changelists',
            vscode.Uri.file(getWorkspaceRoot() || '')
        );

        this.sourceControl.inputBox.placeholder = 'Commit message';
        this.sourceControl.acceptInputCommand = {
            command: 'smartChangelists.commitWorkingChanges',
            title: 'Commit'
        };

        // Create working changes group (default changelist - unshelved changes)
        this.workingChangesGroup = this.sourceControl.createResourceGroup(
            'workingChanges',
            'Working Changes'
        );
        this.workingChangesGroup.hideWhenEmpty = false;

        // Subscribe to service events
        this.disposables.push(
            this.service.onDidChangeChangelists(() => this.updateShelvedGroups()),
            this.service.onDidChangeFiles(() => this.updateWorkingChanges())
        );

        // Initial setup
        this.updateShelvedGroups();
        this.updateWorkingChanges();
    }

    /**
     * Update the working changes group with current git status
     */
    private updateWorkingChanges(): void {
        const files = this.service.getChangedFiles();

        this.workingChangesGroup.resourceStates = files.map(file =>
            this.createWorkingResourceState(file)
        );

        this.workingChangesGroup.label = `Working Changes (${files.length})`;
    }

    /**
     * Update shelved groups based on changelists
     */
    private updateShelvedGroups(): void {
        const changelists = this.service.getChangelists();
        const config = getConfig();

        // Track existing groups for cleanup
        const existingIds = new Set(this.shelvedGroups.keys());
        const currentIds = new Set(
            changelists.filter(cl => !cl.isDefault).map(cl => cl.id)
        );

        // Remove groups that no longer exist
        for (const id of existingIds) {
            if (!currentIds.has(id)) {
                const group = this.shelvedGroups.get(id);
                group?.dispose();
                this.shelvedGroups.delete(id);
            }
        }

        // Create/update groups for non-default changelists
        for (const changelist of changelists) {
            if (changelist.isDefault) continue;

            let group = this.shelvedGroups.get(changelist.id);

            if (!group) {
                // Create new group
                group = this.sourceControl.createResourceGroup(
                    changelist.id,
                    this.formatGroupLabel(changelist)
                );
                group.hideWhenEmpty = !config.showEmptyChangelists;
                this.shelvedGroups.set(changelist.id, group);
            }

            // Update group label and resources
            group.label = this.formatGroupLabel(changelist);
            group.resourceStates = changelist.shelvedFiles.map(shelvedFile =>
                this.createShelvedResourceState(shelvedFile, changelist.id)
            );
        }
    }

    /**
     * Format the group label with file count and active indicator
     */
    private formatGroupLabel(changelist: Changelist): string {
        const count = changelist.shelvedFiles.length;
        const activeMarker = changelist.isActive ? ' ★' : '';
        return `${changelist.label} [Shelved] (${count})${activeMarker}`;
    }

    /**
     * Create a resource state for a working (unshelved) file
     */
    private createWorkingResourceState(file: ChangedFile): ChangelistResourceState {
        const uri = vscode.Uri.file(file.absolutePath);
        const decoration = STATUS_DECORATIONS[file.status];

        return {
            resourceUri: uri,
            file,
            changelistId: 'working',
            decorations: {
                strikeThrough: file.status === 'deleted',
                faded: file.status === 'ignored',
                tooltip: `${file.relativePath} • ${decoration.tooltip}`
            },
            command: {
                command: 'smartChangelists.openDiff',
                title: 'Open Diff',
                arguments: [{ file, changelistId: 'working' }]
            }
        };
    }

    /**
     * Create a resource state for a shelved file
     */
    private createShelvedResourceState(
        shelvedFile: ShelvedFile,
        changelistId: string
    ): vscode.SourceControlResourceState {
        const absolutePath = toAbsolutePath(shelvedFile.relativePath);
        const uri = vscode.Uri.file(absolutePath);
        const statusDecoration = STATUS_DECORATIONS[shelvedFile.status];

        return {
            resourceUri: uri,
            decorations: {
                strikeThrough: shelvedFile.status === 'deleted',
                faded: true, // Shelved files appear faded
                tooltip: `${shelvedFile.relativePath} • Shelved (${statusDecoration.tooltip})`
            },
            command: {
                command: 'smartChangelists.previewShelved',
                title: 'Preview Shelved Changes',
                arguments: [{ shelvedFile, changelistId }]
            }
        };
    }

    /**
     * Get resource group by changelist ID
     */
    public getResourceGroup(changelistId: string): vscode.SourceControlResourceGroup | undefined {
        if (changelistId === 'working') {
            return this.workingChangesGroup;
        }
        return this.shelvedGroups.get(changelistId);
    }

    /**
     * Get source control instance
     */
    public getSourceControl(): vscode.SourceControl {
        return this.sourceControl;
    }

    /**
     * Refresh all
     */
    public async refresh(): Promise<void> {
        await this.service.refresh();
    }

    public dispose(): void {
        this.workingChangesGroup.dispose();
        this.shelvedGroups.forEach(group => group.dispose());
        this.shelvedGroups.clear();
        this.sourceControl.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * File decoration provider for changelist files
 */
export class ChangelistDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    constructor(private readonly service: ChangelistService) {
        service.onDidChangeFiles(() => {
            this._onDidChangeFileDecorations.fire(undefined);
        });
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) return undefined;

        const relativePath = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');
        const files = this.service.getChangedFiles();
        const file = files.find(f => f.relativePath === relativePath);

        if (!file) return undefined;

        const decoration = STATUS_DECORATIONS[file.status];
        return {
            badge: decoration.badge,
            tooltip: decoration.tooltip,
            color: decoration.color
        };
    }
}
