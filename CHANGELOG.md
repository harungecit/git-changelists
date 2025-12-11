# Changelog

All notable changes to the "Git Changelists" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2025-12-11

### Added

**Version Comparison (Experimental)**
- Compare with... - Compare snapshot with HEAD, Working file, or other snapshots
- Compare All Versions - Select any two versions of the same file to compare side-by-side
- New configuration: `enableVersionComparison` (disabled by default)

**AI/CLI Integration**
- Add to Chat command for VS Code Chat extensions (Copilot, etc.)
- Optional file-based snapshots in `.gitchangelists/` folder for CLI tool access
- New configuration: `saveSnapshotsToFile` (disabled by default)
- Compatible with Claude Code, Gemini Code, and other AI coding assistants

**User Interface Enhancements**
- Badge counter on Activity Bar showing total snapshot count
- Smart changelist naming with auto-increment suggestions (v1 → v2, version_1 → version_2)

### Changed
- Updated icon from SVG to PNG format for better compatibility

---

## [1.0.0] - 2025-12-11

### Added

**Core Features**
- Snapshot-based changelist system for organizing Git changes
- Full file content storage (not diffs) ensuring snapshots never corrupt
- Multiple changelists support - organize changes into separate groups
- Same file can have different versions in different changelists

**Commands**
- Save to Changelist - save current file state as snapshot without reverting
- Restore to Working - apply snapshot content to working directory
- Apply & Stage - apply snapshot and stage for commit in one action
- Apply All & Stage - batch apply all snapshots from a changelist
- Delete Snapshot - remove unwanted snapshots
- Create/Rename/Delete Changelist - manage changelist groups

**User Interface**
- Dedicated Activity Bar panel with custom icon
- Diff preview - click any snapshot to see HEAD vs Snapshot comparison
- File type icons from VS Code's icon theme
- Working Changes section showing current Git changes
- Changelist sections showing saved snapshots

**Other**
- Export/Import changelists as JSON
- Auto-refresh on file save
- Keyboard shortcuts:
  - `Ctrl+Shift+N` - Create new changelist
  - `Ctrl+Shift+M` - Save file to changelist
- Persistent state across VS Code sessions
- Configuration options:
  - `showEmptyChangelists` - Show/hide empty changelists
  - `autoRefreshOnSave` - Auto-refresh on file save
  - `confirmBeforeCommit` - Confirmation before commit
  - `confirmBeforeRevert` - Confirmation before revert

### Technical Details
- State version: 3
- Each snapshot stores complete file content independently
- Snapshots are not removed when restored (can be reused)
- No interference with VS Code's built-in Git panel
