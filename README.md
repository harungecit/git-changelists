# Git Changelists

IntelliJ-style changelists for VS Code. Save snapshots of your changes into multiple groups and switch between versions easily.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/harungecit.git-changelists)](https://marketplace.visualstudio.com/items?itemName=harungecit.git-changelists)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Snapshot System**: Save the current state of any file as a snapshot
- **Multiple Versions**: Keep different versions of the same file in different changelists
- **Non-Destructive**: Saving a snapshot doesn't revert your file - keep working!
- **Diff View**: Click any snapshot to see differences from HEAD
- **Apply & Stage**: Apply a snapshot and stage it for commit in one click
- **Independent Snapshots**: Each snapshot stores full content, not diffs - no corruption
- **Export/Import**: Save and restore your changelists

## Installation

### From VSIX (Local)
```bash
code --install-extension git-changelists-1.0.0.vsix
```

### From Source
```bash
git clone https://github.com/user/git-changelists.git
cd git-changelists
npm install
npm run build
npx vsce package
code --install-extension git-changelists-1.0.0.vsix
```

## Usage

### Quick Start

1. Make changes to a file
2. Click the **Git Changelists** icon in the Activity Bar (left sidebar)
3. Right-click on the file under "Working Changes"
4. Select **"Shelve to Changelist..."**
5. Choose or create a changelist

Your snapshot is saved! The file stays as-is so you can continue working.

### Commands

| Action | Description |
|--------|-------------|
| **Save to Changelist** | Save current file state as a snapshot |
| **Restore to Working** | Replace working file with snapshot content |
| **Apply & Stage** | Apply snapshot AND stage for commit |
| **Apply All & Stage** | Apply all snapshots in a changelist |
| **Delete Snapshot** | Remove a snapshot |
| **Preview (Click)** | View diff between HEAD and snapshot |

### Workflow Example

```
1. Edit config.json (v1 → v2)
2. Save to "Feature A" changelist     → Snapshot of v2 saved
3. Continue editing (v2 → v3)
4. Save to "Feature B" changelist     → Snapshot of v3 saved
5. Decide v2 is correct
6. Click "Apply & Stage" on Feature A → File becomes v2, staged for commit
7. Commit!
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+N` | Create new changelist |
| `Ctrl+Shift+M` | Save file to changelist |

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `gitChangelists.defaultChangelistName` | Name for default changelist | "Default Changelist" |
| `gitChangelists.showEmptyChangelists` | Show empty changelists | `true` |
| `gitChangelists.autoRefreshOnSave` | Auto-refresh on file save | `true` |
| `gitChangelists.confirmBeforeCommit` | Confirm before commit | `true` |
| `gitChangelists.confirmBeforeRevert` | Confirm before revert | `true` |

## How It Works

Unlike traditional shelve/stash systems that save diffs, Git Changelists saves the **complete file content** for each snapshot. This means:

- Snapshots never become corrupted due to conflicting changes
- Each snapshot is independent - no dependencies on HEAD
- You can have multiple versions of the same file in different changelists
- Switching between versions is instant and reliable

## Requirements

- VS Code 1.85.0+
- Git installed

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Harun Gecit**
- Website: [harungecit.dev](https://harungecit.dev)
- GitHub: [@harungecit](https://github.com/harungecit)
- LinkedIn: [harungecit](https://linkedin.com/in/harungecit)
- Instagram: [@harungecit.dev](https://instagram.com/harungecit.dev)
- Email: info@harungecit.com

## Contributing

Contributions welcome! Please open an issue or PR.

---

**Enjoy organizing your changes!**
