# Changelog

## [2.0.0] - 2026-01-20

### Added

**Multi-Git Repository Support** (Major Feature)
- **Multi-root workspace support** - Each workspace folder with its own git repository is now handled independently
- **Nested repositories / Submodules** - Automatically discovers and manages nested git repos and submodules
- **Always-visible Activity Bar** - Extension panel is always visible, even without a git repository (shows "No Git Repository" message)
- **Repository-specific state** - Each repository maintains its own changelists and snapshots
- **Repository hierarchy in TreeView** - When multiple repos exist, shows hierarchical view with repos at root level; single repo maintains flat view for backward compatibility

### Changed
- **New RepositoryManager** - Centralized management of all git repositories in workspace
- **State key per repository** - Uses unique hash-based keys for storing each repo's state
- **URI handling updated** - Git content provider now includes repository path for proper multi-repo diff support
- **Automatic migration** - Legacy single-repo state is automatically migrated to new format

### Fixed
- **Shelve from Command Palette** - "Shelve to Changelist" now works from command palette using active editor's file

### Technical
- State version bumped to 4
- New activation event: `onView:smartChangelistsView`
- View `when` condition removed for always-visible panel

### Migration Notes
- Existing changelists will be automatically migrated to the new format
- No action required from users - migration happens on first load

---

## [1.2.0] - 2025-12-30

### Added
- **Multi-select delete** - Select multiple snapshots (Ctrl/Cmd + click) and delete them all at once
- New icon designs

---

## [1.1.3] - 2025-12-13

### Added
- **GitHub Actions CI/CD** - Automated testing and release workflows
- **Unit Tests** - Test infrastructure with Mocha and @vscode/test-electron
- **Multi-platform CI** - Tests run on Ubuntu, Windows, and macOS

### Changed
- Improved icon design for better visibility
- Updated extension description to "JetBrains-style changelists"
- Added more keywords for better discoverability (phpstorm, webstorm, shelve, etc.)

### Technical
- Added `.github/workflows/ci.yml` for continuous integration
- Added `.github/workflows/release.yml` for automated releases
- Added ESLint configuration
- Node.js 22 support

---

## [1.1.2] - 2025-12-12

### Changed
- New simplified icon design for better visibility in Activity Bar
- Separate icons for Marketplace (black) and Activity Bar (white/monochrome)
- Removed unused icon variants for smaller package size

---

## [1.1.1] - 2025-12-11

### Changed
- Rebranded to **Smart Changelists**
- All internal references updated from `gitChangelists` to `smartChangelists`
- Snapshot folder renamed from `.gitchangelists/` to `.smartchangelists/`

---

## [1.1.0] - 2025-12-11

### Added

**Version Comparison (Experimental)**
- Compare with... - Compare snapshot with HEAD, Working file, or other snapshots
- Compare All Versions - Select any two versions of the same file to compare side-by-side
- New configuration: `enableVersionComparison` (disabled by default)

**AI/CLI Integration**
- Add to Chat command for VS Code Chat extensions (Copilot, etc.)
- Optional file-based snapshots in `.smartchangelists/` folder for CLI tool access
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
