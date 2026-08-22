const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),

    // File operations
    selectFiles: (fileTypes) => ipcRenderer.invoke('select-files', fileTypes),
    selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),
    getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
    extractCoverArt: (filePath) => ipcRenderer.invoke('extract-cover-art', filePath),
    openFile: (filePath) => ipcRenderer.send('open-file', filePath),
    openFolder: (filePath) => ipcRenderer.send('open-folder', filePath),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getOutputDirectory: () => ipcRenderer.invoke('get-output-directory'),
    updateLibraries: () => ipcRenderer.invoke('update-libraries'),

    // Conversions
    convertAudio: (options) => ipcRenderer.invoke('convert-audio', options),
    convertVideo: (options) => ipcRenderer.invoke('convert-video', options),
    convertImage: (options) => ipcRenderer.invoke('convert-image', options),
    scanQrFromImage: (filePath) => ipcRenderer.invoke('scan-qr-from-image', filePath),
    convertDocument: (options) => ipcRenderer.invoke('convert-document', options),
    lockPDF: (options) => ipcRenderer.invoke('lock-pdf', options),
    mergePDFs: (options) => ipcRenderer.invoke('merge-pdfs', options),
    readEditableDocument: (options) => ipcRenderer.invoke('read-editable-document', options),
    saveEditableDocument: (options) => ipcRenderer.invoke('save-editable-document', options),
    pdfAddText: (options) => ipcRenderer.invoke('pdf-add-text', options),
    readPdfText: (options) => ipcRenderer.invoke('read-pdf-text', options),
    savePdfText: (options) => ipcRenderer.invoke('save-pdf-text', options),
    compressImage: (options) => ipcRenderer.invoke('compress-image', options),
    cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),

    // File Organizer
    selectOrganizeFolder: () => ipcRenderer.invoke('select-organize-folder'),
    previewOrganization: (folderPath) => ipcRenderer.invoke('preview-organization', folderPath),
    organizeFolder: (data) => ipcRenderer.invoke('organize-folder', data),
    getFolderStats: (folderPath) => ipcRenderer.invoke('get-folder-stats', folderPath),
    getDefaultMappings: () => ipcRenderer.invoke('get-default-mappings'),
    getUserPath: (pathType) => ipcRenderer.invoke('get-user-path', pathType),

    // Auto-Organizer
    startAutoOrganizer: (folderPath) => ipcRenderer.invoke('start-auto-organizer', folderPath),
    stopAutoOrganizer: () => ipcRenderer.invoke('stop-auto-organizer'),
    getAutoOrganizerSettings: () => ipcRenderer.invoke('get-auto-organizer-settings'),
    saveAutoOrganizerSettings: (settings) => ipcRenderer.invoke('save-auto-organizer-settings', settings),
    onAutoOrganizeFile: (callback) => {
        ipcRenderer.on('auto-organize-file', (event, data) => callback(data));
    },

    // Events
    onConversionProgress: (callback) => {
        ipcRenderer.on('conversion-progress', (event, data) => callback(data));
    },
    onOrganizeProgress: (callback) => {
        ipcRenderer.on('organize-progress', (event, progress) => callback(progress));
    },
    onNavigate: (callback) => {
        ipcRenderer.on('navigate', (event, page) => callback(page));
    },

    // Notifications
    showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

    // App info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    openSpotifyPlayer: (spotifyUrl) => ipcRenderer.invoke('open-spotify-player', spotifyUrl),

    // Books
    booksSearchOnline: (query) => ipcRenderer.invoke('books-search-online', query),
    booksGetOnlineLinks: (bookPath) => ipcRenderer.invoke('books-get-online-links', bookPath),
    booksFetchCoverDataUrl: (coverUrl) => ipcRenderer.invoke('books-fetch-cover-data-url', coverUrl),
    booksSearchOffline: (query) => ipcRenderer.invoke('books-search-offline', query),
    booksDownloadOffline: (payload) => ipcRenderer.invoke('books-download-offline', payload),
    booksGetLibrary: () => ipcRenderer.invoke('books-get-library'),
    booksReadEpubFile: (filePath) => ipcRenderer.invoke('books-read-epub-file', filePath),
    booksGetLibraryFolder: () => ipcRenderer.invoke('books-get-library-folder'),
    booksImportFiles: (filePaths) => ipcRenderer.invoke('books-import-files', filePaths),

    // Surf Web Extensions
    surfSelectExtensionFolder: () => ipcRenderer.invoke('surf-select-extension-folder'),
    surfLoadExtensionFolder: (folderPath) => ipcRenderer.invoke('surf-load-extension-folder', folderPath),
    surfInstallStoreExtension: (input) => ipcRenderer.invoke('surf-install-store-extension', input),
    surfListExtensions: () => ipcRenderer.invoke('surf-list-extensions'),
    surfRemoveExtension: (idOrPath) => ipcRenderer.invoke('surf-remove-extension', idOrPath),

    // Live Wallpaper
    liveWallpaperSelectVideo: () => ipcRenderer.invoke('live-wallpaper-select-video'),
    liveWallpaperStart: (options) => ipcRenderer.invoke('live-wallpaper-start', options),
    liveWallpaperStop: () => ipcRenderer.invoke('live-wallpaper-stop'),
    liveWallpaperStatus: () => ipcRenderer.invoke('live-wallpaper-status'),

    // Startup settings
    setLaunchAtStartup: (enabled) => ipcRenderer.invoke('set-launch-at-startup', enabled),
    getLaunchAtStartup: () => ipcRenderer.invoke('get-launch-at-startup'),

    // Sound settings
    getSoundPath: (soundType) => ipcRenderer.invoke('get-sound-path', soundType),
    getPlaySounds: () => ipcRenderer.invoke('get-play-sounds'),
    setPlaySounds: (enabled) => ipcRenderer.invoke('set-play-sounds', enabled),

    // Video/Audio Downloader
    checkDownloaderAvailable: () => ipcRenderer.invoke('check-downloader-available'),
    getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
    getPlaylistInfo: (url) => ipcRenderer.invoke('get-playlist-info', url),
    downloadMedia: (options) => ipcRenderer.invoke('download-media', options),
    cancelDownload: () => ipcRenderer.invoke('cancel-download'),
    clearTempFiles: () => ipcRenderer.invoke('clear-temp-files'),

    // Streaming
    streamSearch: (query) => ipcRenderer.invoke('stream-search', query),
    getStreamUrl: (videoUrl, playbackMode) => ipcRenderer.invoke('get-stream-url', videoUrl, playbackMode),
    importPlaylist: (url) => ipcRenderer.invoke('import-playlist', url),
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download-progress', (event, progress) => callback(progress));
    },

    // Logging
    getLogs: (filter) => ipcRenderer.invoke('get-logs', filter),
    addLog: (type, category, message, details) => ipcRenderer.invoke('add-log', { type, category, message, details }),
    clearLogs: () => ipcRenderer.invoke('clear-logs'),
    exportLogs: () => ipcRenderer.invoke('export-logs'),

    // Conversion History (file-persisted)
    getConversionHistory: () => ipcRenderer.invoke('get-conversion-history'),
    addToConversionHistory: (item) => ipcRenderer.invoke('add-to-conversion-history', item),
    clearConversionHistory: () => ipcRenderer.invoke('clear-conversion-history'),

    // Conversion Stats (file-persisted)
    getConversionStats: () => ipcRenderer.invoke('get-conversion-stats'),
    saveConversionStats: (stats) => ipcRenderer.invoke('save-conversion-stats', stats),

    // Storage Analyzer
    getAvailableDrives: () => ipcRenderer.invoke('get-available-drives'),
    analyzeDrive: (drivePath) => ipcRenderer.invoke('analyze-drive', drivePath),
    browseFolder: (folderPath) => ipcRenderer.invoke('browse-folder', folderPath),
    deleteStorageItem: (itemPath, isDirectory) => ipcRenderer.invoke('delete-storage-item', itemPath, isDirectory),
    moveToRecycleBin: (itemPath) => ipcRenderer.invoke('move-to-recycle-bin', itemPath),
    emptyRecycleBin: () => ipcRenderer.invoke('empty-recycle-bin'),
    getRecycleBinSize: () => ipcRenderer.invoke('get-recycle-bin-size'),
    openInExplorer: (folderPath) => ipcRenderer.invoke('open-in-explorer', folderPath),
    searchFiles: (folderPath, query) => ipcRenderer.invoke('search-files', folderPath, query),
    getEnvVariable: (name) => ipcRenderer.invoke('get-env-variable', name),
    getFolderSize: (folderPath) => ipcRenderer.invoke('get-folder-size', folderPath),
    onStorageScanProgress: (callback) => {
        ipcRenderer.on('storage-scan-progress', (event, progress) => callback(progress));
    },

    // AI Hub
    aiChat: (message, systemPrompt, model) => ipcRenderer.invoke('ai-chat', message, systemPrompt, model),

    // Auto-Updater
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    getAutoUpdate: () => ipcRenderer.invoke('get-auto-update'),
    setAutoUpdate: (enabled) => ipcRenderer.invoke('set-auto-update', enabled),
    getReleaseNotes: () => ipcRenderer.invoke('get-release-notes'),
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, info) => callback(info));
    },
    onUpdateDownloadProgress: (callback) => {
        ipcRenderer.on('update-download-progress', (event, progress) => callback(progress));
    },
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, info) => callback(info));
    },
    onUpdateStatus: (callback) => {
        ipcRenderer.on('update-status', (event, data) => callback(data));
    },
    aiClearChat: () => ipcRenderer.invoke('ai-clear-chat'),
    aiSummarize: (text, maxLength) => ipcRenderer.invoke('ai-summarize', text, maxLength),
    aiTranslate: (text, sourceLang, targetLang) => ipcRenderer.invoke('ai-translate', text, sourceLang, targetLang),
    aiSentiment: (text) => ipcRenderer.invoke('ai-sentiment', text),
    aiQuestionAnswer: (question, context) => ipcRenderer.invoke('ai-question-answer', question, context),
    aiGenerateImage: (prompt, options) => ipcRenderer.invoke('ai-generate-image', prompt, options),
    aiDescribeImage: (imagePath) => ipcRenderer.invoke('ai-describe-image', imagePath),
    aiRemoveBackground: (imagePath) => ipcRenderer.invoke('ai-remove-background', imagePath),
    aiUpscaleImage: (imagePath) => ipcRenderer.invoke('ai-upscale-image', imagePath),
    aiCreativeWrite: (prompt, type, length) => ipcRenderer.invoke('ai-creative-write', prompt, type, length),
    aiImproveText: (text, style) => ipcRenderer.invoke('ai-improve-text', text, style),
    aiTranscribe: (audioPath) => ipcRenderer.invoke('ai-transcribe', audioPath),
    aiGetCapabilities: () => ipcRenderer.invoke('ai-get-capabilities'),
    aiSaveKeys: (keys) => ipcRenderer.invoke('ai-save-keys', keys),
    aiSetGeminiKey: (key) => ipcRenderer.invoke('ai-set-gemini-key', key),
    aiHasKey: () => ipcRenderer.invoke('ai-has-key'),

    // Output files browser
    listOutputFiles: (section) => ipcRenderer.invoke('list-output-files', section),

    // Spotify / SpotiFLAC
    spotifySearch: (query, limit) => ipcRenderer.invoke('spotify-search', query, limit),
    spotifyGetMetadata: (url) => ipcRenderer.invoke('spotify-get-metadata', url),
    spotifyCheckAvailability: (trackID) => ipcRenderer.invoke('spotify-check-availability', trackID),
    spotifyDownload: (options) => ipcRenderer.invoke('spotify-download', options),
    spotifyDownloadLyrics: (options) => ipcRenderer.invoke('spotify-download-lyrics', options),
    spotifySaveCover: (options) => ipcRenderer.invoke('spotify-save-cover', options),
    onSpotifyProgress: (callback) => {
        ipcRenderer.on('spotify-download-progress', (event, data) => callback(data));
    },

    // Download Manager (IDM)
    dmGetState: () => ipcRenderer.invoke('dm-get-state'),
    dmAddTask: (url, filename, outputDir) => ipcRenderer.invoke('dm-add-task', url, filename, outputDir),
    dmPauseTask: (id) => ipcRenderer.invoke('dm-pause-task', id),
    dmResumeTask: (id) => ipcRenderer.invoke('dm-resume-task', id),
    dmCancelTask: (id) => ipcRenderer.invoke('dm-cancel-task', id),
    dmRetryTask: (id) => ipcRenderer.invoke('dm-retry-task', id),
    dmDeleteTask: (id, deleteFile) => ipcRenderer.invoke('dm-delete-task', id, deleteFile),
    dmPauseAll: () => ipcRenderer.invoke('dm-pause-all'),
    dmResumeAll: () => ipcRenderer.invoke('dm-resume-all'),
    dmClearFinished: () => ipcRenderer.invoke('dm-clear-finished'),
    dmSetOutputDir: () => ipcRenderer.invoke('dm-set-output-dir'),
    dmSetMaxConcurrent: (max) => ipcRenderer.invoke('dm-set-max-concurrent', max),
    dmGetBridgeInfo: () => ipcRenderer.invoke('dm-get-bridge-info'),
    dmOpenFile: (filePath) => ipcRenderer.invoke('dm-open-file', filePath),
    dmOpenFolder: (filePath) => ipcRenderer.invoke('dm-open-folder', filePath),
    dmReorderTask: (id, direction) => ipcRenderer.invoke('dm-reorder-task', id, direction),
    dmGetAutoArrange: () => ipcRenderer.invoke('dm-get-auto-arrange'),
    dmSetAutoArrange: (enabled) => ipcRenderer.invoke('dm-set-auto-arrange', enabled),
    onDmState: (callback) => {
        ipcRenderer.on('dm-state', (event, state) => callback(state));
    },

    // Remote Alerts
    getRemoteAlerts: () => ipcRenderer.invoke('get-remote-alerts'),

    // Player Lyrics
    selectLrcFile: () => ipcRenderer.invoke('select-lrc-file'),
    readLrcFile: (filePath) => ipcRenderer.invoke('read-lrc-file', filePath),

    // Context Menu
    registerContextMenu: () => ipcRenderer.invoke('register-context-menu'),
    unregisterContextMenu: () => ipcRenderer.invoke('unregister-context-menu'),
    onContextMenuConvert: (callback) => {
        ipcRenderer.on('context-menu-convert', (event, filePath) => callback(filePath));
    },

    // Clipboard monitoring
    onClipboardLink: (callback) => {
        ipcRenderer.on('clipboard-link-detected', (event, data) => callback(data));
    }
});
