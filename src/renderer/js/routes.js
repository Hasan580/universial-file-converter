/**
 * Every destination in the app. `group` decides which top tab it lives under; `feature` is the
 * key used by Settings > Features to hide a module (same keys as v4, so saved choices carry over).
 */
export const PAGES = {
    home:       { label: 'Home',       icon: 'home',      load: () => import('./pages/home.js') },

    audio:      { label: 'Audio',      icon: 'audio',     group: 'convert',  feature: 'audio',    load: () => import('./pages/audio.js') },
    video:      { label: 'Video',      icon: 'video',     group: 'convert',  feature: 'video',    load: () => import('./pages/video.js') },
    image:      { label: 'Images',     icon: 'image',     group: 'convert',  feature: 'image',    load: () => import('./pages/image.js') },
    compress:   { label: 'Compress',   icon: 'compress',  group: 'convert',  feature: 'compress', load: () => import('./pages/compress.js') },
    document:   { label: 'Documents',  icon: 'document',  group: 'convert',  feature: 'document', load: () => import('./pages/document.js') },

    download:   { label: 'Media',      icon: 'download',  group: 'download', feature: 'download', load: () => import('./pages/download.js') },
    downloads:  { label: 'Direct links', icon: 'link',    group: 'download', feature: 'downloads', load: () => import('./pages/downloads.js') },
    spotify:    { label: 'Spotify',    icon: 'music',     group: 'download', feature: 'spotify',  load: () => import('./pages/spotify.js') },

    history:    { label: 'History',    icon: 'clock',     group: 'library',  load: () => import('./pages/history.js') },
    player:     { label: 'Player',     icon: 'play',      group: 'library',  feature: 'player',   load: () => import('./pages/player.js') },
    books:      { label: 'Books',      icon: 'book',      group: 'library',  feature: 'books',    load: () => import('./pages/books.js') },

    organizer:  { label: 'Organizer',  icon: 'layers',    group: 'tools',    feature: 'organizer', load: () => import('./pages/organizer.js') },
    storage:    { label: 'Storage',    icon: 'drive',     group: 'tools',    feature: 'storage',  load: () => import('./pages/storage.js') },
    ai:         { label: 'AI Hub',     icon: 'sparkles',  group: 'tools',    feature: 'ai',       load: () => import('./pages/ai.js') },
    surf:       { label: 'Browser',    icon: 'globe',     group: 'tools',    feature: 'surf',     load: () => import('./pages/surf.js') },
    wallpaper:  { label: 'Wallpaper',  icon: 'monitor',   group: 'tools',    feature: 'wallpaper', load: () => import('./pages/wallpaper.js') },

    activity:   { label: 'Activity',   icon: 'terminal',  load: () => import('./pages/activity.js') },
    updates:    { label: 'Updates',    icon: 'refresh',   load: () => import('./pages/updates.js') },
    settings:   { label: 'Settings',   icon: 'settings',  load: () => import('./pages/settings.js') }
};

export const GROUPS = [
    { id: 'convert',  label: 'Convert',  first: 'audio' },
    { id: 'download', label: 'Download', first: 'download' },
    { id: 'library',  label: 'Library',  first: 'history' },
    { id: 'tools',    label: 'Tools',    first: 'organizer' }
];

export const groupOf = (page) => (PAGES[page] && PAGES[page].group) || null;

/** Which converter page should receive a file of this type. */
export const PAGE_FOR_TYPE = { audio: 'audio', video: 'video', image: 'image', document: 'document' };
