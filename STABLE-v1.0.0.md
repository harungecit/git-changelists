# Git Changelists - Stable Version 1.0.0

**Tarih:** 2025-12-10
**Dosya:** `git-changelists-1.0.0-stable.vsix`

## Ozellikler

### Snapshot Sistemi
- Dosyanin herhangi bir anini snapshot olarak kaydeder
- Dosya oldugi gibi kalir, revert edilmez
- Ayni dosyanin birden fazla versiyonu farkli changelist'lerde tutulabilir
- Her snapshot birbirinden bagimsiz (tam icerik kaydedilir, diff degil)

### Komutlar

| Komut | Aciklama |
|-------|----------|
| **Save to Changelist** | Dosyanin snapshot'ini al (dosya oldugi gibi kalir) |
| **Restore to Working** | Snapshot'i working directory'e geri yukle |
| **Apply & Stage** | Snapshot'i uygula VE git stage'e ekle |
| **Apply All & Stage** | Tum changelist snapshot'larini uygula ve stage'e ekle |
| **Delete Snapshot** | Snapshot'i sil |
| **Preview** | HEAD vs Snapshot diff gorunumu ac |

### UI
- Ayri Activity Bar paneli (Sol tarafta kendi ikonu)
- Working Changes: Aktif git degisiklikleri
- Changelist grupları: Kaydedilmis snapshot'lar
- Snapshot'a tiklaninca diff gorunumu acilir (HEAD vs Snapshot)

### Teknik Detaylar
- Snapshot icerigi tam olarak kaydedilir (`originalContent`)
- HEAD icerigi referans icin saklanir (`headContent`)
- State version: 3
- VS Code'un Git paneli ayri kalir, cakisma yok

## Dosya Yapisi
```
src/
├── extension.ts           # Ana giris, komut kayitlari
├── ChangelistService.ts   # Core logic, shelve/unshelve
├── ChangelistProvider.ts  # SCM Provider
├── ChangelistTreeProvider.ts # Tree view
├── GitContentProvider.ts  # Diff icin content provider
├── types.ts              # Interface tanimlari
└── utils.ts              # Yardimci fonksiyonlar
```

## Kurulum
```
code --install-extension git-changelists-1.0.0-stable.vsix --force
```
