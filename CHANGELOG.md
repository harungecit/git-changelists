# Changelog

All notable changes to the "Git Changelists" extension will be documented in this file.

## [1.0.0] - 2024-12-10

### Added
- Initial release with snapshot-based system
- **Snapshot System**: Save full file content (not diffs) for reliable versioning
- Multiple changelists support - organize changes into groups
- Save to Changelist - save current file state without reverting
- Restore to Working - apply snapshot to working directory
- Apply & Stage - apply snapshot and stage for commit in one action
- Apply All & Stage - batch apply all snapshots in a changelist
- Delete Snapshot - remove unwanted snapshots
- Diff preview - click any snapshot to see HEAD vs Snapshot comparison
- Drag & drop support for moving files between changelists
- Export/Import changelists as JSON
- Dedicated Activity Bar panel with custom icon
- Git status decorations (Modified, Added, Deleted, Renamed, Untracked)
- Auto-refresh on file save
- Keyboard shortcuts:
  - `Ctrl+Shift+N` - Create new changelist
  - `Ctrl+Shift+M` - Save file to changelist
- Persistent state across VS Code sessions
- Configuration options for customization

### Technical Details
- State version: 3
- Full content storage ensures snapshots never corrupt
- Each snapshot is independent of HEAD
- Same file can have different versions in different changelists
