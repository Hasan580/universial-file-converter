# Spotube-Inspired UI Specification

> A detailed layout and visual design spec for replicating Spotube's desktop UI in an Electron app using HTML/CSS.

---

## 1. Top-Level Layout Structure

The app uses a **three-zone layout** filling the entire viewport:

```
┌──────────────────────────────────────────────────────┐
│                    TITLE BAR (optional)               │  ~32px
├────────────┬─────────────────────────────────────────┤
│            │                                         │
│  SIDEBAR   │          MAIN CONTENT AREA              │
│  (fixed)   │          (scrollable)                   │
│            │                                         │
│  200-240px │          flex: 1                        │
│            │                                         │
│            │                                         │
│            │                                         │
│            │                                         │
├────────────┴─────────────────────────────────────────┤
│              NOW PLAYING / BOTTOM BAR                 │  ~80-90px
└──────────────────────────────────────────────────────┘
```

### CSS Structure:
```css
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-primary);
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  min-width: 220px;
  flex-shrink: 0;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.now-playing-bar {
  height: 80px;
  flex-shrink: 0;
}
```

---

## 2. Color Palette & Theme

Spotube uses a **Material Design 3 (Material You)** inspired theming system with a dark default.

### Dark Theme (Primary):
| Token                  | Value                  | Usage                                |
|------------------------|------------------------|--------------------------------------|
| `--bg-primary`         | `#121212` / `#0f0f0f`  | App background                       |
| `--bg-secondary`       | `#1e1e1e` / `#181818`  | Sidebar, cards                       |
| `--bg-surface`         | `#252525` / `#222222`  | Elevated surfaces, bottom bar        |
| `--bg-surface-hover`   | `#2a2a2a` / `#303030`  | Card/item hover state                |
| `--bg-surface-active`  | `#333333`              | Active/selected items                |
| `--accent`             | `#6C63FF` / `#79E2A0`  | Primary accent (green-ish by default)|
| `--accent-variant`     | `#1DB954`              | Spotify-green accent option          |
| `--text-primary`       | `#FFFFFF`              | Headings, primary text               |
| `--text-secondary`     | `#B3B3B3` / `#a0a0a0`  | Subtitles, secondary labels          |
| `--text-muted`         | `#727272` / `#666666`  | Timestamps, metadata                 |
| `--border`             | `rgba(255,255,255,0.06)`| Subtle dividers                      |
| `--shadow`             | `rgba(0,0,0,0.3)`     | Card shadows                         |

### Light Theme (Alt):
| Token                  | Value                  |
|------------------------|------------------------|
| `--bg-primary`         | `#FAFAFA`              |
| `--bg-secondary`       | `#FFFFFF`              |
| `--bg-surface`         | `#F0F0F0`              |
| `--text-primary`       | `#1A1A1A`              |
| `--text-secondary`     | `#555555`              |

### Key Design Properties:
- **Border radius**: `12px` for cards, `8px` for buttons, `20px` for pills/chips, `50%` for avatars
- **Font family**: System font stack — `'Segoe UI', 'Inter', 'Roboto', -apple-system, sans-serif`
- **Font sizes**: 
  - Section headings: `22-24px`, weight `700`
  - Card titles: `14-15px`, weight `600`
  - Subtitles/artists: `12-13px`, weight `400`
  - Small labels: `11px`
- **Transitions**: `all 0.2s ease` on hover states
- **Scrollbar**: Thin custom scrollbar, ~6px wide, semi-transparent

---

## 3. Sidebar (Left Navigation)

The sidebar is a **fixed-width vertical panel** with icon+text navigation items.

### Structure:
```
┌────────────────────┐
│   🎵 App Logo      │  Logo area, ~60px height
│                    │
├────────────────────┤
│  🏠 Home           │  Nav item (active: accent bg)
│  🔍 Search         │  Nav item
│  📚 Library        │  Nav item
│  📥 Downloads      │  Nav item  (added for your app)
├────────────────────┤
│                    │
│  PLAYLISTS SECTION │  Separator + "Playlists" label
│  ─────────────────│
│  📋 Liked Songs    │  Playlist item
│  📋 My Playlist 1  │  Playlist item
│  📋 My Playlist 2  │  Playlist item
│  ...               │  (scrollable if overflows)
│                    │
├────────────────────┤
│  ⚙️ Settings       │  Bottom-pinned
│  👤 Profile        │  Bottom-pinned
└────────────────────┘
```

### CSS:
```css
.sidebar {
  width: 220px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  padding: 0;
  user-select: none;
}

.sidebar-logo {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 18px;
  font-weight: 700;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}

.sidebar-nav {
  padding: 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.sidebar-nav-item:hover {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
}

.sidebar-nav-item.active {
  background: var(--accent);
  color: #fff;
  /* OR: subtle approach */
  /* background: rgba(108, 99, 255, 0.15); */
  /* color: var(--accent); */
}

.sidebar-nav-item .icon {
  width: 20px;
  height: 20px;
  font-size: 18px;
  flex-shrink: 0;
}

.sidebar-playlists {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  border-top: 1px solid var(--border);
}

.sidebar-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  padding: 8px 12px 4px;
}

.sidebar-playlist-item {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.sidebar-playlist-item:hover {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
}

.sidebar-bottom {
  padding: 8px;
  border-top: 1px solid var(--border);
  margin-top: auto;
}
```

---

## 4. Main Content Area

This is a **scrollable region** that changes based on the active view. Content has consistent inner padding.

### Wrapper:
```css
.main-content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-primary);
}

.main-content-inner {
  padding: 24px 28px;
  max-width: 1400px;
}
```

---

## 5. Home / Browse Page

The home page uses **horizontal scrolling rows** of content cards, similar to Spotify/Netflix.

### Structure:
```
┌─────────────────────────────────────────────────┐
│  Good evening, User                      🔔  ⚙️ │  Greeting header
├─────────────────────────────────────────────────┤
│                                                 │
│  Recently Played            See all →           │  Section header
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │  Horizontal scroll row
│  │ 🎵 │ │ 🎵 │ │ 🎵 │ │ 🎵 │ │ 🎵 │ │ 🎵 │    │  of cards
│  │    │ │    │ │    │ │    │ │    │ │    │    │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    │
│                                                 │
│  Featured Playlists         See all →           │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐            │
│  │ 📋 │ │ 📋 │ │ 📋 │ │ 📋 │ │ 📋 │            │
│  │    │ │    │ │    │ │    │ │    │            │
│  └────┘ └────┘ └────┘ └────┘ └────┘            │
│                                                 │
│  New Releases               See all →           │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │
│  │ 💿 │ │ 💿 │ │ 💿 │ │ 💿 │                   │
│  │    │ │    │ │    │ │    │                   │
│  └────┘ └────┘ └────┘ └────┘                   │
└─────────────────────────────────────────────────┘
```

### Section Header:
```css
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  margin-top: 28px;
}

.section-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
}

.section-see-all {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-see-all:hover {
  color: var(--text-primary);
}
```

### Horizontal Scroll Row:
```css
.card-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-behavior: smooth;
  padding-bottom: 8px;
  /* Hide scrollbar but keep scroll */
  scrollbar-width: none;
}

.card-row::-webkit-scrollbar {
  display: none;
}
```

### Content Card (Album/Playlist/Artist):
```
┌──────────────────┐
│  ┌──────────────┐│
│  │              ││  Album art (square, 1:1)
│  │   ARTWORK    ││  150×150 to 180×180
│  │              ││
│  │      ▶       ││  Play button overlay on hover
│  └──────────────┘│
│  Title of Song    │  14px, semi-bold, ellipsis
│  Artist Name      │  12px, muted, ellipsis
└──────────────────┘
```

```css
.content-card {
  min-width: 170px;
  max-width: 170px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.content-card:hover {
  background: var(--bg-surface-hover);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.content-card .card-image {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  margin-bottom: 10px;
  background: var(--bg-surface);
}

.content-card .card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Play button overlay — hidden by default, appears on card hover */
.content-card .play-overlay {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateY(8px);
  transition: all 0.25s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.content-card:hover .play-overlay {
  opacity: 1;
  transform: translateY(0);
}

.content-card .card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.content-card .card-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### Quick-Access Pill Grid (Top of Home):
Spotube v4+/v5 shows a **2×3 grid of compact pill-shaped items** at the top of the home page for recently played. These are wider, shorter items with a small thumbnail on the left.

```css
.quick-access-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 24px;
}

.quick-access-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-surface);
  border-radius: 6px;
  overflow: hidden;
  height: 56px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.quick-access-item:hover {
  background: var(--bg-surface-hover);
}

.quick-access-item img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  flex-shrink: 0;
}

.quick-access-item .title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

---

## 6. Search Results Page

### Structure:
```
┌─────────────────────────────────────────────────┐
│  🔍 [____Search input field________________]    │  Large search bar
├─────────────────────────────────────────────────┤
│  [Songs] [Albums] [Artists] [Playlists]         │  Filter tabs/chips
├─────────────────────────────────────────────────┤
│                                                 │
│  Songs                                          │
│  ┌──────────────────────────────────────────┐   │
│  │ 🎵  Song Title        Artist    3:42  ⋮ │   │  Track list rows
│  │ 🎵  Song Title        Artist    4:01  ⋮ │   │
│  │ 🎵  Song Title        Artist    2:58  ⋮ │   │
│  │ 🎵  Song Title        Artist    3:15  ⋮ │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
│  Albums                       See all →         │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐            │  Horizontal cards
│  │ 💿 │ │ 💿 │ │ 💿 │ │ 💿 │ │ 💿 │            │
│  └────┘ └────┘ └────┘ └────┘ └────┘            │
│                                                 │
│  Artists                                        │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │  Round avatar cards
│  │ 👤 │ │ 👤 │ │ 👤 │ │ 👤 │                   │
│  └────┘ └────┘ └────┘ └────┘                   │
└─────────────────────────────────────────────────┘
```

### Search Bar:
```css
.search-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 16px 0;
  background: var(--bg-primary);
}

.search-input-wrapper {
  position: relative;
  max-width: 480px;
}

.search-input {
  width: 100%;
  padding: 12px 16px 12px 44px;
  border-radius: 24px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(108, 99, 255, 0.15);
}

.search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 18px;
}
```

### Filter Chips:
```css
.filter-chips {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 6px 16px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.filter-chip:hover {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
}

.filter-chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
```

### Track List Row:
```css
.track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.track-row {
  display: grid;
  grid-template-columns: 40px 1fr 1fr 60px 40px;
  /* #  Title+Art  Artist  Duration  Menu */
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s ease;
  gap: 12px;
}

.track-row:hover {
  background: var(--bg-surface-hover);
}

.track-row .track-number {
  font-size: 14px;
  color: var(--text-muted);
  text-align: center;
}

/* On hover, track number becomes a play icon */
.track-row:hover .track-number {
  /* swap to ▶ icon */
}

.track-row .track-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.track-row .track-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.track-row .track-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-row .track-artist {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-row .track-duration {
  font-size: 13px;
  color: var(--text-muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.track-row .track-menu {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.track-row:hover .track-menu {
  opacity: 1;
}

/* Currently playing track highlight */
.track-row.playing .track-title {
  color: var(--accent);
}
```

---

## 7. Playlist / Album Detail Page

### Structure:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌─────────┐                                    │
│  │         │  Playlist Title (28px bold)         │  Hero header area
│  │ ARTWORK │  By Username · 42 songs · 2h 15m   │  with blurred bg
│  │ 220×220 │                                    │
│  │         │  [▶ Play All] [⬇ Download] [⋮]    │
│  └─────────┘                                    │
│                                                 │
├─────────────────────────────────────────────────┤
│  #   TITLE              ARTIST    ALBUM   TIME  │  Column headers
│  ─────────────────────────────────────────────  │
│  1   🎵 Song Name       Artist    Album   3:42  │
│  2   🎵 Song Name       Artist    Album   4:01  │
│  3   🎵 Song Name       Artist    Album   2:58  │
│  ...                                            │
└─────────────────────────────────────────────────┘
```

### Hero Header (with gradient backdrop):
```css
.playlist-hero {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  padding: 32px 28px;
  position: relative;
  /* Gradient overlay from album art dominant color */
  background: linear-gradient(180deg, 
    rgba(var(--hero-color-rgb), 0.4) 0%, 
    var(--bg-primary) 100%);
  min-height: 280px;
}

.playlist-hero .hero-artwork {
  width: 220px;
  height: 220px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  object-fit: cover;
  flex-shrink: 0;
}

.playlist-hero .hero-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.playlist-hero .hero-type {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-secondary);
}

.playlist-hero .hero-title {
  font-size: 36px;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1.1;
}

.playlist-hero .hero-meta {
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.playlist-hero .hero-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.btn-play-all {
  padding: 12px 32px;
  border-radius: 24px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: transform 0.1s ease, background 0.2s ease;
}

.btn-play-all:hover {
  transform: scale(1.04);
  filter: brightness(1.1);
}

.btn-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-icon:hover {
  color: var(--text-primary);
  border-color: var(--text-primary);
}
```

### Track List Table (Playlist view):
```css
.track-table-header {
  display: grid;
  grid-template-columns: 40px 1.5fr 1fr 1fr 60px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Track rows use same grid columns */
.track-row-playlist {
  display: grid;
  grid-template-columns: 40px 1.5fr 1fr 1fr 60px;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  gap: 12px;
}
```

---

## 8. Now Playing / Bottom Bar

The bottom bar is the **most critical UI element** — always visible, showing current track and controls.

### Structure:
```
┌─────────────────────────────────────────────────────────────────────┐
│  ┌──────┐                                                          │
│  │ ART  │  Song Title          ◄◄  ▶/❚❚  ►►       🔈━━━━━━●○  │
│  │48×48 │  Artist Name    0:45 ━━━━●━━━━━━━━ 3:42   🔀 🔁  📋  │
│  └──────┘                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Three-Column Layout:
```
┌───────────────────┬───────────────────────────┬──────────────────┐
│   LEFT (track)    │    CENTER (controls)      │  RIGHT (extra)   │
│   ~30% width      │    ~40% width             │  ~30% width      │
└───────────────────┴───────────────────────────┴──────────────────┘
```

### HTML Structure:
```html
<div class="now-playing-bar">
  <!-- LEFT: Track Info -->
  <div class="npb-left">
    <img class="npb-artwork" src="..." alt="">
    <div class="npb-track-info">
      <div class="npb-title">Song Title</div>
      <div class="npb-artist">Artist Name</div>
    </div>
    <button class="npb-like-btn">♡</button>
  </div>

  <!-- CENTER: Playback Controls -->
  <div class="npb-center">
    <div class="npb-controls">
      <button class="npb-btn" title="Shuffle">🔀</button>
      <button class="npb-btn" title="Previous">⏮</button>
      <button class="npb-btn npb-play-btn" title="Play/Pause">▶</button>
      <button class="npb-btn" title="Next">⏭</button>
      <button class="npb-btn" title="Repeat">🔁</button>
    </div>
    <div class="npb-progress">
      <span class="npb-time-current">0:45</span>
      <div class="npb-progress-bar">
        <div class="npb-progress-fill" style="width: 25%"></div>
        <div class="npb-progress-handle"></div>
      </div>
      <span class="npb-time-total">3:42</span>
    </div>
  </div>

  <!-- RIGHT: Volume & Extra -->
  <div class="npb-right">
    <button class="npb-btn" title="Lyrics">🎤</button>
    <button class="npb-btn" title="Queue">📋</button>
    <div class="npb-volume">
      <button class="npb-btn">🔊</button>
      <div class="npb-volume-bar">
        <div class="npb-volume-fill" style="width: 70%"></div>
      </div>
    </div>
    <button class="npb-btn" title="Full screen">⛶</button>
  </div>
</div>
```

### CSS:
```css
.now-playing-bar {
  height: 80px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
  z-index: 100;
}

/* --- LEFT: Track Info --- */
.npb-left {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 30%;
  min-width: 180px;
}

.npb-artwork {
  width: 52px;
  height: 52px;
  border-radius: 6px;
  object-fit: cover;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.npb-track-info {
  min-width: 0;
  flex: 1;
}

.npb-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.npb-artist {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.npb-like-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  transition: color 0.15s ease;
}

.npb-like-btn:hover,
.npb-like-btn.liked {
  color: var(--accent);
}

/* --- CENTER: Controls --- */
.npb-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 40%;
  max-width: 600px;
  gap: 4px;
}

.npb-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.npb-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  padding: 6px;
  border-radius: 50%;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.npb-btn:hover {
  color: var(--text-primary);
  transform: scale(1.1);
}

.npb-play-btn {
  width: 36px;
  height: 36px;
  background: var(--text-primary);
  color: var(--bg-primary);
  border-radius: 50%;
  font-size: 14px;
}

.npb-play-btn:hover {
  transform: scale(1.08);
  background: #fff;
}

/* --- Progress Bar --- */
.npb-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.npb-time-current,
.npb-time-total {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 35px;
  text-align: center;
}

.npb-progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  position: relative;
  cursor: pointer;
}

.npb-progress-bar:hover {
  height: 6px;
}

.npb-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  position: relative;
}

.npb-progress-handle {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-primary);
  position: absolute;
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 0.15s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.npb-progress-bar:hover .npb-progress-handle {
  opacity: 1;
}

/* --- RIGHT: Volume & Extras --- */
.npb-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 30%;
  min-width: 150px;
}

.npb-volume {
  display: flex;
  align-items: center;
  gap: 6px;
}

.npb-volume-bar {
  width: 90px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  position: relative;
  cursor: pointer;
}

.npb-volume-fill {
  height: 100%;
  background: var(--text-primary);
  border-radius: 2px;
}

.npb-volume-bar:hover .npb-volume-fill {
  background: var(--accent);
}
```

---

## 9. Playlist Display Variants

### Grid View (Library page):

Playlists in the library/browse area are shown as a **responsive grid of cards**.

```css
.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 20px;
}
```

Each item uses the `.content-card` style from section 5.

### List View (Sidebar / Compact):
In the sidebar or compact mode, playlists are single-line items:
```css
.playlist-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.playlist-list-item:hover {
  background: var(--bg-surface-hover);
}

.playlist-list-item .thumb {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
}

.playlist-list-item .info {
  flex: 1;
  min-width: 0;
}

.playlist-list-item .name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.playlist-list-item .meta {
  font-size: 12px;
  color: var(--text-muted);
}
```

---

## 10. Additional UI Elements

### Skeleton Loading States:
Spotube uses **skeleton shimmer placeholders** while content loads:
```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-surface) 25%,
    var(--bg-surface-hover) 50%,
    var(--bg-surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### Context Menu (Right-click):
```css
.context-menu {
  position: fixed;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 0;
  min-width: 200px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 1000;
}

.context-menu-item {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
}

.context-menu-item:hover {
  background: var(--bg-surface-hover);
}

.context-menu-separator {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
```

### Scrollbar:
```css
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}
```

### Tooltip:
```css
[data-tooltip] {
  position: relative;
}

[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 12px;
  border-radius: 4px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

[data-tooltip]:hover::after {
  opacity: 1;
}
```

---

## 11. Full-Screen "Now Playing" View

When expanding the bottom bar, Spotube shows a **full-screen now-playing overlay** with:

```
┌─────────────────────────────────────────────────┐
│                                                 │
│              (blurred album art bg)             │
│                                                 │
│           ┌──────────────────────┐              │
│           │                      │              │
│           │    LARGE ARTWORK     │              │
│           │     300×300          │              │
│           │                      │              │
│           └──────────────────────┘              │
│                                                 │
│              Song Title (24px)                   │
│              Artist Name (16px)                  │
│                                                 │
│         0:45 ━━━━━━●━━━━━━━━━ 3:42             │
│                                                 │
│           🔀   ⏮   ▶   ⏭   🔁                │
│                                                 │
│              SYNCED LYRICS                       │
│           (scrolling text area)                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

```css
.fullscreen-player {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  /* Blurred album art background */
  overflow: hidden;
}

.fullscreen-player::before {
  content: '';
  position: absolute;
  inset: -50%;
  background-image: var(--current-artwork);
  background-size: cover;
  background-position: center;
  filter: blur(80px) brightness(0.3);
  z-index: -1;
}

.fullscreen-artwork {
  width: 300px;
  height: 300px;
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  object-fit: cover;
}

/* Lyrics panel — shows alongside or below artwork */
.lyrics-panel {
  max-height: 300px;
  overflow-y: auto;
  text-align: center;
  padding: 0 40px;
}

.lyrics-line {
  font-size: 18px;
  color: var(--text-muted);
  padding: 6px 0;
  transition: all 0.3s ease;
}

.lyrics-line.active {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 20px;
}
```

---

## Summary: Container Hierarchy

```
body
├── .app-shell
│   ├── .titlebar (optional, 32px)
│   ├── .app-body (flex row)
│   │   ├── .sidebar (220px fixed)
│   │   │   ├── .sidebar-logo
│   │   │   ├── .sidebar-nav
│   │   │   │   └── .sidebar-nav-item (×4-5)
│   │   │   ├── .sidebar-playlists (scrollable)
│   │   │   │   └── .sidebar-playlist-item (×N)
│   │   │   └── .sidebar-bottom
│   │   └── .main-content (flex: 1, overflow-y: auto)
│   │       └── .main-content-inner
│   │           ├── [HOME]: .quick-access-grid + .section > .card-row
│   │           ├── [SEARCH]: .search-bar + .filter-chips + .track-list + .card-row
│   │           ├── [PLAYLIST]: .playlist-hero + .track-table-header + .track-list
│   │           └── [LIBRARY]: .playlist-grid
│   └── .now-playing-bar (80px fixed)
│       ├── .npb-left (track info)
│       ├── .npb-center (controls + progress)
│       └── .npb-right (volume + extras)
└── .fullscreen-player (overlay, toggled)
    ├── .fullscreen-artwork
    ├── .fullscreen-info
    ├── .fullscreen-controls
    └── .lyrics-panel
```

---

## Key Implementation Notes

1. **All measurements are css pixels** — scale with system DPI in Electron automatically
2. **Use CSS custom properties** for all colors to enable easy theme switching (dark/light)
3. **Use `backdrop-filter: blur()`** for glassmorphism effects on overlays
4. **Icon set**: Use Fluent UI System Icons (what Spotube uses), or Feather Icons, or Material Icons — all free
5. **Progress/volume bars**: Implement with `<input type="range">` styled with CSS, or div-based with JS drag handling
6. **Card hover play button**: Animate in with `opacity` + `translateY` for the smooth pop-up effect
7. **Sidebar active state**: Either accent-colored background pill or subtle highlight with accent-colored text + left border
8. **No visible borders between most areas** — use background color differences and subtle `box-shadow` instead
9. **Responsive**: At narrower widths, sidebar can collapse to icon-only (~60px)
