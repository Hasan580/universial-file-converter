/**
 * Thin, named wrappers over the preload bridge (`window.ufc`), so pages never repeat channel strings.
 * Errors arrive as Error objects with `.kind`, `.detail` and `.cancelled` when the main process set them.
 */

const call = (channel, ...args) => window.ufc.invoke(channel, ...args);
const fire = (channel, ...args) => window.ufc.send(channel, ...args);

export const api = {
    call,
    on: (channel, cb) => window.ufc.on(channel, cb),
    platform: () => window.ufc.platform,
    pathFor: (file) => window.ufc.pathForFile(file),

    ready: () => call('renderer-ready'),
    version: () => call('get-app-version'),
    userPath: (type) => call('get-user-path', type),

    settings: { get: () => call('get-settings'), save: (patch) => call('save-settings', patch) },
    catalog: () => call('get-catalog'),

    pick: {
        files: (kind, opts) => call('select-files', kind, opts),
        folder: (title) => call('select-folder', title),
        output: () => call('select-output-directory'),
        cookieFile: () => call('select-cookie-file')
    },

    files: {
        info: (p) => call('get-file-info', p),
        infoMany: (list) => call('get-files-info', list),
        probe: (p) => call('probe-media', p),
        imageInfo: (p) => call('image-info', p),
        thumb: (p, size) => call('image-thumbnail', p, size),
        cover: (p) => call('extract-cover-art', p),
        exists: (p) => call('path-exists', p),
        open: (p) => fire('open-file', p),
        reveal: (p) => fire('open-folder', p),
        openFolder: (p) => call('open-in-explorer', p),
        url: (u) => call('open-external-url', u),
        listOutput: (section) => call('list-output-files', section),
        notify: (title, body) => fire('show-notification', { title, body }),
        clearTemp: () => call('clear-temp-files')
    },

    convert: {
        audio: (o) => call('convert-audio', o),
        video: (o) => call('convert-video', o),
        extractAudio: (o) => call('extract-audio', o),
        image: (o) => call('convert-image', o),
        compress: (o) => call('compress-image', o),
        document: (o) => call('convert-document', o),
        cancel: (id) => call('cancel-conversion', id),
        qr: (p) => call('scan-qr-from-image', p)
    },

    pdf: {
        lock: (o) => call('lock-pdf', o),
        merge: (o) => call('merge-pdfs', o),
        readDoc: (o) => call('read-editable-document', o),
        saveDoc: (o) => call('save-editable-document', o),
        addText: (o) => call('pdf-add-text', o),
        readText: (o) => call('read-pdf-text', o),
        saveText: (o) => call('save-pdf-text', o)
    },

    dl: {
        check: () => call('check-downloader-available'),
        info: (url) => call('get-video-info', url),
        playlist: (url) => call('get-playlist-info', url),
        start: (o) => call('download-media', o),
        cancel: (id) => call('cancel-download', id),
        engine: () => call('engine-status'),
        repair: () => call('engine-repair'),
        updateLibs: () => call('update-libraries')
    },

    dm: {
        state: () => call('dm-get-state'),
        add: (opts) => call('dm-add-task', opts),
        pause: (id) => call('dm-pause-task', id),
        resume: (id) => call('dm-resume-task', id),
        cancel: (id) => call('dm-cancel-task', id),
        retry: (id) => call('dm-retry-task', id),
        remove: (id, deleteFile) => call('dm-delete-task', id, deleteFile),
        pauseAll: () => call('dm-pause-all'),
        resumeAll: () => call('dm-resume-all'),
        clearFinished: (deleteFile) => call('dm-clear-finished', deleteFile),
        setDir: () => call('dm-set-output-dir'),
        setConcurrent: (n) => call('dm-set-max-concurrent', n),
        reorder: (id, dir) => call('dm-reorder-task', id, dir),
        bridge: () => call('dm-get-bridge-info'),
        autoArrange: () => call('dm-get-auto-arrange'),
        setAutoArrange: (v) => call('dm-set-auto-arrange', v),
        openFile: (p) => call('dm-open-file', p),
        openFolder: (p) => call('dm-open-folder', p)
    },

    history: {
        list: () => call('get-conversion-history'),
        add: (item) => call('add-to-conversion-history', item),
        clear: () => call('clear-conversion-history'),
        stats: () => call('get-conversion-stats'),
        saveStats: (s) => call('save-conversion-stats', s)
    },

    logs: {
        list: (filter) => call('get-logs', filter),
        add: (type, category, message, details) => call('add-log', { type, category, message, details }),
        clear: () => call('clear-logs'),
        export: () => call('export-logs')
    },

    updates: {
        check: () => call('check-for-updates'),
        download: () => call('download-update'),
        install: () => call('install-update'),
        mode: () => call('get-update-mode'),
        notes: () => call('get-release-notes'),
        setAuto: (v) => call('set-auto-update', v)
    },

    system: {
        memory: () => call('get-memory'),
        restart: () => call('restart-app'),
        launchAtStartup: () => call('get-launch-at-startup'),
        setLaunchAtStartup: (v) => call('set-launch-at-startup', v),
        contextMenu: () => call('get-context-menu'),
        registerContextMenu: () => call('register-context-menu'),
        unregisterContextMenu: () => call('unregister-context-menu'),
        alerts: () => call('get-remote-alerts')
    },

    organizer: {
        pick: () => call('select-organize-folder'),
        preview: (folder) => call('preview-organization', folder),
        run: (folder, customMappings) => call('organize-folder', { folderPath: folder, customMappings }),
        stats: (folder) => call('get-folder-stats', folder),
        mappings: () => call('get-default-mappings'),
        autoStart: (folder) => call('start-auto-organizer', folder),
        autoStop: () => call('stop-auto-organizer'),
        autoState: () => call('get-auto-organizer-settings')
    },

    storage: {
        drives: () => call('get-available-drives'),
        analyze: (p) => call('analyze-drive', p),
        cancel: () => call('cancel-storage-scan'),
        browse: (p) => call('browse-folder', p),
        size: (p) => call('get-folder-size', p),
        search: (p, q) => call('search-files', p, q),
        remove: (p, isDir) => call('delete-storage-item', p, isDir),
        trash: (p) => call('move-to-recycle-bin', p),
        trashSize: () => call('get-recycle-bin-size'),
        emptyTrash: () => call('empty-recycle-bin')
    },

    ai: {
        hasKey: () => call('ai-has-key'),
        setKey: (k) => call('ai-set-gemini-key', k),
        chat: (m, sys, model) => call('ai-chat', m, sys, model),
        clear: () => call('ai-clear-chat'),
        caps: () => call('ai-get-capabilities'),
        summarize: (t, n) => call('ai-summarize', t, n),
        translate: (t, from, to) => call('ai-translate', t, from, to),
        sentiment: (t) => call('ai-sentiment', t),
        qa: (q, ctx) => call('ai-question-answer', q, ctx),
        write: (p, type, len) => call('ai-creative-write', p, type, len),
        improve: (t, style) => call('ai-improve-text', t, style),
        describe: (p) => call('ai-describe-image', p)
    },

    stream: {
        search: (q) => call('stream-search', q),
        url: (videoUrl, opts) => call('get-stream-url', videoUrl, opts),
        importPlaylist: (url) => call('import-playlist', url),
        pickLyrics: () => call('select-lrc-file'),
        readLyrics: (p) => call('read-lrc-file', p)
    }
};
