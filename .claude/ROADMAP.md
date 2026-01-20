# Roadmap & Future Tasks

## Completed Features

### v1.0.0
- [x] Snapshot-based changelist system
- [x] Full file content storage
- [x] Multiple changelists support
- [x] Activity Bar panel
- [x] Diff preview
- [x] Export/Import changelists
- [x] Keyboard shortcuts

### v1.1.0
- [x] Version Comparison (experimental)
- [x] AI/CLI Integration (Add to Chat)
- [x] File-based snapshots option
- [x] Badge counter
- [x] Smart changelist naming

### v1.1.1
- [x] Rebrand to "Smart Changelists"
- [x] Update all internal references

### v1.1.2
- [x] New icon design
- [x] Separate Activity Bar / Marketplace icons

### v1.1.3
- [x] GitHub Actions CI/CD
- [x] Unit test infrastructure
- [x] Multi-platform testing
- [x] Auto release on tag

### v1.2.0
- [x] Multi-select delete for snapshots
- [x] New icon designs

### v2.0.1 (Major Release)
- [x] Multi-root workspace support
- [x] Nested git repos / submodule detection
- [x] Activity Bar always visible (even without git)
- [x] Repository-specific state management
- [x] Hierarchical TreeView for multiple repos
- [x] RepositoryManager class
- [x] Automatic state migration from v1.x
- [x] State version 4
- [x] Fix: Shelve command works from command palette

---

## Pending / Future

### High Priority
- [ ] What's New notification on update
- [ ] Dependabot for dependency updates
- [ ] Issue templates (bug, feature)

### Medium Priority
- [ ] WebView for version comparison (Phase 3 of plan)
- [ ] Merge wizard for multiple versions
- [ ] Localization (multi-language)

### Low Priority
- [ ] Telemetry (usage analytics)
- [ ] Contributing guide
- [ ] Sponsor integration

---

## Version Comparison Plan

Reference: `C:\Users\User\.claude\plans\structured-giggling-cherny.md`

### Phase 1: Foundation (DONE)
- [x] FileVersion type
- [x] enableVersionComparison config
- [x] getFileVersions() method
- [x] compareWith command
- [x] Context menu (config-controlled)

### Phase 2: Quick Compare (DONE)
- [x] QuickPick version list
- [x] HEAD, Working, snapshots
- [x] Diff between two versions

### Phase 3: WebView Report (TODO)
- [ ] ComparisonWebView class
- [ ] HTML/CSS/JS template
- [ ] Diff visualization
- [ ] Quick action buttons

### Phase 4: Merge Wizard (TODO)
- [ ] Selection UI per line
- [ ] Merge logic
- [ ] Apply to working
- [ ] Create new snapshot option

---

## What's New Feature

To implement update notification:

```typescript
// src/whatsnew.ts
export async function showWhatsNew(context: vscode.ExtensionContext) {
    const currentVersion = context.extension.packageJSON.version;
    const previousVersion = context.globalState.get<string>('version');

    if (previousVersion !== currentVersion) {
        context.globalState.update('version', currentVersion);

        const action = await vscode.window.showInformationMessage(
            `Smart Changelists v${currentVersion}`,
            'What\'s New',
            'Dismiss'
        );

        if (action === 'What\'s New') {
            vscode.env.openExternal(vscode.Uri.parse(
                'https://github.com/harungecit/smart-changelists/blob/main/CHANGELOG.md'
            ));
        }
    }
}
```

Call from `activate()` in extension.ts.

---

## Extended Git Features (Future Vision)

> **Amaç**: GitLens ve Interactive Git Log gibi eklentilerin popüler özelliklerini ücretsiz ve hafif bir pakette sunmak.

### Motivasyon
- GitLens'in çoğu gelişmiş özelliği Pro (ücretli)
- Kullanıcılar tek eklentiyle birçok iş görebilmeli
- Changelist + blame + log birbirini tamamlayan özellikler

### Kapsam Değişikliği
Eğer bu özellikler eklenirse:
- Eklenti ismi değişebilir: "Git Toolkit", "Git Plus", "Git Suite" vb.
- Marketplace açıklaması ve kategorileri güncellenecek

---

### Feature 1: Inline Blame (GitLens tarzı)

**Açıklama**: Editörde aktif satırın son değişiklik bilgisini gösterir.

**Görünüm**:
```
const x = 5;  // 👤 John Doe • 3 days ago • Fix calculation bug (a1b2c3d)
```

**Teknik Detaylar**:
- `git blame` komutu ile satır bazlı bilgi
- `TextEditorDecorationType` ile inline decoration
- Hover'da detaylı bilgi (full commit message, diff preview)
- Toggle komutu ile açma/kapama
- Performans: Lazy loading, cache mekanizması

**Ayarlar**:
```json
{
  "smartChangelists.inlineBlame.enabled": true,
  "smartChangelists.inlineBlame.format": "${author} • ${date} • ${message}",
  "smartChangelists.inlineBlame.dateFormat": "relative"
}
```

**Komutlar**:
- `Toggle Inline Blame`
- `Copy Commit Hash`
- `Show Commit Details`

---

### Feature 2: Interactive Git Log

**Açıklama**: Git geçmişini görsel olarak gezme, commit detaylarını inceleme.

**Uygulama Seçenekleri**:

#### Seçenek A: TreeView tabanlı
- Activity Bar'da yeni panel veya mevcut panele tab
- Commit listesi → dosya listesi → diff görüntüleme
- Hafif, native VS Code deneyimi

#### Seçenek B: WebView tabanlı
- Zengin görsel deneyim (graph, branch visualization)
- Daha fazla geliştirme eforu
- Git Graph eklentisi benzeri

**Önerilen**: TreeView ile başla, gerekirse WebView ekle.

**Özellikler**:
- [ ] Commit listesi (pagination ile)
- [ ] Branch/tag filtreleme
- [ ] Commit detayları (mesaj, yazar, tarih, hash)
- [ ] Commit'teki değişen dosyalar
- [ ] Dosya diff görüntüleme
- [ ] Commit'e checkout/reset (dikkatli!)
- [ ] Cherry-pick desteği
- [ ] Search/filter commits

**TreeView Yapısı**:
```
📁 GIT LOG
├── 📌 HEAD (main)
│   ├── 🔵 a1b2c3d - Fix login bug (John, 2 hours ago)
│   │   ├── 📄 src/auth.ts (+15, -3)
│   │   └── 📄 src/utils.ts (+2, -1)
│   ├── 🔵 d4e5f6g - Add user profile (Jane, 1 day ago)
│   └── ...
├── 🏷️ Tags
│   ├── v1.2.0
│   └── v1.1.0
└── 🌿 Branches
    ├── main
    ├── develop
    └── feature/xyz
```

---

### Feature 3: Commit Diff Viewer

**Açıklama**: Herhangi bir commit'in tüm değişikliklerini tek ekranda görme.

**Özellikler**:
- Commit seçimi (hash, branch, tag)
- Değişen dosyaların listesi
- Side-by-side veya inline diff
- Dosyalar arası gezinme

---

### Feature 4: Branch Karşılaştırma

**Açıklama**: İki branch arasındaki farkları listeleme.

**Özellikler**:
- Branch seçici (source → target)
- Farklı dosyaların listesi
- Her dosya için diff
- Merge conflict tahmini

---

### Uygulama Önceliği

| Sıra | Özellik | Zorluk | Etki |
|------|---------|--------|------|
| 1 | Inline Blame | Orta | Yüksek |
| 2 | Interactive Git Log (TreeView) | Orta | Yüksek |
| 3 | Commit Diff Viewer | Düşük | Orta |
| 4 | Branch Karşılaştırma | Orta | Orta |
| 5 | Interactive Git Log (WebView) | Yüksek | Yüksek |

---

### Teknik Notlar

**Git Komutları**:
```bash
# Inline blame
git blame -L <line>,<line> --porcelain <file>

# Commit log
git log --oneline --graph --all -n 50

# Commit details
git show --stat <hash>

# Commit diff
git diff <hash>^ <hash>

# Branch comparison
git diff <branch1>..<branch2> --stat
```

**VS Code API'leri**:
- `TextEditorDecorationType` - inline decorations
- `TreeDataProvider` - git log tree
- `WebviewPanel` - rich UI (optional)
- `Diff` - native diff viewer
- `SourceControl` API - git integration

---

## Notes

- Keep version at current until features finalized
- Test locally before pushing tags
- CI must pass before release
- Update CHANGELOG.md for each version
