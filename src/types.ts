import * as vscode from 'vscode';

/**
 * Represents a Git repository in the workspace
 */
export interface GitRepository {
    /** Absolute path to the repository root */
    path: string;
    /** Display name (folder name) */
    name: string;
    /** Whether this is a git submodule */
    isSubmodule: boolean;
    /** Parent repository path if this is a submodule */
    parentRepoPath?: string;
}

/**
 * State for a single repository
 */
export interface RepoState {
    /** Path to the repository */
    repoPath: string;
    /** Display name of the repository */
    repoName: string;
    /** Changelists for this repository */
    changelists: Changelist[];
    /** ID of the active changelist */
    activeChangelistId: string;
}

/**
 * Git file status types
 */
export type GitFileStatus =
    | 'modified'      // M - Modified
    | 'added'         // A - Added (new file staged)
    | 'deleted'       // D - Deleted
    | 'renamed'       // R - Renamed
    | 'copied'        // C - Copied
    | 'untracked'     // ? - Untracked
    | 'ignored'       // ! - Ignored
    | 'conflicted';   // U - Unmerged/Conflicted

/**
 * Represents a single changed file in the working directory
 */
export interface ChangedFile {
    /** Absolute path to the file */
    absolutePath: string;
    /** Relative path from workspace root (or repo root in multi-repo mode) */
    relativePath: string;
    /** Git status of the file */
    status: GitFileStatus;
    /** Original path (for renamed/copied files) */
    originalPath?: string;
    /** Path to the repository this file belongs to (for multi-repo support) */
    repoPath?: string;
}

/**
 * Represents a shelved file entry with its full content
 */
export interface ShelvedFile {
    /** Relative path from workspace root (or repo root in multi-repo mode) */
    relativePath: string;
    /** Git status when shelved */
    status: GitFileStatus;
    /** The diff/patch content (legacy, kept for backward compatibility) */
    patch: string;
    /** Full content of the file when shelved (the actual shelved version) */
    originalContent?: string;
    /** Content from HEAD at the time of shelving (for restoring working dir) */
    headContent?: string;
    /** Timestamp when shelved */
    shelvedAt: number;
    /** Original path (for renamed files) */
    originalPath?: string;
    /** Path to the repository this file belongs to (for multi-repo support) */
    repoPath?: string;
}

/**
 * Represents a changelist (group of changes)
 */
export interface Changelist {
    /** Unique identifier */
    id: string;
    /** User-defined label for the changelist */
    label: string;
    /** Shelved files with their patches */
    shelvedFiles: ShelvedFile[];
    /** Whether this is the default changelist (unshelved working changes) */
    isDefault: boolean;
    /** Whether this is the active changelist (new changes go here) */
    isActive: boolean;
    /** Path to the repository this changelist belongs to (for multi-repo support) */
    repoPath?: string;
}

/**
 * State stored in workspaceState
 */
export interface ChangelistState {
    /** All changelists */
    changelists: Changelist[];
    /** ID of the active changelist */
    activeChangelistId: string;
    /** Version for potential future migrations */
    version: number;
}

/**
 * Export/Import format for changelists
 */
export interface ChangelistExport {
    /** Export format version */
    version: number;
    /** Exported changelists */
    changelists: Array<{
        label: string;
        shelvedFiles: ShelvedFile[];
    }>;
    /** Export timestamp */
    exportedAt: string;
}

/**
 * Resource state for SCM view
 */
export interface ChangelistResourceState extends vscode.SourceControlResourceState {
    /** The changed file this represents */
    file: ChangedFile;
    /** The changelist ID this file belongs to */
    changelistId: string;
    /** Whether this is a shelved file */
    isShelved?: boolean;
}

/**
 * Shelved resource state for SCM view
 */
export interface ShelvedResourceState extends vscode.SourceControlResourceState {
    /** The shelved file data */
    shelvedFile: ShelvedFile;
    /** The changelist ID this file belongs to */
    changelistId: string;
}

/**
 * Configuration options
 */
export interface ChangelistConfig {
    showEmptyChangelists: boolean;
    autoRefreshOnSave: boolean;
    confirmBeforeCommit: boolean;
    confirmBeforeRevert: boolean;
    saveSnapshotsToFile: boolean;
    enableVersionComparison: boolean;
}

/**
 * Represents a version of a file across changelists
 */
export interface FileVersion {
    changelist: Changelist;
    shelvedFile: ShelvedFile;
    label: string;
    timestamp: number;
}

/**
 * Events emitted by the changelist service
 */
export interface ChangelistEvents {
    onDidChangeChangelists: vscode.Event<void>;
    onDidChangeFiles: vscode.Event<void>;
}

/**
 * Decoration data for files
 */
export interface FileDecoration {
    badge: string;
    tooltip: string;
    color: vscode.ThemeColor;
}

/**
 * Map of git status to decoration
 */
export const STATUS_DECORATIONS: Record<GitFileStatus, FileDecoration> = {
    modified: {
        badge: 'M',
        tooltip: 'Modified',
        color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
    },
    added: {
        badge: 'A',
        tooltip: 'Added',
        color: new vscode.ThemeColor('gitDecoration.addedResourceForeground')
    },
    deleted: {
        badge: 'D',
        tooltip: 'Deleted',
        color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
    },
    renamed: {
        badge: 'R',
        tooltip: 'Renamed',
        color: new vscode.ThemeColor('gitDecoration.renamedResourceForeground')
    },
    copied: {
        badge: 'C',
        tooltip: 'Copied',
        color: new vscode.ThemeColor('gitDecoration.addedResourceForeground')
    },
    untracked: {
        badge: 'U',
        tooltip: 'Untracked',
        color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
    },
    ignored: {
        badge: 'I',
        tooltip: 'Ignored',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground')
    },
    conflicted: {
        badge: '!',
        tooltip: 'Conflicted',
        color: new vscode.ThemeColor('gitDecoration.conflictingResourceForeground')
    }
};

/**
 * Shelved file decoration
 */
export const SHELVED_DECORATION: FileDecoration = {
    badge: 'S',
    tooltip: 'Shelved',
    color: new vscode.ThemeColor('gitDecoration.stageModifiedResourceForeground')
};
