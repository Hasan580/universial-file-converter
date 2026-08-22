/**
 * Universal File Converter - Main Application
 */

// =====================================================
// State Management
// =====================================================

const state = {
    currentPage: 'home',
    previousPage: 'home',
    files: {
        audio: [],
        video: [],
        image: [],
        document: [],
        compress: []
    },
    settings: {
        outputDirectory: '',
        theme: 'dark',
        showNotifications: true,
        minimizeToTray: true,
        autoDeleteSource: false
    },
    history: [],
    converting: false,
    currentConversion: {
        active: false,
        type: '',
        engine: 'FFmpeg',
        queue: [],
        total: 0,
        processed: 0,
        completed: 0,
        failed: 0
    }
};

const booksState = {
    mode: 'online',
    initialized: false,
    searchCache: {
        online: [],
        offline: [],
        library: []
    },
    lastQuery: {
        online: '',
        offline: ''
    },
    libraryFolder: '',
    loading: false,
    coverCache: new Map()
};

const booksReaderState = {
    book: null,
    rendition: null,
    currentPath: '',
    currentTitle: '',
    themeIndex: 0,
    fontSize: 16
};

// =====================================================
// DOM Elements
// =====================================================

const elements = {
    // Navigation
    navItems: document.querySelectorAll('.nav-item'),
    pages: document.querySelectorAll('.page'),

    // Window controls
    minimizeBtn: document.getElementById('minimize-btn'),
    maximizeBtn: document.getElementById('maximize-btn'),
    closeBtn: document.getElementById('close-btn'),

    // Dropzones
    globalDropzone: document.getElementById('global-dropzone'),

    // File lists
    audioFileList: document.getElementById('audio-file-list'),
    videoFileList: document.getElementById('video-file-list'),
    imageFileList: document.getElementById('image-file-list'),
    documentFileList: document.getElementById('document-file-list'),
    compressFileList: document.getElementById('compress-file-list'),

    // Format buttons
    audioFormats: document.getElementById('audio-formats'),
    videoFormats: document.getElementById('video-formats'),
    imageFormats: document.getElementById('image-formats'),
    documentFormats: document.getElementById('document-formats'),
    videoResolution: document.getElementById('video-resolution'),

    // Quality sliders
    audioBitrate: document.getElementById('audio-bitrate'),
    audioBitrateValue: document.getElementById('audio-bitrate-value'),
    videoQuality: document.getElementById('video-quality'),
    videoQualityValue: document.getElementById('video-quality-value'),
    imageQuality: document.getElementById('image-quality'),
    imageQualityValue: document.getElementById('image-quality-value'),

    // Other audio options
    audioSamplerate: document.getElementById('audio-samplerate'),
    audioChannels: document.getElementById('audio-channels'),

    // Video options
    videoCodec: document.getElementById('video-codec'),
    videoFps: document.getElementById('video-fps'),

    // Image options
    imageWidth: document.getElementById('image-width'),
    imageHeight: document.getElementById('image-height'),
    maintainRatio: document.getElementById('maintain-ratio'),
    imageQrScanBtn: document.getElementById('image-qr-scan-btn'),
    imageQrResultCard: document.getElementById('image-qr-result-card'),
    imageQrResultSource: document.getElementById('image-qr-result-source'),
    imageQrResultText: document.getElementById('image-qr-result-text'),
    imageQrCopyBtn: document.getElementById('image-qr-copy-btn'),
    imageQrOpenBtn: document.getElementById('image-qr-open-btn'),
    imageQrClearBtn: document.getElementById('image-qr-clear-btn'),

    // Compress options
    compressQuality: document.getElementById('compress-quality'),
    compressQualityValue: document.getElementById('compress-quality-value'),
    compressQualityHint: document.getElementById('compress-quality-hint'),
    compressMaxWidth: document.getElementById('compress-max-width'),
    compressMaxHeight: document.getElementById('compress-max-height'),
    compressMaintainRatio: document.getElementById('compress-maintain-ratio'),

    // Convert buttons
    convertAudioBtn: document.getElementById('convert-audio-btn'),
    convertVideoBtn: document.getElementById('convert-video-btn'),
    convertImageBtn: document.getElementById('convert-image-btn'),
    convertDocumentBtn: document.getElementById('convert-document-btn'),
    compressFilesBtn: document.getElementById('compress-files-btn'),

    // Settings
    outputDirectory: document.getElementById('output-directory'),
    changeOutputDir: document.getElementById('change-output-dir'),
    showNotifications: document.getElementById('show-notifications'),
    minimizeToTray: document.getElementById('minimize-to-tray'),
    autoDeleteSource: document.getElementById('auto-delete-source'),
    launchAtStartup: document.getElementById('launch-at-startup'),
    playSounds: document.getElementById('play-sounds'),
    updateLibrariesBtn: document.getElementById('update-libraries-btn'),
    updateLibrariesStatus: document.getElementById('update-libraries-status'),

    // Current conversion page
    progressModal: document.getElementById('progress-modal'),
    progressList: document.getElementById('progress-list'),
    overallProgress: document.getElementById('overall-progress'),
    progressText: document.getElementById('progress-text'),
    cancelConversion: document.getElementById('cancel-conversion'),
    currentConversionEmpty: document.getElementById('current-conversion-empty'),
    currentConversionTitle: document.getElementById('current-conversion-title'),
    currentConversionStatus: document.getElementById('current-conversion-status'),
    currentConversionSubtitle: document.getElementById('current-conversion-subtitle'),
    currentConversionEngine: document.getElementById('current-conversion-engine'),
    convertingNavBadge: document.getElementById('converting-nav-badge'),

    // Toast container
    toastContainer: document.getElementById('toast-container'),

    // History
    historyList: document.getElementById('history-list'),
    historyEmpty: document.getElementById('history-empty'),

    // Stats
    totalConverted: document.getElementById('total-converted'),
    totalSaved: document.getElementById('total-saved')
};

// =====================================================
// Initialization
// =====================================================

async function init() {
    // Load settings
    await loadSettings();

    // Set up event listeners
    setupNavigation();
    setupWindowControls();
    setupDropzones();
    setupFormatButtons();
    setupSliders();
    setupConvertButtons();
    setupSettings();
    setupActionCards();
    setupHistoryControls();
    setupKeyboardShortcuts();
    updateCurrentConversionPanel();
    setConvertButtonsBusyState();

    // Listen for navigation from tray
    window.electronAPI.onNavigate((page) => {
        navigateTo(page);
    });

    // Listen for conversion progress
    window.electronAPI.onConversionProgress(({ id, progress }) => {
        updateFileProgress(id, progress);
    });

    // Load history
    loadHistory();

    // Load persisted stats
    loadStats();

    // Load app version
    try {
        const version = await window.electronAPI.getAppVersion();
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = version;
        const updateVersionEl = document.getElementById('update-current-version');
        if (updateVersionEl) updateVersionEl.textContent = version;
    } catch (e) { }

    // Log app initialization
    try {
        await window.electronAPI.addLog('info', 'system', 'App UI initialized');
    } catch (e) {
        console.log('Logging not available yet');
    }

    console.log('Universal Converter initialized');
}

// =====================================================
// Keyboard Shortcuts
// =====================================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+O - Open files
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            const type = state.currentPage;
            if (['audio', 'video', 'image', 'document'].includes(type)) {
                window.electronAPI.selectFiles(type).then(files => {
                    if (files.length > 0) handleFiles(files, type);
                });
            }
        }

        // Ctrl+1-4 - Navigate to converters
        if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            const pages = ['audio', 'video', 'image', 'document'];
            navigateTo(pages[parseInt(e.key) - 1]);
        }

        // Ctrl+H - Go to history
        if (e.ctrlKey && e.key === 'h') {
            e.preventDefault();
            navigateTo('history');
        }

        // Escape - Close modals / go home
        if (e.key === 'Escape') {
            if (elements.progressModal?.classList.contains('active')) {
                // Don't close during conversion
                if (!state.converting) hideProgressModal();
            } else {
                navigateTo('home');
            }
        }

        // Ctrl+, - Open settings
        if (e.ctrlKey && e.key === ',') {
            e.preventDefault();
            navigateTo('settings');
        }

        // Media Playback Controls for Universal Player
        if (state.currentPage === 'player') {
            // Don't interfere if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'MediaPlayPause':
                    e.preventDefault();
                    if (typeof playerTogglePlay === 'function') playerTogglePlay();
                    break;
                case 'MediaTrackNext':
                    e.preventDefault();
                    if (typeof playerNext === 'function') playerNext();
                    break;
                case 'MediaTrackPrevious':
                    e.preventDefault();
                    if (typeof playerPrev === 'function') playerPrev();
                    break;
                case 'MediaStop':
                    e.preventDefault();
                    if (typeof playerStop === 'function') playerStop();
                    break;
            }
        }
    });

    // Setup Media Session API (OS level media controls)
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => { if (typeof playerTogglePlay === 'function') playerTogglePlay(); });
        navigator.mediaSession.setActionHandler('pause', () => { if (typeof playerTogglePlay === 'function') playerTogglePlay(); });
        navigator.mediaSession.setActionHandler('previoustrack', () => { if (typeof playerPrev === 'function') playerPrev(); });
        navigator.mediaSession.setActionHandler('nexttrack', () => { if (typeof playerNext === 'function') playerNext(); });
        navigator.mediaSession.setActionHandler('stop', () => { if (typeof playerStop === 'function') playerStop(); });
    }
}

// =====================================================
// Settings
// =====================================================

async function loadSettings() {
    try {
        const settings = await window.electronAPI.getSettings();
        state.settings = { ...state.settings, ...settings };

        // Apply settings to UI
        elements.outputDirectory.value = state.settings.outputDirectory;
        elements.showNotifications.checked = state.settings.showNotifications;
        elements.minimizeToTray.checked = state.settings.minimizeToTray;
        elements.autoDeleteSource.checked = state.settings.autoDeleteSource;

        // Apply theme
        const savedTheme = state.settings.theme || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme === 'dark' ? '' : savedTheme);
        document.querySelectorAll('.theme-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.theme === savedTheme);
        });

        // Apply Gemini API key
        const geminiInput = document.getElementById('gemini-api-key-input');
        if (geminiInput && state.settings.geminiApiKey) {
            geminiInput.value = state.settings.geminiApiKey;
        }

        // Update AI overlay visibility
        updateAIOverlay();
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

async function saveSettings() {
    try {
        await window.electronAPI.saveSettings(state.settings);
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}

function getHiddenFeatures() {
    const defaultHidden = Number(state.settings.defaultHiddenFeaturesVersion || 0) >= 2
        ? { ai: true, surf: true, books: true, compress: true }
        : { ai: true, surf: true };
    return Object.assign({}, defaultHidden, state.settings.hiddenFeatures || {});
}

function isFeatureHidden(feature) {
    return !!getHiddenFeatures()[feature];
}

function applyFeatureVisibility(feature, visible) {
    const navItem = document.querySelector(`.nav-item[data-page="${feature}"]`);
    if (navItem) {
        navItem.style.display = visible ? '' : 'none';
    }

    const actionCard = document.querySelector(`.action-card[data-action="${feature}"]`);
    if (actionCard) {
        actionCard.style.display = visible ? '' : 'none';
    }

    if (!visible && state.currentPage === feature) {
        navigateTo('home');
    }
}

function setupSettings() {
    // Output directory
    elements.changeOutputDir.addEventListener('click', async () => {
        const dir = await window.electronAPI.selectOutputDirectory();
        if (dir) {
            state.settings.outputDirectory = dir;
            elements.outputDirectory.value = dir;
            saveSettings();
        }
    });

    // Theme selector (swatches)
    document.querySelectorAll('.theme-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const theme = swatch.dataset.theme;
            state.settings.theme = theme;

            // Enable smooth theme transition
            document.documentElement.setAttribute('data-theme-transition', '');
            document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : theme);

            document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');

            // Remove transition attribute after animation completes
            setTimeout(() => {
                document.documentElement.removeAttribute('data-theme-transition');
            }, 400);

            saveSettings();
        });
    });

    // Feature visibility toggles
    document.querySelectorAll('input.feature-toggle[data-feature]').forEach(toggle => {
        const feature = toggle.dataset.feature;
        if (!feature) return;

        const hiddenFeatures = getHiddenFeatures();
        toggle.checked = !hiddenFeatures[feature]; // checked = visible

        applyFeatureVisibility(feature, !hiddenFeatures[feature]);

        toggle.addEventListener('change', () => {
            if (!state.settings.hiddenFeatures) state.settings.hiddenFeatures = {};
            state.settings.hiddenFeatures[feature] = !toggle.checked;
            applyFeatureVisibility(feature, toggle.checked);

            saveSettings();
        });
    });

    // Notification toggle
    elements.showNotifications.addEventListener('change', () => {
        state.settings.showNotifications = elements.showNotifications.checked;
        saveSettings();
    });

    // Minimize to tray toggle
    elements.minimizeToTray.addEventListener('change', () => {
        state.settings.minimizeToTray = elements.minimizeToTray.checked;
        saveSettings();
    });

    // Auto delete source toggle
    elements.autoDeleteSource.addEventListener('change', () => {
        state.settings.autoDeleteSource = elements.autoDeleteSource.checked;
        saveSettings();
    });

    // Launch at startup toggle
    elements.launchAtStartup?.addEventListener('change', async () => {
        const enabled = elements.launchAtStartup.checked;
        await window.electronAPI.setLaunchAtStartup(enabled);
        state.settings.launchAtStartup = enabled;
    });

    // Play sounds toggle
    elements.playSounds?.addEventListener('change', async () => {
        const enabled = elements.playSounds.checked;
        await window.electronAPI.setPlaySounds(enabled);
        state.settings.playSounds = enabled;
    });

    // Auto-update toggle
    const autoUpdateCheckbox = document.getElementById('auto-update');
    autoUpdateCheckbox?.addEventListener('change', async () => {
        await window.electronAPI.setAutoUpdate(autoUpdateCheckbox.checked);
    });

    // Check for updates button
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    checkUpdatesBtn?.addEventListener('click', async () => {
        checkUpdatesBtn.disabled = true;
        checkUpdatesBtn.textContent = 'Checking...';
        try {
            const result = await window.electronAPI.checkForUpdates();
            if (result && result.isNewer) {
                showToast(`Update v${result.version} available!`, 'success');
                navigateTo('updates');
            } else if (result && result.error) {
                showToast('Could not check for updates', 'error');
            } else {
                showToast('You\'re on the latest version!', 'info');
            }
        } catch (err) {
            showToast('Could not check for updates', 'error');
        } finally {
            checkUpdatesBtn.disabled = false;
            checkUpdatesBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right:6px;vertical-align:middle;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Check for Updates';
        }
    });

    elements.updateLibrariesBtn?.addEventListener('click', async () => {
        const button = elements.updateLibrariesBtn;
        const statusEl = elements.updateLibrariesStatus;
        const defaultLabel = 'Update Libraries';
        const defaultButtonHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>' + defaultLabel + '</span>';

        button.disabled = true;
        button.classList.add('is-loading');
        button.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Updating...</span>';
        if (statusEl) {
            statusEl.textContent = 'Downloading the latest yt-dlp and ffmpeg builds...';
        }

        try {
            const result = await window.electronAPI.updateLibraries();
            const ytdlpVersion = result?.ytdlp?.version || 'latest';
            const ffmpegVersion = result?.ffmpeg?.version || 'latest';
            if (statusEl) {
                statusEl.textContent = `Updated yt-dlp (${ytdlpVersion}) and ffmpeg (${ffmpegVersion}).`;
            }
            showToast('yt-dlp and ffmpeg were updated successfully.', 'success');
        } catch (err) {
            if (statusEl) {
                statusEl.textContent = err.message || 'Library update failed.';
            }
            showToast('Library update failed: ' + err.message, 'error');
        } finally {
            button.disabled = false;
            button.classList.remove('is-loading');
            button.innerHTML = defaultButtonHtml;
        }
    });

    // Load startup setting
    loadStartupSetting();
    loadPlaySoundsSetting();
    loadAutoUpdateSetting();
}

async function loadStartupSetting() {
    try {
        const enabled = await window.electronAPI.getLaunchAtStartup();
        if (elements.launchAtStartup) {
            elements.launchAtStartup.checked = enabled;
        }
        state.settings.launchAtStartup = enabled;
    } catch (err) {
        console.error('Failed to load startup setting:', err);
    }
}

async function loadPlaySoundsSetting() {
    try {
        const enabled = await window.electronAPI.getPlaySounds();
        if (elements.playSounds) {
            elements.playSounds.checked = enabled;
        }
        state.settings.playSounds = enabled;
    } catch (err) {
        console.error('Failed to load play sounds setting:', err);
    }
}

async function loadAutoUpdateSetting() {
    try {
        const enabled = await window.electronAPI.getAutoUpdate();
        const checkbox = document.getElementById('auto-update');
        if (checkbox) checkbox.checked = enabled;
    } catch (err) {
        console.error('Failed to load auto-update setting:', err);
    }
}

function setupAutoUpdateListeners() {
    let updateVersion = '';

    // Update available notification
    window.electronAPI.onUpdateAvailable?.((info) => {
        updateVersion = info.version;

        // Show update banner
        const banner = document.getElementById('update-banner');
        const bannerText = document.getElementById('update-banner-text');
        const actionBtn = document.getElementById('update-action-btn');

        if (banner) banner.style.display = '';
        if (bannerText) bannerText.textContent = `New version v${info.version} is available!`;
        if (actionBtn) {
            actionBtn.textContent = 'Update Now';
            actionBtn.disabled = false;
            actionBtn.onclick = async () => {
                actionBtn.textContent = 'Downloading...';
                actionBtn.disabled = true;
                const progressBar = document.getElementById('update-progress-bar');
                if (progressBar) progressBar.style.display = '';
                try {
                    await window.electronAPI.downloadUpdate();
                } catch (err) {
                    showToast('Update download failed: ' + err.message, 'error');
                    actionBtn.textContent = 'Retry';
                    actionBtn.disabled = false;
                }
            };
        }

        // Update the Updates page
        updateUpdatesPage(info);

        // Show nav dot
        const navDot = document.getElementById('update-nav-dot');
        if (navDot) navDot.style.display = '';

        // Show system notification
        if (state.settings.showNotifications) {
            window.electronAPI.showNotification(
                'Update Available',
                `A new version (v${info.version}) of Universal File Converter is available!`
            );
        }
    });

    // Download progress
    window.electronAPI.onUpdateDownloadProgress?.((progress) => {
        const fill = document.getElementById('update-progress-fill');
        const actionBtn = document.getElementById('update-action-btn');
        if (fill) fill.style.width = `${progress.percent}%`;
        if (actionBtn) actionBtn.textContent = `Downloading ${progress.percent}%`;

        // Update the Updates page progress
        const pageFill = document.getElementById('update-page-progress-fill');
        const pageText = document.getElementById('update-page-progress-text');
        if (pageFill) pageFill.style.width = `${progress.percent}%`;
        if (pageText) pageText.textContent = `${progress.percent}%`;
    });

    // Update downloaded - ready to install
    window.electronAPI.onUpdateDownloaded?.((info) => {
        const bannerText = document.getElementById('update-banner-text');
        const actionBtn = document.getElementById('update-action-btn');
        const progressBar = document.getElementById('update-progress-bar');

        if (bannerText) bannerText.textContent = `v${info.version} downloaded. Restart to finish updating.`;
        if (progressBar) progressBar.style.display = 'none';
        if (actionBtn) {
            actionBtn.textContent = 'Restart to Update';
            actionBtn.disabled = false;
            actionBtn.onclick = () => {
                window.electronAPI.installUpdate();
            };
        }

        // Update the Updates page
        const dlBtn = document.getElementById('update-download-btn');
        if (dlBtn) {
            dlBtn.textContent = 'Restart to Update';
            dlBtn.onclick = () => window.electronAPI.installUpdate();
        }
        const dlProgress = document.getElementById('update-dl-progress');
        if (dlProgress) dlProgress.style.display = 'none';

        showToast('Update downloaded. Restart the app to finish updating.', 'success');
    });

    // Status updates (checking, up-to-date, error)
    window.electronAPI.onUpdateStatus?.((data) => {
        const badge = document.getElementById('update-status-badge');
        if (!badge) return;

        badge.className = 'update-status-badge';
        if (data.status === 'checking') {
            badge.classList.add('checking');
            badge.innerHTML = '<span class="status-dot"></span>Checking...';
        } else if (data.status === 'up-to-date') {
            badge.innerHTML = '<span class="status-dot"></span>Up to date';
        } else if (data.status === 'error') {
            badge.classList.add('error');
            badge.innerHTML = '<span class="status-dot"></span>Check failed';
        }
    });

    // Dismiss button
    document.getElementById('update-dismiss-btn')?.addEventListener('click', () => {
        const banner = document.getElementById('update-banner');
        if (banner) banner.style.display = 'none';
    });
}

function updateUpdatesPage(info) {
    // Show update available card with release notes
    const card = document.getElementById('update-available-card');
    const versionText = document.getElementById('update-new-version-text');
    const releaseBody = document.getElementById('update-release-body');
    if (card) card.style.display = '';
    if (versionText) versionText.textContent = `Version ${info.version} is ready`;

    // Show release notes for the new version in the update card
    if (releaseBody && info.releaseNotes) {
        let body = typeof info.releaseNotes === 'string' ? info.releaseNotes : '';
        body = body.replace(/^### (.+)$/gm, '<strong>$1</strong>');
        body = body.replace(/^## (.+)$/gm, '<strong>$1</strong>');
        body = body.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        body = body.replace(/^- (.+)$/gm, '  \u2022 $1');
        body = body.replace(/^\* (.+)$/gm, '  \u2022 $1');
        releaseBody.innerHTML = body || '';
    }

    // Update status badge
    const badge = document.getElementById('update-status-badge');
    if (badge) {
        badge.className = 'update-status-badge has-update';
        badge.innerHTML = '<span class="status-dot"></span>Update available';
    }

    // Download button
    const dlBtn = document.getElementById('update-download-btn');
    if (dlBtn) {
        dlBtn.onclick = async () => {
            dlBtn.textContent = 'Downloading...';
            dlBtn.disabled = true;
            const dlProgress = document.getElementById('update-dl-progress');
            if (dlProgress) dlProgress.style.display = 'flex';
            try {
                await window.electronAPI.downloadUpdate();
            } catch (err) {
                showToast('Update download failed', 'error');
                dlBtn.textContent = 'Retry';
                dlBtn.disabled = false;
            }
        };
    }
}

// Setup Updates page
async function setupUpdatesPage() {
    // Check button on Updates page
    const updatesCheckBtn = document.getElementById('updates-check-btn');
    if (updatesCheckBtn) {
        updatesCheckBtn.addEventListener('click', async () => {
            updatesCheckBtn.disabled = true;
            updatesCheckBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" class="spin-icon"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Checking...';

            const badge = document.getElementById('update-status-badge');
            if (badge) {
                badge.className = 'update-status-badge checking';
                badge.innerHTML = '<span class="status-dot"></span>Checking...';
            }

            try {
                const result = await window.electronAPI.checkForUpdates();
                if (result && result.isNewer) {
                    showToast(`Update v${result.version} available!`, 'success');
                    // Fetch release notes for the new version
                    try {
                        const releases = await window.electronAPI.getReleaseNotes();
                        const normalizedResultVersion = normalizeVersionString(result.version) || String(result.version || '').replace(/^v/i, '');
                        const newRelease = releases?.find(r => {
                            const ver = getReleaseVersion(r);
                            return ver && normalizedResultVersion && compareVersions(ver, normalizedResultVersion) === 0;
                        });
                        updateUpdatesPage({
                            version: result.version,
                            releaseNotes: newRelease?.body || ''
                        });
                    } catch (e) {
                        updateUpdatesPage({ version: result.version, releaseNotes: '' });
                    }
                } else if (result && !result.error) {
                    showToast('You\'re on the latest version!', 'info');
                    if (badge) {
                        badge.className = 'update-status-badge';
                        badge.innerHTML = '<span class="status-dot"></span>Up to date';
                    }
                    // Hide update card if shown
                    const card = document.getElementById('update-available-card');
                    if (card) card.style.display = 'none';
                } else {
                    showToast('Could not check for updates', 'error');
                    if (badge) {
                        badge.className = 'update-status-badge error';
                        badge.innerHTML = '<span class="status-dot"></span>Check failed';
                    }
                }
            } catch (err) {
                showToast('Could not check for updates', 'error');
            } finally {
                updatesCheckBtn.disabled = false;
                updatesCheckBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Check for Updates';
            }
        });
    }

    // Load release history
    loadReleaseNotes();
}

function normalizeVersionString(input) {
    const text = String(input || '').trim();
    if (!text) return '';
    const match = text.match(/v?(\d+(?:\.\d+){1,3})/i);
    return match ? match[1] : '';
}

function getReleaseVersion(release) {
    if (!release) return '';
    // Prefer release name because some repos use non-semver tag names.
    return normalizeVersionString(release.name) || normalizeVersionString(release.version);
}

// Compare two semver version strings (e.g. "2.0.1" vs "2.0.2")
// Returns: positive if a > b, negative if a < b, 0 if equal
function compareVersions(a, b) {
    const parse = (value) => {
        const normalized = normalizeVersionString(value) || String(value || '').replace(/^v/i, '');
        return normalized
            .split('.')
            .map((part) => {
                const parsed = Number.parseInt(part, 10);
                return Number.isFinite(parsed) ? parsed : 0;
            });
    };
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na !== nb) return na - nb;
    }
    return 0;
}

async function loadReleaseNotes() {
    const list = document.getElementById('release-notes-list');
    if (!list) return;

    try {
        const releases = await window.electronAPI.getReleaseNotes();
        const currentVersionRaw = document.getElementById('update-current-version')?.textContent || '';
        const currentVersion = normalizeVersionString(currentVersionRaw) || String(currentVersionRaw).trim().replace(/^v/i, '');

        if (!releases || releases.length === 0) {
            list.innerHTML = '<div class="release-notes-empty"><p>No release notes available yet.</p><p style="margin-top:8px;font-size:0.85em;">Create your first release on GitHub to see notes here.</p></div>';
            return;
        }

        const releasesWithMeta = releases.map((release, index) => ({
            ...release,
            _normalizedVersion: getReleaseVersion(release),
            _sourceIndex: index
        }));

        const sortedReleases = releasesWithMeta.sort((a, b) => {
            if (!!a.prerelease !== !!b.prerelease) {
                return a.prerelease ? 1 : -1;
            }

            const av = a._normalizedVersion;
            const bv = b._normalizedVersion;
            if (av && bv) {
                const byVersion = compareVersions(bv, av);
                if (byVersion !== 0) return byVersion;
            } else if (av) {
                return -1;
            } else if (bv) {
                return 1;
            }

            const aDate = a.date ? new Date(a.date).getTime() : 0;
            const bDate = b.date ? new Date(b.date).getTime() : 0;
            if (aDate !== bDate) return bDate - aDate;
            return a._sourceIndex - b._sourceIndex;
        });

        // Determine the actual latest version using proper semver comparison
        const latestVersion = sortedReleases.find((r) => !r.prerelease && r._normalizedVersion)?._normalizedVersion || null;

        list.innerHTML = sortedReleases.map(release => {
            const version = release.version || release.name;
            const cleanVersion = release._normalizedVersion || normalizeVersionString(version);
            const isCurrentVersion = !!(cleanVersion && currentVersion && compareVersions(cleanVersion, currentVersion) === 0);
            const isLatestVersion = !!(latestVersion && cleanVersion && compareVersions(cleanVersion, latestVersion) === 0);
            const date = release.date ? new Date(release.date).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            }) : '';

            // Simple markdown-to-text conversion for release body
            let body = release.body || 'No release notes provided.';
            // Convert markdown headers
            body = body.replace(/^### (.+)$/gm, '<strong>$1</strong>');
            body = body.replace(/^## (.+)$/gm, '<strong>$1</strong>');
            body = body.replace(/^# (.+)$/gm, '<strong>$1</strong>');
            // Convert markdown bold
            body = body.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            // Convert markdown links
            body = body.replace(/\[(.+?)\]\((.+?)\)/g, '$1');
            // Convert markdown lists
            body = body.replace(/^- (.+)$/gm, '  \u2022 $1');
            body = body.replace(/^\* (.+)$/gm, '  \u2022 $1');

            let tagHtml = '';
            if (isCurrentVersion) {
                // Current version always gets the "Current" tag
                tagHtml = '<span class="release-tag current">Current</span>';
            } else if (release.prerelease) {
                tagHtml = '<span class="release-tag prerelease">Pre-release</span>';
            } else if (isLatestVersion) {
                // Only show "Latest" on the actual highest version (and only if it's not also the current)
                tagHtml = '<span class="release-tag">Latest</span>';
            }

            return `
                <div class="release-entry">
                    <div class="release-entry-header">
                        <div class="release-entry-version">
                            <h4>${release.name || version}</h4>
                            ${tagHtml}
                        </div>
                        <span class="release-entry-date">${date}</span>
                    </div>
                    <div class="release-entry-body">${body}</div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Failed to load release notes:', err);
        list.innerHTML = '<div class="release-notes-empty"><p>Could not load release notes.</p><p style="margin-top:8px;font-size:0.85em;">Check your internet connection.</p></div>';
    }
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function playSound(soundType) {
    if (!state.settings.playSounds) return;

    try {
        const soundPath = await window.electronAPI.getSoundPath(soundType);
        if (soundPath) {
            const audio = new Audio('file:///' + soundPath.replace(/\\/g, '/'));
            audio.volume = 0.5;
            audio.play().catch(err => console.log('Sound play failed:', err));
        }
    } catch (err) {
        console.error('Failed to play sound:', err);
    }
}
// =====================================================
// Navigation
// =====================================================

function setupNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateTo(page);
        });
    });

    // Settings gear button (toggles settings or returns to previous page)
    const gearBtn = document.getElementById('settings-gear-btn');
    gearBtn?.addEventListener('click', () => {
        if (state.currentPage === 'settings') {
            navigateTo(state.previousPage || 'home');
        } else {
            navigateTo('settings');
        }
    });

    // All page back buttons
    document.querySelectorAll('.page-back-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(state.previousPage || 'home');
        });
    });
}

function navigateTo(page) {
    if (page !== 'home' && page !== 'settings' && isFeatureHidden(page)) {
        page = 'home';
    }

    if (page !== 'surf') {
        document.body.classList.remove('surf-fullscreen-active');
    }

    const surfFullscreenBtn = document.getElementById('surf-fullscreen-btn');
    if (surfFullscreenBtn) {
        const isSurfFullscreen = document.body.classList.contains('surf-fullscreen-active');
        surfFullscreenBtn.classList.toggle('active', isSurfFullscreen);
        surfFullscreenBtn.setAttribute('aria-pressed', isSurfFullscreen ? 'true' : 'false');
        surfFullscreenBtn.title = isSurfFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
    }

    // Save previous page if changing pages
    if (state.currentPage && state.currentPage !== page) {
        state.previousPage = state.currentPage;
    }

    state.currentPage = page;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Update gear button active state
    const gearBtn = document.getElementById('settings-gear-btn');
    if (gearBtn) {
        gearBtn.classList.toggle('active', page === 'settings');
    }

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Load data for specific pages
    if (page === 'books') {
        handleBooksPageActivated();
    }
}

// =====================================================
// Window Controls
// =====================================================

function setupWindowControls() {
    elements.minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimize();
    });

    elements.maximizeBtn.addEventListener('click', () => {
        window.electronAPI.maximize();
    });

    elements.closeBtn.addEventListener('click', () => {
        window.electronAPI.close();
    });
}

// =====================================================
// Action Cards
// =====================================================

function setupActionCards() {
    document.querySelectorAll('.action-card').forEach(card => {
        card.addEventListener('click', () => {
            const action = card.dataset.action;
            navigateTo(action);
        });
    });
}

// =====================================================
// Books
// =====================================================

function setupBooks() {
    const page = document.getElementById('page-books');
    if (!page || booksState.initialized) return;

    const modeButtons = document.querySelectorAll('[data-books-mode]');
    const searchForm = document.getElementById('books-search-form');
    const searchInput = document.getElementById('books-search-input');
    const searchClear = document.getElementById('books-search-clear');
    const refreshBtn = document.getElementById('books-refresh-btn');
    const importBtn = document.getElementById('books-import-btn');
    const openFolderBtn = document.getElementById('books-open-folder-btn');
    const readerOverlay = document.getElementById('books-reader-overlay');
    const readerClose = document.getElementById('books-reader-close');
    const readerPrev = document.getElementById('books-reader-prev');
    const readerNext = document.getElementById('books-reader-next');
    const readerThemeBtn = document.getElementById('books-reader-theme-btn');
    const readerFontDown = document.getElementById('books-reader-font-down');
    const readerFontUp = document.getElementById('books-reader-font-up');

    booksReaderState.themeIndex = parseInt(localStorage.getItem('books.reader.themeIndex') || '0', 10) || 0;
    booksReaderState.fontSize = parseInt(localStorage.getItem('books.reader.fontSize') || '16', 10) || 16;

    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setBooksMode(button.dataset.booksMode);
        });
    });

    searchForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await performBooksSearch();
    });

    searchInput?.addEventListener('input', () => {
        searchClear.style.display = searchInput.value ? '' : 'none';
    });

    searchClear?.addEventListener('click', () => {
        searchInput.value = '';
        booksState.lastQuery[booksState.mode] = '';
        searchClear.style.display = 'none';
        renderBooksCurrentState(true);
    });

    refreshBtn?.addEventListener('click', async () => {
        if (booksState.mode === 'library') {
            await loadBooksLibrary();
            return;
        }

        if (searchInput?.value.trim()) {
            await performBooksSearch();
            return;
        }

        renderBooksCurrentState(true);
    });

    importBtn?.addEventListener('click', importBooksFiles);
    openFolderBtn?.addEventListener('click', openBooksLibraryFolder);

    readerClose?.addEventListener('click', closeBooksReader);
    readerPrev?.addEventListener('click', () => booksReaderState.rendition?.prev());
    readerNext?.addEventListener('click', () => booksReaderState.rendition?.next());
    readerThemeBtn?.addEventListener('click', cycleBooksReaderTheme);
    readerFontDown?.addEventListener('click', () => adjustBooksReaderFont(-1));
    readerFontUp?.addEventListener('click', () => adjustBooksReaderFont(1));
    readerOverlay?.addEventListener('click', (event) => {
        if (event.target === readerOverlay) {
            closeBooksReader();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (!readerOverlay || readerOverlay.style.display === 'none') return;
        if (event.key === 'Escape') {
            closeBooksReader();
        } else if (event.key === 'ArrowLeft') {
            booksReaderState.rendition?.prev();
        } else if (event.key === 'ArrowRight') {
            booksReaderState.rendition?.next();
        }
    });

    booksState.initialized = true;
    setBooksMode('online', { preserveInput: true });
}

async function handleBooksPageActivated() {
    if (!booksState.initialized) return;
    try {
        const folderResult = await window.electronAPI.booksGetLibraryFolder();
        if (folderResult?.success && folderResult.path) {
            booksState.libraryFolder = folderResult.path;
        }
    } catch (_) { }

    if (booksState.mode === 'library') {
        await loadBooksLibrary();
        return;
    }

    renderBooksCurrentState();
}

function setBooksMode(mode, options = {}) {
    booksState.mode = ['online', 'offline', 'library'].includes(mode) ? mode : 'online';

    document.querySelectorAll('[data-books-mode]').forEach((button) => {
        button.classList.toggle('active', button.dataset.booksMode === booksState.mode);
    });

    const searchForm = document.getElementById('books-search-form');
    const searchInput = document.getElementById('books-search-input');
    const modeNote = document.getElementById('books-mode-note');
    const serviceChip = document.getElementById('books-active-service');
    const resultSummary = document.getElementById('books-result-summary');

    const modeConfig = {
        online: {
            service: 'Online · Z-Library',
            note: 'Z-Library search results open the reader link directly in your browser.',
            placeholder: 'Search EPUB books on Z-Library...'
        },
        offline: {
            service: 'Offline · LibGen',
            note: 'LibGen EPUB results download straight into this app\'s library folder.',
            placeholder: 'Search EPUB books on LibGen...'
        },
        library: {
            service: 'Library · Local EPUB',
            note: 'Read the EPUB books saved in the app or import your own files.',
            placeholder: 'Search disabled in library mode'
        }
    };

    const config = modeConfig[booksState.mode];
    if (serviceChip) serviceChip.textContent = config.service;
    if (modeNote) modeNote.textContent = config.note;
    if (searchForm) searchForm.style.display = booksState.mode === 'library' ? 'none' : '';
    if (searchInput) {
        if (!options.preserveInput) {
            searchInput.value = booksState.lastQuery[booksState.mode] || '';
        }
        searchInput.placeholder = config.placeholder;
    }
    document.getElementById('books-search-clear').style.display = searchInput?.value ? '' : 'none';

    if (resultSummary && booksState.mode !== 'library') {
        const cached = booksState.searchCache[booksState.mode] || [];
        resultSummary.textContent = booksState.lastQuery[booksState.mode]
            ? `${cached.length} result${cached.length === 1 ? '' : 's'}`
            : 'Ready to search';
    }

    if (booksState.mode === 'library') {
        loadBooksLibrary();
    } else {
        renderBooksCurrentState();
    }
}

function renderBooksCurrentState(forceEmpty = false) {
    if (booksState.mode === 'library') return;

    const query = booksState.lastQuery[booksState.mode] || '';
    const cached = booksState.searchCache[booksState.mode] || [];
    if (forceEmpty || !query) {
        renderBooksEmpty(
            booksState.mode === 'online' ? 'Find your next read' : 'Build your offline shelf',
            booksState.mode === 'online'
                ? 'Search Z-Library for EPUB results and open the reader links in your browser.'
                : 'Search LibGen for EPUB files and save them directly into the app library.'
        );
        updateBooksResultSummary('Ready to search');
        return;
    }

    renderBooksResults(cached);
}

async function performBooksSearch() {
    const searchInput = document.getElementById('books-search-input');
    const query = searchInput?.value.trim();
    if (!query) {
        renderBooksCurrentState(true);
        return;
    }

    booksState.lastQuery[booksState.mode] = query;
    setBooksLoading(true, booksState.mode === 'online' ? 'Searching Z-Library...' : 'Searching LibGen...');

    try {
        let result;
        if (booksState.mode === 'online') {
            result = await window.electronAPI.booksSearchOnline(query);
        } else {
            result = await window.electronAPI.booksSearchOffline(query);
        }

        const books = Array.isArray(result?.books) ? result.books : [];
        booksState.searchCache[booksState.mode] = books;
        if (!books.length) {
            renderBooksEmpty('No books found', 'Try another title, author, or a shorter search phrase.');
            updateBooksResultSummary('0 results');
            return;
        }

        renderBooksResults(books);
        updateBooksResultSummary(`${books.length} result${books.length === 1 ? '' : 's'}`);
    } catch (error) {
        console.error('Books search failed:', error);
        renderBooksEmpty('Search failed', error.message || 'The books service could not be reached right now.');
        updateBooksResultSummary('Search failed');
        showToast(`Books search failed: ${error.message}`, 'error');
    } finally {
        setBooksLoading(false);
    }
}

async function loadBooksLibrary() {
    setBooksLoading(true, 'Loading your library...');
    try {
        const result = await window.electronAPI.booksGetLibrary();
        if (result?.folder) {
            booksState.libraryFolder = result.folder;
        }

        const books = Array.isArray(result?.books) ? result.books : [];
        booksState.searchCache.library = books;
        if (!books.length) {
            renderBooksEmpty('Your library is empty', 'Download books from the Offline tab or import EPUB files to start reading here.');
            updateBooksResultSummary('0 books');
            return;
        }

        renderBooksResults(books);
        updateBooksResultSummary(`${books.length} book${books.length === 1 ? '' : 's'}`);
    } catch (error) {
        console.error('Books library failed:', error);
        renderBooksEmpty('Could not load library', error.message || 'The EPUB library folder is unavailable.');
        updateBooksResultSummary('Library error');
        showToast(`Books library failed: ${error.message}`, 'error');
    } finally {
        setBooksLoading(false);
    }
}

function setBooksLoading(isLoading, text = 'Loading...') {
    booksState.loading = isLoading;
    const loading = document.getElementById('books-loading');
    const loadingText = document.getElementById('books-loading-text');
    const results = document.getElementById('books-results');
    const empty = document.getElementById('books-empty-state');

    if (loadingText) loadingText.textContent = text;
    if (loading) loading.style.display = isLoading ? 'flex' : 'none';
    if (results) results.style.display = isLoading ? 'none' : '';
    if (empty) empty.style.display = isLoading ? 'none' : empty.style.display;
}

function renderBooksEmpty(title, text) {
    const emptyTitle = document.getElementById('books-empty-title');
    const emptyText = document.getElementById('books-empty-text');
    const emptyState = document.getElementById('books-empty-state');
    const results = document.getElementById('books-results');

    if (emptyTitle) emptyTitle.textContent = title;
    if (emptyText) emptyText.textContent = text;
    if (emptyState) emptyState.style.display = 'flex';
    if (results) {
        results.innerHTML = '';
        results.style.display = 'none';
    }
}

function renderBooksResults(books) {
    const results = document.getElementById('books-results');
    const emptyState = document.getElementById('books-empty-state');
    if (!results) return;

    results.innerHTML = '';
    results.style.display = books.length ? 'grid' : 'none';
    if (emptyState) {
        emptyState.style.display = books.length ? 'none' : 'flex';
    }

    books.forEach((book) => {
        const card = document.createElement('article');
        card.className = 'books-card';
        card.innerHTML = createBooksCardMarkup(book);
        attachBooksCardActions(card, book);
        hydrateBooksCardCover(card, book);
        results.appendChild(card);
    });
}

function createBooksCardMarkup(book) {
    const coverUrl = book.coverUrl || book.cover || '';
    const badgeClass = booksState.mode === 'online' ? 'online' : booksState.mode === 'offline' ? 'offline' : 'library';
    const badgeText = booksState.mode === 'online' ? 'Z-Library' : booksState.mode === 'offline' ? 'LibGen' : 'Library';
    const metaItems = [];

    if (booksState.mode === 'offline') {
        if (book.language) metaItems.push(book.language);
        if (book.year) metaItems.push(book.year);
        if (book.sizeText || book.fileSize) metaItems.push(booksFormatFileSize(book.fileSize, book.sizeText));
    } else if (booksState.mode === 'library') {
        if (book.source) metaItems.push(String(book.source).toUpperCase());
        if (book.fileSize) metaItems.push(booksFormatFileSize(book.fileSize, book.sizeText));
        if (book.downloadedAt) metaItems.push(booksFormatDate(book.downloadedAt));
    } else {
        metaItems.push('EPUB');
    }

    const coverMarkup = coverUrl
        ? `<div class="books-card-cover" data-books-cover-shell="1"><img data-books-cover-img="1" alt="${booksEscapeAttribute(book.title || 'Book cover')}" loading="lazy"><div class="books-card-cover-meta"><span class="books-badge ${badgeClass}">${booksEscapeHtml(badgeText)}</span>${metaItems.length ? `<span class="books-cover-chip">${booksEscapeHtml(metaItems[0])}</span>` : ''}</div></div>`
        : `<div class="books-card-cover placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg><div class="books-card-cover-meta"><span class="books-badge ${badgeClass}">${booksEscapeHtml(badgeText)}</span>${metaItems.length ? `<span class="books-cover-chip">${booksEscapeHtml(metaItems[0])}</span>` : ''}</div></div>`;

    let actionsMarkup = '';
    if (booksState.mode === 'online') {
        actionsMarkup = `
            <div class="books-card-actions">
                <button type="button" class="books-card-btn primary full" data-books-action="read-online">Read Now</button>
                <button type="button" class="books-card-btn secondary" data-books-action="open-download">Download Page</button>
            </div>
        `;
    } else if (booksState.mode === 'offline') {
        actionsMarkup = `
            <div class="books-card-actions">
                <button type="button" class="books-card-btn primary full" data-books-action="save-offline">Save to Library</button>
            </div>
        `;
    } else {
        actionsMarkup = `
            <div class="books-card-actions">
                <button type="button" class="books-card-btn primary full" data-books-action="read-library">Read</button>
                <button type="button" class="books-card-btn secondary" data-books-action="reveal-library">Reveal</button>
            </div>
        `;
    }

    return `
        ${coverMarkup}
        <div class="books-card-content">
            <h3 class="books-card-title">${booksEscapeHtml(book.title || 'Untitled')}</h3>
            <div class="books-card-author">${booksEscapeHtml(booksAuthorText(book.author || book.authors || 'Unknown Author'))}</div>
            ${metaItems.length > 1 ? `<div class="books-card-meta">${metaItems.slice(1).map((item) => `<span>${booksEscapeHtml(item)}</span>`).join('')}</div>` : ''}
            ${actionsMarkup}
        </div>
    `;
}

async function hydrateBooksCardCover(card, book) {
    const img = card.querySelector('[data-books-cover-img]');
    if (!img) return;

    const coverUrl = String(book.coverUrl || book.cover || '').trim();
    if (!coverUrl) return;

    try {
        let resolvedUrl = booksState.coverCache.get(coverUrl);
        if (!resolvedUrl) {
            const result = await window.electronAPI.booksFetchCoverDataUrl(coverUrl);
            if (!result?.success || !result.dataUrl) {
                throw new Error(result?.message || 'Cover fetch failed');
            }
            resolvedUrl = result.dataUrl;
            booksState.coverCache.set(coverUrl, resolvedUrl);
        }

        img.src = resolvedUrl;
    } catch (error) {
        console.warn('Book cover failed:', error.message);
        const shell = card.querySelector('[data-books-cover-shell]');
        if (shell) {
            shell.classList.add('placeholder');
            img.remove();
            if (!shell.querySelector('svg')) {
                shell.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>');
            }
        }
    }
}

function attachBooksCardActions(card, book) {
    const readOnlineBtn = card.querySelector('[data-books-action="read-online"]');
    const openDownloadBtn = card.querySelector('[data-books-action="open-download"]');
    const saveOfflineBtn = card.querySelector('[data-books-action="save-offline"]');
    const readLibraryBtn = card.querySelector('[data-books-action="read-library"]');
    const revealLibraryBtn = card.querySelector('[data-books-action="reveal-library"]');

    readOnlineBtn?.addEventListener('click', async () => {
        const original = readOnlineBtn.textContent;
        readOnlineBtn.disabled = true;
        readOnlineBtn.textContent = 'Opening...';
        try {
            const links = await fetchBooksOnlineLinks(book);
            if (links.readLink) {
                await window.electronAPI.openExternalUrl(links.readLink);
            } else if (links.downloadLink) {
                await window.electronAPI.openExternalUrl(links.downloadLink);
            } else {
                throw new Error('No reader link was available for this book');
            }
        } catch (error) {
            showToast(error.message || 'Could not open the book', 'error');
        } finally {
            readOnlineBtn.disabled = false;
            readOnlineBtn.textContent = original;
        }
    });

    openDownloadBtn?.addEventListener('click', async () => {
        const original = openDownloadBtn.textContent;
        openDownloadBtn.disabled = true;
        openDownloadBtn.textContent = 'Loading...';
        try {
            const links = await fetchBooksOnlineLinks(book);
            if (!links.downloadLink) {
                throw new Error('No download page was available for this book');
            }
            await window.electronAPI.openExternalUrl(links.downloadLink);
        } catch (error) {
            showToast(error.message || 'Could not open the download page', 'error');
        } finally {
            openDownloadBtn.disabled = false;
            openDownloadBtn.textContent = original;
        }
    });

    saveOfflineBtn?.addEventListener('click', async () => {
        const original = saveOfflineBtn.textContent;
        saveOfflineBtn.disabled = true;
        saveOfflineBtn.textContent = 'Saving...';
        try {
            const result = await window.electronAPI.booksDownloadOffline({
                editionId: book.editionId,
                bookData: book
            });
            if (!result?.success) {
                throw new Error(result?.message || 'Download failed');
            }
            showToast('Book saved to your library', 'success');
            if (booksState.mode === 'library') {
                await loadBooksLibrary();
            }
        } catch (error) {
            showToast(error.message || 'Could not save the book', 'error');
        } finally {
            saveOfflineBtn.disabled = false;
            saveOfflineBtn.textContent = original;
        }
    });

    readLibraryBtn?.addEventListener('click', async () => {
        await openBooksReader(book);
    });

    revealLibraryBtn?.addEventListener('click', () => {
        if (book.localPath) {
            window.electronAPI.openFolder(book.localPath);
        }
    });
}

async function fetchBooksOnlineLinks(book) {
    if (book._resolvedLinks) {
        return book._resolvedLinks;
    }
    const result = await window.electronAPI.booksGetOnlineLinks(book.bookPath);
    if (!result?.success) {
        throw new Error(result?.error || 'The book links could not be resolved');
    }
    book._resolvedLinks = result;
    return result;
}

async function importBooksFiles() {
    try {
        const filePaths = await window.electronAPI.selectFiles('books');
        if (!filePaths || !filePaths.length) {
            return;
        }
        const result = await window.electronAPI.booksImportFiles(filePaths);
        const importedCount = Array.isArray(result?.imported) ? result.imported.length : 0;
        showToast(importedCount ? `Imported ${importedCount} EPUB file${importedCount === 1 ? '' : 's'}` : 'No EPUB files were imported', importedCount ? 'success' : 'info');
        if (booksState.mode === 'library') {
            await loadBooksLibrary();
        }
    } catch (error) {
        showToast(error.message || 'Could not import EPUB files', 'error');
    }
}

async function openBooksLibraryFolder() {
    try {
        const folderResult = await window.electronAPI.booksGetLibraryFolder();
        if (folderResult?.success && folderResult.path) {
            booksState.libraryFolder = folderResult.path;
            await window.electronAPI.openInExplorer(folderResult.path);
        }
    } catch (error) {
        showToast(error.message || 'Could not open the library folder', 'error');
    }
}

async function openBooksReader(book) {
    const overlay = document.getElementById('books-reader-overlay');
    const container = document.getElementById('books-reader-container');
    const title = document.getElementById('books-reader-title');
    const subtitle = document.getElementById('books-reader-subtitle');
    const location = document.getElementById('books-reader-location');

    if (!window.ePub) {
        showToast('The EPUB reader library did not load', 'error');
        return;
    }

    closeBooksReader(false);
    if (overlay) overlay.style.display = 'block';
    if (title) title.textContent = book.title || 'Opening book...';
    if (subtitle) subtitle.textContent = booksAuthorText(book.author || book.authors || 'Unknown Author');
    if (location) location.textContent = 'Opening book...';
    if (container) container.innerHTML = '';
    document.getElementById('books-reader-prev').disabled = true;
    document.getElementById('books-reader-next').disabled = true;

    try {
        const result = await window.electronAPI.booksReadEpubFile(book.localPath);
        if (!result?.success || !result.base64) {
            throw new Error(result?.message || 'Could not read this EPUB file');
        }

        const binary = atob(result.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }

        booksReaderState.book = window.ePub(bytes.buffer);
        booksReaderState.rendition = booksReaderState.book.renderTo(container, {
            width: '100%',
            height: '100%',
            spread: 'none',
            flow: 'paginated'
        });
        booksReaderState.currentPath = book.localPath;
        booksReaderState.currentTitle = book.title || 'Book';

        registerBooksReaderThemes(booksReaderState.rendition);
        applyBooksReaderAppearance();

        booksReaderState.rendition.on('relocated', (currentLocation) => {
            const currentPage = currentLocation?.start?.displayed?.page;
            const totalPages = currentLocation?.start?.displayed?.total;
            const prevBtn = document.getElementById('books-reader-prev');
            const nextBtn = document.getElementById('books-reader-next');
            if (prevBtn) prevBtn.disabled = !!currentLocation?.atStart;
            if (nextBtn) nextBtn.disabled = !!currentLocation?.atEnd;
            if (location) {
                location.textContent = currentPage && totalPages
                    ? `Page ${currentPage} of ${totalPages}`
                    : 'Reading position saved';
            }
            if (currentLocation?.start?.cfi && booksReaderState.currentPath) {
                localStorage.setItem(booksReaderStorageKey('position', booksReaderState.currentPath), currentLocation.start.cfi);
            }
        });

        const savedCfi = localStorage.getItem(booksReaderStorageKey('position', booksReaderState.currentPath));
        await booksReaderState.rendition.display(savedCfi || undefined);
    } catch (error) {
        console.error('Books reader failed:', error);
        showToast(error.message || 'Could not open the EPUB', 'error');
        closeBooksReader();
    }
}

function closeBooksReader(clearOverlay = true) {
    if (booksReaderState.rendition) {
        try { booksReaderState.rendition.destroy(); } catch (_) { }
    }
    if (booksReaderState.book) {
        try { booksReaderState.book.destroy(); } catch (_) { }
    }

    booksReaderState.book = null;
    booksReaderState.rendition = null;
    booksReaderState.currentPath = '';
    booksReaderState.currentTitle = '';

    const container = document.getElementById('books-reader-container');
    if (container) container.innerHTML = '';
    const overlay = document.getElementById('books-reader-overlay');
    if (overlay && clearOverlay) overlay.style.display = 'none';
}

function registerBooksReaderThemes(rendition) {
    if (!rendition?.themes) return;

    rendition.themes.register('ink', {
        body: {
            background: '#f8f5ef',
            color: '#1d1b19',
            'font-family': 'Georgia, Cambria, "Times New Roman", serif',
            'line-height': '1.65',
            padding: '20px'
        },
        a: {
            color: '#7c3aed'
        }
    });

    rendition.themes.register('sepia', {
        body: {
            background: '#f1e7d0',
            color: '#2f261c',
            'font-family': 'Georgia, Cambria, "Times New Roman", serif',
            'line-height': '1.7',
            padding: '20px'
        },
        a: {
            color: '#92400e'
        }
    });

    rendition.themes.register('night', {
        body: {
            background: '#111827',
            color: '#f9fafb',
            'font-family': 'Georgia, Cambria, "Times New Roman", serif',
            'line-height': '1.7',
            padding: '20px'
        },
        a: {
            color: '#c4b5fd'
        }
    });
}

function applyBooksReaderAppearance() {
    if (!booksReaderState.rendition?.themes) return;
    const themeNames = ['ink', 'sepia', 'night'];
    const themeLabels = ['Theme: Ink', 'Theme: Sepia', 'Theme: Night'];
    const themeName = themeNames[booksReaderState.themeIndex % themeNames.length];

    booksReaderState.rendition.themes.select(themeName);
    booksReaderState.rendition.themes.fontSize(`${booksReaderState.fontSize}px`);

    const themeBtn = document.getElementById('books-reader-theme-btn');
    if (themeBtn) {
        themeBtn.textContent = themeLabels[booksReaderState.themeIndex % themeLabels.length];
    }
}

function cycleBooksReaderTheme() {
    booksReaderState.themeIndex = (booksReaderState.themeIndex + 1) % 3;
    localStorage.setItem('books.reader.themeIndex', String(booksReaderState.themeIndex));
    applyBooksReaderAppearance();
}

function adjustBooksReaderFont(delta) {
    booksReaderState.fontSize = Math.min(24, Math.max(12, booksReaderState.fontSize + delta));
    localStorage.setItem('books.reader.fontSize', String(booksReaderState.fontSize));
    applyBooksReaderAppearance();
}

function booksReaderStorageKey(type, suffix) {
    return `books.reader.${type}.${encodeURIComponent(suffix || '')}`;
}

function updateBooksResultSummary(text) {
    const resultSummary = document.getElementById('books-result-summary');
    if (resultSummary) resultSummary.textContent = text;
}

function booksAuthorText(author) {
    if (Array.isArray(author)) {
        return author.filter(Boolean).join(', ') || 'Unknown Author';
    }
    return String(author || 'Unknown Author');
}

function booksFormatFileSize(bytes, fallbackText = '') {
    if (!bytes && fallbackText) {
        return fallbackText;
    }
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function booksFormatDate(isoText) {
    try {
        return new Date(isoText).toLocaleDateString();
    } catch (_) {
        return '';
    }
}

function booksEscapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function booksEscapeAttribute(text) {
    return booksEscapeHtml(text).replace(/`/g, '&#96;');
}

// =====================================================
// Dropzones
// =====================================================

function setupDropzones() {
    // Prevent accidental window navigation when dragging files outside designated dropzones
    window.addEventListener('dragover', (e) => e.preventDefault(), false);
    window.addEventListener('drop', (e) => e.preventDefault(), false);

    // Global dropzone
    setupDropzone(elements.globalDropzone, 'all');

    // Converter-specific dropzones
    document.querySelectorAll('.converter-dropzone').forEach(dropzone => {
        setupDropzone(dropzone, dropzone.dataset.type);
    });
}

function setupDropzone(dropzone, type) {
    if (!dropzone) return;

    // Click to open file dialog
    dropzone.addEventListener('click', async () => {
        const files = await window.electronAPI.selectFiles(type);
        if (files.length > 0) {
            handleFiles(files, type);
        }
    });

    // Drag and drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');

        const files = Array.from(e.dataTransfer.files).map(f => f.path);
        handleFiles(files, type);
    });
}

async function handleFiles(filePaths, type) {
    for (const filePath of filePaths) {
        try {
            const fileInfo = await window.electronAPI.getFileInfo(filePath);

            // Determine file type if global dropzone
            let fileType = type === 'all' ? fileInfo.type : type;

            // For compress type, accept image files
            if (type === 'compress') {
                const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'avif', 'heif', 'heic', 'jxl', 'jp2'];
                if (!imgExts.includes(fileInfo.extension)) {
                    showToast('Only image files can be compressed', 'error');
                    continue;
                }
                fileType = 'compress';
            }

            if (fileType === 'unknown') {
                showToast('Unsupported file type', 'error');
                continue;
            }

            // Add unique ID
            fileInfo.id = Date.now() + Math.random().toString(36).substr(2, 9);
            fileInfo.progress = 0;
            fileInfo.status = 'pending';

            // Add to state
            if (!state.files[fileType]) {
                state.files[fileType] = [];
            }
            state.files[fileType].push(fileInfo);

            // Update UI
            renderFileList(fileType);
            updateConvertButton(fileType);

            // If dropped on global, navigate to the appropriate page
            if (type === 'all') {
                navigateTo(fileType);
            }
        } catch (err) {
            console.error('Error handling file:', err);
            showToast(`Error: ${err.message}`, 'error');
        }
    }
}

function renderFileList(type) {
    const listElement = elements[`${type}FileList`];
    if (!listElement) return;

    listElement.innerHTML = '';

    state.files[type].forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.id = file.id;

        fileItem.innerHTML = `
            <div class="file-icon ${type}">
                ${getFileIcon(type)}
            </div>
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta-row">
                    <span class="file-size-badge">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
                        ${formatFileSize(file.size)}
                    </span>
                    <span class="file-ext-badge">${file.name.split('.').pop().toUpperCase()}</span>
                </div>
            </div>
            <button class="file-remove" data-id="${file.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;

        // Remove button handler
        fileItem.querySelector('.file-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            removeFile(type, file.id);
        });

        listElement.appendChild(fileItem);
    });
}

function removeFile(type, fileId) {
    const fileItem = document.querySelector(`.file-item[data-id="${fileId}"]`);
    if (fileItem) {
        fileItem.classList.add('removing');
        setTimeout(() => {
            state.files[type] = state.files[type].filter(f => f.id !== fileId);
            renderFileList(type);
            updateConvertButton(type);
        }, 300);
    }
}

function getFileIcon(type) {
    const icons = {
        audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><polygon points="10,8 16,12 10,16"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>',
        compress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,14 10,14 10,20"/><polyline points="20,10 14,10 14,4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
        document: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
    };
    return icons[type] || icons.document;
}

// =====================================================
// Format Buttons
// =====================================================

function setupFormatButtons() {
    document.querySelectorAll('.format-buttons').forEach(container => {
        container.querySelectorAll('.format-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Deselect siblings
                container.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    });
}

function getSelectedFormat(type) {
    const container = elements[`${type}Formats`];
    if (!container) return null;

    const activeBtn = container.querySelector('.format-btn.active');
    return activeBtn ? activeBtn.dataset.format : null;
}

function getSelectedResolution() {
    const activeBtn = elements.videoResolution?.querySelector('.format-btn.active');
    return activeBtn ? activeBtn.dataset.resolution : 'original';
}

// =====================================================
// Quality Sliders
// =====================================================

function setupSliders() {
    // Audio bitrate
    elements.audioBitrate?.addEventListener('input', () => {
        if (elements.audioBitrateValue) {
            elements.audioBitrateValue.textContent = `${elements.audioBitrate.value} kbps`;
        }
        updateSliderTrack(elements.audioBitrate);
    });

    // Video quality
    elements.videoQuality?.addEventListener('input', () => {
        const val = parseInt(elements.videoQuality.value);
        elements.videoQualityValue.textContent = `${val}%`;
        const hint = document.getElementById('video-quality-hint');
        if (hint) {
            if (val <= 25) hint.textContent = 'Low (Small file)';
            else if (val <= 50) hint.textContent = 'Medium';
            else if (val <= 75) hint.textContent = 'Balanced';
            else if (val <= 90) hint.textContent = 'High Quality';
            else hint.textContent = 'Ultra (Large file)';
        }
        // Update slider track fill
        updateSliderTrack(elements.videoQuality);
    });

    // Image quality
    elements.imageQuality?.addEventListener('input', () => {
        const val = parseInt(elements.imageQuality.value);
        elements.imageQualityValue.textContent = `${val}%`;
        const hint = document.getElementById('image-quality-hint');
        if (hint) {
            if (val <= 30) hint.textContent = 'Low (Smallest)';
            else if (val <= 55) hint.textContent = 'Medium';
            else if (val <= 80) hint.textContent = 'Good Quality';
            else if (val <= 95) hint.textContent = 'High Quality';
            else hint.textContent = 'Maximum Quality';
        }
        updateSliderTrack(elements.imageQuality);
    });

    // Compress quality
    elements.compressQuality?.addEventListener('input', () => {
        const val = parseInt(elements.compressQuality.value);
        if (elements.compressQualityValue) elements.compressQualityValue.textContent = `${val}%`;
        if (elements.compressQualityHint) {
            if (val <= 20) elements.compressQualityHint.textContent = 'Extreme (Smallest)';
            else if (val <= 40) elements.compressQualityHint.textContent = 'Heavy Compression';
            else if (val <= 60) elements.compressQualityHint.textContent = 'Balanced';
            else if (val <= 80) elements.compressQualityHint.textContent = 'Light Compression';
            else elements.compressQualityHint.textContent = 'Minimal (Best Quality)';
        }
        updateSliderTrack(elements.compressQuality);
    });

    // Initialize slider tracks
    [elements.videoQuality, elements.imageQuality, elements.audioBitrate, elements.compressQuality].forEach(slider => {
        if (slider) updateSliderTrack(slider);
    });
    // Also init video simple quality slider
    const videoSimpleSlider = document.getElementById('video-simple-quality');
    if (videoSimpleSlider) updateSliderTrack(videoSimpleSlider);
    // Also init audio simple quality slider
    const audioSimpleSlider = document.getElementById('audio-simple-quality');
    if (audioSimpleSlider) updateSliderTrack(audioSimpleSlider);
}

function updateSliderTrack(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-percent', `${percent}%`);
}

// =====================================================
// Convert Buttons
// =====================================================

function setupConvertButtons() {
    elements.convertAudioBtn?.addEventListener('click', () => convertFiles('audio'));
    elements.convertVideoBtn?.addEventListener('click', () => convertFiles('video'));
    elements.convertImageBtn?.addEventListener('click', () => convertFiles('image'));
    elements.convertDocumentBtn?.addEventListener('click', () => convertFiles('document'));
    elements.compressFilesBtn?.addEventListener('click', () => compressFiles());

    elements.cancelConversion?.addEventListener('click', cancelConversion);
}

function updateConvertButton(type) {
    if (type === 'compress') {
        if (elements.compressFilesBtn) {
            elements.compressFilesBtn.disabled = state.converting || state.files.compress.length === 0;
        }
        return;
    }
    const btn = elements[`convert${type.charAt(0).toUpperCase() + type.slice(1)}Btn`];
    if (btn) {
        btn.disabled = state.converting || state.files[type].length === 0;
    }
}

function getFileNameFromPath(filePath) {
    const value = String(filePath || '').trim();
    if (!value) return 'image';
    const parts = value.split(/[\\/]/);
    return parts[parts.length - 1] || 'image';
}

function isOpenableQrUrl(value) {
    try {
        const parsed = new URL(String(value || '').trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function clearImageQrResult() {
    if (elements.imageQrResultCard) elements.imageQrResultCard.style.display = 'none';
    if (elements.imageQrResultSource) elements.imageQrResultSource.textContent = 'Scanned from image';
    if (elements.imageQrResultText) elements.imageQrResultText.textContent = '';
    if (elements.imageQrOpenBtn) {
        elements.imageQrOpenBtn.style.display = 'none';
        delete elements.imageQrOpenBtn.dataset.url;
    }
}

function showImageQrResult(value, filePath) {
    const result = String(value || '').trim();
    if (!result || !elements.imageQrResultCard || !elements.imageQrResultText) return;

    elements.imageQrResultCard.style.display = '';
    elements.imageQrResultText.textContent = result;

    if (elements.imageQrResultSource) {
        elements.imageQrResultSource.textContent = `Scanned from ${getFileNameFromPath(filePath)}`;
    }

    const canOpen = isOpenableQrUrl(result);
    if (elements.imageQrOpenBtn) {
        if (canOpen) {
            elements.imageQrOpenBtn.style.display = '';
            elements.imageQrOpenBtn.dataset.url = result;
        } else {
            elements.imageQrOpenBtn.style.display = 'none';
            delete elements.imageQrOpenBtn.dataset.url;
        }
    }
}

async function scanQrFromImageCandidates(filePaths) {
    let lastError = '';

    for (const filePath of filePaths) {
        try {
            const result = await window.electronAPI.scanQrFromImage(filePath);
            if (result?.success && result.data) {
                return {
                    success: true,
                    data: result.data,
                    filePath
                };
            }
            if (result?.error) lastError = result.error;
        } catch (err) {
            lastError = err.message || 'Failed to scan QR code';
        }
    }

    return {
        success: false,
        error: lastError || 'No QR code was found in the selected image(s)'
    };
}

function setupImageQrScanner() {
    const scanBtn = elements.imageQrScanBtn;
    if (!scanBtn) return;

    elements.imageQrClearBtn?.addEventListener('click', clearImageQrResult);

    elements.imageQrCopyBtn?.addEventListener('click', async () => {
        const value = elements.imageQrResultText?.textContent?.trim();
        if (!value) return;

        try {
            await navigator.clipboard.writeText(value);
            showToast('QR text copied to clipboard', 'success');
        } catch (err) {
            showToast('Could not copy QR text', 'error');
        }
    });

    elements.imageQrOpenBtn?.addEventListener('click', async () => {
        const url = elements.imageQrOpenBtn?.dataset.url;
        if (!url) return;

        try {
            await window.electronAPI.openExternalUrl(url);
        } catch (err) {
            showToast('Could not open QR link', 'error');
        }
    });

    scanBtn.addEventListener('click', async () => {
        const label = scanBtn.querySelector('span');
        const defaultLabel = 'Scan QR from Image';
        const queuedPaths = state.files.image.map(file => file.path).filter(Boolean);

        scanBtn.disabled = true;
        clearImageQrResult();
        if (label) label.textContent = queuedPaths.length > 0 ? 'Scanning Added Images...' : 'Choose Image...';

        try {
            const filePaths = queuedPaths.length > 0
                ? queuedPaths
                : await window.electronAPI.selectFiles('image');

            if (!Array.isArray(filePaths) || filePaths.length === 0) {
                return;
            }

            if (label) label.textContent = 'Scanning...';

            const result = await scanQrFromImageCandidates(filePaths);
            if (!result.success) {
                showToast(result.error || 'No QR code was found in the selected image(s)', 'warning');
                return;
            }

            showImageQrResult(result.data, result.filePath);
            showToast('QR code scanned successfully', 'success');
        } catch (err) {
            showToast('QR scan failed: ' + err.message, 'error');
        } finally {
            scanBtn.disabled = false;
            if (label) label.textContent = defaultLabel;
        }
    });
}

// =====================================================
// Conversion Logic
// =====================================================

function setConvertButtonsBusyState() {
    const busy = state.converting;
    ['audio', 'video', 'image', 'document', 'compress'].forEach((type) => {
        const button = type === 'compress'
            ? elements.compressFilesBtn
            : elements[`convert${type.charAt(0).toUpperCase() + type.slice(1)}Btn`];
        if (button) {
            button.disabled = busy || (state.files[type]?.length || 0) === 0;
        }
    });
}

function getConversionTypeLabel(type) {
    switch (type) {
        case 'audio': return 'Audio conversion';
        case 'video': return 'Video conversion';
        case 'image': return 'Image conversion';
        case 'document': return 'Document conversion';
        case 'compress': return 'Image compression';
        default: return 'File conversion';
    }
}

function getTrackedConversionFile(fileId) {
    return state.currentConversion.queue.find((file) => file.id === fileId)
        || ['audio', 'video', 'image', 'document', 'compress']
            .flatMap((type) => state.files[type] || [])
            .find((file) => file.id === fileId)
        || null;
}

function updateCurrentConversionPanel() {
    const hasQueue = state.currentConversion.queue.length > 0;

    if (elements.currentConversionEmpty) {
        elements.currentConversionEmpty.style.display = hasQueue ? 'none' : 'flex';
    }

    if (elements.progressModal) {
        elements.progressModal.classList.toggle('active', hasQueue);
    }

    if (elements.cancelConversion) {
        elements.cancelConversion.style.display = state.currentConversion.active && hasQueue ? 'inline-flex' : 'none';
    }

    if (elements.convertingNavBadge) {
        elements.convertingNavBadge.style.display = state.currentConversion.active ? '' : 'none';
        elements.convertingNavBadge.textContent = state.currentConversion.active ? 'Live' : 'Done';
    }

    if (!hasQueue) {
        if (elements.currentConversionSubtitle) {
            elements.currentConversionSubtitle.textContent = 'Track active conversions without locking the rest of the app.';
        }
        if (elements.currentConversionTitle) {
            elements.currentConversionTitle.textContent = 'Preparing conversion queue...';
        }
        if (elements.currentConversionStatus) {
            elements.currentConversionStatus.textContent = 'Waiting for the next file...';
        }
        if (elements.currentConversionEngine) {
            elements.currentConversionEngine.textContent = 'FFmpeg';
        }
        if (elements.overallProgress) elements.overallProgress.style.width = '0%';
        if (elements.progressText) elements.progressText.textContent = '0%';
        return;
    }

    const label = getConversionTypeLabel(state.currentConversion.type);

    if (elements.currentConversionEngine) {
        elements.currentConversionEngine.textContent = state.currentConversion.engine || 'FFmpeg';
    }
    if (elements.currentConversionTitle) {
        elements.currentConversionTitle.textContent = label;
    }
    if (elements.currentConversionSubtitle) {
        elements.currentConversionSubtitle.textContent = state.currentConversion.active
            ? `${label} is running in the background. You can keep browsing the app normally.`
            : `${label} finished. Review the latest results below.`;
    }
    if (elements.currentConversionStatus) {
        const total = state.currentConversion.total || state.currentConversion.queue.length || 0;
        const processed = state.currentConversion.processed || 0;
        const completed = state.currentConversion.completed || 0;
        const failed = state.currentConversion.failed || 0;
        elements.currentConversionStatus.textContent = state.currentConversion.active
            ? `Processed ${processed} of ${total} files. ${completed} done, ${failed} failed.`
            : `Finished ${total} files. ${completed} done, ${failed} failed.`;
    }
}

function startCurrentConversionSession(type, queue, engine = 'FFmpeg') {
    state.currentConversion = {
        active: true,
        type,
        engine,
        queue,
        total: queue.length,
        processed: 0,
        completed: 0,
        failed: 0
    };

    renderProgressList(queue);
    updateCurrentConversionPanel();
    showProgressModal();
}

function resetCurrentConversionSession() {
    state.currentConversion = {
        active: false,
        type: '',
        engine: 'FFmpeg',
        queue: [],
        total: 0,
        processed: 0,
        completed: 0,
        failed: 0
    };

    if (elements.progressList) {
        elements.progressList.innerHTML = '';
    }

    updateCurrentConversionPanel();
}

function finishCurrentConversionSession(completed, failed) {
    state.currentConversion.active = false;
    state.currentConversion.completed = completed;
    state.currentConversion.failed = failed;
    state.currentConversion.processed = Math.min(
        state.currentConversion.total || state.currentConversion.queue.length,
        completed + failed
    );
    updateCurrentConversionPanel();
}

async function convertFiles(type) {
    if (state.converting) {
        navigateTo('converting');
        showToast('A conversion is already running. You can monitor it in Currently Converting.', 'info');
        return;
    }

    if (state.files[type].length === 0) return;

    state.converting = true;
    setConvertButtonsBusyState();

    const format = getSelectedFormat(type);
    const outputDirectory = state.settings.outputDirectory;
    const queue = state.files[type].map((file) => ({ ...file }));

    let completed = 0;
    let failed = 0;
    let spaceSavedBytes = 0;
    const total = queue.length;

    startCurrentConversionSession(type, queue, 'FFmpeg');

    for (const file of queue) {
        // Check if conversion was cancelled
        if (!state.converting) {
            file.status = 'cancelled';
            updateProgressItem(file.id, 0, 'error');
            failed++;
            continue;
        }

        try {
            file.status = 'converting';
            updateProgressItem(file.id, 0, 'converting');

            const options = {
                id: file.id,
                inputPath: file.path,
                outputFormat: format,
                outputDirectory
            };

            // Add type-specific options
            if (type === 'audio') {
                if (getAudioAdvancedMode()) {
                    options.bitrate = elements.audioBitrate?.value + 'k' || '192k';
                    options.sampleRate = parseInt(elements.audioSamplerate?.value) || 44100;
                    options.channels = parseInt(elements.audioChannels?.value) || 2;
                    options.normalize = document.getElementById('audio-normalize')?.checked ?? false;
                } else {
                    // Simple mode — map quality slider to bitrate
                    const simpleQ = parseInt(document.getElementById('audio-simple-quality')?.value) || 70;
                    const bitrateMap = [64, 96, 128, 160, 192, 224, 256, 288, 320];
                    const idx = Math.min(Math.floor(simpleQ / 12), bitrateMap.length - 1);
                    options.bitrate = bitrateMap[idx] + 'k';
                    options.sampleRate = 44100;
                    options.channels = 2;
                    options.normalize = false;
                }
            } else if (type === 'video') {
                if (getVideoAdvancedMode()) {
                    options.resolution = getSelectedResolution();
                    options.quality = parseInt(elements.videoQuality?.value) || 75;
                    options.codec = elements.videoCodec?.value || 'default';
                    options.fps = elements.videoFps?.value || 'original';
                    // Custom bitrate options from advanced panel
                    const vBitrate = document.getElementById('video-bitrate-select')?.value;
                    const aBitrate = document.getElementById('video-audio-bitrate-select')?.value;
                    if (vBitrate && vBitrate !== 'auto') {
                        options.videoBitrate = vBitrate + 'k';
                    }
                    if (aBitrate && aBitrate !== 'auto') {
                        options.audioBitrate = aBitrate + 'k';
                    }
                } else {
                    // Simple mode — use quality slider
                    const simpleQuality = parseInt(document.getElementById('video-simple-quality')?.value) || 65;
                    options.resolution = 'original';
                    options.quality = simpleQuality;
                    options.codec = 'default';
                    options.fps = 'original';
                }
            } else if (type === 'image') {
                if (getImageAdvancedMode()) {
                    options.quality = parseInt(document.getElementById('image-quality-adv')?.value) || 85;
                    options.width = elements.imageWidth?.value ? parseInt(elements.imageWidth.value) : null;
                    options.height = elements.imageHeight?.value ? parseInt(elements.imageHeight.value) : null;
                    options.maintainAspectRatio = elements.maintainRatio?.checked ?? true;
                    options.dpi = parseInt(document.getElementById('image-dpi')?.value) || 300;
                    options.rotate = parseInt(document.getElementById('image-rotate')?.value) || 0;
                    options.grayscale = document.getElementById('image-grayscale')?.checked ?? false;
                    options.flip = document.getElementById('image-flip')?.checked ?? false;
                    options.flop = document.getElementById('image-flop')?.checked ?? false;
                } else {
                    options.quality = parseInt(elements.imageQuality?.value) || 85;
                    options.width = null;
                    options.height = null;
                    options.maintainAspectRatio = true;
                    options.dpi = 300;
                    options.rotate = 0;
                    options.grayscale = false;
                    options.flip = false;
                    options.flop = false;
                }
                options.compression = options.quality > 80 ? 'high' : options.quality < 40 ? 'low' : 'default';
            }

            // Call the appropriate converter
            const result = await window.electronAPI[`convert${type.charAt(0).toUpperCase() + type.slice(1)}`](options);

            if (result.success) {
                file.status = 'done';
                file.outputPath = result.outputPath;
                file.outputSize = result.outputSize;
                updateProgressItem(file.id, 100, 'done');

                // Add to history
                addToHistory({
                    type,
                    inputName: file.name,
                    outputPath: result.outputPath,
                    inputSize: file.size,
                    outputSize: result.outputSize,
                    timestamp: Date.now(),
                    status: 'success'
                });

                completed++;
            }
        } catch (err) {
            // Don't treat cancellation as an error
            if (err.message && err.message.includes('cancelled')) {
                file.status = 'cancelled';
                updateProgressItem(file.id, 0, 'error');
                failed++;
            } else {
                console.error('Conversion error:', err);
                file.status = 'error';
                updateProgressItem(file.id, 0, 'error');
                failed++;

                // Track failed conversions in history too
                addToHistory({
                    type,
                    inputName: file.name,
                    outputPath: null,
                    inputSize: file.size,
                    outputSize: 0,
                    timestamp: Date.now(),
                    status: 'failed',
                    error: err.message || 'Conversion failed'
                });
            }
        }

        // Update overall progress
        state.currentConversion.processed = completed + failed;
        state.currentConversion.completed = completed;
        state.currentConversion.failed = failed;
        const progress = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
        elements.overallProgress.style.width = `${progress}%`;
        elements.progressText.textContent = `${progress}%`;
        updateCurrentConversionPanel();
    }

    // Conversion complete
    state.converting = false;
    finishCurrentConversionSession(completed, failed);
    setConvertButtonsBusyState();

    if (completed > 0) {
        const msg = failed > 0
            ? `Converted ${completed} file(s), ${failed} failed`
            : `Successfully converted ${completed} file(s)`;
        showToast(msg, failed > 0 ? 'warning' : 'success');
        playSound('success');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification(
                'Conversion Complete',
                msg
            );
        }

        // Update stats
        updateStats(completed, spaceSavedBytes);
    } else {
        // All conversions failed
        showToast(`All ${total} conversion(s) failed`, 'error');
        playSound('failed');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification(
                'Conversion Failed',
                `All ${total} file(s) failed to convert`
            );
        }
    }

    // Clear only files from this run
    const processedIds = new Set(queue.map((file) => file.id));
    state.files[type] = state.files[type].filter((file) => !processedIds.has(file.id));
    renderFileList(type);
    updateConvertButton(type);
    resetCurrentConversionSession();
}

// =====================================================
// Compression Logic
// =====================================================

async function compressFiles() {
    if (state.converting) {
        navigateTo('converting');
        showToast('A conversion is already running. You can monitor it in Currently Converting.', 'info');
        return;
    }

    if (state.files.compress.length === 0) return;

    state.converting = true;
    setConvertButtonsBusyState();

    const quality = parseInt(elements.compressQuality?.value) || 60;
    const outputDirectory = state.settings.outputDirectory;
    const queue = state.files.compress.map((file) => ({ ...file }));

    let completed = 0;
    let failed = 0;
    let compressSpaceSaved = 0;
    const total = queue.length;

    startCurrentConversionSession('compress', queue, 'FFmpeg');

    for (const file of queue) {
        // Check if conversion was cancelled
        if (!state.converting) {
            file.status = 'cancelled';
            updateProgressItem(file.id, 0, 'error');
            failed++;
            continue;
        }

        try {
            file.status = 'converting';
            updateProgressItem(file.id, 0, 'converting');

            const options = {
                id: file.id,
                inputPath: file.path,
                outputDirectory,
                quality
            };

            const result = await window.electronAPI.compressImage(options);

            if (result.success) {
                file.status = 'done';
                file.outputPath = result.outputPath;
                file.outputSize = result.outputSize;
                updateProgressItem(file.id, 100, 'done');

                // Update output size display
                const outputSizeEl = document.querySelector(`.output-size[data-id="${file.id}"]`);
                if (outputSizeEl) {
                    const savedPercent = result.savedPercent || Math.round((1 - result.outputSize / file.size) * 100);
                    outputSizeEl.textContent = `${formatFileSize(result.outputSize)} (${savedPercent > 0 ? '-' : '+'}${Math.abs(savedPercent)}%)`;
                    outputSizeEl.classList.add(savedPercent > 0 ? 'size-smaller' : 'size-larger');
                }

                // Add to history
                addToHistory({
                    type: 'compress',
                    inputName: file.name,
                    outputPath: result.outputPath,
                    inputSize: file.size,
                    outputSize: result.outputSize,
                    timestamp: Date.now(),
                    status: 'success'
                });

                completed++;

                // Track space saved
                const origBytes = file.size || 0;
                const compBytes = result.outputSize || 0;
                if (origBytes > compBytes && compBytes > 0) {
                    compressSpaceSaved += (origBytes - compBytes);
                }
            }
        } catch (err) {
            console.error('Compression error:', err);
            file.status = 'error';
            updateProgressItem(file.id, 0, 'error');
            failed++;

            addToHistory({
                type: 'compress',
                inputName: file.name,
                outputPath: null,
                inputSize: file.size,
                outputSize: 0,
                timestamp: Date.now(),
                status: 'failed',
                error: err.message || 'Compression failed'
            });
        }

        // Update overall progress
        state.currentConversion.processed = completed + failed;
        state.currentConversion.completed = completed;
        state.currentConversion.failed = failed;
        const progress = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
        elements.overallProgress.style.width = `${progress}%`;
        elements.progressText.textContent = `${progress}%`;
        updateCurrentConversionPanel();
    }

    // Compression complete
    state.converting = false;
    finishCurrentConversionSession(completed, failed);
    setConvertButtonsBusyState();

    if (completed > 0) {
        const msg = failed > 0
            ? `Compressed ${completed} file(s), ${failed} failed`
            : `Successfully compressed ${completed} file(s)`;
        showToast(msg, failed > 0 ? 'warning' : 'success');
        playSound('success');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification('Compression Complete', msg);
        }

        updateStats(completed, compressSpaceSaved);
    } else {
        showToast(`All ${total} compression(s) failed`, 'error');
        playSound('failed');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification('Compression Failed', `All ${total} file(s) failed to compress`);
        }
    }

    // Clear only files from this run
    const processedIds = new Set(queue.map((file) => file.id));
    state.files.compress = state.files.compress.filter((file) => !processedIds.has(file.id));
    renderFileList('compress');
    updateConvertButton('compress');
    resetCurrentConversionSession();
}

function renderProgressList(files) {
    elements.progressList.innerHTML = '';

    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'progress-item';
        item.dataset.id = file.id;

        item.innerHTML = `
            <div class="progress-item-info">
                <span class="file-name">${file.name}</span>
                <span class="progress-size-info">
                    <span class="original-size">${formatFileSize(file.size)}</span>
                    <span class="size-arrow">→</span>
                    <span class="output-size" data-id="${file.id}">...</span>
                </span>
            </div>
            <div class="progress-item-bar">
                <div class="progress-item-fill" data-id="${file.id}"></div>
            </div>
            <span class="status pending">Pending</span>
        `;

        elements.progressList.appendChild(item);
    });
}

function updateProgressItem(fileId, progress, status) {
    const item = document.querySelector(`.progress-item[data-id="${fileId}"]`);
    if (!item) return;

    const statusEl = item.querySelector('.status');
    const fillBar = item.querySelector(`.progress-item-fill[data-id="${fileId}"]`);
    statusEl.className = `status ${status}`;

    if (fillBar) {
        fillBar.style.width = `${progress}%`;
    }

    if (status === 'converting') {
        statusEl.textContent = `${progress}%`;
    } else if (status === 'done') {
        statusEl.textContent = 'Done';
        if (fillBar) fillBar.style.width = '100%';
        // Find the file and update output size
        for (const type of ['audio', 'video', 'image', 'document']) {
            const file = state.files[type]?.find(f => f.id === fileId);
            if (file && file.outputSize) {
                const outputSizeEl = item.querySelector(`.output-size[data-id="${fileId}"]`);
                if (outputSizeEl) {
                    outputSizeEl.textContent = formatFileSize(file.outputSize);
                    const savedBytes = file.size - file.outputSize;
                    const savedPercent = file.size > 0 ? Math.round((savedBytes / file.size) * 100) : 0;
                    if (savedBytes > 0) {
                        outputSizeEl.classList.add('size-smaller');
                        outputSizeEl.textContent = `${formatFileSize(file.outputSize)} (↓${savedPercent}%)`;
                    } else if (savedBytes < 0) {
                        outputSizeEl.classList.add('size-larger');
                        outputSizeEl.textContent = `${formatFileSize(file.outputSize)} (↑${Math.abs(savedPercent)}%)`;
                    } else {
                        outputSizeEl.textContent = formatFileSize(file.outputSize);
                    }
                }
            }
        }
    } else if (status === 'error') {
        statusEl.textContent = 'Failed';
        if (fillBar) {
            fillBar.style.width = '100%';
            fillBar.classList.add('error');
        }
    }
}

function updateFileProgress(fileId, progress) {
    updateProgressItem(fileId, progress, 'converting');
}

function cancelConversion() {
    state.converting = false;
    // Actually cancel the running processes in the main process
    if (window.electronAPI.cancelConversion) {
        window.electronAPI.cancelConversion().catch(err => {
            console.error('Failed to cancel conversion:', err);
        });
    }
    hideProgressModal();
    showToast('Conversion cancelled', 'info');
}

function showProgressModal() {
    elements.progressModal.classList.add('active');
    elements.overallProgress.style.width = '0%';
    elements.progressText.textContent = '0%';
}

function hideProgressModal() {
    elements.progressModal.classList.remove('active');
}

function renderProgressList(files) {
    elements.progressList.innerHTML = '';

    files.forEach((file) => {
        const item = document.createElement('div');
        item.className = 'progress-item';
        item.dataset.id = file.id;

        item.innerHTML = `
            <div class="progress-item-info">
                <span class="file-name">${file.name}</span>
                <span class="progress-size-info">
                    <span class="original-size">${formatFileSize(file.size)}</span>
                    <span class="size-arrow">&rarr;</span>
                    <span class="output-size" data-id="${file.id}">...</span>
                </span>
            </div>
            <div class="progress-item-bar">
                <div class="progress-item-fill" data-id="${file.id}"></div>
            </div>
            <span class="status pending">Pending</span>
        `;

        elements.progressList.appendChild(item);
    });
}

function updateProgressItem(fileId, progress, status) {
    const item = document.querySelector(`.progress-item[data-id="${fileId}"]`);
    if (!item) return;

    const statusEl = item.querySelector('.status');
    const fillBar = item.querySelector(`.progress-item-fill[data-id="${fileId}"]`);
    statusEl.className = `status ${status}`;

    if (fillBar) {
        fillBar.style.width = `${progress}%`;
    }

    if (status === 'converting') {
        statusEl.textContent = `${progress}%`;
        return;
    }

    if (status === 'done') {
        statusEl.textContent = 'Done';
        if (fillBar) fillBar.style.width = '100%';

        const file = getTrackedConversionFile(fileId);
        if (file && file.outputSize) {
            const outputSizeEl = item.querySelector(`.output-size[data-id="${fileId}"]`);
            if (outputSizeEl) {
                outputSizeEl.textContent = formatFileSize(file.outputSize);
                const savedBytes = file.size - file.outputSize;
                const savedPercent = file.size > 0 ? Math.round((savedBytes / file.size) * 100) : 0;
                if (savedBytes > 0) {
                    outputSizeEl.classList.add('size-smaller');
                    outputSizeEl.textContent = `${formatFileSize(file.outputSize)} (down ${savedPercent}%)`;
                } else if (savedBytes < 0) {
                    outputSizeEl.classList.add('size-larger');
                    outputSizeEl.textContent = `${formatFileSize(file.outputSize)} (up ${Math.abs(savedPercent)}%)`;
                } else {
                    outputSizeEl.textContent = formatFileSize(file.outputSize);
                }
            }
        }
        return;
    }

    if (status === 'error') {
        statusEl.textContent = 'Failed';
        if (fillBar) {
            fillBar.style.width = '100%';
            fillBar.classList.add('error');
        }
    }
}

function updateFileProgress(fileId, progress) {
    updateProgressItem(fileId, progress, 'converting');
}

function cancelConversion() {
    state.converting = false;
    if (window.electronAPI.cancelConversion) {
        window.electronAPI.cancelConversion().catch((err) => {
            console.error('Failed to cancel conversion:', err);
        });
    }
    state.currentConversion.active = false;
    updateCurrentConversionPanel();
    showToast('Conversion cancelled', 'info');
}

function showProgressModal() {
    navigateTo('converting');
    updateCurrentConversionPanel();
    elements.overallProgress.style.width = '0%';
    elements.progressText.textContent = '0%';
}

function hideProgressModal() {
    updateCurrentConversionPanel();
}

async function convertFiles(type) {
    if (state.converting) {
        navigateTo('converting');
        showToast('A conversion is already running. You can monitor it in Currently Converting.', 'info');
        return;
    }

    if (state.files[type].length === 0) return;

    state.converting = true;
    setConvertButtonsBusyState();

    const format = getSelectedFormat(type);
    const outputDirectory = state.settings.outputDirectory;
    const queue = state.files[type].map((file) => ({ ...file }));

    let completed = 0;
    let failed = 0;
    let spaceSavedBytes = 0;
    const total = queue.length;

    startCurrentConversionSession(type, queue, 'FFmpeg');

    for (const file of queue) {
        if (!state.converting) {
            file.status = 'cancelled';
            updateProgressItem(file.id, 0, 'error');
            failed++;
            continue;
        }

        try {
            file.status = 'converting';
            updateProgressItem(file.id, 0, 'converting');

            const options = {
                id: file.id,
                inputPath: file.path,
                outputFormat: format,
                outputDirectory
            };

            if (type === 'audio') {
                if (getAudioAdvancedMode()) {
                    options.bitrate = elements.audioBitrate?.value + 'k' || '192k';
                    options.sampleRate = parseInt(elements.audioSamplerate?.value) || 44100;
                    options.channels = parseInt(elements.audioChannels?.value) || 2;
                } else {
                    const simpleQ = parseInt(document.getElementById('audio-simple-quality')?.value) || 70;
                    const bitrateMap = [64, 96, 128, 160, 192, 224, 256, 288, 320];
                    const idx = Math.min(Math.floor(simpleQ / 12), bitrateMap.length - 1);
                    options.bitrate = bitrateMap[idx] + 'k';
                    options.sampleRate = 44100;
                    options.channels = 2;
                }
            } else if (type === 'video') {
                if (getVideoAdvancedMode()) {
                    options.resolution = getSelectedResolution();
                    options.quality = parseInt(elements.videoQuality?.value) || 75;
                    options.codec = elements.videoCodec?.value || 'default';
                    options.fps = elements.videoFps?.value || 'original';
                    const vBitrate = document.getElementById('video-bitrate-select')?.value;
                    const aBitrate = document.getElementById('video-audio-bitrate-select')?.value;
                    if (vBitrate && vBitrate !== 'auto') {
                        options.videoBitrate = vBitrate + 'k';
                    }
                    if (aBitrate && aBitrate !== 'auto') {
                        options.audioBitrate = aBitrate + 'k';
                    }
                } else {
                    const simpleQuality = parseInt(document.getElementById('video-simple-quality')?.value) || 65;
                    options.resolution = 'original';
                    options.quality = simpleQuality;
                    options.codec = 'default';
                    options.fps = 'original';
                }
            } else if (type === 'image') {
                if (getImageAdvancedMode()) {
                    options.quality = parseInt(document.getElementById('image-quality-adv')?.value) || 85;
                    options.width = elements.imageWidth?.value ? parseInt(elements.imageWidth.value) : null;
                    options.height = elements.imageHeight?.value ? parseInt(elements.imageHeight.value) : null;
                    options.maintainAspectRatio = elements.maintainRatio?.checked ?? true;
                } else {
                    options.quality = parseInt(elements.imageQuality?.value) || 85;
                    options.width = null;
                    options.height = null;
                    options.maintainAspectRatio = true;
                }
                options.compression = options.quality > 80 ? 'high' : options.quality < 40 ? 'low' : 'default';
            }

            const result = await window.electronAPI[`convert${type.charAt(0).toUpperCase() + type.slice(1)}`](options);

            if (result.success) {
                file.status = 'done';
                file.outputPath = result.outputPath;
                file.outputSize = result.outputSize;
                updateProgressItem(file.id, 100, 'done');

                addToHistory({
                    type,
                    inputName: file.name,
                    outputPath: result.outputPath,
                    inputSize: file.size,
                    outputSize: result.outputSize,
                    timestamp: Date.now(),
                    status: 'success'
                });

                completed++;
            }
        } catch (err) {
            if (err.message && err.message.includes('cancelled')) {
                file.status = 'cancelled';
                updateProgressItem(file.id, 0, 'error');
                failed++;
            } else {
                console.error('Conversion error:', err);
                file.status = 'error';
                updateProgressItem(file.id, 0, 'error');
                failed++;

                addToHistory({
                    type,
                    inputName: file.name,
                    outputPath: null,
                    inputSize: file.size,
                    outputSize: 0,
                    timestamp: Date.now(),
                    status: 'failed',
                    error: err.message || 'Conversion failed'
                });
            }
        }

        state.currentConversion.processed = completed + failed;
        state.currentConversion.completed = completed;
        state.currentConversion.failed = failed;
        const progress = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
        elements.overallProgress.style.width = `${progress}%`;
        elements.progressText.textContent = `${progress}%`;
        updateCurrentConversionPanel();
    }

    state.converting = false;
    finishCurrentConversionSession(completed, failed);
    setConvertButtonsBusyState();

    if (completed > 0) {
        const msg = failed > 0
            ? `Converted ${completed} file(s), ${failed} failed`
            : `Successfully converted ${completed} file(s)`;
        showToast(msg, failed > 0 ? 'warning' : 'success');
        playSound('success');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification('Conversion Complete', msg);
        }

        updateStats(completed, spaceSavedBytes);
    } else {
        showToast(`All ${total} conversion(s) failed`, 'error');
        playSound('failed');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification('Conversion Failed', `All ${total} file(s) failed to convert`);
        }
    }

    const processedIds = new Set(queue.map((file) => file.id));
    state.files[type] = state.files[type].filter((file) => !processedIds.has(file.id));
    renderFileList(type);
    updateConvertButton(type);
    resetCurrentConversionSession();
}

async function compressFiles() {
    if (state.converting) {
        navigateTo('converting');
        showToast('A conversion is already running. You can monitor it in Currently Converting.', 'info');
        return;
    }

    if (state.files.compress.length === 0) return;

    state.converting = true;
    setConvertButtonsBusyState();

    const quality = parseInt(elements.compressQuality?.value) || 60;
    const outputDirectory = state.settings.outputDirectory;
    const queue = state.files.compress.map((file) => ({ ...file }));

    let completed = 0;
    let failed = 0;
    let compressSpaceSaved = 0;
    const total = queue.length;

    startCurrentConversionSession('compress', queue, 'FFmpeg');

    for (const file of queue) {
        if (!state.converting) {
            file.status = 'cancelled';
            updateProgressItem(file.id, 0, 'error');
            failed++;
            continue;
        }

        try {
            file.status = 'converting';
            updateProgressItem(file.id, 0, 'converting');

            const options = {
                id: file.id,
                inputPath: file.path,
                outputDirectory,
                quality
            };

            const result = await window.electronAPI.compressImage(options);

            if (result.success) {
                file.status = 'done';
                file.outputPath = result.outputPath;
                file.outputSize = result.outputSize;
                updateProgressItem(file.id, 100, 'done');

                const outputSizeEl = document.querySelector(`.output-size[data-id="${file.id}"]`);
                if (outputSizeEl) {
                    const savedPercent = result.savedPercent || Math.round((1 - result.outputSize / file.size) * 100);
                    outputSizeEl.textContent = `${formatFileSize(result.outputSize)} (${savedPercent > 0 ? '-' : '+'}${Math.abs(savedPercent)}%)`;
                    outputSizeEl.classList.add(savedPercent > 0 ? 'size-smaller' : 'size-larger');
                }

                addToHistory({
                    type: 'compress',
                    inputName: file.name,
                    outputPath: result.outputPath,
                    inputSize: file.size,
                    outputSize: result.outputSize,
                    timestamp: Date.now(),
                    status: 'success'
                });

                completed++;

                const origBytes = file.size || 0;
                const compBytes = result.outputSize || 0;
                if (origBytes > compBytes && compBytes > 0) {
                    compressSpaceSaved += (origBytes - compBytes);
                }
            }
        } catch (err) {
            console.error('Compression error:', err);
            file.status = 'error';
            updateProgressItem(file.id, 0, 'error');
            failed++;

            addToHistory({
                type: 'compress',
                inputName: file.name,
                outputPath: null,
                inputSize: file.size,
                outputSize: 0,
                timestamp: Date.now(),
                status: 'failed',
                error: err.message || 'Compression failed'
            });
        }

        state.currentConversion.processed = completed + failed;
        state.currentConversion.completed = completed;
        state.currentConversion.failed = failed;
        const progress = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
        elements.overallProgress.style.width = `${progress}%`;
        elements.progressText.textContent = `${progress}%`;
        updateCurrentConversionPanel();
    }

    state.converting = false;
    finishCurrentConversionSession(completed, failed);
    setConvertButtonsBusyState();

    if (completed > 0) {
        const msg = failed > 0
            ? `Compressed ${completed} file(s), ${failed} failed`
            : `Successfully compressed ${completed} file(s)`;
        showToast(msg, failed > 0 ? 'warning' : 'success');
        playSound('success');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification('Compression Complete', msg);
        }

        updateStats(completed, compressSpaceSaved);
    } else {
        showToast(`All ${total} compression(s) failed`, 'error');
        playSound('failed');

        if (state.settings.showNotifications) {
            window.electronAPI.showNotification('Compression Failed', `All ${total} file(s) failed to compress`);
        }
    }

    const processedIds = new Set(queue.map((file) => file.id));
    state.files.compress = state.files.compress.filter((file) => !processedIds.has(file.id));
    renderFileList('compress');
    updateConvertButton('compress');
    resetCurrentConversionSession();
}

// =====================================================
// History
// =====================================================

function addToHistory(item) {
    state.history.unshift(item);

    // Keep only last 200 items
    if (state.history.length > 200) {
        state.history.pop();
    }

    // Save to file via IPC (persistent across reinstalls/updates)
    window.electronAPI.addToConversionHistory(item).catch(err => {
        console.error('Failed to persist history:', err);
    });

    renderHistory();
}

async function loadHistory() {
    try {
        // Load from file-persisted storage (main process)
        const saved = await window.electronAPI.getConversionHistory();
        if (saved && Array.isArray(saved) && saved.length > 0) {
            state.history = saved;
            renderHistory();
            return;
        }

        // Fallback: migrate from localStorage if exists
        const localSaved = localStorage.getItem('conversionHistory');
        if (localSaved) {
            state.history = JSON.parse(localSaved);
            // Migrate to file-persisted storage
            for (const item of state.history) {
                await window.electronAPI.addToConversionHistory(item);
            }
            // Remove old localStorage entry
            localStorage.removeItem('conversionHistory');
            renderHistory();
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function renderHistory() {
    if (!elements.historyList || !elements.historyEmpty) return;

    if (state.history.length === 0) {
        elements.historyEmpty.style.display = 'flex';
        elements.historyList.innerHTML = '';
        return;
    }

    elements.historyEmpty.style.display = 'none';
    elements.historyList.innerHTML = '';

    // Get active filter (if any)
    const activeFilter = document.querySelector('.history-filter-btn.active')?.dataset?.filter || 'all';

    const filteredHistory = activeFilter === 'all'
        ? state.history
        : state.history.filter(item => item.type === activeFilter);

    if (filteredHistory.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'history-filter-empty';
        emptyMsg.innerHTML = `<p>No ${activeFilter} conversions found</p>`;
        elements.historyList.appendChild(emptyMsg);
        return;
    }

    filteredHistory.forEach((item, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        const savedBytes = (item.inputSize || 0) - (item.outputSize || 0);
        const savedPercent = item.inputSize > 0 ? Math.round((savedBytes / item.inputSize) * 100) : 0;
        const savedInfo = savedBytes > 0
            ? `<span class="size-saved">↓ ${savedPercent}% smaller</span>`
            : savedBytes < 0
                ? `<span class="size-grew">↑ ${Math.abs(savedPercent)}% larger</span>`
                : '';

        historyItem.innerHTML = `
            <div class="file-icon ${item.type}">
                ${getFileIcon(item.type)}
            </div>
            <div class="file-info">
                <div class="file-name" title="${item.inputName || ''}">${item.inputName || 'Unknown file'}</div>
                <div class="file-meta">
                    <span class="file-size">${formatFileSize(item.inputSize || 0)} → ${formatFileSize(item.outputSize || 0)}</span>
                    ${savedInfo}
                </div>
            </div>
            <div class="history-item-actions">
                <span class="badge ${item.status === 'failed' ? 'error' : 'success'}">${formatTimeAgo(item.timestamp)}</span>
                ${item.outputPath ? `<button class="btn-icon open-folder" data-path="${item.outputPath}" title="Show in folder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                </button>` : ''}
                <button class="btn-icon remove-history" data-index="${index}" title="Remove from history">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `;

        const openBtn = historyItem.querySelector('.open-folder');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                window.electronAPI.openFolder(item.outputPath);
            });
        }

        const removeBtn = historyItem.querySelector('.remove-history');
        if (removeBtn) {
            removeBtn.addEventListener('click', async () => {
                state.history.splice(index, 1);
                // Re-save entire history
                await window.electronAPI.clearConversionHistory();
                for (const h of state.history) {
                    await window.electronAPI.addToConversionHistory(h);
                }
                renderHistory();
                showToast('Item removed from history', 'info');
            });
        }

        elements.historyList.appendChild(historyItem);
    });
}

// =====================================================
// History Controls (filter & clear)
// =====================================================

function setupHistoryControls() {
    // Filter buttons
    document.querySelectorAll('.history-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.history-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderHistory();
        });
    });

    // Clear all history button
    const clearBtn = document.getElementById('clear-history-btn');
    clearBtn?.addEventListener('click', async () => {
        if (state.history.length === 0) {
            showToast('History is already empty', 'info');
            return;
        }

        // Confirm before clearing
        const confirmed = confirm('Are you sure you want to clear all conversion history?');
        if (!confirmed) return;

        state.history = [];
        await window.electronAPI.clearConversionHistory();
        renderHistory();
        showToast('Conversion history cleared', 'success');
    });
}

// =====================================================
// Stats (file-persisted)
// =====================================================

async function loadStats() {
    try {
        const stats = await window.electronAPI.getConversionStats();
        if (stats && elements.totalConverted) {
            elements.totalConverted.textContent = stats.totalConverted || 0;
        }
        if (stats && elements.totalSaved) {
            elements.totalSaved.textContent = formatBytes(stats.totalSavedBytes || 0);
        }
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

async function updateStats(converted, spaceSavedBytes) {
    const current = parseInt(elements.totalConverted.textContent) || 0;
    const newTotal = current + converted;
    animateValue(elements.totalConverted, current, newTotal, 500);

    // Update space saved
    let currentSavedBytes = 0;
    try {
        const stats = await window.electronAPI.getConversionStats();
        currentSavedBytes = stats?.totalSavedBytes || 0;
    } catch (e) {}
    const newSavedBytes = currentSavedBytes + (spaceSavedBytes || 0);
    if (elements.totalSaved) {
        elements.totalSaved.textContent = formatBytes(newSavedBytes);
    }

    // Persist stats
    try {
        await window.electronAPI.saveConversionStats({
            totalConverted: newTotal,
            totalSavedBytes: newSavedBytes,
            lastUpdated: Date.now()
        });
    } catch (err) {
        console.error('Failed to save stats:', err);
    }
}

function formatBytes(bytes) {
    if (bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
    return `${val} ${units[i]}`;
}

function animateValue(element, start, end, duration) {
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const value = Math.floor(start + (end - start) * progress);
        element.textContent = value;

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

// =====================================================
// Toast Notifications
// =====================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    toast.innerHTML = `
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
    `;

    elements.toastContainer.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 5000);

    // Manual close
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    });
}

// =====================================================
// Utility Functions
// =====================================================

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    const intervals = [
        { label: 'year', seconds: 31536000 },
        { label: 'month', seconds: 2592000 },
        { label: 'day', seconds: 86400 },
        { label: 'hour', seconds: 3600 },
        { label: 'minute', seconds: 60 }
    ];

    for (const interval of intervals) {
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) {
            return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
        }
    }

    return 'Just now';
}

// =====================================================
// File Organizer
// =====================================================

let organizerState = {
    selectedFolder: null,
    preview: []
};

function setupOrganizer() {
    const selectFolderBtn = document.getElementById('select-organize-folder');
    const previewBtn = document.getElementById('preview-organize-btn');
    const organizeBtn = document.getElementById('organize-btn');
    const folderPathInput = document.getElementById('organize-folder-path');

    // Browse button
    selectFolderBtn?.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectOrganizeFolder();
        if (folder) {
            organizerState.selectedFolder = folder;
            folderPathInput.value = folder;
            await loadFolderStats(folder);
            previewBtn.disabled = false;
            organizeBtn.disabled = false;
        }
    });

    // Quick folder buttons (manual organizer only - those with data-folder attribute)
    document.querySelectorAll('.quick-folder-btn[data-folder]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const folderType = btn.dataset.folder;
            let folderPath;

            // Get user folders using electron API
            try {
                folderPath = await window.electronAPI.getUserPath(folderType === 'downloads' ? 'downloads' :
                    folderType === 'desktop' ? 'desktop' : 'documents');
            } catch (err) {
                console.error('Failed to get user path:', err);
                return;
            }

            if (folderPath) {
                organizerState.selectedFolder = folderPath;
                folderPathInput.value = folderPath;
                await loadFolderStats(folderPath);
                previewBtn.disabled = false;
                organizeBtn.disabled = false;
            }
        });
    });

    // Preview button
    previewBtn?.addEventListener('click', async () => {
        if (!organizerState.selectedFolder) return;

        try {
            organizerState.preview = await window.electronAPI.previewOrganization(organizerState.selectedFolder);
            renderPreview();
        } catch (err) {
            console.error('Preview error:', err);
            showToast('Failed to preview organization', 'error');
        }
    });

    // Organize button
    organizeBtn?.addEventListener('click', async () => {
        if (!organizerState.selectedFolder) return;

        if (!confirm('Are you sure you want to organize this folder? Files will be moved to subfolders.')) {
            return;
        }

        organizeBtn.disabled = true;
        organizeBtn.innerHTML = '<span class="spinner"></span> Organizing...';

        try {
            const result = await window.electronAPI.organizeFolder({
                folderPath: organizerState.selectedFolder,
                customMappings: {}
            });

            const successCount = result.success.length;
            const failedCount = result.failed.length;
            const skippedCount = result.skipped.length;

            showToast(`Organized ${successCount} files. Skipped ${skippedCount}, Failed ${failedCount}`,
                failedCount > 0 ? 'warning' : 'success');

            // Refresh stats
            await loadFolderStats(organizerState.selectedFolder);
            organizerState.preview = [];
            document.getElementById('file-preview-container').style.display = 'none';

            if (state.settings.showNotifications) {
                window.electronAPI.showNotification(
                    'Files Organized',
                    `${successCount} files organized successfully`
                );
            }
        } catch (err) {
            console.error('Organize error:', err);
            showToast('Failed to organize files', 'error');
        } finally {
            organizeBtn.disabled = false;
            organizeBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    <polyline points="12,11 12,17"/>
                    <polyline points="9,14 12,17 15,14"/>
                </svg>
                Organize Files
            `;
        }
    });

    // Listen for organize progress
    window.electronAPI.onOrganizeProgress?.((progress) => {
        // Could update a progress bar here
        console.log('Organize progress:', progress);
    });
}

async function loadFolderStats(folderPath) {
    try {
        const stats = await window.electronAPI.getFolderStats(folderPath);
        if (stats) {
            document.getElementById('folder-stats').style.display = 'grid';
            document.getElementById('org-total-files').textContent = stats.totalFiles;
            document.getElementById('org-total-size').textContent = formatFileSize(stats.totalSize);
            document.getElementById('org-file-types').textContent = Object.keys(stats.byType).length;
        }
    } catch (err) {
        console.error('Failed to load folder stats:', err);
    }
}

function renderPreview() {
    const container = document.getElementById('file-preview-container');
    const list = document.getElementById('file-preview-list');

    if (organizerState.preview.length === 0) {
        container.style.display = 'none';
        showToast('No files to organize in this folder', 'info');
        return;
    }

    container.style.display = 'block';
    list.innerHTML = '';

    // Show max 20 files in preview
    const previewItems = organizerState.preview.slice(0, 20);

    previewItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `
            <span class="file-name">${item.fileName}</span>
            <span class="target-folder">→ ${item.targetFolder}</span>
        `;
        list.appendChild(div);
    });

    if (organizerState.preview.length > 20) {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'preview-item';
        moreDiv.innerHTML = `<span class="file-name" style="color: var(--text-muted)">... and ${organizerState.preview.length - 20} more files</span>`;
        list.appendChild(moreDiv);
    }
}

// =====================================================
// Auto-Organizer
// =====================================================

let autoOrganizerState = {
    enabled: false,
    watchFolder: '',
    filesOrganized: 0,
    lastAction: null,
    activityLog: []
};

function setupAutoOrganizer() {
    const enableToggle = document.getElementById('auto-org-enabled');
    const selectFolderBtn = document.getElementById('select-auto-org-folder');
    const folderPathInput = document.getElementById('auto-org-folder-path');
    const statusText = document.getElementById('auto-org-status');
    const goToSettingsBtn = document.getElementById('go-to-settings-btn');
    const statsContainer = document.getElementById('auto-org-stats');
    const activityContainer = document.getElementById('auto-org-activity');

    // Load saved auto-organizer settings
    loadAutoOrganizerSettings();

    // Go to settings button
    goToSettingsBtn?.addEventListener('click', () => {
        navigateTo('settings');
    });

    // Enable/Disable toggle
    enableToggle?.addEventListener('change', async () => {
        const enabled = enableToggle.checked;

        // Check if minimize to tray is enabled
        if (enabled && !state.settings.minimizeToTray) {
            enableToggle.checked = false;
            showToast('Please enable "Minimize to Tray" in Settings first', 'warning');
            return;
        }

        // Check if folder is selected
        if (enabled && !autoOrganizerState.watchFolder) {
            enableToggle.checked = false;
            showToast('Please select a folder to watch first', 'warning');
            return;
        }

        autoOrganizerState.enabled = enabled;
        statusText.textContent = enabled ? 'Active' : 'Disabled';
        statusText.style.color = enabled ? '#10b981' : 'var(--text-tertiary)';

        // Show/hide stats and activity
        statsContainer.style.display = enabled ? 'grid' : 'none';
        activityContainer.style.display = enabled ? 'block' : 'none';

        // Save settings and start/stop watcher
        await saveAutoOrganizerSettings();

        if (enabled) {
            await window.electronAPI.startAutoOrganizer(autoOrganizerState.watchFolder);
            showToast('Auto-Organizer started', 'success');
            addActivity('🟢', 'Auto-Organizer started');
        } else {
            await window.electronAPI.stopAutoOrganizer();
            showToast('Auto-Organizer stopped', 'info');
            addActivity('🔴', 'Auto-Organizer stopped');
        }
    });

    // Browse folder button
    selectFolderBtn?.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectOrganizeFolder();
        if (folder) {
            autoOrganizerState.watchFolder = folder;
            folderPathInput.value = folder;
            await saveAutoOrganizerSettings();
        }
    });

    // Quick folder buttons for auto-organizer
    document.querySelectorAll('[data-auto-folder]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const folderType = btn.dataset.autoFolder;
            let folderPath;

            try {
                folderPath = await window.electronAPI.getUserPath(
                    folderType === 'downloads' ? 'downloads' :
                        folderType === 'desktop' ? 'desktop' : 'documents'
                );
            } catch (err) {
                console.error('Failed to get user path:', err);
                return;
            }

            if (folderPath) {
                autoOrganizerState.watchFolder = folderPath;
                folderPathInput.value = folderPath;
                await saveAutoOrganizerSettings();
            }
        });
    });

    // Listen for auto-organize events
    window.electronAPI.onAutoOrganizeFile?.((data) => {
        autoOrganizerState.filesOrganized++;
        autoOrganizerState.lastAction = new Date().toLocaleTimeString();

        // Update stats
        document.getElementById('auto-org-files-organized').textContent = autoOrganizerState.filesOrganized;
        document.getElementById('auto-org-last-action').textContent = autoOrganizerState.lastAction;

        // Add to activity log
        const icon = data.success ? '✅' : '❌';
        const message = data.success ?
            `Organized: ${data.fileName} → ${data.targetFolder}` :
            `Failed: ${data.fileName} - ${data.error}`;
        addActivity(icon, message);

        // Save stats
        saveAutoOrganizerSettings();
    });
}

function addActivity(icon, message) {
    const activityList = document.getElementById('auto-org-activity-list');
    if (!activityList) return;

    // Remove empty message if exists
    const emptyMsg = activityList.querySelector('.activity-empty');
    if (emptyMsg) emptyMsg.remove();

    // Create activity item
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
        <span class="activity-icon">${icon}</span>
        <span class="activity-text">${message}</span>
        <span class="activity-time">${new Date().toLocaleTimeString()}</span>
    `;

    // Add to top of list
    activityList.insertBefore(item, activityList.firstChild);

    // Keep only last 10 items
    while (activityList.children.length > 10) {
        activityList.removeChild(activityList.lastChild);
    }

    // Store in state
    autoOrganizerState.activityLog.unshift({
        icon,
        message,
        time: new Date().toISOString()
    });
    if (autoOrganizerState.activityLog.length > 10) {
        autoOrganizerState.activityLog.pop();
    }
}

async function loadAutoOrganizerSettings() {
    try {
        const settings = await window.electronAPI.getAutoOrganizerSettings();
        if (settings) {
            autoOrganizerState = { ...autoOrganizerState, ...settings };

            // Update UI
            const enableToggle = document.getElementById('auto-org-enabled');
            const folderPathInput = document.getElementById('auto-org-folder-path');
            const statusText = document.getElementById('auto-org-status');
            const statsContainer = document.getElementById('auto-org-stats');
            const activityContainer = document.getElementById('auto-org-activity');

            if (enableToggle) enableToggle.checked = autoOrganizerState.enabled;
            if (folderPathInput) folderPathInput.value = autoOrganizerState.watchFolder || '';
            if (statusText) {
                statusText.textContent = autoOrganizerState.enabled ? 'Active' : 'Disabled';
                statusText.style.color = autoOrganizerState.enabled ? '#10b981' : 'var(--text-tertiary)';
            }

            // Show/hide stats and activity
            if (statsContainer) statsContainer.style.display = autoOrganizerState.enabled ? 'grid' : 'none';
            if (activityContainer) activityContainer.style.display = autoOrganizerState.enabled ? 'block' : 'none';

            // Update stats
            document.getElementById('auto-org-files-organized').textContent = autoOrganizerState.filesOrganized || 0;
            document.getElementById('auto-org-last-action').textContent = autoOrganizerState.lastAction || 'Never';

            // Restore activity log
            if (autoOrganizerState.activityLog && autoOrganizerState.activityLog.length > 0) {
                const activityList = document.getElementById('auto-org-activity-list');
                if (activityList) {
                    activityList.innerHTML = '';
                    autoOrganizerState.activityLog.forEach(activity => {
                        const item = document.createElement('div');
                        item.className = 'activity-item';
                        const time = new Date(activity.time).toLocaleTimeString();
                        item.innerHTML = `
                            <span class="activity-icon">${activity.icon}</span>
                            <span class="activity-text">${activity.message}</span>
                            <span class="activity-time">${time}</span>
                        `;
                        activityList.appendChild(item);
                    });
                }
            }
        }
    } catch (err) {
        console.error('Failed to load auto-organizer settings:', err);
    }
}

async function saveAutoOrganizerSettings() {
    try {
        await window.electronAPI.saveAutoOrganizerSettings(autoOrganizerState);
    } catch (err) {
        console.error('Failed to save auto-organizer settings:', err);
    }
}

// =====================================================
// Video/Audio Downloader
// =====================================================

let downloadState = {
    videoInfo: null,
    format: 'video', // 'video' or 'audio'
    quality: 'best',
    audioBitrate: '320',
    downloading: false,
    downloadSubtitles: false,
    downloadThumbnail: false,
    subtitleLanguage: 'en'
};

function setupDownloader() {
    const urlInput = document.getElementById('download-url');
    const fetchBtn = document.getElementById('fetch-info-btn');
    const downloadBtn = document.getElementById('download-btn');
    const clearUrlBtn = document.getElementById('clear-url-btn');
    const pasteUrlBtn = document.getElementById('paste-url-btn');
    const formatBtns = document.querySelectorAll('#download-formats .format-btn');
    const qualitySelect = document.getElementById('quality-select');
    const qualityGroup = document.getElementById('quality-group');
    const audioBitrateSelect = document.getElementById('audio-bitrate-select');
    const audioBitrateGroup = document.getElementById('audio-bitrate-group');

    // Clear URL button
    clearUrlBtn?.addEventListener('click', async () => {
        // Cancel any ongoing download first
        if (downloadState.downloading) {
            await window.electronAPI.cancelDownload();
            downloadState.downloading = false;
            downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';
        }

        // Clear the input and hide preview
        urlInput.value = '';
        downloadState.videoInfo = null;
        const previewSection = document.getElementById('video-preview-section');
        if (previewSection) previewSection.style.display = 'none';
        const progressContainer = document.getElementById('download-progress');
        if (progressContainer) progressContainer.style.display = 'none';
        showToast('Cleared', 'info');
    });

    // Paste URL button
    pasteUrlBtn?.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                // Cancel any ongoing download first
                if (downloadState.downloading) {
                    await window.electronAPI.cancelDownload();
                    downloadState.downloading = false;
                    downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';
                }

                urlInput.value = text;
                downloadState.videoInfo = null;
                const previewSection = document.getElementById('video-preview-section');
                if (previewSection) previewSection.style.display = 'none';
                showToast('URL pasted', 'info');
            }
        } catch (err) {
            showToast('Could not paste from clipboard', 'error');
        }
    });

    // Fetch video info
    fetchBtn?.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showToast('Please enter a URL', 'error');
            return;
        }

        // Cancel any ongoing download first
        if (downloadState.downloading) {
            await window.electronAPI.cancelDownload();
            downloadState.downloading = false;
            downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';
            const progressContainer = document.getElementById('download-progress');
            if (progressContainer) progressContainer.style.display = 'none';
        }

        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg><span>Fetching...</span>';

        try {
            const info = await window.electronAPI.getVideoInfo(url);
            console.log('Received video info:', info);
            console.log('Thumbnail in info:', info.thumbnail ? 'present (' + info.thumbnail.substring(0, 30) + '...)' : 'missing');
            downloadState.videoInfo = info;
            displayVideoInfo(info);
            showToast('Video info fetched!', 'success');
        } catch (err) {
            showToast(err.message || 'Failed to fetch video info', 'error');
            console.error('Fetch error:', err);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><span>Fetch Info</span>';
        }
    });

    // Format selection
    formatBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            formatBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            downloadState.format = btn.dataset.format;

            // Show/hide quality selector for video, bitrate for audio
            const isAudioFormat = downloadState.format === 'audio' || downloadState.format === 'audio-flac';
            if (isAudioFormat) {
                qualityGroup.style.display = 'none';
                audioBitrateGroup.style.display = downloadState.format === 'audio' ? 'flex' : 'none';
            } else {
                qualityGroup.style.display = 'flex';
                audioBitrateGroup.style.display = 'none';
            }

            // Update size estimate
            updateSizeEstimate();
        });
    });

    // Quality selection
    qualitySelect?.addEventListener('change', () => {
        downloadState.quality = qualitySelect.value;
        updateSizeEstimate();
    });

    // Audio bitrate selection
    audioBitrateSelect?.addEventListener('change', () => {
        downloadState.audioBitrate = audioBitrateSelect.value;
        updateSizeEstimate();
    });

    // Subtitle checkbox
    const subtitleCheckbox = document.getElementById('download-subtitles');
    const subtitleOptions = document.getElementById('subtitle-options');
    const subtitleLangSelect = document.getElementById('subtitle-language');

    subtitleCheckbox?.addEventListener('change', () => {
        downloadState.downloadSubtitles = subtitleCheckbox.checked;
        if (subtitleOptions) {
            subtitleOptions.style.display = subtitleCheckbox.checked ? 'flex' : 'none';
        }
    });

    subtitleLangSelect?.addEventListener('change', () => {
        downloadState.subtitleLanguage = subtitleLangSelect.value;
    });

    // Thumbnail checkbox
    const thumbnailCheckbox = document.getElementById('download-thumbnail');
    thumbnailCheckbox?.addEventListener('change', () => {
        downloadState.downloadThumbnail = thumbnailCheckbox.checked;
    });

    // Download button
    downloadBtn?.addEventListener('click', async () => {
        if (!downloadState.videoInfo) {
            showToast('Please fetch video info first', 'error');
            return;
        }

        if (downloadState.downloading) {
            // Cancel download
            await window.electronAPI.cancelDownload();
            downloadState.downloading = false;
            downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';

            // Reset progress UI
            const progressContainer = document.getElementById('download-progress');
            const progressFill = document.getElementById('download-progress-fill');
            const progressText = document.getElementById('download-progress-text');
            const progressPhase = document.getElementById('download-phase');

            if (progressContainer) progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            if (progressText) progressText.textContent = '0%';
            if (progressPhase) progressPhase.textContent = '';

            // Update Download Manager
            updateDownloadManagerUI(null);
            showToast('Download cancelled', 'info');
            return;
        }

        downloadState.downloading = true;
        downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg> Cancel';

        const progressContainer = document.getElementById('download-progress');
        const progressFill = document.getElementById('download-progress-fill');
        const progressText = document.getElementById('download-progress-text');

        progressContainer.style.display = 'flex';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';

        // Update Download Manager UI
        updateDownloadManagerUI({
            title: downloadState.videoInfo.title,
            thumbnail: downloadState.videoInfo.thumbnail,
            format: downloadState.format,
            quality: downloadState.quality
        });

        try {
            // Determine format parameters
            const isAudioFormat = downloadState.format === 'audio' || downloadState.format === 'audio-flac';
            let dlFormat = 'mp4';
            if (downloadState.format === 'audio') dlFormat = 'mp3';
            else if (downloadState.format === 'audio-flac') dlFormat = 'flac';
            else if (downloadState.format === 'webm') dlFormat = 'webm';

            const result = await window.electronAPI.downloadMedia({
                url: downloadState.videoInfo.url,
                format: dlFormat,
                quality: downloadState.quality,
                audioBitrate: downloadState.audioBitrate,
                audioOnly: isAudioFormat,
                downloadSubtitles: downloadState.downloadSubtitles || false,
                downloadThumbnail: downloadState.downloadThumbnail || false,
                subtitleLanguage: downloadState.subtitleLanguage || 'en'
            });

            if (result.success) {
                let successMsg = 'Download complete!';
                const extras = [];
                if (result.subtitleFiles && result.subtitleFiles.length > 0) {
                    extras.push(`${result.subtitleFiles.length} subtitle(s)`);
                }
                if (result.thumbnailFile) {
                    extras.push('thumbnail');
                }
                if (extras.length > 0) {
                    successMsg += ` +${extras.join(', ')}`;
                }
                showToast(successMsg, 'success');
                playSound('success');

                // Add to download history
                addToDownloadHistory({
                    title: downloadState.videoInfo.title,
                    format: downloadState.format,
                    quality: downloadState.quality,
                    size: result.outputSize
                }, true);

                if (state.settings.showNotifications) {
                    window.electronAPI.showNotification(
                        'Download Complete',
                        `${downloadState.videoInfo.title} has been downloaded`
                    );
                }

                // Show "Open File Location" button
                const statusDiv = document.getElementById('download-status');
                if (statusDiv && result.outputPath) {
                    statusDiv.className = 'downloader-status success';
                    statusDiv.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
                        <span>Download complete!</span>
                        <button class="btn-open-location" id="download-open-location" title="Open file location">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            Open Location
                        </button>
                    `;
                    document.getElementById('download-open-location')?.addEventListener('click', () => {
                        window.electronAPI.openFolder(result.outputPath);
                    });
                }
            }
        } catch (err) {
            showToast(err.message || 'Download failed', 'error');
            playSound('failed');

            // Add failed download to history
            addToDownloadHistory({
                title: downloadState.videoInfo?.title || 'Unknown',
                format: downloadState.format,
                quality: downloadState.quality
            }, false);
        } finally {
            downloadState.downloading = false;
            downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';

            // Update Download Manager
            updateDownloadManagerUI(null);

            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 2000);
        }
    });

    // Listen for download progress
    window.electronAPI.onDownloadProgress?.((data) => {
        const progressFill = document.getElementById('download-progress-fill');
        const progressText = document.getElementById('download-progress-text');
        const progressPhase = document.getElementById('download-phase');

        // Handle both object and number formats
        const progress = typeof data === 'object' ? data.progress : data;
        const phase = typeof data === 'object' ? data.phase : '';

        if (progressFill && progressText) {
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `${Math.round(progress)}%`;
        }

        // Update phase indicator
        if (progressPhase) {
            if (phase === 'video') {
                progressPhase.textContent = '📹 Downloading video...';
            } else if (phase === 'audio') {
                progressPhase.textContent = '🎵 Downloading audio...';
            } else if (phase === 'merge') {
                progressPhase.textContent = '🔄 Merging streams...';
            } else if (phase === 'complete') {
                progressPhase.textContent = '✅ Complete!';
            } else {
                progressPhase.textContent = 'Downloading...';
            }
        }

        // Also update Download Manager
        if (typeof data === 'object') {
            updateDownloadManagerProgress(data);
        } else {
            updateDownloadManagerProgress({ progress });
        }
    });

    // Check downloader availability
    checkDownloaderStatus();
}

async function checkDownloaderStatus() {
    const statusDiv = document.getElementById('downloader-status');
    if (!statusDiv) return;

    // Show loading state first
    statusDiv.className = 'downloader-status loading';
    statusDiv.innerHTML = `
        <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
        </svg>
        <span>Checking yt-dlp...</span>
    `;

    try {
        const available = await window.electronAPI.checkDownloaderAvailable();
        if (available) {
            statusDiv.className = 'downloader-status success';
            statusDiv.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="m9 12 2 2 4-4"/>
                </svg>
                <span>Ready to download</span>
            `;
        } else {
            statusDiv.className = 'downloader-status warning';
            statusDiv.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4"/>
                    <path d="M12 16h.01"/>
                </svg>
                <span>yt-dlp will be downloaded on first use</span>
            `;
        }
    } catch (err) {
        console.error('Downloader check failed:', err);
        statusDiv.className = 'downloader-status error';
        statusDiv.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="m15 9-6 6"/>
                <path d="m9 9 6 6"/>
            </svg>
            <span>Failed to check downloader status</span>
        `;
    }
}

// =====================================================
// Playlist Downloader
// =====================================================

let playlistState = {
    info: null,
    entries: [],
    selected: new Set(),
    format: 'video',
    quality: 'best',
    audioBitrate: '320',
    downloading: false,
    currentIndex: 0,
    totalSelected: 0
};

function setupPlaylist() {
    // Mode toggle
    const modeSingleBtn = document.getElementById('mode-single');
    const modePlaylistBtn = document.getElementById('mode-playlist');
    const modeSpotifyBtn = document.getElementById('mode-spotify');
    const singlePanel = document.getElementById('single-download-panel');
    const playlistPanel = document.getElementById('playlist-download-panel');
    const spotifyPanel = document.getElementById('spotify-download-panel');

    function setMode(mode) {
        modeSingleBtn?.classList.toggle('active', mode === 'single');
        modePlaylistBtn?.classList.toggle('active', mode === 'playlist');
        modeSpotifyBtn?.classList.toggle('active', mode === 'spotify');
        if (singlePanel) singlePanel.style.display = mode === 'single' ? '' : 'none';
        if (playlistPanel) playlistPanel.style.display = mode === 'playlist' ? '' : 'none';
        if (spotifyPanel) spotifyPanel.style.display = mode === 'spotify' ? '' : 'none';
    }

    modeSingleBtn?.addEventListener('click', () => setMode('single'));
    modePlaylistBtn?.addEventListener('click', () => setMode('playlist'));
    modeSpotifyBtn?.addEventListener('click', () => setMode('spotify'));

    // Fetch playlist
    const fetchPlaylistBtn = document.getElementById('fetch-playlist-btn');
    const playlistUrlInput = document.getElementById('playlist-url');

    fetchPlaylistBtn?.addEventListener('click', async () => {
        const url = playlistUrlInput.value.trim();
        if (!url) {
            showToast('Please enter a playlist URL', 'error');
            return;
        }

        fetchPlaylistBtn.disabled = true;
        fetchPlaylistBtn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg><span>Fetching...</span>';

        const statusDiv = document.getElementById('playlist-status');
        if (statusDiv) {
            statusDiv.className = 'downloader-status loading';
            statusDiv.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg><span>Fetching playlist info...</span>';
        }

        try {
            const info = await window.electronAPI.getPlaylistInfo(url);
            playlistState.info = info;
            playlistState.entries = info.entries || [];
            playlistState.selected = new Set(playlistState.entries.map((_, i) => i));
            displayPlaylistInfo(info);
            showToast(`Playlist loaded: ${info.count} videos`, 'success');

            if (statusDiv) {
                statusDiv.className = 'downloader-status success';
                statusDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg><span>Playlist ready - ${info.count} videos</span>`;
            }
        } catch (err) {
            showToast(err.message || 'Failed to fetch playlist', 'error');
            if (statusDiv) {
                statusDiv.className = 'downloader-status error';
                statusDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>${err.message || 'Failed to fetch playlist'}</span>`;
            }
        } finally {
            fetchPlaylistBtn.disabled = false;
            fetchPlaylistBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><span>Fetch Playlist</span>';
        }
    });

    // Playlist format buttons
    const playlistFormatBtns = document.querySelectorAll('#playlist-formats .format-btn');
    const playlistQualityGroup = document.getElementById('playlist-quality-group');
    const playlistBitrateGroup = document.getElementById('playlist-bitrate-group');

    playlistFormatBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            playlistFormatBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            playlistState.format = btn.dataset.format;
            const isAudio = playlistState.format === 'audio' || playlistState.format === 'audio-flac';
            if (playlistQualityGroup) playlistQualityGroup.style.display = isAudio ? 'none' : 'flex';
            if (playlistBitrateGroup) playlistBitrateGroup.style.display = playlistState.format === 'audio' ? 'flex' : 'none';
        });
    });

    document.getElementById('playlist-quality-select')?.addEventListener('change', (e) => {
        playlistState.quality = e.target.value;
    });

    document.getElementById('playlist-bitrate-select')?.addEventListener('change', (e) => {
        playlistState.audioBitrate = e.target.value;
    });

    // Select/Deselect all
    document.getElementById('playlist-select-all')?.addEventListener('click', () => {
        playlistState.selected = new Set(playlistState.entries.map((_, i) => i));
        updatePlaylistCheckboxes();
        updatePlaylistDownloadBtn();
    });

    document.getElementById('playlist-deselect-all')?.addEventListener('click', () => {
        playlistState.selected.clear();
        updatePlaylistCheckboxes();
        updatePlaylistDownloadBtn();
    });

    // Download playlist button
    const downloadPlaylistBtn = document.getElementById('download-playlist-btn');
    downloadPlaylistBtn?.addEventListener('click', () => {
        if (playlistState.downloading) {
            playlistState.downloading = false;
            downloadPlaylistBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Selected';
            window.electronAPI.cancelDownload();
            showToast('Playlist download cancelled', 'info');
            return;
        }
        downloadPlaylist();
    });
}

function displayPlaylistInfo(info) {
    const section = document.getElementById('playlist-info-section');
    const titleEl = document.getElementById('playlist-title');
    const countEl = document.getElementById('playlist-count');
    const entriesEl = document.getElementById('playlist-entries');

    if (titleEl) titleEl.textContent = info.title || 'Untitled Playlist';
    if (countEl) countEl.textContent = `${info.count} videos`;

    if (entriesEl) {
        entriesEl.innerHTML = info.entries.map((entry, i) => {
            const duration = entry.duration ? formatDuration(entry.duration) : '--:--';
            const thumbUrl = entry.thumbnail || '';
            const thumbHtml = thumbUrl
                ? `<img class="playlist-entry-thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="playlist-entry-thumb-fallback" style="display:none"><span>${i + 1}</span></div>`
                : `<div class="playlist-entry-thumb-fallback"><span>${i + 1}</span></div>`;
            return `
                <div class="playlist-entry ${playlistState.selected.has(i) ? 'selected' : ''}" data-index="${i}">
                    ${thumbHtml}
                    <div class="playlist-entry-info">
                        <span class="playlist-entry-title">${escapeHtml(entry.title || 'Unknown')}</span>
                        <span class="playlist-entry-meta">${escapeHtml(entry.uploader || '')} · ${duration}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Click to toggle selection
        entriesEl.querySelectorAll('.playlist-entry').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index);
                if (playlistState.selected.has(idx)) {
                    playlistState.selected.delete(idx);
                    el.classList.remove('selected');
                } else {
                    playlistState.selected.add(idx);
                    el.classList.add('selected');
                }
                updatePlaylistDownloadBtn();
            });
        });
    }

    if (section) section.style.display = '';
    updatePlaylistDownloadBtn();
}

function updatePlaylistCheckboxes() {
    const entriesEl = document.getElementById('playlist-entries');
    if (!entriesEl) return;
    entriesEl.querySelectorAll('.playlist-entry').forEach(el => {
        const idx = parseInt(el.dataset.index);
        if (playlistState.selected.has(idx)) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });
}

function updatePlaylistDownloadBtn() {
    const btn = document.getElementById('download-playlist-btn');
    if (!btn) return;
    const count = playlistState.selected.size;
    btn.disabled = count === 0;
    if (!playlistState.downloading) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Selected (${count})`;
    }
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function downloadPlaylist() {
    const selected = Array.from(playlistState.selected).sort((a, b) => a - b);
    if (selected.length === 0) return;

    playlistState.downloading = true;
    playlistState.totalSelected = selected.length;
    playlistState.currentIndex = 0;

    const downloadBtn = document.getElementById('download-playlist-btn');
    const progressContainer = document.getElementById('playlist-progress');
    const progressFill = document.getElementById('playlist-progress-fill');
    const progressText = document.getElementById('playlist-progress-text');
    const progressPhase = document.getElementById('playlist-phase');
    const currentItem = document.getElementById('playlist-current-item');

    if (downloadBtn) {
        downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg> Cancel';
    }

    if (progressContainer) progressContainer.style.display = 'flex';

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < selected.length; i++) {
        if (!playlistState.downloading) break;

        const entry = playlistState.entries[selected[i]];
        playlistState.currentIndex = i + 1;

        // Update progress
        const overallPct = Math.round((i / selected.length) * 100);
        if (progressFill) progressFill.style.width = `${overallPct}%`;
        if (progressText) progressText.textContent = `${i + 1}/${selected.length}`;
        if (progressPhase) progressPhase.textContent = `Downloading ${i + 1} of ${selected.length}`;
        if (currentItem) currentItem.textContent = entry.title || `Video ${selected[i] + 1}`;

        // Mark entry as downloading
        const entryEl = document.querySelector(`.playlist-entry[data-index="${selected[i]}"]`);
        if (entryEl) entryEl.classList.add('downloading');

        try {
            const isAudioFormat = playlistState.format === 'audio' || playlistState.format === 'audio-flac';
            let dlFormat = 'mp4';
            if (playlistState.format === 'audio') dlFormat = 'mp3';
            else if (playlistState.format === 'audio-flac') dlFormat = 'flac';

            const videoUrl = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;

            const result = await window.electronAPI.downloadMedia({
                url: videoUrl,
                format: dlFormat,
                quality: playlistState.quality,
                audioBitrate: playlistState.audioBitrate,
                audioOnly: isAudioFormat,
                downloadSubtitles: false,
                downloadThumbnail: false,
                subtitleLanguage: 'en'
            });

            // Only count as completed if we got a valid result
            if (result && result.success !== false) {
                completed++;
                if (entryEl) {
                    entryEl.classList.remove('downloading');
                    entryEl.classList.add('completed');
                }
            } else {
                failed++;
                if (entryEl) {
                    entryEl.classList.remove('downloading');
                    entryEl.classList.add('failed');
                }
            }
        } catch (err) {
            failed++;
            console.error(`Failed to download ${entry.title}:`, err);
            if (entryEl) {
                entryEl.classList.remove('downloading');
                entryEl.classList.add('failed');
            }
        }

        // Small delay between downloads to avoid yt-dlp race conditions
        if (i < selected.length - 1 && playlistState.downloading) {
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    // Finish
    playlistState.downloading = false;

    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = `${completed + failed}/${selected.length}`;
    if (progressPhase) progressPhase.textContent = playlistState.downloading === false ? 'Complete!' : 'Cancelled';
    if (currentItem) currentItem.textContent = '';

    if (downloadBtn) {
        downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Selected';
        downloadBtn.disabled = false;
    }

    const statusDiv = document.getElementById('playlist-status');
    if (failed > 0) {
        showToast(`Playlist: ${completed} downloaded, ${failed} failed`, 'warning');
        if (statusDiv) {
            statusDiv.className = 'downloader-status warning';
            statusDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg><span>${completed} downloaded, ${failed} failed</span>`;
        }
    } else if (completed > 0) {
        showToast(`Playlist download complete! ${completed} files`, 'success');
        playSound('success');
        if (statusDiv) {
            statusDiv.className = 'downloader-status success';
            statusDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg><span>All ${completed} videos downloaded!</span>
                <button class="btn-open-location" id="playlist-open-location" title="Open download folder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    Open Location
                </button>`;
            document.getElementById('playlist-open-location')?.addEventListener('click', () => {
                if (state.settings.outputDirectory) {
                    window.electronAPI.openFolder(state.settings.outputDirectory);
                }
            });
        }
        if (state.settings.showNotifications) {
            window.electronAPI.showNotification('Playlist Complete', `${completed} videos downloaded successfully`);
        }
    }

    setTimeout(() => {
        if (progressContainer) progressContainer.style.display = 'none';
    }, 3000);
}

// =====================================================
// Spotify / SpotiFLAC Integration
// =====================================================

let spotifyState = {
    selectedTrack: null,
    selectedTracks: [],
    allTracks: [],
    service: 'tidal',
    quality: 'LOSSLESS',
    downloading: false,
    searchResults: null,
    collectionType: null, // 'track', 'album', 'playlist'
    selected: new Set()
};

function setupSpotify() {
    const searchInput = document.getElementById('spotify-search-input');
    const searchBtn = document.getElementById('spotify-search-btn');
    const resultsSection = document.getElementById('spotify-results-section');
    const resultsList = document.getElementById('spotify-results-list');
    const trackInfoSection = document.getElementById('spotify-track-info');
    const tracklistSection = document.getElementById('spotify-tracklist-section');
    const downloadBtn = document.getElementById('spotify-download-btn');
    const progressContainer = document.getElementById('spotify-progress');
    const statusDiv = document.getElementById('spotify-status');

    // Search
    searchBtn?.addEventListener('click', () => performSpotifySearch());
    searchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSpotifySearch();
    });

    async function performSpotifySearch() {
        const query = searchInput?.value?.trim();
        if (!query) {
            showToast('Please enter a search query or Spotify URL', 'error');
            return;
        }

        searchBtn.disabled = true;
        searchBtn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg><span>Searching...</span>';
        updateSpotifyStatus('loading', 'Searching Spotify...');

        try {
            // Check if it's a Spotify URL
            const isURL = query.includes('spotify.com/') || query.startsWith('spotify:');

            if (isURL) {
                const data = await window.electronAPI.spotifyGetMetadata(query);
                handleSpotifyMetadata(data, query);
            } else {
                const data = await window.electronAPI.spotifySearch(query, 20);
                spotifyState.searchResults = data;
                displaySpotifySearchResults(data);
            }
        } catch (err) {
            showToast(err.message || 'Spotify search failed', 'error');
            updateSpotifyStatus('error', err.message || 'Search failed');
        } finally {
            searchBtn.disabled = false;
            searchBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><span>Search</span>';
        }
    }

    function handleSpotifyMetadata(data, url) {
        // Determine type from URL
        if (url.includes('/track/') || url.includes('spotify:track:') || data.track) {
            // Single track
            const track = data.track || data;
            spotifyState.collectionType = 'track';
            spotifyState.selectedTrack = track;
            spotifyState.allTracks = [track];
            spotifyState.selected = new Set([0]);
            displaySpotifyTrackInfo(track);
            if (tracklistSection) tracklistSection.style.display = 'none';
            if (resultsSection) resultsSection.style.display = 'none';
            if (downloadBtn) downloadBtn.disabled = false;
            updateSpotifyStatus('success', `Track loaded: ${track.name}`);
        } else if (data.tracks && Array.isArray(data.tracks)) {
            // Album or playlist
            spotifyState.collectionType = url.includes('/album/') || url.includes('spotify:album:') ? 'album' : 'playlist';
            spotifyState.allTracks = data.tracks;
            spotifyState.selected = new Set(data.tracks.map((_, i) => i));
            displaySpotifyCollection(data);
            if (trackInfoSection) trackInfoSection.style.display = 'none';
            if (resultsSection) resultsSection.style.display = 'none';
            if (downloadBtn) downloadBtn.disabled = false;
            updateSpotifyStatus('success', `${data.name}: ${data.tracks.length} tracks`);
        }
    }

    function displaySpotifySearchResults(data) {
        if (!data || !data.results) return;

        if (resultsSection) resultsSection.style.display = '';
        if (trackInfoSection) trackInfoSection.style.display = 'none';
        if (tracklistSection) tracklistSection.style.display = 'none';

        // Setup tabs
        const tabs = document.querySelectorAll('.spotify-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderSpotifyTab(tab.dataset.tab, data.results);
            });
        });

        // Show tracks by default
        renderSpotifyTab('tracks', data.results);
        updateSpotifyStatus('success', `Found ${data.totalResults.tracks} tracks, ${data.totalResults.albums} albums`);
    }

    function renderSpotifyTab(tab, results) {
        if (!resultsList) return;
        resultsList.innerHTML = '';

        const items = results[tab] || [];
        if (items.length === 0) {
            resultsList.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
            return;
        }

        items.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = 'spotify-result-item';
            el.dataset.index = idx;
            el.dataset.type = tab;

            const coverUrl = item.cover || '';
            const coverHTML = coverUrl
                ? `<img src="${coverUrl}" class="spotify-result-cover" alt="">`
                : `<div class="spotify-result-cover no-cover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;

            const typeSingular = tab.replace(/s$/, '');

            if (tab === 'tracks') {
                el.innerHTML = `
                    ${coverHTML}
                    <div class="spotify-result-info">
                        <div class="spotify-result-name">${escapeHtml(item.name)}${item.is_explicit ? ' <span class="explicit-badge">E</span>' : ''}</div>
                        <div class="spotify-result-sub">${escapeHtml(item.artists)} &middot; ${escapeHtml(item.album || '')}</div>
                    </div>
                    <div class="spotify-result-duration">${item.duration || ''}</div>
                `;
            } else if (tab === 'albums') {
                el.innerHTML = `
                    ${coverHTML}
                    <div class="spotify-result-info">
                        <div class="spotify-result-name">${escapeHtml(item.name)}</div>
                        <div class="spotify-result-sub">${escapeHtml(item.artists)}${item.year ? ` &middot; ${item.year}` : ''}</div>
                    </div>
                `;
            } else if (tab === 'playlists') {
                el.innerHTML = `
                    ${coverHTML}
                    <div class="spotify-result-info">
                        <div class="spotify-result-name">${escapeHtml(item.name)}</div>
                        <div class="spotify-result-sub">${item.owner ? `by ${escapeHtml(item.owner)}` : ''}</div>
                    </div>
                `;
            } else if (tab === 'artists') {
                el.innerHTML = `
                    ${coverHTML}
                    <div class="spotify-result-info">
                        <div class="spotify-result-name">${escapeHtml(item.name)}</div>
                    </div>
                `;
            }

            el.addEventListener('click', () => handleSpotifyResultClick(item, typeSingular));
            resultsList.appendChild(el);
        });
    }

    async function handleSpotifyResultClick(item, type) {
        if (type === 'track') {
            spotifyState.collectionType = 'track';
            spotifyState.selectedTrack = item;
            spotifyState.allTracks = [item];
            spotifyState.selected = new Set([0]);
            displaySpotifyTrackInfo(item);
            if (tracklistSection) tracklistSection.style.display = 'none';
            if (downloadBtn) downloadBtn.disabled = false;
            updateSpotifyStatus('success', `Selected: ${item.name}`);

            // Check availability in the background
            checkSpotifyAvailability(item.id);
        } else if (type === 'album' || type === 'playlist') {
            updateSpotifyStatus('loading', `Loading ${type}...`);
            try {
                const url = `https://open.spotify.com/${type}/${item.id}`;
                const data = await window.electronAPI.spotifyGetMetadata(url);
                handleSpotifyMetadata(data, url);
            } catch (err) {
                showToast(`Failed to load ${type}: ${err.message}`, 'error');
                updateSpotifyStatus('error', err.message);
            }
        }
    }

    function displaySpotifyTrackInfo(track) {
        if (!trackInfoSection) return;
        trackInfoSection.style.display = '';

        const coverImg = document.getElementById('spotify-track-cover');
        const nameEl = document.getElementById('spotify-track-name');
        const artistEl = document.getElementById('spotify-track-artist');
        const albumEl = document.getElementById('spotify-track-album');
        const durationEl = document.getElementById('spotify-track-duration');

        if (coverImg) {
            const coverUrl = track.cover
                ? (typeof track.cover === 'object' ? (track.cover.medium || track.cover.large || track.cover.small) : track.cover)
                : '';
            coverImg.src = coverUrl || '';
            coverImg.style.display = coverUrl ? '' : 'none';
        }
        if (nameEl) nameEl.textContent = track.name || track.title || '';
        if (artistEl) artistEl.textContent = track.artists || track.artist || '';
        if (albumEl) albumEl.textContent = track.album ? (typeof track.album === 'object' ? track.album.name : track.album) : '';
        if (durationEl) durationEl.textContent = track.duration || '';
    }

    function displaySpotifyCollection(data) {
        if (!tracklistSection) return;
        tracklistSection.style.display = '';

        const titleEl = document.getElementById('spotify-collection-title');
        const countEl = document.getElementById('spotify-collection-count');
        const listEl = document.getElementById('spotify-tracklist');

        if (titleEl) titleEl.textContent = data.name || 'Collection';
        if (countEl) countEl.textContent = `${data.tracks.length} tracks`;

        if (listEl) {
            listEl.innerHTML = '';
            data.tracks.forEach((track, idx) => {
                const entry = document.createElement('div');
                entry.className = 'playlist-entry';
                entry.dataset.index = idx;

                const trackName = track.name || track.title || '';
                const trackArtist = track.artists || track.artist || '';

                entry.innerHTML = `
                    <label class="entry-checkbox">
                        <input type="checkbox" checked data-index="${idx}">
                    </label>
                    <span class="entry-number">${idx + 1}</span>
                    <div class="entry-info">
                        <span class="entry-title">${escapeHtml(trackName)}${track.is_explicit ? ' <span class="explicit-badge">E</span>' : ''}</span>
                        <span class="entry-subtitle">${escapeHtml(trackArtist)}${track.duration ? ` &middot; ${track.duration}` : ''}</span>
                    </div>
                `;

                const checkbox = entry.querySelector('input[type="checkbox"]');
                checkbox?.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        spotifyState.selected.add(idx);
                    } else {
                        spotifyState.selected.delete(idx);
                    }
                    if (downloadBtn) downloadBtn.disabled = spotifyState.selected.size === 0;
                });

                listEl.appendChild(entry);
            });
        }

        // Select/Deselect all
        document.getElementById('spotify-select-all')?.addEventListener('click', () => {
            spotifyState.selected = new Set(data.tracks.map((_, i) => i));
            listEl?.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            if (downloadBtn) downloadBtn.disabled = false;
        });

        document.getElementById('spotify-deselect-all')?.addEventListener('click', () => {
            spotifyState.selected.clear();
            listEl?.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            if (downloadBtn) downloadBtn.disabled = true;
        });
    }

    async function checkSpotifyAvailability(trackID) {
        const availSection = document.getElementById('spotify-availability');
        if (!availSection) return;
        availSection.style.display = 'flex';

        const tidalEl = document.getElementById('avail-tidal');
        const qobuzEl = document.getElementById('avail-qobuz');
        const amazonEl = document.getElementById('avail-amazon');

        if (tidalEl) { tidalEl.textContent = 'Tidal: ...'; tidalEl.className = 'avail-badge tidal checking'; }
        if (qobuzEl) { qobuzEl.textContent = 'Qobuz: ...'; qobuzEl.className = 'avail-badge qobuz checking'; }
        if (amazonEl) { amazonEl.textContent = 'Amazon: ...'; amazonEl.className = 'avail-badge amazon checking'; }

        try {
            const avail = await window.electronAPI.spotifyCheckAvailability(trackID);
            if (tidalEl) {
                tidalEl.textContent = avail.tidal ? 'Tidal: Yes' : 'Tidal: No';
                tidalEl.className = `avail-badge tidal ${avail.tidal ? 'available' : 'unavailable'}`;
            }
            if (qobuzEl) {
                qobuzEl.textContent = avail.qobuz ? 'Qobuz: Yes' : 'Qobuz: No';
                qobuzEl.className = `avail-badge qobuz ${avail.qobuz ? 'available' : 'unavailable'}`;
            }
            if (amazonEl) {
                amazonEl.textContent = avail.amazon ? 'Amazon: Yes' : 'Amazon: No';
                amazonEl.className = `avail-badge amazon ${avail.amazon ? 'available' : 'unavailable'}`;
            }
        } catch (e) {
            if (tidalEl) { tidalEl.textContent = 'Tidal: ?'; tidalEl.className = 'avail-badge tidal unknown'; }
            if (qobuzEl) { qobuzEl.textContent = 'Qobuz: ?'; qobuzEl.className = 'avail-badge qobuz unknown'; }
            if (amazonEl) { amazonEl.textContent = 'Amazon: ?'; amazonEl.className = 'avail-badge amazon unknown'; }
        }
    }

    // Service selection buttons
    const serviceBtns = document.querySelectorAll('#spotify-service-btns .format-btn');
    serviceBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            serviceBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            spotifyState.service = btn.dataset.service;
        });
    });

    // Quality select
    const qualitySelect = document.getElementById('spotify-quality-select');
    qualitySelect?.addEventListener('change', () => {
        spotifyState.quality = qualitySelect.value;
    });

    // Download button
    downloadBtn?.addEventListener('click', async () => {
        if (spotifyState.downloading) return;
        if (spotifyState.allTracks.length === 0 || spotifyState.selected.size === 0) {
            showToast('No tracks selected', 'error');
            return;
        }

        // Get output directory (use configured default automatically)
        let outputDir;
        try {
            outputDir = await window.electronAPI.getOutputDirectory();
        } catch (e) {
            outputDir = '';
        }

        spotifyState.downloading = true;
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Downloading...';

        if (progressContainer) progressContainer.style.display = 'flex';

        const selectedIndices = Array.from(spotifyState.selected).sort((a, b) => a - b);
        let completed = 0;
        let failed = 0;

        // Listen for progress updates
        window.electronAPI.onSpotifyProgress?.((progress) => {
            const progressFill = document.getElementById('spotify-progress-fill');
            const progressText = document.getElementById('spotify-progress-text');
            if (progress.percent != null && progressFill) {
                // Scale individual track progress within overall progress
                const trackProgress = progress.percent;
                const overallBase = Math.round((completed / selectedIndices.length) * 100);
                const overallMax = Math.round(((completed + 1) / selectedIndices.length) * 100);
                const scaled = overallBase + Math.round((trackProgress / 100) * (overallMax - overallBase));
                progressFill.style.width = `${scaled}%`;
                progressText.textContent = `${scaled}%`;
            }
        });

        for (let i = 0; i < selectedIndices.length; i++) {
            if (!spotifyState.downloading) break;

            const track = spotifyState.allTracks[selectedIndices[i]];
            const trackName = track.name || track.title || '';
            const trackArtist = track.artists || track.artist || '';

            const phaseEl = document.getElementById('spotify-phase');
            const currentEl = document.getElementById('spotify-current-item');
            const progressFill = document.getElementById('spotify-progress-fill');
            const progressText = document.getElementById('spotify-progress-text');

            if (phaseEl) phaseEl.textContent = `Downloading ${i + 1} of ${selectedIndices.length}`;
            if (currentEl) currentEl.textContent = `${trackName} - ${trackArtist}`;

            const pct = Math.round((i / selectedIndices.length) * 100);
            if (progressFill) progressFill.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `${pct}%`;

            try {
                const downloadOptions = JSON.parse(JSON.stringify({
                    spotifyID: String(track.id || ''),
                    service: String(spotifyState.service || 'tidal'),
                    outputDir: String(outputDir || ''),
                    quality: String(spotifyState.quality || 'LOSSLESS'),
                    trackInfo: {
                        name: String(trackName || ''),
                        artists: String(trackArtist || ''),
                        album: track.album ? String(typeof track.album === 'object' ? track.album.name : track.album) : '',
                        coverUrl: track.cover
                            ? String(typeof track.cover === 'string'
                                ? track.cover
                                : (track.cover.large || track.cover.medium || track.cover.small || ''))
                            : ''
                    }
                }));
                const dlResult = await window.electronAPI.spotifyDownload(downloadOptions);
                if (dlResult && dlResult.success === false) {
                    throw new Error(dlResult.error || 'Download failed');
                }

                // Download lyrics if checkbox is checked
                const lyricsCheckbox = document.getElementById('spotify-lyrics-checkbox');
                if (lyricsCheckbox && lyricsCheckbox.checked) {
                    try {
                        const lyricsResult = await window.electronAPI.spotifyDownloadLyrics({
                            trackInfo: {
                                name: String(trackName || ''),
                                artists: String(trackArtist || ''),
                                album: downloadOptions.trackInfo.album,
                                duration: track.duration_s || track.durationSeconds || 0
                            },
                            outputDir: String(outputDir || '')
                        });
                        if (lyricsResult && lyricsResult.success) {
                            console.log(`Lyrics downloaded for: ${trackName}` + (lyricsResult.synced ? ' (synced)' : ' (plain)'));
                        }
                    } catch (lyricsErr) {
                        console.log(`No lyrics found for: ${trackName}`);
                    }
                }

                // Download cover art if checkbox is checked
                const coverCheckbox = document.getElementById('spotify-cover-checkbox');
                if (coverCheckbox && coverCheckbox.checked && downloadOptions.trackInfo.coverUrl) {
                    try {
                        const safeName = (trackName || 'cover').replace(/[<>:"/\\|?*]/g, '_');
                        const coverResult = await window.electronAPI.spotifySaveCover({
                            coverUrl: downloadOptions.trackInfo.coverUrl,
                            outputDir: String(outputDir || ''),
                            fileName: `${safeName} - Cover.jpg`
                        });
                        if (coverResult && coverResult.success) {
                            console.log(`Cover art saved for: ${trackName}`);
                        }
                    } catch (coverErr) {
                        console.log(`Could not save cover art for: ${trackName}`);
                    }
                }

                completed++;

                const entryEl = document.querySelector(`#spotify-tracklist .playlist-entry[data-index="${selectedIndices[i]}"]`);
                if (entryEl) entryEl.classList.add('completed');
            } catch (err) {
                failed++;
                console.error(`Spotify download failed for ${trackName}:`, err);
                showToast(`Failed: ${trackName} - ${err.message}`, 'error');

                const entryEl = document.querySelector(`#spotify-tracklist .playlist-entry[data-index="${selectedIndices[i]}"]`);
                if (entryEl) entryEl.classList.add('failed');
            }

            // Small delay between downloads
            if (i < selectedIndices.length - 1 && spotifyState.downloading) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Finish
        spotifyState.downloading = false;

        const progressFill = document.getElementById('spotify-progress-fill');
        const progressText = document.getElementById('spotify-progress-text');
        if (progressFill) progressFill.style.width = '100%';
        if (progressText) progressText.textContent = '100%';

        downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download from Spotify';
        downloadBtn.disabled = false;

        if (failed > 0 && completed > 0) {
            showToast(`${completed} downloaded, ${failed} failed`, 'warning');
            updateSpotifyStatus('warning', `${completed} downloaded, ${failed} failed`);
        } else if (completed > 0) {
            showToast(`All ${completed} tracks downloaded!`, 'success');
            playSound('success');
            updateSpotifyStatus('success', `All ${completed} tracks downloaded!`);
            // Add open location button for Spotify downloads
            const spotifyStatusDiv = document.getElementById('spotify-status');
            if (spotifyStatusDiv && state.settings.outputDirectory) {
                spotifyStatusDiv.innerHTML += `
                    <button class="btn-open-location" id="spotify-open-location" title="Open download folder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        Open Location
                    </button>`;
                document.getElementById('spotify-open-location')?.addEventListener('click', () => {
                    window.electronAPI.openFolder(state.settings.outputDirectory);
                });
            }
        } else {
            updateSpotifyStatus('error', `All ${failed} downloads failed`);
        }

        setTimeout(() => {
            if (progressContainer) progressContainer.style.display = 'none';
        }, 3000);
    });
}

function updateSpotifyStatus(type, message) {
    const statusDiv = document.getElementById('spotify-status');
    if (!statusDiv) return;

    const icons = {
        loading: '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>'
    };

    statusDiv.className = `downloader-status ${type}`;
    statusDiv.innerHTML = `${icons[type] || icons.success}<span>${message}</span>`;
}

/**
 * Update file size estimate based on current settings and video duration
 */
function updateSizeEstimate() {
    const videoEstimate = document.getElementById('video-size-estimate');
    const audioEstimate = document.getElementById('audio-size-estimate');

    if (!downloadState.videoInfo || !downloadState.videoInfo.duration) {
        if (videoEstimate) videoEstimate.textContent = '';
        if (audioEstimate) audioEstimate.textContent = '';
        return;
    }

    const durationSeconds = downloadState.videoInfo.duration;

    // Video bitrate estimates (in kbps) based on quality
    const videoBitrates = {
        'best': 8000,  // ~8 Mbps for best quality
        '1080': 5000,  // ~5 Mbps for 1080p
        '720': 2500,   // ~2.5 Mbps for 720p
        '480': 1500,   // ~1.5 Mbps for 480p
        '360': 800     // ~800 kbps for 360p
    };

    // Calculate video size estimate (video bitrate + audio ~192kbps)
    const videoBitrate = videoBitrates[downloadState.quality] || 5000;
    const videoSize = ((videoBitrate + 192) * durationSeconds) / 8 / 1024; // Convert to MB

    // Calculate audio size estimate
    const audioBitrate = parseInt(downloadState.audioBitrate) || 192;
    let audioSize;
    if (downloadState.format === 'audio-flac') {
        // FLAC lossless: ~1411 kbps for CD quality (16bit/44.1kHz stereo)
        audioSize = (1411 * durationSeconds) / 8 / 1024;
    } else {
        audioSize = (audioBitrate * durationSeconds) / 8 / 1024; // Convert to MB
    }

    // Format sizes
    const formatEstimate = (sizeMB) => {
        if (sizeMB >= 1024) {
            return `~${(sizeMB / 1024).toFixed(1)} GB`;
        }
        return `~${Math.round(sizeMB)} MB`;
    };

    if (videoEstimate) {
        videoEstimate.textContent = formatEstimate(videoSize);
    }

    if (audioEstimate) {
        audioEstimate.textContent = formatEstimate(audioSize);
    }
}

function displayVideoInfo(info) {
    const previewSection = document.getElementById('video-preview-section');
    const thumbnail = document.getElementById('video-thumbnail');
    const title = document.getElementById('video-title');
    const uploader = document.getElementById('video-uploader');
    const duration = document.getElementById('video-duration');

    console.log('displayVideoInfo called with:', {
        hasThumb: !!info.thumbnail,
        thumbStart: info.thumbnail ? info.thumbnail.substring(0, 60) : null,
        title: info.title
    });

    if (previewSection) {
        previewSection.style.display = 'block';
    }

    if (thumbnail) {
        const container = thumbnail.parentElement;
        console.log('Thumbnail element found:', thumbnail);
        console.log('Container element:', container);

        if (info.thumbnail) {
            console.log('Setting thumbnail, length:', info.thumbnail.length);

            // Clear any previous state and force visibility
            thumbnail.style.cssText = 'display: block !important; width: 100%; height: 100%; object-fit: cover;';
            container.style.background = 'transparent';

            // Set the source directly - it's a base64 data URL
            thumbnail.src = info.thumbnail;

            thumbnail.onload = () => {
                console.log('Thumbnail loaded successfully, dimensions:', thumbnail.naturalWidth, 'x', thumbnail.naturalHeight);
            };

            thumbnail.onerror = (e) => {
                console.log('Thumbnail load error:', e);
                thumbnail.style.display = 'none';
                container.style.background = 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)';
            };
        } else {
            console.log('No thumbnail in info');
            thumbnail.style.display = 'none';
            container.style.background = 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)';
        }
    } else {
        console.log('Thumbnail element NOT FOUND');
    }

    if (title) {
        title.textContent = info.title || 'Unknown Title';
    }

    if (uploader) {
        uploader.textContent = info.uploader || 'Unknown Uploader';
    }

    if (duration && info.duration) {
        const mins = Math.floor(info.duration / 60);
        const secs = Math.floor(info.duration % 60);
        duration.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Update subtitle availability indicator
    const subtitleAvailability = document.getElementById('subtitle-availability');
    if (subtitleAvailability) {
        if (info.hasSubtitles || info.hasAutoSubtitles) {
            const count = (info.availableSubtitleLangs || []).length;
            subtitleAvailability.textContent = `${count} language(s) available`;
            subtitleAvailability.style.color = 'var(--accent-primary)';
        } else {
            subtitleAvailability.textContent = 'No subtitles available for this video';
            subtitleAvailability.style.color = 'var(--text-tertiary)';
        }
    }

    // Update file size estimates
    updateSizeEstimate();
}

// =====================================================
// Logs System
// =====================================================

async function setupLogs() {
    const refreshBtn = document.getElementById('refresh-logs-btn');
    const exportBtn = document.getElementById('export-logs-btn');
    const clearBtn = document.getElementById('clear-logs-btn');
    const filterType = document.getElementById('log-filter-type');
    const filterCategory = document.getElementById('log-filter-category');

    // Load logs on page load
    await loadLogs();

    // Refresh button
    refreshBtn?.addEventListener('click', async () => {
        await loadLogs();
        showToast('Logs refreshed', 'info');
    });

    // Export button
    exportBtn?.addEventListener('click', async () => {
        try {
            const result = await window.electronAPI.exportLogs();
            if (result) {
                showToast('Logs exported successfully', 'success');
            }
        } catch (err) {
            showToast('Failed to export logs', 'error');
        }
    });

    // Clear button
    clearBtn?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all logs?')) {
            await window.electronAPI.clearLogs();
            await loadLogs();
            showToast('Logs cleared', 'info');
        }
    });

    // Filter changes
    filterType?.addEventListener('change', () => loadLogs());
    filterCategory?.addEventListener('change', () => loadLogs());
}

async function loadLogs() {
    const filterType = document.getElementById('log-filter-type')?.value || '';
    const filterCategory = document.getElementById('log-filter-category')?.value || '';
    const logsList = document.getElementById('logs-list');
    const logsEmpty = document.getElementById('logs-empty');

    if (!logsList) return;

    try {
        const filter = {};
        if (filterType) filter.type = filterType;
        if (filterCategory) filter.category = filterCategory;

        const logs = await window.electronAPI.getLogs(filter);

        if (logs.length === 0) {
            if (logsEmpty) logsEmpty.style.display = 'block';
            logsList.innerHTML = '';
            logsList.appendChild(logsEmpty);
            return;
        }

        if (logsEmpty) logsEmpty.style.display = 'none';

        // Keep the empty element but clear other content
        logsList.innerHTML = '';

        logs.forEach(log => {
            const logItem = document.createElement('div');
            logItem.className = `log-item log-${log.type}`;

            const timestamp = new Date(log.timestamp);
            const timeStr = timestamp.toLocaleString();

            logItem.innerHTML = `
                <div class="log-icon ${log.type}">
                    ${getLogIcon(log.type)}
                </div>
                <div class="log-content">
                    <div class="log-header">
                        <span class="log-category">${log.category}</span>
                        <span class="log-time">${timeStr}</span>
                    </div>
                    <div class="log-message">${log.message}</div>
                    ${log.details ? `<div class="log-details">${JSON.stringify(log.details)}</div>` : ''}
                </div>
            `;

            logsList.appendChild(logItem);
        });
    } catch (err) {
        console.error('Failed to load logs:', err);
    }
}

function getLogIcon(type) {
    const icons = {
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    };
    return icons[type] || icons.info;
}

// =====================================================
// =====================================================
// File Explorer - Simple & Clean
// =====================================================

let currentPath = null;
let navHistory = [];
let navIndex = -1;
let selectedFile = null;

// =====================================================
// AI Hub
// =====================================================

let aiState = {
    currentTool: null,
    selectedImage: null,
    isProcessing: false
};

function setupAI() {
    const chatInput = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-send-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const modalClose = document.getElementById('ai-modal-close');
    const modalCancel = document.getElementById('ai-modal-cancel');
    const modalSubmit = document.getElementById('ai-modal-submit');
    const modal = document.getElementById('ai-tool-modal');
    const charCount = document.querySelector('.ai-char-count');
    const modelSelect = document.getElementById('gemini-model-select');
    const modelBadge = document.getElementById('ai-model-badge');

    // Model selector
    if (modelSelect) {
        // Restore saved model
        if (state.settings.geminiModel) {
            modelSelect.value = state.settings.geminiModel;
        }
        // Update badge text
        if (modelBadge && modelSelect.selectedOptions[0]) {
            modelBadge.textContent = modelSelect.selectedOptions[0].text;
        }
        modelSelect.addEventListener('change', async () => {
            state.settings.geminiModel = modelSelect.value;
            if (modelBadge && modelSelect.selectedOptions[0]) {
                modelBadge.textContent = modelSelect.selectedOptions[0].text;
            }
            try {
                await window.electronAPI.saveSettings(state.settings);
                showToast(`Model switched to ${modelSelect.selectedOptions[0].text}`, 'success');
            } catch (e) { /* ignore */ }
        });
    }

    // Chat functionality
    sendBtn?.addEventListener('click', sendChatMessage);
    chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    // Auto-resize textarea and character count
    chatInput?.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';

        // Update character count
        if (charCount) {
            const count = chatInput.value.length;
            charCount.textContent = `${count}/2000`;
            charCount.style.color = count > 1800 ? '#ef4444' : count > 1500 ? '#f59e0b' : '';
        }
    });

    // Clear chat
    clearChatBtn?.addEventListener('click', async () => {
        await window.electronAPI.aiClearChat();
        const messagesContainer = document.getElementById('ai-chat-messages');
        messagesContainer.innerHTML = `
            <div class="ai-message assistant">
                <div class="ai-avatar"><span>🤖</span></div>
                <div class="ai-message-content">
                    <div class="ai-message-header">
                        <span class="ai-name">AI Assistant</span>
                        <span class="ai-time">Just now</span>
                    </div>
                    <p>Chat cleared! ✨ I'm ready for a fresh conversation. What would you like to explore?</p>
                </div>
            </div>
        `;
    });

    // Suggestion buttons
    document.querySelectorAll('.ai-suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
            const suggestion = btn.dataset.suggestion;
            if (chatInput && suggestion) {
                chatInput.value = suggestion;
                chatInput.dispatchEvent(new Event('input'));
                sendChatMessage();
            }
        });
    });

    // Tool cards
    document.querySelectorAll('.ai-tool-card').forEach(card => {
        card.addEventListener('click', () => openAITool(card.dataset.tool));
    });

    // Modal controls
    modalClose?.addEventListener('click', closeAIModal);
    modalCancel?.addEventListener('click', closeAIModal);
    modalSubmit?.addEventListener('click', processAITool);

    // Close modal on backdrop click
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeAIModal();
    });
}

function getTimeString() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function sendChatMessage() {
    const input = document.getElementById('ai-chat-input');
    const messagesContainer = document.getElementById('ai-chat-messages');
    const sendBtn = document.getElementById('ai-send-btn');
    const charCount = document.querySelector('.ai-char-count');

    const message = input.value.trim();
    if (!message || aiState.isProcessing) return;

    aiState.isProcessing = true;
    sendBtn.disabled = true;

    // Add user message with enhanced UI
    const userTime = getTimeString();
    messagesContainer.innerHTML += `
        <div class="ai-message user">
            <div class="ai-avatar"><span>👤</span></div>
            <div class="ai-message-content">
                <div class="ai-message-header">
                    <span class="ai-name">You</span>
                    <span class="ai-time">${userTime}</span>
                </div>
                <p>${escapeHtml(message)}</p>
            </div>
        </div>
    `;

    // Add typing indicator
    const typingId = 'typing-' + Date.now();
    messagesContainer.innerHTML += `
        <div class="ai-message assistant typing" id="${typingId}">
            <div class="ai-avatar"><span>🤖</span></div>
            <div class="ai-message-content">
                <div class="ai-message-header">
                    <span class="ai-name">AI Assistant</span>
                    <span class="ai-time">Thinking...</span>
                </div>
                <p><span class="typing-dots">●●●</span></p>
            </div>
        </div>
    `;

    input.value = '';
    input.style.height = 'auto';
    if (charCount) charCount.textContent = '0/2000';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
        const selectedModel = document.getElementById('gemini-model-select')?.value || null;
        const result = await window.electronAPI.aiChat(message, null, selectedModel);

        // Remove typing indicator
        document.getElementById(typingId)?.remove();

        const aiTime = getTimeString();

        if (result.success) {
            messagesContainer.innerHTML += `
                <div class="ai-message assistant">
                    <div class="ai-avatar"><span>🤖</span></div>
                    <div class="ai-message-content">
                        <div class="ai-message-header">
                            <span class="ai-name">AI Assistant</span>
                            <span class="ai-time">${aiTime}</span>
                        </div>
                        <p>${formatAIResponse(result.response)}</p>
                    </div>
                </div>
            `;
        } else {
            messagesContainer.innerHTML += `
                <div class="ai-message assistant error">
                    <div class="ai-avatar"><span>⚠️</span></div>
                    <div class="ai-message-content">
                        <div class="ai-message-header">
                            <span class="ai-name">AI Assistant</span>
                            <span class="ai-time">${aiTime}</span>
                        </div>
                        <p>Oops! Something went wrong: ${result.error}</p>
                        <p class="ai-retry-hint">💡 Try rephrasing your question or try again in a moment.</p>
                    </div>
                </div>
            `;
        }
    } catch (err) {
        document.getElementById(typingId)?.remove();
        const errorTime = getTimeString();
        messagesContainer.innerHTML += `
            <div class="ai-message assistant error">
                <div class="ai-avatar"><span>⚠️</span></div>
                <div class="ai-message-content">
                    <div class="ai-message-header">
                        <span class="ai-name">AI Assistant</span>
                        <span class="ai-time">${errorTime}</span>
                    </div>
                    <p>Connection error. The AI service might be temporarily unavailable.</p>
                    <p class="ai-retry-hint">💡 Please try again in a few seconds.</p>
                </div>
            </div>
        `;
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    aiState.isProcessing = false;
    sendBtn.disabled = false;
}

function formatAIResponse(text) {
    // Convert markdown-like formatting
    return escapeHtml(text)
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openAITool(tool) {
    aiState.currentTool = tool;
    aiState.selectedImage = null;

    const modal = document.getElementById('ai-tool-modal');
    const title = document.getElementById('ai-modal-title');
    const body = document.getElementById('ai-modal-body');
    const submitBtn = document.getElementById('ai-modal-submit');

    let content = '';
    let buttonText = 'Process';

    switch (tool) {
        case 'image-gen':
            title.textContent = '🎨 Image Generator';
            buttonText = 'Generate';
            content = `
                <div class="ai-form-group">
                    <label>Describe the image you want to create</label>
                    <textarea id="ai-image-prompt" placeholder="A beautiful sunset over mountains with a lake reflection, digital art style, 4k, highly detailed"></textarea>
                </div>
                <div class="ai-form-group">
                    <label>Negative prompt (what to avoid)</label>
                    <input type="text" id="ai-negative-prompt" placeholder="blurry, low quality, distorted">
                </div>
                <div id="ai-result-container"></div>
            `;
            break;

        case 'bg-remove':
            title.textContent = '✂️ Remove Background';
            buttonText = 'Remove Background';
            content = `
                <div class="ai-form-group">
                    <label>Select an image</label>
                    <div class="ai-drop-zone" id="ai-bg-drop-zone">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21,15 16,10 5,21"/>
                        </svg>
                        <p>Click or drag an image here</p>
                        <span>Supports JPG, PNG, WebP</span>
                    </div>
                    <input type="file" id="ai-bg-file" accept="image/*" style="display:none">
                    <div class="ai-image-preview" id="ai-bg-preview" style="display:none">
                        <img id="ai-bg-preview-img" src="">
                        <button class="remove-btn" id="ai-bg-remove-preview">×</button>
                    </div>
                </div>
                <div id="ai-result-container"></div>
            `;
            break;

        case 'upscale':
            title.textContent = '🔍 Image Upscaler';
            buttonText = 'Upscale 2x';
            content = `
                <div class="ai-form-group">
                    <label>Select an image to upscale</label>
                    <div class="ai-drop-zone" id="ai-upscale-drop-zone">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15,3 21,3 21,9"/>
                            <polyline points="9,21 3,21 3,15"/>
                            <line x1="21" y1="3" x2="14" y2="10"/>
                            <line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                        <p>Click or drag an image here</p>
                        <span>Image will be upscaled 2x</span>
                    </div>
                    <input type="file" id="ai-upscale-file" accept="image/*" style="display:none">
                    <div class="ai-image-preview" id="ai-upscale-preview" style="display:none">
                        <img id="ai-upscale-preview-img" src="">
                        <button class="remove-btn" id="ai-upscale-remove-preview">×</button>
                    </div>
                </div>
                <div id="ai-result-container"></div>
            `;
            break;

        case 'translate':
            title.textContent = '🌐 Translator';
            buttonText = 'Translate';
            content = `
                <div class="ai-form-row">
                    <div class="ai-form-group">
                        <label>From</label>
                        <select id="ai-source-lang">
                            <option value="en">English</option>
                            <option value="es">Spanish</option>
                            <option value="fr">French</option>
                            <option value="de">German</option>
                        </select>
                    </div>
                    <div class="ai-form-group">
                        <label>To</label>
                        <select id="ai-target-lang">
                            <option value="es">Spanish</option>
                            <option value="fr">French</option>
                            <option value="de">German</option>
                            <option value="it">Italian</option>
                            <option value="pt">Portuguese</option>
                            <option value="ru">Russian</option>
                            <option value="zh">Chinese</option>
                            <option value="ja">Japanese</option>
                            <option value="ar">Arabic</option>
                        </select>
                    </div>
                </div>
                <div class="ai-form-group">
                    <label>Text to translate</label>
                    <textarea id="ai-translate-text" placeholder="Enter text to translate..."></textarea>
                </div>
                <div id="ai-result-container"></div>
            `;
            break;

        case 'summarize':
            title.textContent = '📋 Text Summarizer';
            buttonText = 'Summarize';
            content = `
                <div class="ai-form-group">
                    <label>Text to summarize</label>
                    <textarea id="ai-summarize-text" placeholder="Paste a long article or document here..." style="min-height: 200px;"></textarea>
                </div>
                <div id="ai-result-container"></div>
            `;
            break;

        case 'creative':
            title.textContent = '✨ Creative Writer';
            buttonText = 'Generate';
            content = `
                <div class="ai-form-row">
                    <div class="ai-form-group">
                        <label>Type</label>
                        <select id="ai-creative-type">
                            <option value="story">Short Story</option>
                            <option value="poem">Poem</option>
                            <option value="lyrics">Song Lyrics</option>
                            <option value="script">Script/Dialogue</option>
                        </select>
                    </div>
                    <div class="ai-form-group">
                        <label>Length</label>
                        <select id="ai-creative-length">
                            <option value="short">Short</option>
                            <option value="medium" selected>Medium</option>
                            <option value="long">Long</option>
                        </select>
                    </div>
                </div>
                <div class="ai-form-group">
                    <label>Topic or theme</label>
                    <textarea id="ai-creative-prompt" placeholder="A hero's journey through a magical forest..."></textarea>
                </div>
                <div id="ai-result-container"></div>
            `;
            break;

        case 'improve':
            title.textContent = '✏️ Text Improver';
            buttonText = 'Improve';
            content = `
                <div class="ai-form-group">
                    <label>Style</label>
                    <select id="ai-improve-style">
                        <option value="professional">Professional</option>
                        <option value="casual">Casual</option>
                        <option value="academic">Academic</option>
                        <option value="creative">Creative</option>
                        <option value="concise">Concise</option>
                    </select>
                </div>
                <div class="ai-form-group">
                    <label>Text to improve</label>
                    <textarea id="ai-improve-text" placeholder="Enter text you want to rewrite or improve..."></textarea>
                </div>
                <div id="ai-result-container"></div>
            `;
            break;

        case 'describe':
            title.textContent = '👁️ Image Describer';
            buttonText = 'Describe';
            content = `
                <div class="ai-form-group">
                    <label>Select an image</label>
                    <div class="ai-drop-zone" id="ai-describe-drop-zone">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <circle cx="12" cy="12" r="4"/>
                        </svg>
                        <p>Click or drag an image here</p>
                        <span>AI will describe the contents</span>
                    </div>
                    <input type="file" id="ai-describe-file" accept="image/*" style="display:none">
                    <div class="ai-image-preview" id="ai-describe-preview" style="display:none">
                        <img id="ai-describe-preview-img" src="">
                        <button class="remove-btn" id="ai-describe-remove-preview">×</button>
                    </div>
                </div>
                <div id="ai-result-container"></div>
            `;
            break;
    }

    body.innerHTML = content;
    submitBtn.textContent = buttonText;

    // Setup file upload for image tools
    setupImageUpload(tool);

    modal.classList.add('active');
}

function setupImageUpload(tool) {
    const toolMap = {
        'bg-remove': 'bg',
        'upscale': 'upscale',
        'describe': 'describe'
    };

    const prefix = toolMap[tool];
    if (!prefix) return;

    const dropZone = document.getElementById(`ai-${prefix}-drop-zone`);
    const fileInput = document.getElementById(`ai-${prefix}-file`);
    const preview = document.getElementById(`ai-${prefix}-preview`);
    const previewImg = document.getElementById(`ai-${prefix}-preview-img`);
    const removeBtn = document.getElementById(`ai-${prefix}-remove-preview`);

    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageSelect(file, prefix);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleImageSelect(file, prefix);
        }
    });

    removeBtn?.addEventListener('click', () => {
        aiState.selectedImage = null;
        preview.style.display = 'none';
        dropZone.style.display = 'block';
    });
}

function handleImageSelect(file, prefix) {
    const dropZone = document.getElementById(`ai-${prefix}-drop-zone`);
    const preview = document.getElementById(`ai-${prefix}-preview`);
    const previewImg = document.getElementById(`ai-${prefix}-preview-img`);

    // Store file path (for Electron)
    aiState.selectedImage = file.path;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImg.src = e.target.result;
        preview.style.display = 'block';
        dropZone.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function closeAIModal() {
    const modal = document.getElementById('ai-tool-modal');
    modal.classList.remove('active');
    aiState.currentTool = null;
    aiState.selectedImage = null;
}

async function processAITool() {
    const resultContainer = document.getElementById('ai-result-container');
    const submitBtn = document.getElementById('ai-modal-submit');

    if (aiState.isProcessing) return;

    aiState.isProcessing = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Processing...';

    resultContainer.innerHTML = `
        <div class="ai-loading">
            <div class="spinner"></div>
            <p>AI is working its magic...</p>
        </div>
    `;

    try {
        let result;

        switch (aiState.currentTool) {
            case 'image-gen':
                const prompt = document.getElementById('ai-image-prompt').value.trim();
                const negPrompt = document.getElementById('ai-negative-prompt').value.trim();
                if (!prompt) {
                    throw new Error('Please enter an image description');
                }
                result = await window.electronAPI.aiGenerateImage(prompt, { negativePrompt: negPrompt });
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <img src="${result.image}" class="ai-result-image" alt="Generated image">
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="downloadAIImage('${result.image}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7,10 12,15 17,10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                    Download
                                </button>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'bg-remove':
                if (!aiState.selectedImage) {
                    throw new Error('Please select an image first');
                }
                result = await window.electronAPI.aiRemoveBackground(aiState.selectedImage);
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <img src="${result.image}" class="ai-result-image" alt="Background removed">
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="downloadAIImage('${result.image}')">Download</button>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'upscale':
                if (!aiState.selectedImage) {
                    throw new Error('Please select an image first');
                }
                result = await window.electronAPI.aiUpscaleImage(aiState.selectedImage);
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <img src="${result.image}" class="ai-result-image" alt="Upscaled image">
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="downloadAIImage('${result.image}')">Download</button>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'translate':
                const text = document.getElementById('ai-translate-text').value.trim();
                const sourceLang = document.getElementById('ai-source-lang').value;
                const targetLang = document.getElementById('ai-target-lang').value;
                if (!text) {
                    throw new Error('Please enter text to translate');
                }
                result = await window.electronAPI.aiTranslate(text, sourceLang, targetLang);
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <div class="ai-result-text">${escapeHtml(result.translation)}</div>
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="copyToClipboard('${escapeHtml(result.translation).replace(/'/g, "\\'")}')">Copy</button>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'summarize':
                const sumText = document.getElementById('ai-summarize-text').value.trim();
                if (!sumText) {
                    throw new Error('Please enter text to summarize');
                }
                result = await window.electronAPI.aiSummarize(sumText);
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <div class="ai-result-text">${escapeHtml(result.summary)}</div>
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="copyToClipboard(\`${escapeHtml(result.summary).replace(/`/g, '\\`')}\`)">Copy</button>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'creative':
                const creativePrompt = document.getElementById('ai-creative-prompt').value.trim();
                const creativeType = document.getElementById('ai-creative-type').value;
                const creativeLength = document.getElementById('ai-creative-length').value;
                if (!creativePrompt) {
                    throw new Error('Please enter a topic or theme');
                }
                result = await window.electronAPI.aiCreativeWrite(creativePrompt, creativeType, creativeLength);
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <div class="ai-result-text">${formatAIResponse(result.text)}</div>
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="copyToClipboard(\`${escapeHtml(result.text).replace(/`/g, '\\`')}\`)">Copy</button>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'improve':
                const improveText = document.getElementById('ai-improve-text').value.trim();
                const improveStyle = document.getElementById('ai-improve-style').value;
                if (!improveText) {
                    throw new Error('Please enter text to improve');
                }
                result = await window.electronAPI.aiImproveText(improveText, improveStyle);
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <div class="ai-result-text">${formatAIResponse(result.text)}</div>
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="copyToClipboard(\`${escapeHtml(result.text).replace(/`/g, '\\`')}\`)">Copy</button>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'describe':
                if (!aiState.selectedImage) {
                    throw new Error('Please select an image first');
                }
                result = await window.electronAPI.aiDescribeImage(aiState.selectedImage);
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="ai-result">
                            <div class="ai-result-text">${escapeHtml(result.description)}</div>
                            <div class="ai-result-actions">
                                <button class="btn-secondary" onclick="copyToClipboard('${escapeHtml(result.description).replace(/'/g, "\\'")}')">Copy</button>
                            </div>
                        </div>
                    `;
                }
                break;
        }

        if (result && !result.success) {
            throw new Error(result.error || 'Operation failed');
        }

        showToast('AI processing complete!', 'success');

    } catch (err) {
        resultContainer.innerHTML = `
            <div class="ai-result" style="color: #ef4444;">
                <p>❌ ${err.message}</p>
            </div>
        `;
        showToast(err.message, 'error');
    }

    aiState.isProcessing = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Process';
}

function downloadAIImage(dataUrl) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `ai-image-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Image downloaded!', 'success');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

// Make functions globally available
window.downloadAIImage = downloadAIImage;
window.copyToClipboard = copyToClipboard;

async function setupStorage() {
    const driveCards = document.getElementById('drive-cards');
    if (!driveCards) return;

    // Load drives into dashboard cards
    try {
        const drives = await window.electronAPI.getAvailableDrives();
        renderDriveCards(drives);
    } catch (err) {
        console.error('Failed to load drives:', err);
    }

    // Load cleanup info
    loadCleanupInfo();

    // Refresh drives button
    document.getElementById('refresh-drives-btn')?.addEventListener('click', async () => {
        try {
            const drives = await window.electronAPI.getAvailableDrives();
            renderDriveCards(drives);
            showToast('Drives refreshed', 'success');
        } catch (err) {
            showToast('Failed to refresh drives', 'error');
        }
    });

    // Clean temp files
    document.getElementById('clean-temp-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('clean-temp-btn');
        btn.disabled = true;
        btn.textContent = 'Cleaning...';
        try {
            await window.electronAPI.clearTempFiles();
            showToast('Temp files cleared!', 'success');
            loadCleanupInfo();
        } catch (err) {
            showToast('Failed to clear temp files', 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Clean';
    });

    // Empty recycle bin 
    document.getElementById('empty-recycle-btn')?.addEventListener('click', async () => {
        if (!confirm('Empty the Recycle Bin? This cannot be undone.')) return;
        const btn = document.getElementById('empty-recycle-btn');
        btn.disabled = true;
        btn.textContent = 'Emptying...';
        try {
            await window.electronAPI.emptyRecycleBin();
            showToast('Recycle Bin emptied!', 'success');
            loadCleanupInfo();
        } catch (err) {
            showToast('Failed to empty recycle bin', 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Empty';
    });

    // Deep scan
    document.getElementById('deep-scan-btn')?.addEventListener('click', startDeepScan);

    // Close scan results
    document.getElementById('close-scan-results')?.addEventListener('click', () => {
        document.getElementById('scan-results-section').style.display = 'none';
    });

    // Setup navigation buttons (file browser)
    document.getElementById('btn-back')?.addEventListener('click', goBack);
    document.getElementById('btn-forward')?.addEventListener('click', goForward);
    document.getElementById('btn-up')?.addEventListener('click', goUp);
    document.getElementById('btn-refresh')?.addEventListener('click', refresh);

    // Setup quick links
    document.querySelectorAll('.quick-link:not(.analyze-btn)').forEach(btn => {
        btn.addEventListener('click', () => openQuickLink(btn.dataset.path));
    });

    // Context menu
    setupContextMenu();

    // Close context menu on click outside
    document.addEventListener('click', () => {
        document.getElementById('context-menu').style.display = 'none';
    });
}

async function loadCleanupInfo() {
    // Get recycle bin size
    try {
        const result = await window.electronAPI.getRecycleBinSize();
        const el = document.getElementById('recycle-size');
        if (el) el.textContent = formatSize(result.size || 0);
    } catch {
        const el = document.getElementById('recycle-size');
        if (el) el.textContent = 'Unable to check';
    }

    // Get temp file size estimate
    try {
        const tempSize = await window.electronAPI.getFolderSize(await window.electronAPI.getEnvVariable('TEMP'));
        const el = document.getElementById('temp-size');
        if (el) el.textContent = formatSize(tempSize || 0);
    } catch {
        const el = document.getElementById('temp-size');
        if (el) el.textContent = 'Unable to check';
    }
}

function renderDriveCards(drives) {
    const container = document.getElementById('drive-cards');
    if (!container) return;
    container.innerHTML = '';

    drives.forEach(drive => {
        const usedPercent = drive.usedPercent || 0;
        const barColor = usedPercent > 90 ? '#ef4444' : usedPercent > 70 ? '#f59e0b' : '#22c55e';

        const card = document.createElement('div');
        card.className = 'drive-card';
        card.innerHTML = `
            <div class="drive-card-header">
                <div class="drive-card-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="4" width="20" height="16" rx="2"/>
                        <path d="M6 8h.01M6 12h.01"/>
                    </svg>
                </div>
                <div class="drive-card-name">${drive.name}</div>
            </div>
            <div class="drive-card-bar">
                <div class="drive-card-fill" style="width: ${usedPercent}%; background: ${barColor};"></div>
            </div>
            <div class="drive-card-stats">
                <span>${formatSize(drive.freeSpace)} free</span>
                <span>${formatSize(drive.totalSize)} total</span>
            </div>
            <div class="drive-card-percent">${usedPercent}% used</div>
        `;
        card.addEventListener('click', () => {
            document.querySelectorAll('.drive-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            navigateToPath(drive.root);
        });
        container.appendChild(card);
    });
}

async function startDeepScan() {
    // Get the first available drive
    let scanDrive = 'C:\\';
    const activeCard = document.querySelector('.drive-card.active');
    if (activeCard) {
        const name = activeCard.querySelector('.drive-card-name')?.textContent;
        if (name) scanDrive = name + '\\';
    }

    const section = document.getElementById('scan-results-section');
    const progressDiv = document.getElementById('scan-progress');
    const progressFill = document.getElementById('scan-progress-fill');
    const progressText = document.getElementById('scan-progress-text');
    const foldersDiv = document.getElementById('scan-largest-folders');
    const filesDiv = document.getElementById('scan-largest-files');
    const catsDiv = document.getElementById('scan-categories');

    section.style.display = 'block';
    progressDiv.style.display = 'flex';
    foldersDiv.innerHTML = '<div class="scan-loading">Scanning...</div>';
    filesDiv.innerHTML = '<div class="scan-loading">Scanning...</div>';
    catsDiv.innerHTML = '<div class="scan-loading">Scanning...</div>';

    try {
        // Listen for progress events via IPC
        window.electronAPI.onStorageScanProgress((progress) => {
            if (progressFill) progressFill.style.width = `${progress.percent}%`;
            if (progressText) progressText.textContent = `${progress.percent}% - ${progress.message}`;
        });

        const analysis = await window.electronAPI.analyzeDrive(scanDrive);

        progressDiv.style.display = 'none';

        // Render largest folders
        if (analysis.largestFolders && analysis.largestFolders.length > 0) {
            foldersDiv.innerHTML = analysis.largestFolders.slice(0, 10).map(f => `
                <div class="scan-item" data-path="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">
                    <span class="scan-item-name">📁 ${escapeHtml(f.name)}</span>
                    <span class="scan-item-size">${formatSize(f.size)}</span>
                </div>
            `).join('');
            foldersDiv.querySelectorAll('.scan-item').forEach(item => {
                item.addEventListener('click', () => navigateToPath(item.dataset.path));
            });
        } else {
            foldersDiv.innerHTML = '<div class="scan-empty">No large folders found</div>';
        }

        // Render largest files
        if (analysis.largestFiles && analysis.largestFiles.length > 0) {
            filesDiv.innerHTML = analysis.largestFiles.slice(0, 10).map(f => `
                <div class="scan-item" data-path="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">
                    <span class="scan-item-name">📄 ${escapeHtml(f.name)}</span>
                    <span class="scan-item-size">${formatSize(f.size)}</span>
                </div>
            `).join('');
            filesDiv.querySelectorAll('.scan-item').forEach(item => {
                item.addEventListener('click', () => {
                    window.electronAPI.openInExplorer(item.dataset.path);
                });
            });
        } else {
            filesDiv.innerHTML = '<div class="scan-empty">No large files found</div>';
        }

        // Render categories
        if (analysis.categories) {
            const catColors = {
                documents: '#3b82f6',
                images: '#22c55e',
                videos: '#ef4444',
                audio: '#ec4899',
                archives: '#f97316',
                applications: '#8b5cf6',
                other: '#6b7280'
            };
            const catEmojis = {
                documents: '📄', images: '🖼️', videos: '🎬',
                audio: '🎵', archives: '📦', applications: '💻', other: '📋'
            };
            const totalCatSize = Object.values(analysis.categories).reduce((s, c) => s + c.size, 0);

            catsDiv.innerHTML = Object.entries(analysis.categories)
                .filter(([, data]) => data.size > 0)
                .sort((a, b) => b[1].size - a[1].size)
                .map(([cat, data]) => {
                    const pct = totalCatSize > 0 ? ((data.size / totalCatSize) * 100).toFixed(1) : 0;
                    return `
                        <div class="scan-category">
                            <div class="scan-cat-header">
                                <span>${catEmojis[cat] || '📋'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                                <span>${formatSize(data.size)} (${data.count} files)</span>
                            </div>
                            <div class="scan-cat-bar">
                                <div class="scan-cat-fill" style="width: ${pct}%; background: ${catColors[cat] || '#6b7280'};"></div>
                            </div>
                        </div>
                    `;
                }).join('');

            if (catsDiv.innerHTML === '') {
                catsDiv.innerHTML = '<div class="scan-empty">No files categorized</div>';
            }
        }

    } catch (err) {
        console.error('Deep scan failed:', err);
        progressDiv.style.display = 'none';
        foldersDiv.innerHTML = '<div class="scan-empty">Scan failed</div>';
        filesDiv.innerHTML = '<div class="scan-empty">Scan failed</div>';
        catsDiv.innerHTML = '<div class="scan-empty">Scan failed</div>';
    }
}

async function openQuickLink(folder) {
    const userProfile = await window.electronAPI.getEnvVariable('USERPROFILE');
    const paths = {
        downloads: `${userProfile}\\Downloads`,
        documents: `${userProfile}\\Documents`,
        desktop: `${userProfile}\\Desktop`,
        pictures: `${userProfile}\\Pictures`,
        videos: `${userProfile}\\Videos`,
        music: `${userProfile}\\Music`
    };
    navigateToPath(paths[folder] || userProfile);
}

function navigateToPath(path) {
    // Add to history
    if (navIndex < navHistory.length - 1) {
        navHistory = navHistory.slice(0, navIndex + 1);
    }
    navHistory.push(path);
    navIndex = navHistory.length - 1;

    loadPath(path);
    updateNavButtons();
}

function goBack() {
    if (navIndex > 0) {
        navIndex--;
        loadPath(navHistory[navIndex]);
        updateNavButtons();
    }
}

function goForward() {
    if (navIndex < navHistory.length - 1) {
        navIndex++;
        loadPath(navHistory[navIndex]);
        updateNavButtons();
    }
}

function goUp() {
    if (!currentPath) return;
    const parent = currentPath.replace(/\\[^\\]+\\?$/, '');
    if (parent && parent !== currentPath && parent.length >= 2) {
        navigateToPath(parent.endsWith(':') ? parent + '\\' : parent);
    }
}

function refresh() {
    if (currentPath) loadPath(currentPath);
}

function updateNavButtons() {
    document.getElementById('btn-back').disabled = navIndex <= 0;
    document.getElementById('btn-forward').disabled = navIndex >= navHistory.length - 1;
    document.getElementById('btn-up').disabled = !currentPath || currentPath.match(/^[A-Z]:\\?$/i);
}

async function loadPath(path) {
    currentPath = path;
    const container = document.getElementById('file-container');
    const pathBar = document.getElementById('path-bar');
    const statusBar = document.getElementById('status-bar');

    // Update path bar
    updatePathBar(path);

    // Show loading
    container.innerHTML = `<div class="loading-row"><div class="loading-spinner"></div><p>Loading...</p></div>`;

    try {
        const result = await window.electronAPI.browseFolder(path);

        if (result.error) {
            container.innerHTML = `
                <div class="explorer-welcome">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <h3>Access Denied</h3>
                    <p>${result.error}</p>
                </div>
            `;
            return;
        }

        const items = result.items || [];

        if (items.length === 0) {
            container.innerHTML = `
                <div class="explorer-welcome">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <h3>Empty Folder</h3>
                    <p>This folder is empty</p>
                </div>
            `;
            document.getElementById('item-count').textContent = '0 items';
            return;
        }

        // Sort: folders first, then files
        items.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return b.isDirectory ? 1 : -1;
            return a.name.localeCompare(b.name);
        });

        renderTable(items);
        document.getElementById('item-count').textContent = `${items.length} items`;

    } catch (err) {
        console.error('Error loading path:', err);
        container.innerHTML = `
            <div class="explorer-welcome">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <h3>Error</h3>
                <p>${err.message}</p>
            </div>
        `;
    }
}

function updatePathBar(path) {
    const pathBar = document.getElementById('path-bar');
    const parts = path.split('\\').filter(p => p);

    let html = '';
    let currentSegment = '';

    parts.forEach((part, i) => {
        currentSegment += (i === 0 ? part : '\\' + part);
        const segmentPath = i === 0 ? part + '\\' : currentSegment;

        html += `<span class="path-segment" data-path="${segmentPath}">${part}</span>`;
        if (i < parts.length - 1) {
            html += `<span class="path-sep">›</span>`;
        }
    });

    pathBar.innerHTML = html || '<span class="path-text">Select a location</span>';

    // Click handlers for path segments
    pathBar.querySelectorAll('.path-segment').forEach(seg => {
        seg.addEventListener('click', () => navigateToPath(seg.dataset.path));
    });
}

function renderTable(items) {
    const container = document.getElementById('file-container');

    let html = `
        <table class="file-table">
            <thead>
                <tr>
                    <th class="col-name">Name</th>
                    <th class="col-type">Type</th>
                    <th class="col-size">Size</th>
                    <th class="col-date">Modified</th>
                </tr>
            </thead>
            <tbody>
    `;

    items.forEach(item => {
        const icon = getIcon(item);
        const type = getType(item);
        const size = item.isDirectory ? '' : formatSize(item.size || 0);
        const date = item.modified ? formatDate(item.modified) : '';

        html += `
            <tr data-path="${escapeHtml(item.path)}" data-isdir="${item.isDirectory}" data-name="${escapeHtml(item.name)}">
                <td class="col-name">
                    <div class="file-name-cell">
                        <div class="file-icon ${icon.class}">${icon.svg}</div>
                        <span class="file-name">${escapeHtml(item.name)}</span>
                    </div>
                </td>
                <td class="col-type">${type}</td>
                <td class="col-size">${size}</td>
                <td class="col-date">${date}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Add event listeners to rows
    container.querySelectorAll('tbody tr').forEach(row => {
        // Double click to open
        row.addEventListener('dblclick', () => {
            if (row.dataset.isdir === 'true') {
                navigateToPath(row.dataset.path);
            } else {
                window.electronAPI.openInExplorer(row.dataset.path);
            }
        });

        // Single click to select
        row.addEventListener('click', () => {
            container.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            selectedFile = {
                path: row.dataset.path,
                name: row.dataset.name,
                isDirectory: row.dataset.isdir === 'true'
            };
            document.getElementById('selected-info').textContent = row.dataset.name;
        });

        // Right click for context menu
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectedFile = {
                path: row.dataset.path,
                name: row.dataset.name,
                isDirectory: row.dataset.isdir === 'true'
            };
            showContextMenu(e.clientX, e.clientY);
        });
    });
}

function getIcon(item) {
    if (item.isDirectory) {
        return { class: 'folder', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>' };
    }

    const ext = (item.name.split('.').pop() || '').toLowerCase();

    const types = {
        video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv'],
        audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma'],
        image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'],
        document: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'],
        archive: ['zip', 'rar', '7z', 'tar', 'gz'],
        code: ['js', 'ts', 'py', 'html', 'css', 'json', 'xml', 'java', 'cpp', 'c', 'cs']
    };

    for (const [type, exts] of Object.entries(types)) {
        if (exts.includes(ext)) {
            const icons = {
                video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>',
                audio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
                image: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
                document: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
                archive: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2v2z"/></svg>',
                code: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>'
            };
            return { class: type, svg: icons[type] };
        }
    }

    return { class: 'file', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>' };
}

function getType(item) {
    if (item.isDirectory) return 'Folder';
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    if (!ext || ext === item.name.toLowerCase()) return 'File';
    return ext.toUpperCase();
}

function formatDate(dateStr) {
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setupContextMenu() {
    const menu = document.getElementById('context-menu');
    if (!menu) return;

    menu.querySelectorAll('.context-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            menu.style.display = 'none';

            if (!selectedFile) return;

            const action = item.dataset.action;

            switch (action) {
                case 'open':
                    window.electronAPI.openInExplorer(selectedFile.path);
                    break;

                case 'copy-path':
                    await navigator.clipboard.writeText(selectedFile.path);
                    showToast('Path copied', 'success');
                    break;

                case 'recycle':
                    if (confirm(`Move "${selectedFile.name}" to Recycle Bin?`)) {
                        try {
                            await window.electronAPI.moveToRecycleBin(selectedFile.path);
                            showToast('Moved to Recycle Bin', 'success');
                            refresh();
                        } catch (err) {
                            showToast('Failed: ' + err.message, 'error');
                        }
                    }
                    break;

                case 'delete':
                    if (confirm(`Permanently delete "${selectedFile.name}"?\n\nThis cannot be undone!`)) {
                        try {
                            await window.electronAPI.deleteStorageItem(selectedFile.path, selectedFile.isDirectory);
                            showToast('Deleted', 'success');
                            refresh();
                        } catch (err) {
                            showToast('Failed: ' + err.message, 'error');
                        }
                    }
                    break;
            }
        });
    });
}

function showContextMenu(x, y) {
    const menu = document.getElementById('context-menu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';

    // Adjust if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${y - rect.height}px`;
    }
}

// =====================================================
// Download Manager
// =====================================================

function setupDownloadManager() {
    const clearTempBtn = document.getElementById('clear-temp-btn');
    const cancelAllBtn = document.getElementById('cancel-all-downloads-btn');
    const clearHistoryBtn = document.getElementById('clear-download-history-btn');
    const dmCancelBtn = document.getElementById('dm-cancel-btn');

    // Load download history from localStorage
    loadDownloadHistory();

    // Clear temp files button
    clearTempBtn?.addEventListener('click', async () => {
        clearTempBtn.disabled = true;
        clearTempBtn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Clearing...';

        try {
            const result = await window.electronAPI.clearTempFiles();
            if (result.success) {
                showToast(`Cleared ${result.count} temp files (${formatSize(result.freedSpace)})`, 'success');
            } else {
                showToast(result.error || 'Failed to clear temp files', 'error');
            }
        } catch (err) {
            showToast('Failed to clear temp files', 'error');
        } finally {
            clearTempBtn.disabled = false;
            clearTempBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Clear Temp';
        }
    });

    // Cancel all downloads
    cancelAllBtn?.addEventListener('click', async () => {
        if (downloadState.downloading) {
            await window.electronAPI.cancelDownload();
            downloadState.downloading = false;

            // Reset Download page UI
            const downloadBtn = document.getElementById('download-btn');
            const progressContainer = document.getElementById('download-progress');
            const progressFill = document.getElementById('download-progress-fill');
            const progressText = document.getElementById('download-progress-text');
            const progressPhase = document.getElementById('download-phase');

            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';
            }
            if (progressContainer) progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            if (progressText) progressText.textContent = '0%';
            if (progressPhase) progressPhase.textContent = '';

            updateDownloadManagerUI(null);
            showToast('All downloads cancelled', 'info');
        }
    });

    // Cancel current download from Download Manager
    dmCancelBtn?.addEventListener('click', async () => {
        if (downloadState.downloading) {
            await window.electronAPI.cancelDownload();
            downloadState.downloading = false;

            // Reset Download page UI
            const downloadBtn = document.getElementById('download-btn');
            const progressContainer = document.getElementById('download-progress');
            const progressFill = document.getElementById('download-progress-fill');
            const progressText = document.getElementById('download-progress-text');
            const progressPhase = document.getElementById('download-phase');

            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download';
            }
            if (progressContainer) progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            if (progressText) progressText.textContent = '0%';
            if (progressPhase) progressPhase.textContent = '';

            updateDownloadManagerUI(null);
            showToast('Download cancelled', 'info');
        }
    });

    // Clear download history
    clearHistoryBtn?.addEventListener('click', () => {
        downloadManagerState.history = [];
        localStorage.removeItem('downloadHistory');
        renderDownloadHistory();
        showToast('Download history cleared', 'info');
    });

    // Listen for download progress updates
    window.electronAPI.onDownloadProgress?.((data) => {
        // Update Download Manager UI
        if (typeof data === 'object') {
            updateDownloadManagerProgress(data);
        } else {
            // Legacy: just a percentage number
            updateDownloadManagerProgress({ progress: data });
        }
    });
}

function updateDownloadManagerUI(download) {
    const noActiveDownload = document.getElementById('no-active-download');
    const activeDownload = document.getElementById('active-download');
    const activeCount = document.getElementById('active-downloads-count');

    if (!download) {
        // No active download
        if (noActiveDownload) noActiveDownload.style.display = 'flex';
        if (activeDownload) activeDownload.style.display = 'none';
        if (activeCount) activeCount.textContent = '0 Active';
        downloadManagerState.currentDownload = null;
        return;
    }

    downloadManagerState.currentDownload = download;

    if (noActiveDownload) noActiveDownload.style.display = 'none';
    if (activeDownload) activeDownload.style.display = 'flex';
    if (activeCount) activeCount.textContent = '1 Active';

    // Update UI elements
    const thumbnail = document.getElementById('dm-thumbnail');
    const title = document.getElementById('dm-title');
    const format = document.getElementById('dm-format');
    const quality = document.getElementById('dm-quality');

    if (thumbnail && download.thumbnail) thumbnail.src = download.thumbnail;
    if (title) title.textContent = download.title || 'Downloading...';
    if (format) format.textContent = download.format?.toUpperCase() || 'MP4';
    if (quality) quality.textContent = download.quality || 'Best';
}

function updateDownloadManagerProgress(data) {
    const progressFill = document.getElementById('dm-progress-fill');
    const progressText = document.getElementById('dm-progress-text');
    const speedText = document.getElementById('dm-speed');
    const etaText = document.getElementById('dm-eta');
    const speedDisplay = document.getElementById('download-speed');

    const progress = data.progress || 0;
    const speed = data.speed || downloadManagerState.lastSpeed;
    const eta = data.eta || '';
    const phase = data.phase || '';

    downloadManagerState.lastSpeed = speed;
    downloadManagerState.lastProgress = progress;

    if (progressFill) progressFill.style.width = `${progress}%`;
    if (progressText) progressText.textContent = `${Math.round(progress)}%`;
    if (speedText) speedText.textContent = speed || '-- KB/s';

    // Show phase-aware ETA/status
    let etaDisplay = eta || '--:--';
    if (phase === 'video') {
        etaDisplay = `📹 Video: ${eta || 'downloading...'}`;
    } else if (phase === 'audio') {
        etaDisplay = `🎵 Audio: ${eta || 'downloading...'}`;
    } else if (phase === 'merge') {
        etaDisplay = '🔄 Merging streams...';
    } else if (phase === 'complete') {
        etaDisplay = '✅ Complete!';
    }
    if (etaText) etaText.textContent = etaDisplay;
    if (speedDisplay) speedDisplay.textContent = speed || '0 KB/s';

    // Also update the active download view if not already showing
    if (downloadState.downloading && !downloadManagerState.currentDownload) {
        updateDownloadManagerUI({
            title: downloadState.videoInfo?.title || 'Downloading...',
            thumbnail: downloadState.videoInfo?.thumbnail,
            format: downloadState.format,
            quality: downloadState.quality
        });
    }
}

function addToDownloadHistory(download, success) {
    const historyItem = {
        id: Date.now(),
        title: download.title || 'Unknown',
        format: download.format || 'mp4',
        quality: download.quality || 'best',
        success: success,
        timestamp: new Date().toISOString(),
        size: download.size || 0
    };

    downloadManagerState.history.unshift(historyItem);

    // Keep only last 50 items
    if (downloadManagerState.history.length > 50) {
        downloadManagerState.history = downloadManagerState.history.slice(0, 50);
    }

    // Save to localStorage
    localStorage.setItem('downloadHistory', JSON.stringify(downloadManagerState.history));

    renderDownloadHistory();
}

function loadDownloadHistory() {
    try {
        const saved = localStorage.getItem('downloadHistory');
        if (saved) {
            downloadManagerState.history = JSON.parse(saved);
            renderDownloadHistory();
        }
    } catch (e) {
        console.error('Failed to load download history:', e);
    }
}

function renderDownloadHistory() {
    const historyList = document.getElementById('download-history-list');
    const emptyState = document.getElementById('download-history-empty');

    if (!historyList) return;

    // Clear existing items (keep empty state)
    const existingItems = historyList.querySelectorAll('.download-history-item');
    existingItems.forEach(item => item.remove());

    if (downloadManagerState.history.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    downloadManagerState.history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'download-history-item';

        const timeAgo = getTimeAgo(new Date(item.timestamp));

        div.innerHTML = `
            <div class="item-icon ${item.success ? 'success' : 'error'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${item.success
                ? '<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/>'
                : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
            }
                </svg>
            </div>
            <div class="item-info">
                <div class="item-title">${escapeHtml(item.title)}</div>
                <div class="item-meta">
                    <span>${item.format.toUpperCase()}</span>
                    <span>${item.quality}</span>
                    <span>${timeAgo}</span>
                </div>
            </div>
        `;

        historyList.appendChild(div);
    });
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// =====================================================
// Gemini API Key Setup
// =====================================================

function setupGeminiKey() {
    const saveBtn = document.getElementById('save-gemini-key-btn');
    const input = document.getElementById('gemini-api-key-input');
    const link = document.getElementById('gemini-key-link');
    const aiLink = document.getElementById('ai-gemini-link');

    // Settings page save button
    saveBtn?.addEventListener('click', async () => {
        const key = input.value.trim();
        try {
            await window.electronAPI.aiSetGeminiKey(key);
            state.settings.geminiApiKey = key;
            showToast(key ? 'Gemini API key saved!' : 'Gemini API key cleared', key ? 'success' : 'info');
            updateAIOverlay();
        } catch (err) {
            showToast('Failed to save API key', 'error');
        }
    });

    // Overlay inline save button
    const overlaySaveBtn = document.getElementById('ai-overlay-save-key-btn');
    const overlayInput = document.getElementById('ai-overlay-key-input');
    overlaySaveBtn?.addEventListener('click', async () => {
        const key = overlayInput.value.trim();
        if (!key) { showToast('Please enter an API key', 'warning'); return; }
        try {
            await window.electronAPI.aiSetGeminiKey(key);
            state.settings.geminiApiKey = key;
            if (input) input.value = key; // sync settings page input
            showToast('Gemini API key saved!', 'success');
            updateAIOverlay();
        } catch (err) {
            showToast('Failed to save API key', 'error');
        }
    });

    // AI Hub header "API Key" button - toggles inline editor
    const changeKeyBtn = document.getElementById('ai-change-key-btn');
    const keyEditor = document.getElementById('ai-key-editor');
    const inlineSaveBtn = document.getElementById('ai-inline-save-btn');
    const inlineCancelBtn = document.getElementById('ai-inline-cancel-btn');
    const inlineKeyInput = document.getElementById('ai-inline-key-input');

    changeKeyBtn?.addEventListener('click', () => {
        if (keyEditor) {
            const showing = keyEditor.style.display !== 'none';
            keyEditor.style.display = showing ? 'none' : 'block';
            if (!showing && inlineKeyInput) {
                inlineKeyInput.value = '';
                inlineKeyInput.focus();
            }
        }
    });

    inlineSaveBtn?.addEventListener('click', async () => {
        const key = inlineKeyInput?.value.trim();
        if (!key) { showToast('Please enter an API key', 'warning'); return; }
        try {
            await window.electronAPI.aiSetGeminiKey(key);
            state.settings.geminiApiKey = key;
            if (input) input.value = key; // sync settings page input
            showToast('API key updated!', 'success');
            updateAIOverlay();
            if (keyEditor) keyEditor.style.display = 'none';
        } catch (err) {
            showToast('Failed to save API key', 'error');
        }
    });

    inlineCancelBtn?.addEventListener('click', () => {
        if (keyEditor) keyEditor.style.display = 'none';
    });

    link?.addEventListener('click', () => {
        window.electronAPI.openFile('https://aistudio.google.com/app/apikey');
    });

    aiLink?.addEventListener('click', () => {
        window.electronAPI.openFile('https://aistudio.google.com/app/apikey');
    });
}

function updateAIOverlay() {
    const overlay = document.getElementById('ai-key-overlay');
    const statusBadge = document.getElementById('ai-status-badge');
    const statusText = document.getElementById('ai-status-text');

    const hasKey = !!(state.settings.geminiApiKey && state.settings.geminiApiKey.length > 10);

    if (overlay) {
        overlay.style.display = hasKey ? 'none' : 'flex';
    }
    if (statusBadge) {
        statusBadge.classList.toggle('offline', !hasKey);
    }
    if (statusText) {
        statusText.textContent = hasKey ? 'AI Online' : 'No API Key';
    }
}



// =====================================================
// My Files Browser
// =====================================================

let currentFilesFilter = 'all';

function setupMyFiles() {
    // Filter tabs
    document.querySelectorAll('.files-filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.files-filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilesFilter = tab.dataset.filter;
            loadMyFiles();
        });
    });

    // Refresh button
    document.getElementById('files-refresh-btn')?.addEventListener('click', () => loadMyFiles());

    // Open folder button
    document.getElementById('files-open-folder-btn')?.addEventListener('click', () => {
        if (state.settings.outputDirectory) {
            window.electronAPI.openFolder(state.settings.outputDirectory);
        }
    });
}

async function loadMyFiles() {
    const grid = document.getElementById('my-files-grid');
    const empty = document.getElementById('my-files-empty');
    if (!grid) return;

    grid.innerHTML = '<div class="files-loading"><div class="spinner"></div><span>Loading files...</span></div>';

    try {
        const result = await window.electronAPI.listOutputFiles(currentFilesFilter === 'all' ? null : currentFilesFilter);

        if (!result.success || !result.files || result.files.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'flex';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = result.files.map(file => `
            <div class="file-card" data-path="${escapeHtml(file.path)}">
                <div class="file-card-icon ${file.type || 'other'}">
                    ${getFileTypeIcon(file.type)}
                </div>
                <div class="file-card-info">
                    <div class="file-card-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="file-card-meta">
                        <span class="file-card-ext">${(file.extension || '').toUpperCase()}</span>
                        <span class="file-card-size">${formatSize(file.size)}</span>
                    </div>
                </div>
                <div class="file-card-actions">
                    <button class="btn-icon file-open-btn" title="Open file" data-path="${escapeHtml(file.path)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15,3 21,3 21,9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                    </button>

                </div>
            </div>
        `).join('');

        // Attach event listeners
        grid.querySelectorAll('.file-open-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.electronAPI.openFile(btn.dataset.path);
            });
        });


    } catch (err) {
        grid.innerHTML = `<div class="files-error">Failed to load files: ${err.message}</div>`;
    }
}


function getFileTypeIcon(type) {
    const icons = {
        audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><polygon points="23,7 16,12 23,17 23,7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>',
        document: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>'
    };
    return icons[type] || icons.document;
}

// =====================================================
// Download Manager State
// =====================================================

const downloadManagerState = {
    currentDownload: null,
    history: [],
    lastSpeed: 0,
    lastProgress: 0
};

// =====================================================
// IDM Download Manager (Bridge + Engine)
// =====================================================

let dmState = { tasks: [], maxConcurrent: 4, defaultOutputDir: '' };

function setupIDMDownloadManager() {
    // Listen for live state updates from main process
    if (window.electronAPI.onDmState) {
        window.electronAPI.onDmState((state) => {
            dmState = state;
            renderDMUI();
        });
    }

    // Initial state load
    loadDMState();

    // Bridge info
    loadBridgeInfo();

    // Add URL button
    const addUrlBtn = document.getElementById('dm-add-url-btn');
    if (addUrlBtn) addUrlBtn.addEventListener('click', () => openDMAddUrlModal());

    // Pause / Resume / Clear All
    const pauseAllBtn = document.getElementById('dm-pause-all-btn');
    const resumeAllBtn = document.getElementById('dm-resume-all-btn');
    const clearFinishedBtn = document.getElementById('dm-clear-finished-btn');
    if (pauseAllBtn) pauseAllBtn.addEventListener('click', async () => {
        await window.electronAPI.dmPauseAll();
    });
    if (resumeAllBtn) resumeAllBtn.addEventListener('click', async () => {
        await window.electronAPI.dmResumeAll();
    });
    if (clearFinishedBtn) clearFinishedBtn.addEventListener('click', async () => {
        await window.electronAPI.dmClearFinished();
    });

    // Browse directory
    const browseDirBtn = document.getElementById('dm-browse-dir-btn');
    if (browseDirBtn) browseDirBtn.addEventListener('click', async () => {
        const dir = await window.electronAPI.dmSetOutputDir();
        if (dir) {
            const dirDisplay = document.getElementById('dm-output-dir');
            if (dirDisplay) dirDisplay.value = dir;
        }
    });

    // Max concurrent selector
    const maxConcurrentSel = document.getElementById('dm-max-concurrent');
    if (maxConcurrentSel) {
        maxConcurrentSel.addEventListener('change', async () => {
            const val = parseInt(maxConcurrentSel.value);
            await window.electronAPI.dmSetMaxConcurrent(val);
        });
    }

    // Auto-Arrange toggle
    const autoArrangeToggle = document.getElementById('dm-auto-arrange');
    if (autoArrangeToggle) {
        // Load saved state
        if (window.electronAPI.dmGetAutoArrange) {
            window.electronAPI.dmGetAutoArrange().then(enabled => {
                autoArrangeToggle.checked = enabled;
            });
        }
        autoArrangeToggle.addEventListener('change', async () => {
            if (window.electronAPI.dmSetAutoArrange) {
                await window.electronAPI.dmSetAutoArrange(autoArrangeToggle.checked);
            }
            showToast(autoArrangeToggle.checked ? 'Auto-arrange enabled' : 'Auto-arrange disabled', 'info');
        });
    }

    // Extension note dismiss button
    const noteDismiss = document.getElementById('dm-note-dismiss');
    const extensionNote = document.getElementById('dm-extension-note');
    if (noteDismiss && extensionNote) {
        if (localStorage.getItem('dm-extension-note-dismissed') === 'true') {
            extensionNote.style.display = 'none';
        }
        noteDismiss.addEventListener('click', () => {
            extensionNote.style.display = 'none';
            localStorage.setItem('dm-extension-note-dismissed', 'true');
        });
    }

    // Auto-arrange note dismiss button
    const arrangeNoteDismiss = document.getElementById('dm-arrange-note-dismiss');
    const arrangeNote = document.getElementById('dm-arrange-note');
    if (arrangeNoteDismiss && arrangeNote) {
        if (localStorage.getItem('dm-arrange-note-dismissed') === 'true') {
            arrangeNote.style.display = 'none';
        }
        arrangeNoteDismiss.addEventListener('click', () => {
            arrangeNote.style.display = 'none';
            localStorage.setItem('dm-arrange-note-dismissed', 'true');
        });
    }

    // Extension note GitHub link
    const githubLink = document.getElementById('dm-extension-github-link');
    if (githubLink) {
        githubLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.electronAPI.openExternalUrl) {
                window.electronAPI.openExternalUrl('https://github.com/Hasan580/universial-file-converter/tree/main/browser-extension');
            }
        });
    }

    // Add URL Modal
    const modalOverlay = document.getElementById('dm-add-url-modal');
    const modalCancel = document.getElementById('dm-add-url-cancel');
    const modalConfirm = document.getElementById('dm-add-url-confirm');

    if (modalCancel) modalCancel.addEventListener('click', () => closeDMAddUrlModal());
    if (modalOverlay) modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeDMAddUrlModal();
    });
    if (modalConfirm) modalConfirm.addEventListener('click', async () => {
        const urlInput = document.getElementById('dm-new-url');
        const fnameInput = document.getElementById('dm-new-filename');
        const url = urlInput ? urlInput.value.trim() : '';
        const filename = fnameInput ? fnameInput.value.trim() : '';

        if (!url) {
            showToast('Please enter a URL', 'error');
            return;
        }

        try {
            await window.electronAPI.dmAddTask(url, filename || undefined);
            showToast('Download added', 'success');
            closeDMAddUrlModal();
            if (urlInput) urlInput.value = '';
            if (fnameInput) fnameInput.value = '';
        } catch (err) {
            showToast('Failed to add download: ' + err.message, 'error');
        }
    });
}

async function loadDMState() {
    try {
        const state = await window.electronAPI.dmGetState();
        if (state) {
            dmState = state;
            renderDMUI();
        }
    } catch (e) {
        console.error('Failed to load DM state:', e);
    }
}

async function loadBridgeInfo() {
    try {
        const info = await window.electronAPI.dmGetBridgeInfo();
        if (info) {
            const dot = document.getElementById('dm-bridge-dot');
            const text = document.getElementById('dm-bridge-text');

            if (dot) dot.style.background = info.running ? '#22c55e' : '#ef4444';
            if (text) text.textContent = info.running
                ? `Bridge active on port ${info.port} — auto-capture ready`
                : 'Bridge offline — restart the app';
        }
    } catch (e) {
        console.error('Failed to load bridge info:', e);
    }
}

function renderDMUI() {
    renderDMStats();
    renderDMSettings();
    renderDMTaskList();
}

function renderDMStats() {
    const tasks = dmState.tasks || [];
    const active = tasks.filter(t => t.status === 'downloading').length;
    const queued = tasks.filter(t => t.status === 'queued').length;
    const completed = tasks.filter(t => t.status === 'completed').length;

    // Total speed
    let totalSpeed = 0;
    tasks.forEach(t => {
        if (t.status === 'downloading' && t.speedBytesPerSec) totalSpeed += t.speedBytesPerSec;
    });

    const activeEl = document.getElementById('dm-active-count');
    const queueEl = document.getElementById('dm-queue-count');
    const speedEl = document.getElementById('dm-total-speed');
    const completedEl = document.getElementById('dm-completed-count');

    if (activeEl) activeEl.textContent = active;
    if (queueEl) queueEl.textContent = queued;
    if (speedEl) speedEl.textContent = formatDMSpeed(totalSpeed);
    if (completedEl) completedEl.textContent = completed;
}

function renderDMSettings() {
    const dirEl = document.getElementById('dm-output-dir');
    const maxEl = document.getElementById('dm-max-concurrent');
    if (dirEl && dmState.defaultOutputDir) dirEl.value = dmState.defaultOutputDir;
    if (maxEl) maxEl.value = dmState.maxConcurrent || 4;
}

function renderDMTaskList() {
    const container = document.getElementById('dm-task-list');
    if (!container) return;

    const tasks = dmState.tasks || [];

    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="dm-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <p>No downloads yet</p>
                <p style="font-size:0.85rem;color:var(--text-secondary);">Add a URL or capture downloads from your browser</p>
            </div>
        `;
        return;
    }

    container.innerHTML = tasks.map(task => renderDMTaskItem(task)).join('');

    // Attach event listeners for task action buttons
    container.querySelectorAll('[data-dm-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = btn.dataset.dmAction;
            const taskId = btn.dataset.dmId;
            handleDMTaskAction(action, taskId);
        });
    });
}

function renderDMTaskItem(task) {
    const statusClass = task.status || 'queued';
    const progress = task.progress || 0;
    const speed = task.speedBytesPerSec || 0;
    const downloaded = task.downloadedBytes || 0;
    const total = task.totalBytes || 0;
    const filename = task.fileName || extractFilenameFromUrl(task.url);
    const ext = filename.split('.').pop().toUpperCase();

    // Status icon (shown in the badge)
    let statusIcon = '';
    switch (task.status) {
        case 'downloading':
            statusIcon = '<svg class="dm-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>';
            break;
        case 'completed':
            statusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M20 6L9 17l-5-5"/></svg>';
            break;
        case 'failed':
            statusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
            break;
        case 'paused':
            statusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
            break;
        case 'cancelled':
            statusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
            break;
        default:
            statusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>';
    }

    // Details row pieces
    const detailParts = [];
    if (task.status === 'downloading') {
        detailParts.push(`<span class="dm-detail-speed">${formatDMSpeed(speed)}</span>`);
        if (total > 0) detailParts.push(`<span class="dm-detail-size">${formatDMSize(downloaded)} / ${formatDMSize(total)}</span>`);
        if (task.etaSeconds && task.etaSeconds > 0) detailParts.push(`<span class="dm-detail-eta">ETA ${formatDMEta(task.etaSeconds)}</span>`);
    } else if (task.status === 'completed') {
        if (total > 0) detailParts.push(`<span class="dm-detail-size">${formatDMSize(total)}</span>`);
        detailParts.push(`<span class="dm-detail-done">Completed</span>`);
    } else if (task.status === 'paused') {
        detailParts.push(`<span class="dm-detail-paused">Paused at ${progress.toFixed(1)}%</span>`);
        if (total > 0) detailParts.push(`<span class="dm-detail-size">${formatDMSize(downloaded)} / ${formatDMSize(total)}</span>`);
    } else if (task.status === 'failed') {
        detailParts.push(`<span class="dm-detail-error">${task.error || 'Download failed'}</span>`);
    } else if (task.status === 'cancelled') {
        detailParts.push(`<span class="dm-detail-cancel">Cancelled</span>`);
    } else {
        detailParts.push(`<span class="dm-detail-queued">Waiting in queue...</span>`);
    }

    // Trash SVG (reused)
    const trashSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

    // Action buttons
    let actions = '';
    switch (task.status) {
        case 'downloading':
            actions = `<button class="dm-task-action-btn" data-dm-action="pause" data-dm-id="${task.id}" title="Pause"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>
                       <button class="dm-task-action-btn dm-task-action-danger" data-dm-action="trash" data-dm-id="${task.id}" title="Delete">${trashSvg}</button>`;
            break;
        case 'paused':
            actions = `<button class="dm-task-action-btn" data-dm-action="resume" data-dm-id="${task.id}" title="Resume"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5,3 19,12 5,21"/></svg></button>
                       <button class="dm-task-action-btn dm-task-action-danger" data-dm-action="trash" data-dm-id="${task.id}" title="Delete">${trashSvg}</button>`;
            break;
        case 'completed':
            actions = `<button class="dm-task-action-btn" data-dm-action="open-file" data-dm-id="${task.id}" title="Open File"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg></button>
                       <button class="dm-task-action-btn" data-dm-action="open-folder" data-dm-id="${task.id}" title="Open Folder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
                       <button class="dm-task-action-btn dm-task-action-danger" data-dm-action="trash" data-dm-id="${task.id}" title="Delete">${trashSvg}</button>`;
            break;
        case 'failed':
        case 'cancelled':
            actions = `<button class="dm-task-action-btn" data-dm-action="retry" data-dm-id="${task.id}" title="Retry"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
                       <button class="dm-task-action-btn dm-task-action-danger" data-dm-action="trash" data-dm-id="${task.id}" title="Delete">${trashSvg}</button>`;
            break;
        default: // queued
            actions = `<button class="dm-task-action-btn dm-task-action-danger" data-dm-action="trash" data-dm-id="${task.id}" title="Delete">${trashSvg}</button>`;
    }

    return `
        <div class="dm-task-item dm-status-${statusClass}" data-task-id="${task.id}">
            <div class="dm-task-icon-badge ${statusClass}">
                ${statusIcon}
            </div>
            <div class="dm-task-body">
                <div class="dm-task-header">
                    <div class="dm-task-name" title="${filename}">
                        <span class="dm-task-ext">${ext}</span>
                        ${filename}
                    </div>
                    <div class="dm-task-actions">
                        ${actions}
                    </div>
                </div>
                <div class="dm-task-progress-track">
                    <div class="dm-task-progress-fill ${statusClass}" style="width:${progress}%"></div>
                </div>
                <div class="dm-task-details">
                    ${detailParts.join('<span class="dm-detail-sep">·</span>')}
                </div>
            </div>
        </div>
    `;
}

async function handleDMTaskAction(action, taskId) {
    try {
        switch (action) {
            case 'pause': await window.electronAPI.dmPauseTask(taskId); break;
            case 'resume': await window.electronAPI.dmResumeTask(taskId); break;
            case 'cancel': await window.electronAPI.dmCancelTask(taskId); break;
            case 'retry': await window.electronAPI.dmRetryTask(taskId); break;
            case 'delete': await window.electronAPI.dmDeleteTask(taskId, false); break;
            case 'trash': await window.electronAPI.dmDeleteTask(taskId, true); break;
            case 'open-file': {
                const task = (dmState.tasks || []).find(t => t.id === taskId);
                if (task && task.outputPath) {
                    const result = await window.electronAPI.dmOpenFile(task.outputPath);
                    if (result && !result.ok) showToast('File not found — it may have been moved or deleted', 'error');
                } else {
                    showToast('File path not available', 'error');
                }
                break;
            }
            case 'open-folder': {
                const task = (dmState.tasks || []).find(t => t.id === taskId);
                if (task && task.outputPath) {
                    const result = await window.electronAPI.dmOpenFolder(task.outputPath);
                    if (result && !result.ok) showToast('Folder not found', 'error');
                } else {
                    showToast('File path not available', 'error');
                }
                break;
            }
        }
    } catch (e) {
        showToast('Action failed: ' + e.message, 'error');
    }
}

function openDMAddUrlModal() {
    const modal = document.getElementById('dm-add-url-modal');
    if (modal) modal.classList.add('active');
    const urlInput = document.getElementById('dm-new-url');
    if (urlInput) { urlInput.value = ''; urlInput.focus(); }
    const fnameInput = document.getElementById('dm-new-filename');
    if (fnameInput) fnameInput.value = '';
}

function closeDMAddUrlModal() {
    const modal = document.getElementById('dm-add-url-modal');
    if (modal) modal.classList.remove('active');
}

function extractFilenameFromUrl(url) {
    try {
        const u = new URL(url);
        const path = u.pathname;
        const segments = path.split('/').filter(Boolean);
        return segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : url;
    } catch {
        return url || 'Unknown';
    }
}

function formatDMSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let idx = 0;
    let val = bytesPerSec;
    while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
    return val.toFixed(idx > 0 ? 1 : 0) + ' ' + units[idx];
}

function formatDMSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
    return val.toFixed(idx > 0 ? 1 : 0) + ' ' + units[idx];
}

function formatDMEta(seconds) {
    if (!seconds || seconds <= 0) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

// =====================================================
// Surf The Web
// =====================================================

function normalizeSurfInput(rawInput) {
    const value = (rawInput || '').trim();
    if (!value) return 'https://www.google.com/';

    const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value);
    if (hasProtocol) {
        if (/^(https?|chrome-extension):\/\//i.test(value)) return value;
        return null;
    }

    const looksLikeDomain = /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-z0-9-]+\.)+[a-z]{2,})(\/.*)?$/i.test(value);
    if (looksLikeDomain) {
        return `https://${value}`;
    }

    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function setupSurfWeb() {
    let webview = document.getElementById('surf-webview');
    const backBtn = document.getElementById('surf-back-btn');
    const forwardBtn = document.getElementById('surf-forward-btn');
    const reloadBtn = document.getElementById('surf-reload-btn');
    const homeBtn = document.getElementById('surf-home-btn');
    const fullscreenBtn = document.getElementById('surf-fullscreen-btn');
    const goBtn = document.getElementById('surf-go-btn');
    const addressForm = document.getElementById('surf-address-form');
    const addressInput = document.getElementById('surf-address-input');
    const statusEl = document.getElementById('surf-status');
    const extensionsBtn = document.getElementById('surf-extensions-btn');
    const extensionsPanel = document.getElementById('surf-extensions-panel');
    const loadExtensionBtn = document.getElementById('surf-load-extension-btn');
    const openWebStoreBtn = document.getElementById('surf-open-webstore-btn');
    const installCurrentStoreBtn = document.getElementById('surf-install-current-store-btn');
    const installStoreForm = document.getElementById('surf-install-store-form');
    const storeInput = document.getElementById('surf-store-extension-input');
    const installStoreBtn = document.getElementById('surf-install-store-btn');
    const extensionsList = document.getElementById('surf-extensions-list');
    const initialWebviewUrl = webview?.getAttribute('src') || 'https://www.google.com/';
    let webviewReady = false;
    let lastStoreHintUrl = '';
    const surfFullscreenClass = 'surf-fullscreen-active';

    if (!webview || !addressInput || !addressForm) return;

    const surfUserAgent = String(navigator.userAgent || '')
        .replace(/\sElectron\/[0-9.]+/ig, '')
        .replace(/\sUniversal-File-Converter\/[0-9.]+/ig, '')
        .trim();

    const applySurfUserAgent = () => {
        if (!surfUserAgent) return;
        try {
            webview.setUserAgent(surfUserAgent);
        } catch (_) {
            // Ignore user-agent assignment failures.
        }
    };

    const escape = (text) => {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    };

    const formatErrorMessage = (err) => {
        const raw = String(err?.message || err || 'Unknown error');
        return raw
            .replace(/^Error invoking remote method '[^']+':\s*/i, '')
            .replace(/^Error:\s*/i, '');
    };

    const parseChromeStoreId = (input) => {
        const value = String(input || '').trim();
        if (!value) return '';
        const direct = value.match(/^[a-p]{32}$/i);
        if (direct) return direct[0].toLowerCase();

        try {
            const parsed = new URL(value);
            const parts = parsed.pathname.split('/').filter(Boolean);
            const idPart = parts.find((part) => /^[a-p]{32}$/i.test(part));
            return idPart ? idPart.toLowerCase() : '';
        } catch (_) {
            return '';
        }
    };

    const isChromeStoreDetailUrl = (url) => {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            if (!/chromewebstore\.google\.com$/i.test(parsed.hostname)) return false;
            if (!parsed.pathname.includes('/detail/')) return false;
            return !!parseChromeStoreId(url);
        } catch (_) {
            return false;
        }
    };

    const setStatus = (text) => {
        if (statusEl) statusEl.textContent = text || 'Ready';
    };

    const setInstallCurrentStoreButtonState = (url) => {
        if (!installCurrentStoreBtn) return;
        const storeId = parseChromeStoreId(url);
        const shouldShow = !!storeId && isChromeStoreDetailUrl(url);
        installCurrentStoreBtn.classList.toggle('hidden', !shouldShow);
        installCurrentStoreBtn.dataset.storeId = storeId || '';
    };

    const updateNavButtons = () => {
        try {
            if (!webviewReady) {
                if (backBtn) backBtn.disabled = true;
                if (forwardBtn) forwardBtn.disabled = true;
                return;
            }
            if (backBtn) backBtn.disabled = !webview.canGoBack();
            if (forwardBtn) forwardBtn.disabled = !webview.canGoForward();
        } catch {
            if (backBtn) backBtn.disabled = true;
            if (forwardBtn) forwardBtn.disabled = true;
        }
    };

    const getWebviewUrlSafe = () => {
        try {
            return webview.getURL() || '';
        } catch (_) {
            return '';
        }
    };

    const getWebviewTitleSafe = () => {
        try {
            return webview.getTitle() || '';
        } catch (_) {
            return '';
        }
    };

    const renderExtensions = (items) => {
        if (!extensionsList) return;

        if (!items || items.length === 0) {
            extensionsList.innerHTML = '<div class="surf-extension-empty">No extensions loaded</div>';
            return;
        }

        extensionsList.innerHTML = items.map((ext) => {
            const key = encodeURIComponent(ext.id || ext.path || ext.storeId || '');
            const sourceLabel = ext.source === 'store'
                ? 'Chrome Web Store'
                : (ext.source === 'runtime' ? 'Runtime' : 'Local Folder');
            const warnings = Array.isArray(ext.warnings) ? ext.warnings.filter(Boolean) : [];
            const meta = `${sourceLabel}${ext.loaded ? ' | Loaded' : ' | Not loaded'}${ext.version ? ` | v${ext.version}` : ''}${warnings.length ? ` | ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`;
            const warningMarkup = warnings.length
                ? `<div class="surf-extension-warning" title="${escape(warnings.join(' | '))}">${escape(warnings[0])}</div>`
                : '';
            return `<div class="surf-extension-item">
                <div class="surf-extension-info">
                    <div class="surf-extension-name">${escape(ext.name || ext.id || 'Unknown Extension')}</div>
                    <div class="surf-extension-meta">${escape(meta)}</div>
                    ${warningMarkup}
                </div>
                <button class="surf-extension-remove" data-key="${key}">Remove</button>
            </div>`;
        }).join('');

        extensionsList.querySelectorAll('.surf-extension-remove').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const key = decodeURIComponent(btn.dataset.key || '');
                if (!key || typeof window.electronAPI.surfRemoveExtension !== 'function') return;

                btn.disabled = true;
                try {
                    await window.electronAPI.surfRemoveExtension(key);
                    showToast('Extension removed', 'info');
                    await refreshExtensionsList();
                    setStatus('Applying extension changes...');
                    setTimeout(() => window.location.reload(), 120);
                } catch (err) {
                    showToast(formatErrorMessage(err) || 'Failed to remove extension', 'error');
                } finally {
                    btn.disabled = false;
                }
            });
        });
    };

    const refreshExtensionsList = async () => {
        if (typeof window.electronAPI.surfListExtensions !== 'function') return;
        try {
            const items = await window.electronAPI.surfListExtensions();
            renderExtensions(items);
        } catch (err) {
            if (extensionsList) {
                extensionsList.innerHTML = '<div class="surf-extension-empty">Failed to load extensions</div>';
            }
        }
    };

    const setPanelOpen = (open) => {
        if (!extensionsPanel) return;
        extensionsPanel.classList.toggle('open', !!open);
        extensionsBtn?.classList.toggle('active', !!open);
        if (open) refreshExtensionsList();
    };

    const setFullscreenMode = (active) => {
        document.body.classList.toggle(surfFullscreenClass, !!active);
        if (fullscreenBtn) {
            fullscreenBtn.classList.toggle('active', !!active);
            fullscreenBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
            fullscreenBtn.title = active ? 'Exit Fullscreen' : 'Fullscreen';
        }
    };

    const isFullscreenMode = () => document.body.classList.contains(surfFullscreenClass);

    const syncAddress = (url) => {
        const currentUrl = url || getWebviewUrlSafe() || initialWebviewUrl;
        if (currentUrl) {
            addressInput.value = currentUrl;
            setInstallCurrentStoreButtonState(currentUrl);
        }
    };

    const navigateToInput = (inputValue) => {
        const targetUrl = normalizeSurfInput(inputValue);
        if (!targetUrl) {
            showToast('Only HTTP/HTTPS/Chrome-extension URLs are supported in this tab', 'warning');
            return;
        }

        try {
            webview.loadURL(targetUrl);
        } catch (err) {
            setStatus('Failed to open page');
            showToast('Could not open that page', 'error');
        }
    };

    const installFromStoreInput = async (input) => {
        if (typeof window.electronAPI.surfInstallStoreExtension !== 'function') {
            showToast('Store install API is not available', 'error');
            return;
        }

        const normalizedInput = (input || '').trim();
        if (!normalizedInput) {
            showToast('Paste a Chrome Web Store URL or extension ID', 'warning');
            return;
        }

        try {
            if (installStoreBtn) installStoreBtn.disabled = true;
            if (installCurrentStoreBtn) installCurrentStoreBtn.disabled = true;
            const result = await window.electronAPI.surfInstallStoreExtension(normalizedInput);
            const extensionName = result?.extension?.name || 'Extension';
            const warningList = Array.isArray(result?.extension?.warnings) ? result.extension.warnings.filter(Boolean) : [];

            if (warningList.length > 0) {
                showToast(`${extensionName} installed with limited support`, 'warning');
                setStatus(warningList[0]);
            } else {
                showToast(`${extensionName} installed`, 'success');
            }

            if (storeInput) storeInput.value = '';
            await refreshExtensionsList();
            setStatus('Applying extension changes...');
            setTimeout(() => window.location.reload(), 120);
        } catch (err) {
            showToast(formatErrorMessage(err) || 'Failed to install from Chrome Web Store', 'error');
        } finally {
            if (installStoreBtn) installStoreBtn.disabled = false;
            if (installCurrentStoreBtn) installCurrentStoreBtn.disabled = false;
        }
    };

    addressForm.addEventListener('submit', (e) => {
        e.preventDefault();
        navigateToInput(addressInput.value);
    });

    goBtn?.addEventListener('click', () => {
        navigateToInput(addressInput.value);
    });

    backBtn?.addEventListener('click', () => {
        if (!webviewReady) return;
        if (webview.canGoBack()) webview.goBack();
    });

    forwardBtn?.addEventListener('click', () => {
        if (!webviewReady) return;
        if (webview.canGoForward()) webview.goForward();
    });

    reloadBtn?.addEventListener('click', () => {
        if (!webviewReady) return;
        webview.reload();
    });

    homeBtn?.addEventListener('click', () => {
        navigateToInput('https://www.google.com/');
    });

    fullscreenBtn?.addEventListener('click', () => {
        setFullscreenMode(!isFullscreenMode());
    });

    extensionsBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const open = !extensionsPanel?.classList.contains('open');
        setPanelOpen(open);
    });

    document.addEventListener('click', (e) => {
        if (!extensionsPanel?.classList.contains('open')) return;
        if (e.target.closest('#surf-extensions-panel') || e.target.closest('#surf-extensions-btn')) return;
        setPanelOpen(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !isFullscreenMode()) return;
        e.preventDefault();
        setFullscreenMode(false);
    });

    loadExtensionBtn?.addEventListener('click', async () => {
        if (typeof window.electronAPI.surfSelectExtensionFolder !== 'function' || typeof window.electronAPI.surfLoadExtensionFolder !== 'function') {
            showToast('Extensions API is not available', 'error');
            return;
        }

        try {
            loadExtensionBtn.disabled = true;
            const folderPath = await window.electronAPI.surfSelectExtensionFolder();
            if (!folderPath) return;

            const result = await window.electronAPI.surfLoadExtensionFolder(folderPath);
            const extensionName = result?.extension?.name || 'Extension';
            const warningList = Array.isArray(result?.extension?.warnings) ? result.extension.warnings.filter(Boolean) : [];
            if (warningList.length > 0) {
                showToast(`${extensionName} loaded with limited support`, 'warning');
                setStatus(warningList[0]);
            } else {
                showToast(`${extensionName} loaded`, 'success');
            }
            await refreshExtensionsList();
            setStatus('Applying extension changes...');
            setTimeout(() => window.location.reload(), 120);
        } catch (err) {
            showToast(formatErrorMessage(err) || 'Failed to load local extension', 'error');
        } finally {
            loadExtensionBtn.disabled = false;
        }
    });

    openWebStoreBtn?.addEventListener('click', () => {
        navigateToInput('https://chromewebstore.google.com/');
        setStatus('Opening Chrome Web Store...');
    });

    installStoreForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await installFromStoreInput((storeInput?.value || '').trim());
    });

    installCurrentStoreBtn?.addEventListener('click', async () => {
        const currentUrl = getWebviewUrlSafe() || addressInput.value || '';
        const storeId = parseChromeStoreId(currentUrl);
        if (!storeId) {
            showToast('Open a Chrome Web Store extension details page first', 'warning');
            return;
        }
        await installFromStoreInput(currentUrl);
    });

    webview.addEventListener('dom-ready', () => {
        applySurfUserAgent();
        webviewReady = true;
        syncAddress();
        updateNavButtons();
    });

    webview.addEventListener('did-start-loading', () => {
        setStatus('Loading...');
        updateNavButtons();
    });

    webview.addEventListener('did-stop-loading', () => {
        syncAddress();
        const title = getWebviewTitleSafe();
        const currentUrl = getWebviewUrlSafe();
        if (isChromeStoreDetailUrl(currentUrl)) {
            setStatus('Chrome Web Store add button is disabled here. Use Install This Extension in toolbar.');
            if (lastStoreHintUrl !== currentUrl) {
                showToast('Use Install This Extension (toolbar) or Extensions panel to install store add-ons', 'info');
                lastStoreHintUrl = currentUrl;
            }
        } else {
            setStatus(title || currentUrl || 'Ready');
        }
        setInstallCurrentStoreButtonState(currentUrl);
        updateNavButtons();
    });

    webview.addEventListener('did-navigate', (e) => {
        syncAddress(e.url);
        setInstallCurrentStoreButtonState(e.url);
        updateNavButtons();
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
        syncAddress(e.url);
        setInstallCurrentStoreButtonState(e.url);
        updateNavButtons();
    });

    webview.addEventListener('did-fail-load', (e) => {
        if (e.errorCode === -3) return;
        setStatus(`Failed: ${e.errorDescription}`);
        showToast(`Could not load page: ${e.errorDescription}`, 'error');
        updateNavButtons();
    });

    // Keep target=_blank links in-app when webview emits this event.
    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        if (e.url) webview.loadURL(e.url);
    });

    addressInput.value = initialWebviewUrl;
    applySurfUserAgent();
    setInstallCurrentStoreButtonState(initialWebviewUrl);
    updateNavButtons();
    refreshExtensionsList();
}

function setupLiveWallpaperTab() {
    const pathInput = document.getElementById('wallpaper-video-path');
    const selectBtn = document.getElementById('wallpaper-select-btn');
    const statusEl = document.getElementById('wallpaper-status');
    const startBtn = document.getElementById('wallpaper-start-btn');
    const stopBtn = document.getElementById('wallpaper-stop-btn');
    const mutedToggle = document.getElementById('wallpaper-muted');
    const loopToggle = document.getElementById('wallpaper-loop');
    const volumeSlider = document.getElementById('wallpaper-volume');
    const volumeValue = document.getElementById('wallpaper-volume-value');
    const playbackRateSelect = document.getElementById('wallpaper-playback-rate');
    const fitModeSelect = document.getElementById('wallpaper-fit-mode');

    if (!pathInput || !statusEl || !startBtn || !stopBtn) return;

    const api = window.electronAPI;
    if (!api?.liveWallpaperStatus || !api?.liveWallpaperStart || !api?.liveWallpaperStop || !api?.liveWallpaperSelectVideo) {
        statusEl.textContent = 'Live wallpaper API is not available in this build.';
        statusEl.classList.add('error');
        return;
    }

    const setStatus = (text, mode = '') => {
        statusEl.textContent = text || 'Ready';
        statusEl.classList.remove('running', 'error');
        if (mode) statusEl.classList.add(mode);
    };

    const ensureAudibleVolumeOnUnmute = () => {
        if (!mutedToggle || !volumeSlider) return;
        if (!mutedToggle.checked && Number(volumeSlider.value || 0) <= 0) {
            volumeSlider.value = '40';
        }
    };

    const updateVolumeUI = () => {
        const volume = Number(volumeSlider?.value || 0);
        if (volumeValue) {
            volumeValue.textContent = mutedToggle?.checked ? `${volume}% (muted)` : `${volume}%`;
        }
        if (volumeSlider) {
            updateSliderTrack(volumeSlider);
        }
    };

    const getOptions = () => ({
        filePath: (pathInput.value || '').trim(),
        muted: !!mutedToggle?.checked,
        loop: !!loopToggle?.checked,
        volume: Number(volumeSlider?.value || 0),
        playbackRate: Number(playbackRateSelect?.value || 1),
        fitMode: String(fitModeSelect?.value || 'cover')
    });

    const applyStatus = (status) => {
        const settings = status?.settings || {};
        if (typeof settings.filePath === 'string') pathInput.value = settings.filePath;
        if (mutedToggle && typeof settings.muted === 'boolean') mutedToggle.checked = settings.muted;
        if (loopToggle && typeof settings.loop === 'boolean') loopToggle.checked = settings.loop;
        if (volumeSlider && Number.isFinite(Number(settings.volume))) {
            volumeSlider.value = String(settings.volume);
        }
        if (playbackRateSelect && settings.playbackRate) {
            playbackRateSelect.value = String(settings.playbackRate);
        }
        if (fitModeSelect && settings.fitMode) {
            fitModeSelect.value = String(settings.fitMode);
        }

        updateVolumeUI();

        if (status?.running) {
            setStatus('Wallpaper running behind desktop icons.', 'running');
        } else if (status?.lastError) {
            setStatus(status.lastError, 'error');
        } else {
            setStatus('Wallpaper is currently stopped.');
        }
    };

    const refreshStatus = async () => {
        try {
            const status = await api.liveWallpaperStatus();
            applyStatus(status);
            if (status?.supported === false) {
                setStatus('Live wallpaper is supported on Windows only.', 'error');
            }
        } catch (err) {
            setStatus(err?.message || 'Failed to read wallpaper status', 'error');
        }
    };

    selectBtn?.addEventListener('click', async () => {
        try {
            const selectedPath = await api.liveWallpaperSelectVideo();
            if (!selectedPath) return;
            pathInput.value = selectedPath;
            setStatus('Video selected. Click Start / Apply Wallpaper to enable.');
        } catch (err) {
            setStatus(err?.message || 'Failed to select video file', 'error');
        }
    });

    startBtn?.addEventListener('click', async () => {
        const options = getOptions();
        if (!options.filePath) {
            showToast('Choose an MP4 file first', 'warning');
            return;
        }

        startBtn.disabled = true;
        try {
            const status = await api.liveWallpaperStart(options);
            applyStatus(status);
            showToast('Live wallpaper started', 'success');
        } catch (err) {
            const message = String(err?.message || err || 'Failed to start live wallpaper');
            setStatus(message, 'error');
            showToast(message, 'error');
        } finally {
            startBtn.disabled = false;
        }
    });

    stopBtn?.addEventListener('click', async () => {
        stopBtn.disabled = true;
        try {
            const status = await api.liveWallpaperStop();
            applyStatus(status);
            showToast('Live wallpaper stopped', 'info');
        } catch (err) {
            const message = String(err?.message || err || 'Failed to stop live wallpaper');
            setStatus(message, 'error');
            showToast(message, 'error');
        } finally {
            stopBtn.disabled = false;
        }
    });

    mutedToggle?.addEventListener('change', () => {
        ensureAudibleVolumeOnUnmute();
        updateVolumeUI();
    });
    volumeSlider?.addEventListener('input', updateVolumeUI);
    playbackRateSelect?.addEventListener('change', () => setStatus('Playback speed updated. Click Start / Apply to apply.'));
    fitModeSelect?.addEventListener('change', () => setStatus('Fit mode updated. Click Start / Apply to apply.'));
    loopToggle?.addEventListener('change', () => setStatus('Loop setting updated. Click Start / Apply to apply.'));

    updateVolumeUI();
    refreshStatus();
}

// =====================================================
// Universal Player
// =====================================================

const PLAYER_STREAM_MODE_STORAGE_KEY = 'player-stream-playback-mode-v1';
const PLAYER_STREAM_RESOLUTION_STORAGE_KEY = 'player-stream-video-resolution-v1';
const PLAYER_VIDEO_RESOLUTIONS = ['auto', '1080', '720', '480', '360'];

function playerReadStreamPlaybackMode() {
    try {
        return localStorage.getItem(PLAYER_STREAM_MODE_STORAGE_KEY) === 'video' ? 'video' : 'audio';
    } catch (err) {
        console.error('Failed to load player stream playback mode:', err);
        return 'audio';
    }
}

function playerNormalizeStreamResolution(value) {
    const normalized = String(value || '').toLowerCase();
    return PLAYER_VIDEO_RESOLUTIONS.includes(normalized) ? normalized : 'auto';
}

function playerReadStreamResolution() {
    try {
        return playerNormalizeStreamResolution(localStorage.getItem(PLAYER_STREAM_RESOLUTION_STORAGE_KEY));
    } catch (err) {
        console.error('Failed to load player video resolution preference:', err);
        return 'auto';
    }
}

const playerState = {
    playlist: [],
    currentIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeat: 'none', // none, all, one
    mediaType: null, // 'audio' or 'video'
    audioContext: null,
    analyser: null,
    sourceNode: null,
    animationFrame: null,
    seekDragging: false,
    // Lyrics state
    lyricsLines: [],      // parsed [{time: seconds, text: string}]
    lyricsVisible: false,
    currentLrcIndex: -1,
    lyricsFilePath: null,
    // Streaming state
    isStreaming: false,
    streamQueue: [],
    streamCurrentIndex: -1,
    streamPlaybackMode: playerReadStreamPlaybackMode(),
    streamVideoResolution: playerReadStreamResolution(),
    queueVisible: false,
    libraryTab: 'queue',
    savedPlaylists: [],
    isDownloadingCurrent: false
};

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'aiff', 'opus', 'ac3', 'dts', 'amr', 'wv', 'ape', 'mka'];
const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'm4v', '3gp', 'ts', 'vob', 'mts', 'ogv'];
const PLAYER_AUDIO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const PLAYER_VIDEO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/></svg>';
const PLAYER_ALBUM_FALLBACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="80" height="80"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const PLAYER_PLAYLIST_STORAGE_KEY = 'player-saved-playlists-v1';

function createStreamTrack(result) {
    if (!result) return null;
    const url = result.url || (result.id ? `https://www.youtube.com/watch?v=${result.id}` : '');
    if (!url) return null;

    return {
        id: result.id || null,
        title: result.title || 'Unknown',
        url,
        spotifyUrl: result.spotifyUrl || '',
        source: result.source || '',
        thumbnail: result.thumbnail || '',
        duration: Number(result.duration) || 0,
        uploader: result.uploader || '',
        view_count: Number(result.view_count) || 0,
        streamUrl: result.streamUrl || null
    };
}

function createLocalPlayerFile(value) {
    const filePath = typeof value === 'string' ? value : value?.path;
    if (!filePath) return null;

    const type = getMediaType(filePath);
    if (!type) return null;

    return {
        path: filePath,
        name: value?.name || filePath.split(/[\\/]/).pop(),
        type,
        ext: (value?.ext || filePath.split('.').pop() || '').toUpperCase(),
        thumbnail: value?.thumbnail || null,
        thumbnailState: value?.thumbnail ? 'ready' : 'idle'
    };
}

function playerGetActiveQueueMode() {
    if (playerState.isStreaming && playerState.streamQueue.length > 0) return 'stream';
    if (playerState.playlist.length > 0) return 'local';
    return null;
}

function playerGetQueueByMode(mode) {
    return mode === 'stream' ? playerState.streamQueue : playerState.playlist;
}

function playerGetActiveQueue() {
    const mode = playerGetActiveQueueMode();
    return mode ? playerGetQueueByMode(mode) : [];
}

function playerGetCurrentTrack() {
    if (playerState.isStreaming && playerState.streamCurrentIndex >= 0) {
        return {
            mode: 'stream',
            track: playerState.streamQueue[playerState.streamCurrentIndex] || null
        };
    }

    if (playerState.currentIndex >= 0) {
        return {
            mode: 'local',
            track: playerState.playlist[playerState.currentIndex] || null
        };
    }

    return { mode: null, track: null };
}

function playerUpdateDownloadButtonState() {
    const button = document.getElementById('player-download-current-btn');
    if (!button) return;

    const current = playerGetCurrentTrack();
    const canDownload = current.mode === 'stream' && !!current.track?.url;

    button.disabled = !canDownload || playerState.isDownloadingCurrent;
    button.classList.toggle('loading', playerState.isDownloadingCurrent);

    if (playerState.isDownloadingCurrent) {
        button.title = 'Downloading current song as MP3 320 kbps...';
    } else if (canDownload) {
        button.title = 'Download current song as MP3 320 kbps';
    } else {
        button.title = 'Play a streaming song to download it as MP3 320 kbps';
    }
}

async function playerDownloadCurrentTrack() {
    if (playerState.isDownloadingCurrent) return;

    const current = playerGetCurrentTrack();
    const track = current.track;
    if (current.mode !== 'stream' || !track?.url) {
        showToast('Play a streaming song first to download it', 'warning');
        playerUpdateDownloadButtonState();
        return;
    }

    playerState.isDownloadingCurrent = true;
    playerUpdateDownloadButtonState();

    const trackTitle = track.title || 'Current song';

    try {
        showToast(`Downloading "${trackTitle}" as MP3 320 kbps`, 'info');

        const result = await window.electronAPI.downloadMedia({
            url: track.url,
            format: 'mp3',
            quality: 'best',
            audioBitrate: '320',
            audioOnly: true,
            downloadSubtitles: false,
            downloadThumbnail: false,
            subtitleLanguage: 'en'
        });

        if (!result || result.success === false) {
            throw new Error(result?.message || 'Download failed');
        }

        addToDownloadHistory({
            title: trackTitle,
            format: 'mp3',
            quality: '320kbps',
            size: result.outputSize || 0
        }, true);

        showToast(`Saved "${trackTitle}" as MP3 320 kbps`, 'success');
        if (state.settings.showNotifications) {
            window.electronAPI.showNotification(
                'Download Complete',
                `${trackTitle} has been saved as MP3 320 kbps`
            );
        }
    } catch (err) {
        console.error('Current track download failed:', err);
        addToDownloadHistory({
            title: trackTitle,
            format: 'mp3',
            quality: '320kbps'
        }, false);
        showToast('Download failed: ' + err.message, 'error');
    } finally {
        playerState.isDownloadingCurrent = false;
        playerUpdateDownloadButtonState();
    }
}

function playerLoadSavedPlaylists() {
    try {
        const parsed = JSON.parse(localStorage.getItem(PLAYER_PLAYLIST_STORAGE_KEY) || '[]');
        playerState.savedPlaylists = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error('Failed to load player playlists:', err);
        playerState.savedPlaylists = [];
    }
}

function playerPersistSavedPlaylists() {
    try {
        localStorage.setItem(PLAYER_PLAYLIST_STORAGE_KEY, JSON.stringify(playerState.savedPlaylists));
    } catch (err) {
        console.error('Failed to save player playlists:', err);
    }
}

function playerPersistStreamPlaybackMode() {
    try {
        localStorage.setItem(PLAYER_STREAM_MODE_STORAGE_KEY, playerState.streamPlaybackMode);
    } catch (err) {
        console.error('Failed to save player stream playback mode:', err);
    }
}

function playerPersistStreamResolution() {
    try {
        localStorage.setItem(PLAYER_STREAM_RESOLUTION_STORAGE_KEY, playerState.streamVideoResolution);
    } catch (err) {
        console.error('Failed to save player video resolution preference:', err);
    }
}

function playerGetStreamPlaybackLabel(mode) {
    return mode === 'video' ? 'MP4 Video' : 'MP3 Audio';
}

function playerGetStreamResolutionLabel(resolution) {
    const normalized = playerNormalizeStreamResolution(resolution);
    return normalized === 'auto' ? 'Auto' : `${normalized}p`;
}

function playerToggleVideoFullscreen(forceOpen = false) {
    const videoWrapper = document.getElementById('player-video-wrapper');
    if (!videoWrapper) return;

    if (document.fullscreenElement === videoWrapper) {
        if (!forceOpen) {
            const exitResult = document.exitFullscreen?.();
            if (typeof exitResult?.catch === 'function') {
                exitResult.catch(() => {});
            }
        }
        return;
    }

    if (typeof videoWrapper.requestFullscreen === 'function') {
        const requestResult = videoWrapper.requestFullscreen();
        if (typeof requestResult?.catch === 'function') {
            requestResult.catch((err) => {
                console.error('Failed to enter fullscreen:', err);
            });
        }
    }
}

function playerUpdateVideoStageControls() {
    const fullscreenBtn = document.getElementById('player-video-fullscreen-btn');
    const resolutionBtn = document.getElementById('player-video-resolution-btn');
    const resolutionLabel = document.getElementById('player-video-resolution-label');
    const resolutionPopup = document.getElementById('player-video-resolution-popup');
    const canFullscreen = playerState.mediaType === 'video';
    const canChooseResolution = playerState.isStreaming && playerState.streamPlaybackMode === 'video';

    if (fullscreenBtn) {
        fullscreenBtn.disabled = !canFullscreen;
    }

    if (!canChooseResolution && resolutionPopup) {
        resolutionPopup.classList.remove('open');
    }

    if (resolutionBtn) {
        resolutionBtn.disabled = !canChooseResolution;
        resolutionBtn.setAttribute('aria-expanded', resolutionPopup?.classList.contains('open') ? 'true' : 'false');
    }

    if (resolutionLabel) {
        resolutionLabel.textContent = playerGetStreamResolutionLabel(playerState.streamVideoResolution);
    }

    document.querySelectorAll('.player-video-resolution-option').forEach((button) => {
        const isActive = button.dataset.playerResolution === playerState.streamVideoResolution;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

}

function playerSetVideoStageVisible(visible, options = {}) {
    const stage = document.getElementById('player-video-stage');
    const stageMode = document.getElementById('player-video-stage-mode');
    const stageCaption = document.getElementById('player-video-stage-caption');
    if (!stage) return;

    stage.classList.toggle('visible', visible);
    stage.setAttribute('aria-hidden', visible ? 'false' : 'true');

    if (stageMode && options.label) stageMode.textContent = options.label;
    if (stageCaption && options.caption) stageCaption.textContent = options.caption;
    playerUpdateVideoStageControls();
}

function playerUpdateStreamModeUI() {
    document.querySelectorAll('.sp-stream-mode-btn').forEach((button) => {
        const isActive = button.dataset.streamMode === playerState.streamPlaybackMode;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    playerUpdateVideoStageControls();
}

function playerSetStreamPlaybackMode(mode, { restartCurrent = true } = {}) {
    const nextMode = mode === 'video' ? 'video' : 'audio';
    if (playerState.streamPlaybackMode === nextMode) {
        playerUpdateStreamModeUI();
        return;
    }

    playerState.streamPlaybackMode = nextMode;
    playerPersistStreamPlaybackMode();
    playerUpdateStreamModeUI();

    if (restartCurrent && playerState.isStreaming && playerState.streamCurrentIndex >= 0) {
        const current = playerState.streamQueue[playerState.streamCurrentIndex];
        if (current) {
            streamPlayResult(current, playerState.streamQueue, null);
        }
    }
}

function playerSetStreamResolution(resolution, { restartCurrent = true } = {}) {
    const nextResolution = playerNormalizeStreamResolution(resolution);
    if (playerState.streamVideoResolution === nextResolution) {
        playerUpdateVideoStageControls();
        return;
    }

    playerState.streamVideoResolution = nextResolution;
    playerPersistStreamResolution();
    playerUpdateVideoStageControls();

    if (restartCurrent && playerState.isStreaming && playerState.streamCurrentIndex >= 0 && playerState.streamPlaybackMode === 'video') {
        const current = playerState.streamQueue[playerState.streamCurrentIndex];
        if (current) {
            streamPlayResult(current, playerState.streamQueue, null);
        }
    }
}

function playerSerializeTrack(mode, item) {
    if (mode === 'stream') {
        return {
            id: item.id || null,
            title: item.title || 'Unknown',
            url: item.url,
            thumbnail: item.thumbnail || '',
            duration: Number(item.duration) || 0,
            uploader: item.uploader || '',
            view_count: Number(item.view_count) || 0
        };
    }

    return {
        path: item.path,
        name: item.name,
        ext: item.ext,
        thumbnail: item.thumbnail || null
    };
}

function playerGetQueueSnapshot() {
    const mode = playerGetActiveQueueMode();
    const queue = playerGetActiveQueue();
    if (!mode || queue.length === 0) return null;

    return {
        mode,
        tracks: queue.map((item) => playerSerializeTrack(mode, item))
    };
}

function playerSuggestPlaylistName() {
    const mode = playerGetActiveQueueMode();
    const queue = playerGetActiveQueue();
    if (!mode || queue.length === 0) return 'My Playlist';

    const firstTitle = mode === 'stream'
        ? (queue[0].title || 'My Playlist')
        : playerNameWithoutExtension(queue[0].name || 'My Playlist');

    if (queue.length === 1) return firstTitle;
    return `${firstTitle} Mix`;
}

function playerSwitchLibraryTab(tab) {
    playerState.libraryTab = tab === 'playlists' ? 'playlists' : 'queue';

    document.querySelectorAll('.sp-queue-tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.playerTab === playerState.libraryTab);
    });

    const queuePanel = document.getElementById('player-queue-panel');
    const playlistsPanel = document.getElementById('player-playlists-panel');
    if (queuePanel) queuePanel.classList.toggle('active', playerState.libraryTab === 'queue');
    if (playlistsPanel) playlistsPanel.classList.toggle('active', playerState.libraryTab === 'playlists');
}

function playerSetQueueVisibility(visible, tab) {
    if (tab) playerSwitchLibraryTab(tab);
    else playerSwitchLibraryTab(playerState.libraryTab);

    playerState.queueVisible = !!visible;
    const page = document.getElementById('page-player');
    if (page) page.classList.toggle('queue-open', playerState.queueVisible);

    document.getElementById('player-queue-toggle')?.classList.toggle('active', playerState.queueVisible);
    document.getElementById('player-queue-open-btn')?.classList.toggle('active', playerState.queueVisible);
}

function playerUpdateQueueBadges() {
    const mode = playerGetActiveQueueMode();
    const queue = playerGetActiveQueue();
    const count = queue.length;
    const label = mode === 'local'
        ? `${count} file${count === 1 ? '' : 's'}`
        : `${count} track${count === 1 ? '' : 's'}`;

    const queueCount = document.getElementById('sp-queue-count');
    if (queueCount) queueCount.textContent = count > 0 ? label : '0 tracks';

    const topBadge = document.getElementById('player-queue-open-count');
    if (topBadge) topBadge.textContent = String(count);

    const toggleBadge = document.getElementById('player-queue-toggle-count');
    if (toggleBadge) toggleBadge.textContent = String(count);

    const saveQueueBtn = document.getElementById('sp-queue-save');
    const savePlaylistBtn = document.getElementById('player-save-playlist-btn');
    if (saveQueueBtn) saveQueueBtn.disabled = count === 0;
    if (savePlaylistBtn) savePlaylistBtn.disabled = count === 0;
}

function playerOpenPlaylistSaveComposer() {
    if (playerGetActiveQueue().length === 0) {
        showToast('Add songs to the queue first', 'warning');
        return;
    }

    playerSetQueueVisibility(true, 'playlists');
    const input = document.getElementById('player-playlist-name');
    if (input && !input.value.trim()) {
        input.value = playerSuggestPlaylistName();
    }
    input?.focus();
    input?.select();
}

function playerSaveCurrentQueueAsPlaylist(name) {
    const snapshot = playerGetQueueSnapshot();
    if (!snapshot) {
        showToast('Nothing to save yet', 'warning');
        return false;
    }

    const trimmedName = (name || '').trim() || playerSuggestPlaylistName() || 'My Playlist';
    const existingIndex = playerState.savedPlaylists.findIndex((item) => item.name.toLowerCase() === trimmedName.toLowerCase());
    const existing = existingIndex >= 0 ? playerState.savedPlaylists[existingIndex] : null;
    const savedPlaylist = {
        id: existing?.id || `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        mode: snapshot.mode,
        tracks: snapshot.tracks,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        playerState.savedPlaylists[existingIndex] = savedPlaylist;
    } else {
        playerState.savedPlaylists.unshift(savedPlaylist);
    }

    playerPersistSavedPlaylists();
    renderSavedPlayerPlaylists();
    playerSwitchLibraryTab('playlists');
    showToast(existing ? 'Playlist updated' : 'Playlist saved', 'success');
    return true;
}

function playerDeleteSavedPlaylist(playlistId) {
    const before = playerState.savedPlaylists.length;
    playerState.savedPlaylists = playerState.savedPlaylists.filter((item) => item.id !== playlistId);
    if (playerState.savedPlaylists.length === before) return;

    playerPersistSavedPlaylists();
    renderSavedPlayerPlaylists();
    showToast('Playlist removed', 'success');
}

function renderSavedPlayerPlaylists() {
    const container = document.getElementById('player-saved-playlists');
    if (!container) return;

    if (playerState.savedPlaylists.length === 0) {
        container.innerHTML = '<div class="sp-empty-card">Save a queue and it will appear here so you can launch it again later.</div>';
        return;
    }

    container.innerHTML = playerState.savedPlaylists.map((playlist) => {
        const firstTrack = playlist.tracks?.[0];
        const cover = firstTrack?.thumbnail || '';
        const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0;
        const modeLabel = playlist.mode === 'stream' ? 'Streaming' : 'Local files';
        return `<div class="sp-saved-playlist" data-playlist-id="${playlist.id}">
            <div class="sp-saved-playlist-cover">
                ${cover ? `<img src="${cover}" alt="" loading="lazy">` : PLAYER_AUDIO_ICON}
            </div>
            <div class="sp-saved-playlist-info">
                <div class="sp-saved-playlist-title">${playerEscapeHtml(playlist.name)}</div>
                <div class="sp-saved-playlist-meta">${trackCount} item${trackCount === 1 ? '' : 's'} | ${modeLabel}</div>
            </div>
            <div class="sp-saved-playlist-actions">
                <button class="sp-saved-playlist-btn" data-playlist-action="launch" data-playlist-id="${playlist.id}">Launch</button>
                <button class="sp-saved-playlist-delete" data-playlist-action="delete" data-playlist-id="${playlist.id}" title="Delete playlist">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-playlist-action="launch"]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            playerLoadSavedPlaylist(button.dataset.playlistId);
        });
    });

    container.querySelectorAll('[data-playlist-action="delete"]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            playerDeleteSavedPlaylist(button.dataset.playlistId);
        });
    });

    container.querySelectorAll('.sp-saved-playlist').forEach((card) => {
        card.addEventListener('click', () => {
            playerLoadSavedPlaylist(card.dataset.playlistId);
        });
    });
}

function playerLoadSavedPlaylist(playlistId) {
    const playlist = playerState.savedPlaylists.find((item) => item.id === playlistId);
    if (!playlist) return;

    const welcome = document.getElementById('sp-welcome');
    const nowPlaying = document.getElementById('sp-now-playing');
    if (welcome) welcome.style.display = 'none';
    if (nowPlaying) { nowPlaying.style.display = 'flex'; nowPlaying.classList.add('sp-np-enter'); }

    if (playlist.mode === 'stream') {
        playerState.playlist = [];
        playerState.currentIndex = -1;
        playerState.playlist = [];
        playerState.currentIndex = -1;
        playerState.isStreaming = true;
        playerState.streamQueue = (playlist.tracks || []).map(createStreamTrack).filter(Boolean);
        playerState.streamCurrentIndex = 0;
        renderPlayerQueue();
        playerSetQueueVisibility(true, 'queue');

        if (playerState.streamQueue.length === 0) {
            showToast('This playlist is empty', 'warning');
            return;
        }

        streamPlayResult(playerState.streamQueue[0], playerState.streamQueue, null);
    } else {
        playerState.isStreaming = false;
        playerState.streamQueue = [];
        playerState.streamCurrentIndex = -1;
        playerState.playlist = (playlist.tracks || []).map(createLocalPlayerFile).filter(Boolean);
        playerState.currentIndex = -1;
        renderPlayerQueue();
        playerSetQueueVisibility(true, 'queue');

        if (playerState.playlist.length === 0) {
            showToast('This playlist is empty', 'warning');
            return;
        }

        playerState.playlist.forEach((file) => playerEnsureArtwork(file));
        playerPlayIndex(0);
    }

    showToast(`Launched "${playlist.name}"`, 'success');
}

function getMediaType(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
    return null;
}

function playerEscapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function playerPathToFileUrl(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const encodedPath = encodeURI(normalizedPath).replace(/#/g, '%23').replace(/\?/g, '%3F');
    return 'file:///' + encodedPath;
}

function playerNameWithoutExtension(fileName) {
    return (fileName || '').replace(/\.[^/.]+$/, '');
}

function playerHashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function playerGetInitials(fileName) {
    const clean = playerNameWithoutExtension(fileName).trim();
    if (!clean) return 'A';
    const words = clean.split(/[\s_\-.]+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

function createPlayerAudioCover(fileName) {
    const size = 220;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const seed = playerHashString(fileName || 'audio');
    const hueA = seed % 360;
    const hueB = (hueA + 42) % 360;
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, `hsl(${hueA}, 78%, 46%)`);
    gradient.addColorStop(1, `hsl(${hueB}, 82%, 56%)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(size * 0.78, size * 0.26, size * 0.26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.font = '700 32px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(playerGetInitials(fileName), 20, 20);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = '700 94px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', size / 2, size / 2 + 8);

    return canvas.toDataURL('image/png');
}

function createPlayerVideoThumbnail(filePath) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        let completed = false;
        let timeoutId = null;

        const cleanup = () => {
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.onloadeddata = null;
            video.onseeked = null;
            video.onerror = null;
            if (timeoutId) clearTimeout(timeoutId);
        };

        const done = (thumbnail) => {
            if (completed) return;
            completed = true;
            cleanup();
            resolve(thumbnail || null);
        };

        const capture = () => {
            if (!video.videoWidth || !video.videoHeight) {
                done(null);
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = 220;
            canvas.height = 220;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                done(null);
                return;
            }

            const srcRatio = video.videoWidth / video.videoHeight;
            const dstRatio = canvas.width / canvas.height;
            let sx = 0;
            let sy = 0;
            let sw = video.videoWidth;
            let sh = video.videoHeight;

            if (srcRatio > dstRatio) {
                sw = video.videoHeight * dstRatio;
                sx = (video.videoWidth - sw) / 2;
            } else if (srcRatio < dstRatio) {
                sh = video.videoWidth / dstRatio;
                sy = (video.videoHeight - sh) / 2;
            }

            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

            const overlay = ctx.createLinearGradient(0, canvas.height, 0, canvas.height * 0.4);
            overlay.addColorStop(0, 'rgba(0, 0, 0, 0.36)');
            overlay.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = overlay;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            done(canvas.toDataURL('image/jpeg', 0.86));
        };

        video.onloadeddata = () => {
            const duration = Number.isFinite(video.duration) ? video.duration : 0;
            const target = duration > 0 ? Math.max(0, Math.min(duration - 0.05, duration * 0.15)) : 0;

            if (target <= 0) {
                capture();
                return;
            }

            video.onseeked = () => capture();
            try {
                video.currentTime = target;
            } catch {
                capture();
            }
        };

        video.onerror = () => done(null);

        timeoutId = setTimeout(() => done(null), 6000);

        video.src = playerPathToFileUrl(filePath);
        video.load();
    });
}

async function playerEnsureArtwork(file) {
    if (!file || file.thumbnailState === 'loading' || file.thumbnailState === 'ready') return;
    file.thumbnailState = 'loading';

    if (file.type === 'audio') {
        // Try to extract embedded cover art from the audio file
        let coverArt = null;
        try {
            if (window.electronAPI && window.electronAPI.extractCoverArt) {
                coverArt = await window.electronAPI.extractCoverArt(file.path);
            }
        } catch (e) {
            console.log('Cover art extraction not available:', e);
        }

        file.thumbnail = coverArt || createPlayerAudioCover(file.name);
        file.thumbnailState = 'ready';
        if (playerState.playlist[playerState.currentIndex] === file && playerState.mediaType === 'audio') {
            updatePlayerAlbumArt(file);
        }
        renderPlayerPlaylist();
        return;
    }

    try {
        file.thumbnail = await createPlayerVideoThumbnail(file.path);
        file.thumbnailState = 'ready';
    } catch (err) {
        file.thumbnail = null;
        file.thumbnailState = 'error';
    }

    renderPlayerPlaylist();
}

function updatePlayerAlbumArt(file) {
    const artImg = document.getElementById('sp-np-art-img');
    const artFallback = document.querySelector('.sp-np-art-fallback');
    if (!artImg) return;

    if (file && file.thumbnail) {
        artImg.src = file.thumbnail;
        artImg.style.display = 'block';
        if (artFallback) artFallback.style.display = 'none';
        playerExtractDominantColor(file.thumbnail);
    } else {
        artImg.src = '';
        artImg.style.display = 'none';
        if (artFallback) artFallback.style.display = 'block';
        // Reset glow to default
        const np = document.getElementById('sp-now-playing');
        if (np) np.style.removeProperty('--np-glow-color');
    }
}

// =====================================================
// Streaming Search & Playback
// =====================================================

function formatStreamDuration(seconds) {
    if (!seconds || !isFinite(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViewCount(count) {
    if (!count) return '';
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M views';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K views';
    return count + ' views';
}

function setupStreamSearch() {
    const form = document.getElementById('stream-search-form');
    const input = document.getElementById('stream-search-input');
    const clearBtn = document.getElementById('stream-search-clear');
    const resultsContainer = document.getElementById('stream-search-results');
    const resultsGrid = document.getElementById('stream-results-grid');
    const resultsCount = document.getElementById('stream-results-count');
    const resultsClose = document.getElementById('stream-results-close');
    const addAllBtn = document.getElementById('stream-results-add-all');
    const loading = document.getElementById('stream-search-loading');
    let lastSearchResults = [];

    if (!form || !input) return;

    input.addEventListener('input', () => {
        clearBtn.style.display = input.value.length > 0 ? 'block' : 'none';
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        input.focus();
    });

    resultsClose.addEventListener('click', () => {
        resultsContainer.style.display = 'none';
        // Show welcome back if nothing is playing
        if (!playerState.isPlaying && !playerState.isStreaming && playerState.playlist.length === 0) {
            const welcome = document.getElementById('sp-welcome');
            if (welcome) welcome.style.display = 'flex';
        }
    });

    // Add all results to queue
    if (addAllBtn) {
        addAllBtn.addEventListener('click', () => {
            if (lastSearchResults.length === 0) return;
            playerState.playlist = [];
            playerState.currentIndex = -1;
            let added = 0;
            lastSearchResults.forEach(r => {
                const track = createStreamTrack(r);
                if (!track) return;
                const exists = playerState.streamQueue.some(t => t.url === track.url);
                if (!exists) {
                    playerState.streamQueue.push(track);
                    added++;
                }
            });
            if (added > 0) {
                playerState.isStreaming = true;
                renderStreamPlaylist();
                playerSetQueueVisibility(true, 'queue');
                showToast(`Added ${added} tracks to queue`, 'success');
            } else {
                showToast('All tracks already in queue', 'warning');
            }
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = input.value.trim();
        if (!query) return;

        // Detect URL type for better UX messages
        const isUrl = /^https?:\/\//i.test(query);
        const isSpotify = /spotify\.com/i.test(query);
        const isYoutube = /youtu(\.be|be\.com)/i.test(query);

        // Hide welcome, show loading with context-aware message
        const welcome = document.getElementById('sp-welcome');
        if (welcome) welcome.style.display = 'none';

        loading.style.display = 'flex';
        const loadingText = loading.querySelector('span');
        if (loadingText) {
            if (isSpotify) loadingText.textContent = 'Resolving Spotify link...';
            else if (isYoutube && isUrl) loadingText.textContent = 'Fetching from YouTube...';
            else if (isUrl) loadingText.textContent = 'Resolving link...';
            else loadingText.textContent = 'Searching...';
        }
        resultsContainer.style.display = 'none';
        resultsGrid.innerHTML = '';

        try {
            const results = await window.electronAPI.streamSearch(query);

            if (results && results.length > 0) {
                lastSearchResults = results;
                resultsCount.textContent = `${results.length} results`;

                // Group results by source for section headers
                const hasSpotify = results.some(r => r.source === 'spotify');
                const hasYoutube = results.some(r => r.source === 'youtube' || !r.source);
                const hasBothSources = hasSpotify && hasYoutube;

                const spotifyIcon = '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
                const youtubeIcon = '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>';

                const renderCard = (r, i) => `
                    <div class="stream-result-card" data-index="${i}">
                        <div class="stream-result-thumb">
                            ${r.thumbnail ? `<img src="${r.thumbnail}" alt="" loading="lazy">` : ''}
                            ${r.duration ? `<span class="stream-duration-badge">${formatStreamDuration(r.duration)}</span>` : ''}
                        </div>
                        <div class="stream-result-info">
                            <div class="stream-result-title" title="${playerEscapeHtml(r.title)}">${playerEscapeHtml(r.title)}</div>
                            <div class="stream-result-artist">${playerEscapeHtml(r.uploader)}${r.view_count ? ' \u2022 ' + formatViewCount(r.view_count) : ''}</div>
                            ${r.source ? `<span class="stream-source-badge ${r.source}">${r.source === 'spotify' ? spotifyIcon : youtubeIcon} ${r.source === 'spotify' ? 'Spotify' : 'YouTube'}</span>` : ''}
                        </div>
                        ${playerGetSpotifyUrl(r) ? `
                        <button class="stream-result-open-spotify" title="Open in Spotify" data-index="${i}">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                        </button>
                        ` : ''}
                        <button class="stream-result-add-queue" title="Add to queue" data-index="${i}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>
                        <button class="stream-result-play" title="Play" data-index="${i}">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="8,5 19,12 8,19"/></svg>
                        </button>
                    </div>`;

                let html = '';
                if (hasBothSources) {
                    const spotifyResults = results.filter(r => r.source === 'spotify');
                    const youtubeResults = results.filter(r => r.source === 'youtube' || !r.source);
                    if (spotifyResults.length > 0) {
                        html += `<div class="stream-results-section-header"><span class="stream-section-icon spotify">${spotifyIcon}</span>From Spotify</div>`;
                        html += spotifyResults.map((r) => renderCard(r, results.indexOf(r))).join('');
                    }
                    if (youtubeResults.length > 0) {
                        html += `<div class="stream-results-section-header"><span class="stream-section-icon youtube">${youtubeIcon}</span>From YouTube</div>`;
                        html += youtubeResults.map((r) => renderCard(r, results.indexOf(r))).join('');
                    }
                } else {
                    html = results.map((r, i) => renderCard(r, i)).join('');
                }

                resultsGrid.innerHTML = html;

                // Attach play handlers
                resultsGrid.querySelectorAll('.stream-result-play').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const idx = parseInt(btn.dataset.index);
                        streamPlayResult(results[idx], results, btn.closest('.stream-result-card'));
                    });
                });

                // Attach add-to-queue handlers
                resultsGrid.querySelectorAll('.stream-result-add-queue').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const idx = parseInt(btn.dataset.index);
                        addToStreamQueue(results[idx]);
                    });
                });

                resultsGrid.querySelectorAll('.stream-result-open-spotify').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const idx = parseInt(btn.dataset.index);
                        await playerOpenInSpotify(results[idx]);
                    });
                });

                // Clicking the card row itself also plays
                resultsGrid.querySelectorAll('.stream-result-card').forEach(card => {
                    card.addEventListener('click', (e) => {
                        if (e.target.closest('.stream-result-play') || e.target.closest('.stream-result-add-queue') || e.target.closest('.stream-result-open-spotify')) return;
                        const idx = parseInt(card.dataset.index);
                        streamPlayResult(results[idx], results, card);
                    });
                });

                resultsContainer.style.display = 'block';
            } else {
                resultsCount.textContent = 'No results found';
                resultsGrid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary);">No results found. Try a different search.</div>';
                resultsContainer.style.display = 'block';
            }
        } catch (err) {
            console.error('Stream search error:', err);
            showToast('Search failed: ' + err.message, 'error');
        } finally {
            loading.style.display = 'none';
        }
    });
}

// =====================================================
// Playlist Import (Spotify / YouTube / SoundCloud)
// =====================================================

function setupPlaylistImport() {
    const importBtn = document.getElementById('sp-import-playlist-btn');
    const modal = document.getElementById('sp-import-modal');
    const modalClose = document.getElementById('sp-import-modal-close');
    const urlInput = document.getElementById('sp-import-url');
    const goBtn = document.getElementById('sp-import-go-btn');
    const progress = document.getElementById('sp-import-progress');

    if (!importBtn || !modal) return;

    importBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        urlInput.value = '';
        goBtn.disabled = true;
        if (progress) progress.style.display = 'none';
        urlInput.focus();
    });

    modalClose.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    urlInput.addEventListener('input', () => {
        goBtn.disabled = !urlInput.value.trim();
    });

    goBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) return;

        goBtn.disabled = true;
        goBtn.textContent = 'Importing...';
        if (progress) {
            progress.style.display = 'block';
            progress.textContent = 'Fetching playlist tracks...';
        }

        try {
            const tracks = await window.electronAPI.importPlaylist(url);

            if (!tracks || tracks.length === 0) {
                showToast('No tracks found in playlist', 'warning');
                return;
            }

            if (progress) progress.textContent = `Found ${tracks.length} tracks!`;

            // Load tracks into stream queue
            playerState.playlist = [];
            playerState.currentIndex = -1;
            playerState.isStreaming = true;
            playerState.streamQueue = tracks.map((track) => createStreamTrack(track)).filter(Boolean);
            playerState.streamCurrentIndex = 0;

            // Hide welcome, show queue
            const welcome = document.getElementById('sp-welcome');
            if (welcome) welcome.style.display = 'none';

            renderStreamPlaylist();
            playerSetQueueVisibility(true, 'queue');
            showToast(`Imported ${tracks.length} tracks`, 'success');

            // Auto-play first track
            if (playerState.streamQueue.length > 0) {
                streamPlayResult(playerState.streamQueue[0], playerState.streamQueue, null);
            }

            // Close modal
            modal.style.display = 'none';
        } catch (err) {
            console.error('Playlist import error:', err);
            showToast('Import failed: ' + err.message, 'error');
            if (progress) progress.textContent = 'Import failed. Check the URL and try again.';
        } finally {
            goBtn.disabled = false;
            goBtn.textContent = 'Import';
        }
    });
}

// =====================================================
// Quick Chips & Queue Toggle
// =====================================================

function setupQuickChips() {
    document.querySelectorAll('#page-player [data-query]').forEach(chip => {
        chip.addEventListener('click', () => {
            const query = chip.dataset.query || chip.textContent.trim();
            const input = document.getElementById('stream-search-input');
            const form = document.getElementById('stream-search-form');
            if (input && form) {
                input.value = query;
                input.dispatchEvent(new Event('input'));
                form.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        });
    });
}

function addToStreamQueue(result) {
    const track = createStreamTrack(result);
    if (!track) return;

    // Check for duplicates
    const exists = playerState.streamQueue.some(t => t.url === track.url);
    if (exists) {
        showToast('Already in queue', 'warning');
        return;
    }

    playerState.playlist = [];
    playerState.currentIndex = -1;
    playerState.isStreaming = true;
    playerState.streamQueue.push(track);
    renderStreamPlaylist();
    showToast(`Added "${track.title}" to queue`, 'success');
}

// Extract dominant color from a thumbnail URL for ambient glow
function playerExtractDominantColor(imgUrl) {
    if (!imgUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 8;
            canvas.height = 8;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 8, 8);
            const data = ctx.getImageData(0, 0, 8, 8).data;
            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
                // Skip very dark or very light pixels
                const brightness = data[i] + data[i + 1] + data[i + 2];
                if (brightness > 60 && brightness < 700) {
                    r += data[i]; g += data[i + 1]; b += data[i + 2];
                    count++;
                }
            }
            if (count > 0) {
                r = Math.round(r / count);
                g = Math.round(g / count);
                b = Math.round(b / count);
                const np = document.getElementById('sp-now-playing');
                if (np) np.style.setProperty('--np-glow-color', `rgba(${r}, ${g}, ${b}, 0.15)`);
            }
        } catch (e) { /* CORS or canvas error — ignore */ }
    };
    img.src = imgUrl;
}

// Apply scrolling marquee to the now-playing title if it overflows
function playerApplyScrollingTitle(text) {
    const titleEl = document.getElementById('sp-np-title');
    if (!titleEl) return;
    titleEl.classList.remove('scrolling');
    titleEl.textContent = text;
    // Check overflow after a frame
    requestAnimationFrame(() => {
        if (titleEl.scrollWidth > titleEl.clientWidth) {
            titleEl.classList.add('scrolling');
            // Duplicate text for seamless scroll loop
            titleEl.innerHTML = `<span class="sp-np-title-inner">${playerEscapeHtml(text)}\u00A0\u00A0\u00A0\u2014\u00A0\u00A0\u00A0${playerEscapeHtml(text)}</span>`;
        }
    });
}

function playerGetSpotifyUrl(result) {
    if (!result) return '';
    if (result.spotifyUrl) return result.spotifyUrl;
    if (String(result.source || '').toLowerCase() === 'spotify' && typeof result.url === 'string' && /spotify\.com\//i.test(result.url)) {
        return result.url;
    }
    return '';
}

async function playerOpenInSpotify(result) {
    const spotifyUrl = playerGetSpotifyUrl(result);
    if (!spotifyUrl) {
        showToast('Spotify link not available for this result', 'warning');
        return;
    }

    try {
        if (typeof window.electronAPI.openSpotifyPlayer === 'function') {
            await window.electronAPI.openSpotifyPlayer(spotifyUrl);
        } else if (typeof window.electronAPI.openExternalUrl === 'function') {
            await window.electronAPI.openExternalUrl(spotifyUrl);
        } else {
            throw new Error('Spotify opener is unavailable');
        }
        showToast('Opened in Spotify', 'success');
    } catch (err) {
        showToast('Could not open Spotify: ' + (err?.message || 'Unknown error'), 'error');
    }
}

async function streamPlayResult(result, allResults, cardEl) {
    if (!result || !result.url) return;

    // Mark card as loading
    if (cardEl) cardEl.classList.add('loading');

    try {
        const requestedMode = playerState.streamPlaybackMode === 'video' ? 'video' : 'audio';
        const requestedResolution = requestedMode === 'video' ? playerState.streamVideoResolution : 'auto';
        const streamResponse = await window.electronAPI.getStreamUrl(result.url, {
            mode: requestedMode,
            resolution: requestedResolution
        });
        const streamUrl = typeof streamResponse === 'string' ? streamResponse : streamResponse?.streamUrl;
        const resolvedMediaType = streamResponse?.mediaType === 'video' ? 'video' : 'audio';
        const didFallback = !!streamResponse?.didFallback;
        if (!streamUrl) {
            showToast('Could not get stream URL', 'error');
            return;
        }

        // Add to streaming queue (append if queue exists, don't replace)
        playerState.isStreaming = true;
        const trackUrl = result.url || `https://www.youtube.com/watch?v=${result.id}`;
        let trackIdx = playerState.streamQueue.findIndex(t => t.url === trackUrl);
        if (trackIdx === -1) {
            // Track not in queue yet — add it
            const track = createStreamTrack(result);
            if (!track) return;
            playerState.streamQueue.push(track);
            trackIdx = playerState.streamQueue.length - 1;
        }
        playerState.streamCurrentIndex = trackIdx;

        // Set up the player with this stream
        const detailsEl = document.getElementById('sp-np-artist');
        const audio = document.getElementById('player-audio');
        const video = document.getElementById('player-video');

        // Show now-playing bar, hide welcome
        const welcome = document.getElementById('sp-welcome');
        const nowPlaying = document.getElementById('sp-now-playing');
        if (welcome) welcome.style.display = 'none';
        if (nowPlaying) { nowPlaying.style.display = 'flex'; nowPlaying.classList.add('sp-np-enter'); }

        // Stop current playback
        if (video) { video.pause(); video.src = ''; }
        if (audio) { audio.pause(); audio.src = ''; }
        if (video) {
            video.ontimeupdate = null;
            video.onloadedmetadata = null;
            video.onended = null;
        }
        if (audio) {
            audio.ontimeupdate = null;
            audio.onloadedmetadata = null;
            audio.onended = null;
        }
        if (playerState.animationFrame) {
            cancelAnimationFrame(playerState.animationFrame);
            playerState.animationFrame = null;
        }

        // Update UI
        playerApplyScrollingTitle(result.title);
        if (detailsEl) {
            detailsEl.textContent = resolvedMediaType === 'video'
                ? `${result.uploader || 'YouTube'} \u2022 Streaming MP4 \u2022 ${playerGetStreamResolutionLabel(requestedResolution)}`
                : `${result.uploader || 'YouTube'} \u2022 Streaming MP3`;
        }

        // Set album art from thumbnail
        const artImg = document.getElementById('sp-np-art-img');
        const artFallback = document.querySelector('.sp-np-art-fallback');
        const artContainer = document.getElementById('sp-np-art');
        if (artImg && result.thumbnail) {
            artImg.src = result.thumbnail;
            artImg.style.display = 'block';
            if (artFallback) artFallback.style.display = 'none';
            if (artContainer) artContainer.classList.add('playing');
            playerExtractDominantColor(result.thumbnail);
        } else if (artImg) {
            artImg.src = '';
            artImg.style.display = 'none';
            if (artFallback) artFallback.style.display = 'block';
            if (artContainer) artContainer.classList.remove('playing');
        }

        // Play the stream
        playerState.mediaType = resolvedMediaType;
        playerState.currentIndex = -1; // Not a local file
        playerUpdateVideoStageControls();
        if (resolvedMediaType === 'video' && video) {
            playerSetVideoStageVisible(true, {
                label: `${playerGetStreamPlaybackLabel('video')} • ${playerGetStreamResolutionLabel(requestedResolution)}`,
                caption: 'Watching the current YouTube result in the Player tab. Double-click the video for fullscreen.'
            });
            video.src = streamUrl;
            video.load();

            video.play().then(() => {
                playerState.isPlaying = true;
                updatePlayButton(true);
                startAudioVisualization(video);
            }).catch(e => console.error('Stream play error:', e));

            video.ontimeupdate = () => updatePlayerProgress(video);
            video.onloadedmetadata = () => updatePlayerDuration(video);
            video.onended = () => streamOnEnded();
        } else if (audio) {
            playerSetVideoStageVisible(false);
            audio.src = streamUrl;
            audio.load();

            audio.play().then(() => {
                playerState.isPlaying = true;
                updatePlayButton(true);
                startAudioVisualization(audio);
            }).catch(e => console.error('Stream play error:', e));

            audio.ontimeupdate = () => updatePlayerProgress(audio);
            audio.onloadedmetadata = () => updatePlayerDuration(audio);
            audio.onended = () => streamOnEnded();
        }

        // Apply current volume
        const volumeSlider = document.getElementById('player-volume-slider');
        if (volumeSlider) {
            const volume = parseInt(volumeSlider.value) / 100;
            if (audio) audio.volume = volume;
            if (video) video.volume = volume;
        }

        // Apply current speed
        const speedLabel = document.getElementById('player-speed-label');
        if (speedLabel) {
            const speed = parseFloat(speedLabel.textContent);
            if (audio) audio.playbackRate = speed;
            if (video) video.playbackRate = speed;
        }

        if (didFallback && requestedMode === 'video') {
            showToast('This result could not open in the selected video quality, so it fell back to MP3 audio.', 'warning');
        }

        // Update playlist to show stream queue
        renderStreamPlaylist();

        // Mark now-playing result card
        document.querySelectorAll('.stream-result-card.now-playing').forEach(c => c.classList.remove('now-playing'));
        if (cardEl) cardEl.classList.add('now-playing');

        // Media Session
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: result.title,
                artist: result.uploader || 'YouTube',
                artwork: result.thumbnail ? [{ src: result.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : []
            });
        }
    } catch (err) {
        console.error('Stream play error:', err);
        showToast('Failed to play: ' + err.message, 'error');
    } finally {
        if (cardEl) cardEl.classList.remove('loading');
    }
}

async function streamOnEnded() {
    playerState.isPlaying = false;
    updatePlayButton(false);

    if (!playerState.isStreaming || playerState.streamQueue.length === 0) return;

    if (playerState.repeat === 'one') {
        // Replay current
        const current = playerState.streamQueue[playerState.streamCurrentIndex];
        if (current) streamPlayResult(current, playerState.streamQueue, null);
        return;
    }

    let nextIdx;
    if (playerState.shuffle) {
        nextIdx = Math.floor(Math.random() * playerState.streamQueue.length);
    } else {
        nextIdx = playerState.streamCurrentIndex + 1;
    }

    if (nextIdx >= playerState.streamQueue.length) {
        if (playerState.repeat === 'all') {
            nextIdx = 0;
        } else {
            return; // End of queue
        }
    }

    playerState.streamCurrentIndex = nextIdx;
    const next = playerState.streamQueue[nextIdx];
    if (next) streamPlayResult(next, playerState.streamQueue, null);
}

function renderStreamPlaylist() {
    renderPlayerQueue();
}

function playerPlayQueueIndex(mode, index) {
    if (mode === 'stream') {
        const track = playerState.streamQueue[index];
        if (track) {
            playerState.streamCurrentIndex = index;
            streamPlayResult(track, playerState.streamQueue, null);
        }
        return;
    }

    playerPlayIndex(index);
}

function playerMoveQueueItem(mode, index, direction) {
    const queue = playerGetQueueByMode(mode);
    const targetIndex = index + direction;
    if (!queue[targetIndex]) return;

    [queue[index], queue[targetIndex]] = [queue[targetIndex], queue[index]];

    if (mode === 'stream') {
        if (playerState.streamCurrentIndex === index) playerState.streamCurrentIndex = targetIndex;
        else if (playerState.streamCurrentIndex === targetIndex) playerState.streamCurrentIndex = index;
    } else {
        if (playerState.currentIndex === index) playerState.currentIndex = targetIndex;
        else if (playerState.currentIndex === targetIndex) playerState.currentIndex = index;
    }

    renderPlayerQueue();
}

function playerRemoveFromStreamQueue(index) {
    if (index < 0 || index >= playerState.streamQueue.length) return;

    const removingCurrent = index === playerState.streamCurrentIndex;
    playerState.streamQueue.splice(index, 1);

    if (playerState.streamQueue.length === 0) {
        playerClearPlaylist();
        return;
    }

    if (index < playerState.streamCurrentIndex) {
        playerState.streamCurrentIndex--;
    } else if (removingCurrent) {
        const nextIndex = Math.min(index, playerState.streamQueue.length - 1);
        playerState.streamCurrentIndex = nextIndex;
        streamPlayResult(playerState.streamQueue[nextIndex], playerState.streamQueue, null);
        return;
    }

    renderPlayerQueue();
}

function renderPlayerQueue() {
    const container = document.getElementById('sp-queue-items');
    if (!container) return;

    const mode = playerGetActiveQueueMode();
    const queue = playerGetActiveQueue();
    playerUpdateQueueBadges();
    playerUpdateDownloadButtonState();

    if (!mode || queue.length === 0) {
        container.innerHTML = '<div class="sp-empty-card">Queue is empty. Add local files or send songs here from the search results.</div>';
        return;
    }

    container.innerHTML = queue.map((item, idx) => {
        const isActive = mode === 'stream' ? idx === playerState.streamCurrentIndex : idx === playerState.currentIndex;
        const title = mode === 'stream' ? item.title : item.name;
        const meta = mode === 'stream'
            ? (item.uploader || 'Streaming')
            : `${item.ext || ''} | ${item.type === 'audio' ? 'Local audio' : 'Local video'}`;
        const duration = mode === 'stream'
            ? formatStreamDuration(item.duration)
            : (item.type === 'audio' ? 'Audio' : 'Video');
        const thumbContent = item.thumbnail
            ? `<img src="${item.thumbnail}" alt="" loading="lazy">`
            : (mode === 'stream' || item.type === 'audio' ? PLAYER_AUDIO_ICON : PLAYER_VIDEO_ICON);

        return `<div class="sp-queue-item ${isActive ? 'active' : ''}" data-queue-mode="${mode}" data-index="${idx}">
            <span class="sp-queue-item-num">${idx + 1}</span>
            <div class="sp-queue-item-thumb">${thumbContent}</div>
            <div class="sp-queue-item-info">
                <div class="sp-queue-item-title">${playerEscapeHtml(title)}</div>
                <div class="sp-queue-item-artist">${playerEscapeHtml(meta)}</div>
            </div>
            <div class="sp-queue-item-actions">
                <span class="sp-queue-item-duration">${playerEscapeHtml(duration)}</span>
                <button class="sp-queue-item-action" data-queue-action="up" data-index="${idx}" data-queue-mode="${mode}" title="Move up" ${idx === 0 ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <button class="sp-queue-item-action" data-queue-action="down" data-index="${idx}" data-queue-mode="${mode}" title="Move down" ${idx === queue.length - 1 ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <button class="sp-queue-item-remove" data-queue-action="remove" data-index="${idx}" data-queue-mode="${mode}" title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.sp-queue-item').forEach((itemEl) => {
        itemEl.addEventListener('click', (event) => {
            if (event.target.closest('[data-queue-action]')) return;
            const modeValue = itemEl.dataset.queueMode;
            const index = parseInt(itemEl.dataset.index, 10);
            playerPlayQueueIndex(modeValue, index);
        });
    });

    container.querySelectorAll('[data-queue-action]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const modeValue = button.dataset.queueMode;
            const index = parseInt(button.dataset.index, 10);
            const action = button.dataset.queueAction;

            if (action === 'up') playerMoveQueueItem(modeValue, index, -1);
            if (action === 'down') playerMoveQueueItem(modeValue, index, 1);
            if (action === 'remove') {
                if (modeValue === 'stream') playerRemoveFromStreamQueue(index);
                else playerRemoveFromPlaylist(index);
            }
        });
    });

    const activeItem = container.querySelector('.sp-queue-item.active');
    if (activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function setupUniversalPlayer() {
    const browseBtn = document.getElementById('player-browse-btn');
    const playBtn = document.getElementById('player-play-btn');
    const prevBtn = document.getElementById('player-prev-btn');
    const nextBtn = document.getElementById('player-next-btn');
    const shuffleBtn = document.getElementById('player-shuffle-btn');
    const repeatBtn = document.getElementById('player-repeat-btn');
    const volumeBtn = document.getElementById('player-volume-btn');
    const volumeSlider = document.getElementById('player-volume-slider');
    const speedBtn = document.getElementById('player-speed-btn');
    const speedPopup = document.getElementById('player-speed-popup');
    const seekbar = document.getElementById('player-seekbar');
    const downloadCurrentBtn = document.getElementById('player-download-current-btn');
    const queueToggle = document.getElementById('player-queue-toggle');
    const queueOpenBtn = document.getElementById('player-queue-open-btn');
    const queueCloseBtn = document.getElementById('player-queue-close');
    const queueClearBtn = document.getElementById('sp-queue-clear');
    const queueSaveBtn = document.getElementById('sp-queue-save');
    const savePlaylistBtn = document.getElementById('player-save-playlist-btn');
    const playlistNameInput = document.getElementById('player-playlist-name');
    const streamModeButtons = document.querySelectorAll('.sp-stream-mode-btn');
    const fullscreenBtn = document.getElementById('player-video-fullscreen-btn');
    const resolutionBtn = document.getElementById('player-video-resolution-btn');
    const resolutionPopup = document.getElementById('player-video-resolution-popup');
    const resolutionOptions = document.querySelectorAll('.player-video-resolution-option');

    playerLoadSavedPlaylists();
    playerUpdateStreamModeUI();
    playerUpdateVideoStageControls();
    renderSavedPlayerPlaylists();
    renderPlayerQueue();
    playerSwitchLibraryTab('queue');
    playerSetQueueVisibility(false, 'queue');

    // Browse files
    const browseFiles = async () => {
        try {
            const files = await window.electronAPI.selectFiles('player');
            if (files && files.length > 0) {
                playerAddFiles(files);
            }
        } catch (e) {
            console.error('Failed to browse player files:', e);
        }
    };

    browseBtn?.addEventListener('click', browseFiles);
    streamModeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            playerSetStreamPlaybackMode(button.dataset.streamMode);
        });
    });
    fullscreenBtn?.addEventListener('click', () => {
        playerToggleVideoFullscreen(true);
    });
    resolutionBtn?.addEventListener('click', (event) => {
        if (resolutionBtn.disabled || !resolutionPopup) return;
        event.stopPropagation();
        resolutionPopup.classList.toggle('open');
        resolutionBtn.setAttribute('aria-expanded', resolutionPopup.classList.contains('open') ? 'true' : 'false');
    });
    resolutionOptions.forEach((button) => {
        button.addEventListener('click', () => {
            playerSetStreamResolution(button.dataset.playerResolution);
            resolutionPopup?.classList.remove('open');
            resolutionBtn?.setAttribute('aria-expanded', 'false');
        });
    });

    // Play/Pause
    playBtn?.addEventListener('click', () => playerTogglePlay());
    downloadCurrentBtn?.addEventListener('click', () => {
        playerDownloadCurrentTrack();
    });

    // Lyrics toggle
    const lyricsToggleBtn = document.getElementById('player-lyrics-toggle-btn');
    lyricsToggleBtn?.addEventListener('click', () => {
        if (typeof playerToggleLyrics === 'function') playerToggleLyrics();
        lyricsToggleBtn.classList.toggle('active', playerState.lyricsVisible);
    });

    // Lyrics panel close button
    const lyricsCloseBtn = document.getElementById('player-lyrics-close-btn');
    lyricsCloseBtn?.addEventListener('click', () => {
        playerState.lyricsVisible = false;
        const panel = document.getElementById('player-lyrics-panel');
        const page = document.getElementById('page-player');
        if (panel) panel.style.display = 'none';
        if (page) page.classList.remove('lyrics-open');
        lyricsToggleBtn?.classList.remove('active');
    });

    // Lyrics load .lrc button
    const lyricsLoadBtn = document.getElementById('player-lyrics-load-btn');
    lyricsLoadBtn?.addEventListener('click', () => {
        if (typeof playerBrowseLrcFile === 'function') playerBrowseLrcFile();
    });

    // Prev/Next
    prevBtn?.addEventListener('click', () => playerPrev());
    nextBtn?.addEventListener('click', () => playerNext());

    // Shuffle
    shuffleBtn?.addEventListener('click', () => {
        playerState.shuffle = !playerState.shuffle;
        shuffleBtn.classList.toggle('active', playerState.shuffle);
    });

    // Repeat
    repeatBtn?.addEventListener('click', () => {
        if (playerState.repeat === 'none') {
            playerState.repeat = 'all';
            repeatBtn.classList.add('active');
            repeatBtn.title = 'Repeat All';
        } else if (playerState.repeat === 'all') {
            playerState.repeat = 'one';
            repeatBtn.classList.add('active');
            repeatBtn.title = 'Repeat One';
            repeatBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                <text x="12" y="15" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="bold">1</text>
            </svg>`;
        } else {
            playerState.repeat = 'none';
            repeatBtn.classList.remove('active');
            repeatBtn.title = 'Repeat';
            repeatBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>`;
        }
    });

    // Volume
    let lastVolume = 100;
    const updateVolumeTrack = () => {
        if (volumeSlider) volumeSlider.style.setProperty('--volume-pct', volumeSlider.value + '%');
    };
    updateVolumeTrack(); // Set initial fill
    volumeSlider?.addEventListener('input', () => {
        const vol = parseInt(volumeSlider.value) / 100;
        playerSetVolume(vol);
        lastVolume = parseInt(volumeSlider.value);
        updateVolumeIcon(vol);
        updateVolumeTrack();
    });

    volumeBtn?.addEventListener('click', () => {
        if (parseInt(volumeSlider.value) > 0) {
            lastVolume = parseInt(volumeSlider.value);
            volumeSlider.value = 0;
            playerSetVolume(0);
            updateVolumeIcon(0);
        } else {
            volumeSlider.value = lastVolume;
            playerSetVolume(lastVolume / 100);
            updateVolumeIcon(lastVolume / 100);
        }
        updateVolumeTrack();
    });

    // Speed
    speedBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const popup = document.getElementById('player-speed-popup');
        if (popup) popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });

    document.querySelectorAll('.player-speed-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const speed = parseFloat(opt.dataset.speed);
            playerSetSpeed(speed);
            document.querySelectorAll('.player-speed-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            const label = document.getElementById('player-speed-label');
            if (label) label.textContent = speed + 'x';
            if (speedPopup) speedPopup.style.display = 'none';
        });
    });

    // Close speed popup on outside click
    document.addEventListener('click', (e) => {
        if (speedPopup && !e.target.closest('#player-speed-btn') && !e.target.closest('#player-speed-popup')) {
            speedPopup.style.display = 'none';
        }
        if (resolutionPopup && !e.target.closest('#player-video-resolution-btn') && !e.target.closest('#player-video-resolution-popup')) {
            resolutionPopup.classList.remove('open');
            resolutionBtn?.setAttribute('aria-expanded', 'false');
        }
    });

    // Fullscreen overlay controls (still supported for video)
    setupFullscreenOverlay();

    // Seekbar
    if (seekbar) {
        seekbar.addEventListener('mousedown', (e) => {
            playerState.seekDragging = true;
            playerSeekTo(e);
        });
        document.addEventListener('mousemove', (e) => {
            if (playerState.seekDragging) playerSeekTo(e);
        });
        document.addEventListener('mouseup', () => {
            playerState.seekDragging = false;
        });

        // Seekbar hover tooltip
        seekbar.addEventListener('mousemove', (e) => {
            const tooltip = document.getElementById('player-seekbar-tooltip');
            if (!tooltip) return;
            const rect = seekbar.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            tooltip.style.left = (pct * 100) + '%';
            const media = document.getElementById('player-audio');
            const video = document.getElementById('player-video');
            const active = (media && media.duration) ? media : ((video && video.duration) ? video : null);
            if (active && active.duration) {
                tooltip.textContent = formatPlayerTime(pct * active.duration);
            }
        });
    }

    queueClearBtn?.addEventListener('click', () => {
        playerClearPlaylist();
    });

    document.querySelectorAll('.sp-queue-tab').forEach((button) => {
        button.addEventListener('click', () => {
            playerSwitchLibraryTab(button.dataset.playerTab);
        });
    });

    queueToggle?.addEventListener('click', () => {
        const nextVisible = !playerState.queueVisible;
        const nextTab = nextVisible && playerGetActiveQueue().length === 0 ? 'playlists' : playerState.libraryTab;
        playerSetQueueVisibility(nextVisible, nextTab);
    });

    queueOpenBtn?.addEventListener('click', () => {
        const nextVisible = !playerState.queueVisible;
        const nextTab = nextVisible && playerGetActiveQueue().length === 0 ? 'playlists' : 'queue';
        playerSetQueueVisibility(nextVisible, nextTab);
    });

    queueCloseBtn?.addEventListener('click', () => {
        playerSetQueueVisibility(false, playerState.libraryTab);
    });

    queueSaveBtn?.addEventListener('click', () => {
        playerOpenPlaylistSaveComposer();
    });

    savePlaylistBtn?.addEventListener('click', () => {
        const saved = playerSaveCurrentQueueAsPlaylist(playlistNameInput?.value || '');
        if (saved && playlistNameInput) playlistNameInput.value = '';
    });

    playlistNameInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const saved = playerSaveCurrentQueueAsPlaylist(playlistNameInput.value);
        if (saved) playlistNameInput.value = '';
    });

    // Keyboard shortcuts when on player page
    document.addEventListener('keydown', (e) => {
        if (state.currentPage !== 'player') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key === 'Escape' && playerState.queueVisible) {
            playerSetQueueVisibility(false, playerState.libraryTab);
            return;
        }

        switch (e.key) {
            case ' ':
            case 'k':
            case 'K':
                e.preventDefault();
                playerTogglePlay();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                playerSeekRelative(-5);
                break;
            case 'ArrowRight':
                e.preventDefault();
                playerSeekRelative(5);
                break;
            case 'ArrowUp':
                e.preventDefault();
                volumeSlider.value = Math.min(100, parseInt(volumeSlider.value) + 5);
                playerSetVolume(parseInt(volumeSlider.value) / 100);
                updateVolumeIcon(parseInt(volumeSlider.value) / 100);
                break;
            case 'ArrowDown':
                e.preventDefault();
                volumeSlider.value = Math.max(0, parseInt(volumeSlider.value) - 5);
                playerSetVolume(parseInt(volumeSlider.value) / 100);
                updateVolumeIcon(parseInt(volumeSlider.value) / 100);
                break;
            case 'n':
            case 'N':
                playerNext();
                break;
            case 'p':
            case 'P':
                playerPrev();
                break;
            case 'End':
                e.preventDefault();
                playerEndCurrent();
                break;
        }
    });
}

function setupFullscreenOverlay() {
    const videoWrapper = document.getElementById('player-video-wrapper');
    const overlay = document.getElementById('fs-overlay-controls');
    const video = document.getElementById('player-video');
    if (!videoWrapper || !overlay || !video) return;

    let hideTimeout = null;

    function showOverlay() {
        overlay.classList.add('visible');
        videoWrapper.style.cursor = 'default';
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            if (document.fullscreenElement) {
                overlay.classList.remove('visible');
                videoWrapper.style.cursor = 'none';
            }
        }, 2500);
    }

    // Show/hide overlay on mouse movement in fullscreen
    videoWrapper.addEventListener('mousemove', () => {
        if (document.fullscreenElement) showOverlay();
    });

    videoWrapper.addEventListener('mouseleave', () => {
        if (document.fullscreenElement) {
            clearTimeout(hideTimeout);
            overlay.classList.remove('visible');
        }
    });

    // Double-click video to toggle fullscreen
    video.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            playerToggleVideoFullscreen(true);
        }
    });

    // On fullscreen change, sync state
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement === videoWrapper) {
            // Entering fullscreen — update overlay state
            const titleEl = document.getElementById('fs-overlay-title');
            const trackTitle = document.getElementById('sp-np-title');
            if (titleEl && trackTitle) titleEl.textContent = trackTitle.textContent;

            // Sync volume slider
            const mainVolume = document.getElementById('player-volume-slider');
            const fsVolume = document.getElementById('fs-volume-slider');
            if (mainVolume && fsVolume) fsVolume.value = mainVolume.value;

            // Sync play/pause icons
            updatePlayButton(playerState.isPlaying);
            playerUpdateVideoStageControls();

            showOverlay();
        } else {
            // Exiting fullscreen
            overlay.classList.remove('visible');
            videoWrapper.style.cursor = 'default';
            clearTimeout(hideTimeout);
            playerUpdateVideoStageControls();
        }
    });

    // Fullscreen play/pause button
    const fsCenterPlayBtn = document.getElementById('fs-center-play-btn');
    fsCenterPlayBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        playerTogglePlay();
    });

    // Click on video to play/pause
    video.addEventListener('click', (e) => {
        if (document.fullscreenElement) {
            e.preventDefault();
            playerTogglePlay();
            showOverlay();
        }
    });

    // Fullscreen seekbar
    const fsSeekbar = document.getElementById('fs-seekbar');
    if (fsSeekbar) {
        fsSeekbar.addEventListener('click', (e) => {
            const rect = fsSeekbar.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (video.duration && isFinite(video.duration)) {
                video.currentTime = pct * video.duration;
            }
        });
    }

    // Fullscreen volume slider
    const fsVolumeSlider = document.getElementById('fs-volume-slider');
    if (fsVolumeSlider) {
        fsVolumeSlider.addEventListener('input', () => {
            const vol = parseInt(fsVolumeSlider.value) / 100;
            video.volume = vol;
            // Sync main volume slider
            const mainVolume = document.getElementById('player-volume-slider');
            if (mainVolume) mainVolume.value = fsVolumeSlider.value;
            updateVolumeIcon(vol);
        });
    }

    // Fullscreen mute toggle
    const fsVolumeBtn = document.getElementById('fs-volume-btn');
    let fsLastVolume = 100;
    fsVolumeBtn?.addEventListener('click', () => {
        if (parseInt(fsVolumeSlider.value) > 0) {
            fsLastVolume = parseInt(fsVolumeSlider.value);
            fsVolumeSlider.value = 0;
            video.volume = 0;
        } else {
            fsVolumeSlider.value = fsLastVolume;
            video.volume = fsLastVolume / 100;
        }
        const mainVolume = document.getElementById('player-volume-slider');
        if (mainVolume) mainVolume.value = fsVolumeSlider.value;
        updateVolumeIcon(parseInt(fsVolumeSlider.value) / 100);
    });

    // Exit fullscreen button
    const fsExitBtn = document.getElementById('fs-exit-fullscreen-btn');
    fsExitBtn?.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
    });
}

function updateVolumeIcon(vol) {
    const icon = document.getElementById('player-volume-icon');
    if (!icon) return;
    if (vol === 0) {
        icon.innerHTML = `<polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" stroke="none"/>
            <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/>
            <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/>`;
    } else if (vol < 0.5) {
        icon.innerHTML = `<polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" stroke="none"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"/>`;
    } else {
        icon.innerHTML = `<polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" stroke="none"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"/>`;
    }
}

function playerAddFiles(filePaths) {
    // Switch from streaming to local file mode
    playerState.isStreaming = false;
    playerState.streamQueue = [];
    playerState.streamCurrentIndex = -1;

    const newFiles = filePaths.map((filePath) => createLocalPlayerFile(filePath)).filter(Boolean);

    if (newFiles.length === 0) return;

    const wasEmpty = playerState.playlist.length === 0;
    playerState.playlist.push(...newFiles);

    // Show now-playing bar, hide welcome
    const welcome = document.getElementById('sp-welcome');
    const nowPlaying = document.getElementById('sp-now-playing');
    if (welcome) welcome.style.display = 'none';
    if (nowPlaying) { nowPlaying.style.display = 'flex'; nowPlaying.classList.add('sp-np-enter'); }

    renderPlayerPlaylist();
    newFiles.forEach(file => {
        playerEnsureArtwork(file);
    });

    // Auto-play first file if playlist was empty
    if (wasEmpty) {
        playerPlayIndex(0);
    }
}

function playerPlayIndex(index) {
    if (index < 0 || index >= playerState.playlist.length) return;

    const file = playerState.playlist[index];
    playerState.currentIndex = index;
    playerState.mediaType = file.type;

    // Clear previous lyrics and auto-detect for new track
    playerClearLyrics();
    if (file.type === 'audio') {
        playerAutoDetectLyrics(file.path);
    }

    const video = document.getElementById('player-video');
    const audio = document.getElementById('player-audio');
    const detailsEl = document.getElementById('sp-np-artist');

    // Stop current playback
    if (video) { video.pause(); video.src = ''; }
    if (audio) { audio.pause(); audio.src = ''; }
    if (playerState.animationFrame) {
        cancelAnimationFrame(playerState.animationFrame);
        playerState.animationFrame = null;
    }

    // Update UI
    playerApplyScrollingTitle(file.name);
    if (detailsEl) detailsEl.textContent = file.ext + ' \u2022 ' + file.type.charAt(0).toUpperCase() + file.type.slice(1);

    // Show now-playing bar, hide welcome
    const welcome = document.getElementById('sp-welcome');
    const nowPlaying = document.getElementById('sp-now-playing');
    if (welcome) welcome.style.display = 'none';
    if (nowPlaying) { nowPlaying.style.display = 'flex'; nowPlaying.classList.add('sp-np-enter'); }

    if (file.type === 'video') {
        playerSetVideoStageVisible(true, {
            label: 'Local Video',
            caption: 'Playing a local video file in the Player tab. Double-click the video for fullscreen.'
        });
        updatePlayerAlbumArt(null);

        // Use file:// protocol for local files
        video.src = playerPathToFileUrl(file.path);
        video.load();
        video.play().then(() => {
            playerState.isPlaying = true;
            updatePlayButton(true);
            startAudioVisualization(video);
        }).catch(e => console.error('Video play error:', e));

        // Set up time update
        video.ontimeupdate = () => updatePlayerProgress(video);
        video.onloadedmetadata = () => updatePlayerDuration(video);
        video.onended = () => playerOnEnded();
    } else {
        playerSetVideoStageVisible(false);
        updatePlayerAlbumArt(file);

        audio.src = playerPathToFileUrl(file.path);
        audio.load();
        audio.play().then(() => {
            playerState.isPlaying = true;
            updatePlayButton(true);
            startAudioVisualization(audio);
        }).catch(e => console.error('Audio play error:', e));

        audio.ontimeupdate = () => updatePlayerProgress(audio);
        audio.onloadedmetadata = () => updatePlayerDuration(audio);
        audio.onended = () => playerOnEnded();
    }

    // Apply current volume and speed
    const volumeSlider = document.getElementById('player-volume-slider');
    if (volumeSlider) {
        const vol = parseInt(volumeSlider.value) / 100;
        if (file.type === 'video' && video) video.volume = vol;
        if (file.type === 'audio' && audio) audio.volume = vol;
    }

    const speedLabel = document.getElementById('player-speed-label');
    if (speedLabel) {
        const speed = parseFloat(speedLabel.textContent);
        if (file.type === 'video' && video) video.playbackRate = speed;
        if (file.type === 'audio' && audio) audio.playbackRate = speed;
    }

    renderPlayerPlaylist();
}

function playerTogglePlay() {
    if (playerState.currentIndex < 0 && !playerState.isStreaming) return;

    const media = getActiveMedia();
    if (!media) return;

    if (playerState.isPlaying) {
        media.pause();
        playerState.isPlaying = false;
        updatePlayButton(false);
    } else {
        media.play().then(() => {
            playerState.isPlaying = true;
            updatePlayButton(true);
            startAudioVisualization(media);
        }).catch(e => console.error('Play error:', e));
    }
}

function playerPrev() {
    // Handle streaming mode
    if (playerState.isStreaming && playerState.streamQueue.length > 0) {
        const media = getActiveMedia();
        if (media && media.currentTime > 3) {
            media.currentTime = 0;
            return;
        }
        let idx = playerState.streamCurrentIndex - 1;
        if (idx < 0) idx = playerState.streamQueue.length - 1;
        playerState.streamCurrentIndex = idx;
        streamPlayResult(playerState.streamQueue[idx], playerState.streamQueue, null);
        return;
    }

    if (playerState.playlist.length === 0) return;
    const media = getActiveMedia();
    if (media && media.currentTime > 3) {
        media.currentTime = 0;
        return;
    }
    let idx = playerState.currentIndex - 1;
    if (idx < 0) idx = playerState.playlist.length - 1;
    playerPlayIndex(idx);
}

function playerNext() {
    // Handle streaming mode
    if (playerState.isStreaming && playerState.streamQueue.length > 0) {
        let idx;
        if (playerState.shuffle) {
            idx = Math.floor(Math.random() * playerState.streamQueue.length);
        } else {
            idx = playerState.streamCurrentIndex + 1;
            if (idx >= playerState.streamQueue.length) idx = 0;
        }
        playerState.streamCurrentIndex = idx;
        streamPlayResult(playerState.streamQueue[idx], playerState.streamQueue, null);
        return;
    }

    if (playerState.playlist.length === 0) return;
    let idx;
    if (playerState.shuffle) {
        idx = Math.floor(Math.random() * playerState.playlist.length);
    } else {
        idx = playerState.currentIndex + 1;
        if (idx >= playerState.playlist.length) idx = 0;
    }
    playerPlayIndex(idx);
}

function playerEndCurrent() {
    if (playerState.currentIndex < 0 && !playerState.isStreaming) return;
    const media = getActiveMedia();
    if (media) media.pause();
    playerOnEnded();
}

function playerStop() {
    const media = getActiveMedia();
    if (!media) return;

    media.pause();
    media.currentTime = 0;
    playerState.isPlaying = false;
    updatePlayButton(false);
}

function playerOnEnded() {
    playerState.isPlaying = false;
    updatePlayButton(false);

    // If streaming, delegate to stream handler
    if (playerState.isStreaming) {
        streamOnEnded();
        return;
    }

    if (playerState.repeat === 'one') {
        playerPlayIndex(playerState.currentIndex);
    } else if (playerState.repeat === 'all') {
        playerNext();
    } else {
        // No repeat - play next if available
        if (playerState.currentIndex < playerState.playlist.length - 1) {
            playerNext();
        }
    }
}

function getActiveMedia() {
    if (playerState.mediaType === 'video') return document.getElementById('player-video');
    if (playerState.mediaType === 'audio') return document.getElementById('player-audio');
    return null;
}

function updatePlayButton(playing) {
    const playIcon = document.getElementById('player-play-icon');
    const pauseIcon = document.getElementById('player-pause-icon');
    if (playIcon) playIcon.style.display = playing ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = playing ? 'block' : 'none';
    // Sync fullscreen overlay
    const fsPlayIcon = document.getElementById('fs-play-icon');
    const fsPauseIcon = document.getElementById('fs-pause-icon');
    if (fsPlayIcon) fsPlayIcon.style.display = playing ? 'none' : 'block';
    if (fsPauseIcon) fsPauseIcon.style.display = playing ? 'block' : 'none';
}

function updatePlayerProgress(media) {
    if (playerState.seekDragging) return;
    if (!media || !media.duration) return;

    const progress = (media.currentTime / media.duration) * 100;
    const progressBar = document.getElementById('player-seekbar-progress');
    const thumb = document.getElementById('player-seekbar-thumb');
    const currentTimeEl = document.getElementById('player-current-time');

    if (progressBar) progressBar.style.width = progress + '%';
    if (thumb) thumb.style.left = progress + '%';
    if (currentTimeEl) currentTimeEl.textContent = formatPlayerTime(media.currentTime);

    // Sync fullscreen overlay progress
    const fsProgressBar = document.getElementById('fs-seekbar-progress');
    const fsCurrentTime = document.getElementById('fs-current-time');
    if (fsProgressBar) fsProgressBar.style.width = progress + '%';
    if (fsCurrentTime) fsCurrentTime.textContent = formatPlayerTime(media.currentTime);

    // Update lyrics sync
    updateLyricsSync(media.currentTime);
}

function updatePlayerDuration(media) {
    const durationEl = document.getElementById('player-duration');
    if (durationEl && media.duration && isFinite(media.duration)) {
        durationEl.textContent = formatPlayerTime(media.duration);
    }
    // Sync fullscreen overlay duration
    const fsDurationEl = document.getElementById('fs-duration');
    if (fsDurationEl && media.duration && isFinite(media.duration)) {
        fsDurationEl.textContent = formatPlayerTime(media.duration);
    }
}

function formatPlayerTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function playerSeekTo(e) {
    const seekbar = document.getElementById('player-seekbar');
    const media = getActiveMedia();
    if (!seekbar || !media || !media.duration) return;

    const rect = seekbar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = x / rect.width;
    media.currentTime = percent * media.duration;
    updatePlayerProgress(media);
}

function playerSeekRelative(seconds) {
    const media = getActiveMedia();
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(media.duration || 0, media.currentTime + seconds));
}

function playerSetVolume(vol) {
    const video = document.getElementById('player-video');
    const audio = document.getElementById('player-audio');
    if (video) video.volume = vol;
    if (audio) audio.volume = vol;
}

function playerSetSpeed(speed) {
    const video = document.getElementById('player-video');
    const audio = document.getElementById('player-audio');
    if (video) video.playbackRate = speed;
    if (audio) audio.playbackRate = speed;
}

function playerClearPlaylist() {
    const video = document.getElementById('player-video');
    const audio = document.getElementById('player-audio');
    if (video) { video.pause(); video.src = ''; }
    if (audio) { audio.pause(); audio.src = ''; }

    if (playerState.animationFrame) {
        cancelAnimationFrame(playerState.animationFrame);
        playerState.animationFrame = null;
    }

    playerState.playlist = [];
    playerState.currentIndex = -1;
    playerState.isPlaying = false;
    playerState.mediaType = null;
    playerState.isStreaming = false;
    playerState.streamQueue = [];
    playerState.streamCurrentIndex = -1;
    playerSetVideoStageVisible(false);

    // Reset UI - show welcome, hide now-playing
    const welcome = document.getElementById('sp-welcome');
    const nowPlaying = document.getElementById('sp-now-playing');
    if (welcome) welcome.style.display = 'flex';
    if (nowPlaying) nowPlaying.style.display = 'none';

    updatePlayButton(false);
    updatePlayerAlbumArt(null);

    const titleEl = document.getElementById('sp-np-title');
    const artistEl = document.getElementById('sp-np-artist');
    if (titleEl) {
        titleEl.classList.remove('scrolling');
        titleEl.textContent = 'Not Playing';
    }
    if (artistEl) artistEl.textContent = 'Select a track';

    const progressBar = document.getElementById('player-seekbar-progress');
    const thumb = document.getElementById('player-seekbar-thumb');
    const currentTimeEl = document.getElementById('player-current-time');
    const durationEl = document.getElementById('player-duration');
    if (progressBar) progressBar.style.width = '0%';
    if (thumb) thumb.style.left = '0%';
    if (currentTimeEl) currentTimeEl.textContent = '0:00';
    if (durationEl) durationEl.textContent = '0:00';

    renderPlayerPlaylist();
    playerUpdateQueueBadges();
}

// =====================================================
// Player Lyrics System (LRC Parser + Sync)
// =====================================================

/**
 * Parse LRC format lyrics into timed lines
 * Supports: [mm:ss.xx] text, [mm:ss] text, metadata tags [ti:], [ar:], etc.
 */
function parseLRC(lrcContent) {
    const lines = lrcContent.split('\n');
    const parsed = [];

    for (const line of lines) {
        // Match timestamp patterns: [mm:ss.xx] or [mm:ss]
        const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:])(\d{1,3})?\]/g;
        const textPart = line.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();

        // Skip metadata tags like [ti:], [ar:], [al:], [by:]
        if (/^\[[a-zA-Z]{2}:/.test(line.trim())) continue;

        let match;
        while ((match = timeRegex.exec(line)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const centiseconds = match[3] ? parseInt(match[3].padEnd(2, '0').slice(0, 2), 10) : 0;
            const time = minutes * 60 + seconds + centiseconds / 100;

            parsed.push({ time, text: textPart || '♪' });
        }
    }

    // Sort by time
    parsed.sort((a, b) => a.time - b.time);
    return parsed;
}

/**
 * Load lyrics from an .lrc file path
 */
async function playerLoadLyricsFromFile(filePath) {
    try {
        const result = await window.electronAPI.readLrcFile(filePath);
        if (result && result.content) {
            const lines = parseLRC(result.content);
            if (lines.length === 0) {
                showToast('No timed lyrics found in file', 'warning');
                return false;
            }
            playerState.lyricsLines = lines;
            playerState.currentLrcIndex = -1;
            playerState.lyricsFilePath = filePath;
            renderLyricsContent();
            return true;
        } else {
            showToast('Failed to read lyrics file', 'error');
            return false;
        }
    } catch (err) {
        showToast('Error loading lyrics: ' + err.message, 'error');
        return false;
    }
}

/**
 * Open file dialog to select and load .lrc file
 */
async function playerBrowseLrcFile() {
    try {
        const result = await window.electronAPI.selectLrcFile();
        if (!result) return; // cancelled
        if (result.error) {
            showToast('Error: ' + result.error, 'error');
            return;
        }
        const lines = parseLRC(result.content);
        if (lines.length === 0) {
            showToast('No timed lyrics found in file', 'warning');
            return;
        }
        playerState.lyricsLines = lines;
        playerState.currentLrcIndex = -1;
        playerState.lyricsFilePath = result.path;
        renderLyricsContent();
        showToast(`Lyrics loaded: ${lines.length} lines`, 'success');
    } catch (err) {
        showToast('Error loading lyrics', 'error');
    }
}

/**
 * Auto-detect .lrc file next to the current audio file
 */
async function playerAutoDetectLyrics(audioPath) {
    if (!audioPath) return;
    // Replace audio extension with .lrc
    const lrcPath = audioPath.replace(/\.[^.]+$/, '.lrc');
    if (lrcPath === audioPath) return;

    try {
        const result = await window.electronAPI.readLrcFile(lrcPath);
        if (result && result.content) {
            const lines = parseLRC(result.content);
            if (lines.length > 0) {
                playerState.lyricsLines = lines;
                playerState.currentLrcIndex = -1;
                playerState.lyricsFilePath = lrcPath;
                renderLyricsContent();
                // Auto-show lyrics panel if we found a matching file
                if (!playerState.lyricsVisible) {
                    playerToggleLyrics();
                }
            }
        }
    } catch (e) {
        // No auto-detected lyrics, that's fine
    }
}

/**
 * Render lyrics content into the panel
 */
function renderLyricsContent() {
    const content = document.getElementById('player-lyrics-content');
    if (!content) return;

    if (playerState.lyricsLines.length === 0) {
        content.innerHTML = `
            <div class="player-lyrics-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                </svg>
                <p>No lyrics loaded</p>
                <span>Click "Load .lrc" to add a lyrics file</span>
            </div>`;
        return;
    }

    const linesHTML = playerState.lyricsLines.map((line, idx) =>
        `<div class="player-lyrics-line" data-index="${idx}" data-time="${line.time}">${escapeHTML(line.text)}</div>`
    ).join('');

    content.innerHTML = linesHTML;

    // Make lyrics lines clickable to seek
    content.querySelectorAll('.player-lyrics-line').forEach(el => {
        el.addEventListener('click', () => {
            const time = parseFloat(el.dataset.time);
            const media = getActiveMedia();
            if (media && isFinite(time)) {
                media.currentTime = time;
            }
        });
    });
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Update lyrics sync based on current playback time
 */
function updateLyricsSync(currentTime) {
    if (!playerState.lyricsVisible || playerState.lyricsLines.length === 0) return;

    const lines = playerState.lyricsLines;
    let newIndex = -1;

    // Find the current line based on time
    for (let i = lines.length - 1; i >= 0; i--) {
        if (currentTime >= lines[i].time) {
            newIndex = i;
            break;
        }
    }

    if (newIndex === playerState.currentLrcIndex) return;
    playerState.currentLrcIndex = newIndex;

    const content = document.getElementById('player-lyrics-content');
    if (!content) return;

    // Update active class
    const allLines = content.querySelectorAll('.player-lyrics-line');
    allLines.forEach((el, idx) => {
        el.classList.toggle('active', idx === newIndex);
        el.classList.toggle('past', idx < newIndex);
    });

    // Auto-scroll to active line
    if (newIndex >= 0 && allLines[newIndex]) {
        const activeLine = allLines[newIndex];
        const containerRect = content.getBoundingClientRect();
        const lineRect = activeLine.getBoundingClientRect();
        const offset = lineRect.top - containerRect.top - containerRect.height / 2 + lineRect.height / 2;
        content.scrollBy({ top: offset, behavior: 'smooth' });
    }
}

/**
 * Toggle lyrics panel visibility
 */
function playerToggleLyrics() {
    playerState.lyricsVisible = !playerState.lyricsVisible;
    const panel = document.getElementById('player-lyrics-panel');
    const page = document.getElementById('page-player');
    const btn = document.getElementById('player-lyrics-toggle-btn');

    if (page) page.classList.toggle('lyrics-open', playerState.lyricsVisible);
    if (panel) panel.style.display = playerState.lyricsVisible ? 'flex' : 'none';
    if (btn) btn.classList.toggle('active', playerState.lyricsVisible);

    if (playerState.lyricsVisible) {
        renderLyricsContent();
    }
}

/**
 * Clear lyrics state (called when switching tracks)
 */
function playerClearLyrics() {
    playerState.lyricsLines = [];
    playerState.currentLrcIndex = -1;
    playerState.lyricsFilePath = null;
    renderLyricsContent();
}

function renderPlayerPlaylist() {
    playerState.playlist.forEach(file => {
        if (!file.thumbnail && (file.thumbnailState === 'idle' || !file.thumbnailState)) {
            playerEnsureArtwork(file);
        }
    });
    renderPlayerQueue();
}

function playerRemoveFromPlaylist(index) {
    if (index === playerState.currentIndex) {
        // Currently playing - stop and play next
        const media = getActiveMedia();
        if (media) { media.pause(); media.src = ''; }
        playerState.playlist.splice(index, 1);
        if (playerState.playlist.length === 0) {
            playerClearPlaylist();
            return;
        }
        playerState.currentIndex = Math.min(index, playerState.playlist.length - 1);
        playerPlayIndex(playerState.currentIndex);
    } else {
        playerState.playlist.splice(index, 1);
        if (index < playerState.currentIndex) {
            playerState.currentIndex--;
        }
        if (playerState.playlist.length === 0) {
            playerClearPlaylist();
            return;
        }
        renderPlayerPlaylist();
    }
}

function startAudioVisualization(audioElement) {
    const canvas = document.getElementById('player-visualizer');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Skip Web Audio API visualization for streaming (cross-origin) content
    // createMediaElementSource() fails with CORS and taints the audio element
    if (playerState.isStreaming) {
        // Simple CSS-driven pulse animation fallback for streaming
        if (playerState.animationFrame) cancelAnimationFrame(playerState.animationFrame);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    try {
        if (!playerState.audioContext) {
            playerState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Disconnect previous source if exists
        if (playerState.sourceNode) {
            try { playerState.sourceNode.disconnect(); } catch (e) { }
        }

        playerState.analyser = playerState.audioContext.createAnalyser();
        playerState.analyser.fftSize = 256;

        // Only create source node once per audio element
        if (!audioElement._sourceNode) {
            audioElement._sourceNode = playerState.audioContext.createMediaElementSource(audioElement);
        }
        playerState.sourceNode = audioElement._sourceNode;
        playerState.sourceNode.connect(playerState.analyser);
        playerState.analyser.connect(playerState.audioContext.destination);

        // Apply audio enhancement filters if active
        if (window._applyAudioEnhancement) {
            try { window._applyAudioEnhancement(); } catch (e) { }
        }

        const bufferLength = playerState.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            playerState.animationFrame = requestAnimationFrame(draw);
            playerState.analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height;
                const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
                gradient.addColorStop(0, 'rgba(124, 58, 237, 0.6)');
                gradient.addColorStop(1, 'rgba(236, 72, 153, 0.8)');
                ctx.fillStyle = gradient;
                ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
                x += barWidth;
            }
        }

        if (playerState.animationFrame) cancelAnimationFrame(playerState.animationFrame);
        draw();
    } catch (e) {
        console.log('Audio visualization not available:', e);
    }
}

// =====================================================
// Audio Enhancement
// =====================================================

const enhanceState = {
    bassFilter: null,
    trebleFilter: null,
    surroundGain: null,
    surroundDelay: null,
    initialized: false
};

// =====================================================
// Video Converter - Simple / Advanced Mode
// =====================================================

function setupVideoAdvancedMode() {
    const simpleBtn = document.getElementById('video-mode-simple');
    const advancedBtn = document.getElementById('video-mode-advanced');
    const advancedPanel = document.getElementById('video-advanced-panel');
    const simpleQualityPanel = document.getElementById('video-simple-quality-panel');

    if (!simpleBtn || !advancedBtn || !advancedPanel) return;

    // Setup simple quality slider
    const simpleSlider = document.getElementById('video-simple-quality');
    const simpleValue = document.getElementById('video-simple-quality-value');
    const simpleHint = document.getElementById('video-simple-quality-hint');

    if (simpleSlider) {
        const savedSimpleQuality = localStorage.getItem('videoSimpleQuality');
        if (savedSimpleQuality) simpleSlider.value = savedSimpleQuality;

        function updateSimpleQualityDisplay() {
            const val = parseInt(simpleSlider.value);
            if (simpleValue) simpleValue.textContent = val + '%';
            let hint = 'Balanced';
            if (val <= 20) hint = 'Smallest file';
            else if (val <= 40) hint = 'Small file';
            else if (val <= 60) hint = 'Balanced';
            else if (val <= 80) hint = 'High quality';
            else hint = 'Best quality';
            if (simpleHint) simpleHint.textContent = hint;
            localStorage.setItem('videoSimpleQuality', val);
        }

        simpleSlider.addEventListener('input', () => {
            updateSimpleQualityDisplay();
            updateSliderTrack(simpleSlider);
        });
        updateSimpleQualityDisplay();
        updateSliderTrack(simpleSlider);
    }

    // Restore saved mode
    const savedMode = localStorage.getItem('videoConverterMode') || 'simple';
    if (savedMode === 'advanced') {
        simpleBtn.classList.remove('active');
        advancedBtn.classList.add('active');
        advancedPanel.style.display = 'block';
        if (simpleQualityPanel) simpleQualityPanel.style.display = 'none';
    }

    simpleBtn.addEventListener('click', () => {
        simpleBtn.classList.add('active');
        advancedBtn.classList.remove('active');
        advancedPanel.style.display = 'none';
        if (simpleQualityPanel) simpleQualityPanel.style.display = 'block';
        localStorage.setItem('videoConverterMode', 'simple');
    });

    advancedBtn.addEventListener('click', () => {
        advancedBtn.classList.add('active');
        simpleBtn.classList.remove('active');
        advancedPanel.style.display = 'block';
        if (simpleQualityPanel) simpleQualityPanel.style.display = 'none';
        localStorage.setItem('videoConverterMode', 'advanced');
    });

    // Re-init format buttons inside the advanced panel so they work with the existing setupFormatButtons
    advancedPanel.querySelectorAll('.format-buttons').forEach(container => {
        container.querySelectorAll('.format-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    });
}

function getVideoAdvancedMode() {
    return localStorage.getItem('videoConverterMode') === 'advanced';
}

// =====================================================
// Audio Advanced Mode
// =====================================================

function setupAudioAdvancedMode() {
    const simpleBtn = document.getElementById('audio-mode-simple');
    const advancedBtn = document.getElementById('audio-mode-advanced');
    const simplePanel = document.getElementById('audio-simple-panel');
    const advancedPanel = document.getElementById('audio-advanced-panel');

    if (!simpleBtn || !advancedBtn || !advancedPanel) return;

    // Setup simple quality slider
    const simpleSlider = document.getElementById('audio-simple-quality');
    const simpleValue = document.getElementById('audio-simple-quality-value');
    const simpleHint = document.getElementById('audio-simple-quality-hint');

    if (simpleSlider) {
        const saved = localStorage.getItem('audioSimpleQuality');
        if (saved) simpleSlider.value = saved;

        function updateAudioSimpleDisplay() {
            const val = parseInt(simpleSlider.value);
            if (simpleValue) simpleValue.textContent = val + '%';
            let hint = 'Balanced';
            if (val <= 20) hint = 'Smallest file';
            else if (val <= 40) hint = 'Small file';
            else if (val <= 60) hint = 'Balanced';
            else if (val <= 80) hint = 'High quality';
            else hint = 'Best quality';
            if (simpleHint) simpleHint.textContent = hint;
            localStorage.setItem('audioSimpleQuality', val);
        }

        simpleSlider.addEventListener('input', () => {
            updateAudioSimpleDisplay();
            updateSliderTrack(simpleSlider);
        });
        updateAudioSimpleDisplay();
        updateSliderTrack(simpleSlider);
    }

    const savedMode = localStorage.getItem('audioConverterMode') || 'simple';
    if (savedMode === 'advanced') {
        simpleBtn.classList.remove('active');
        advancedBtn.classList.add('active');
        if (advancedPanel) advancedPanel.style.display = 'block';
        if (simplePanel) simplePanel.style.display = 'none';
    }

    simpleBtn.addEventListener('click', () => {
        simpleBtn.classList.add('active');
        advancedBtn.classList.remove('active');
        if (advancedPanel) advancedPanel.style.display = 'none';
        if (simplePanel) simplePanel.style.display = 'block';
        localStorage.setItem('audioConverterMode', 'simple');
    });

    advancedBtn.addEventListener('click', () => {
        advancedBtn.classList.add('active');
        simpleBtn.classList.remove('active');
        if (advancedPanel) advancedPanel.style.display = 'block';
        if (simplePanel) simplePanel.style.display = 'none';
        localStorage.setItem('audioConverterMode', 'advanced');
    });
}

function getAudioAdvancedMode() {
    return localStorage.getItem('audioConverterMode') === 'advanced';
}

// =====================================================
// Image Advanced Mode
// =====================================================

function setupImageAdvancedMode() {
    const simpleBtn = document.getElementById('image-mode-simple');
    const advancedBtn = document.getElementById('image-mode-advanced');
    const simplePanel = document.getElementById('image-simple-panel');
    const advancedPanel = document.getElementById('image-advanced-panel');

    if (!simpleBtn || !advancedBtn || !advancedPanel) return;

    // Setup advanced quality slider (separate from simple)
    const advSlider = document.getElementById('image-quality-adv');
    const advValue = document.getElementById('image-quality-adv-value');
    const advHint = document.getElementById('image-quality-adv-hint');

    if (advSlider) {
        function updateImageAdvDisplay() {
            const val = parseInt(advSlider.value);
            if (advValue) advValue.textContent = val + '%';
            let hint = 'Good Quality';
            if (val <= 30) hint = 'Low (Smallest)';
            else if (val <= 55) hint = 'Medium';
            else if (val <= 80) hint = 'Good Quality';
            else if (val <= 95) hint = 'High Quality';
            else hint = 'Maximum Quality';
            if (advHint) advHint.textContent = hint;
        }

        advSlider.addEventListener('input', () => {
            updateImageAdvDisplay();
            updateSliderTrack(advSlider);
        });
        updateImageAdvDisplay();
        updateSliderTrack(advSlider);
    }

    const savedMode = localStorage.getItem('imageConverterMode') || 'simple';
    if (savedMode === 'advanced') {
        simpleBtn.classList.remove('active');
        advancedBtn.classList.add('active');
        if (advancedPanel) advancedPanel.style.display = 'block';
        if (simplePanel) simplePanel.style.display = 'none';
    }

    simpleBtn.addEventListener('click', () => {
        simpleBtn.classList.add('active');
        advancedBtn.classList.remove('active');
        if (advancedPanel) advancedPanel.style.display = 'none';
        if (simplePanel) simplePanel.style.display = 'block';
        localStorage.setItem('imageConverterMode', 'simple');
    });

    advancedBtn.addEventListener('click', () => {
        advancedBtn.classList.add('active');
        simpleBtn.classList.remove('active');
        if (advancedPanel) advancedPanel.style.display = 'block';
        if (simplePanel) simplePanel.style.display = 'none';
        localStorage.setItem('imageConverterMode', 'advanced');
    });
}

function getImageAdvancedMode() {
    return localStorage.getItem('imageConverterMode') === 'advanced';
}

function setupAudioEnhancement() {
    const toggleBtn = document.getElementById('player-enhance-toggle');
    const panel = document.getElementById('player-enhance-panel');
    const bassSlider = document.getElementById('enhance-bass');
    const trebleSlider = document.getElementById('enhance-treble');
    const surroundSlider = document.getElementById('enhance-surround');
    const bassValue = document.getElementById('enhance-bass-value');
    const trebleValue = document.getElementById('enhance-treble-value');
    const surroundValue = document.getElementById('enhance-surround-value');
    const resetBtn = document.getElementById('enhance-reset-btn');
    const presetBtns = document.querySelectorAll('.enhance-preset-btn');

    if (!toggleBtn || !panel) return;

    // Load saved preferences
    const saved = JSON.parse(localStorage.getItem('audio-enhance') || '{}');
    if (saved.bass !== undefined && bassSlider) bassSlider.value = saved.bass;
    if (saved.treble !== undefined && trebleSlider) trebleSlider.value = saved.treble;
    if (saved.surround !== undefined && surroundSlider) surroundSlider.value = saved.surround;
    if (saved.preset) {
        presetBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === saved.preset);
        });
    }

    // Update display values
    const updateDisplayValues = () => {
        if (bassValue && bassSlider) bassValue.textContent = (bassSlider.value > 0 ? '+' : '') + bassSlider.value + ' dB';
        if (trebleValue && trebleSlider) trebleValue.textContent = (trebleSlider.value > 0 ? '+' : '') + trebleSlider.value + ' dB';
        if (surroundValue && surroundSlider) surroundValue.textContent = surroundSlider.value + '%';
    };
    updateDisplayValues();

    // Toggle panel
    toggleBtn.addEventListener('click', () => {
        const isOpen = panel.style.display !== 'none';
        panel.style.display = isOpen ? 'none' : 'flex';
        toggleBtn.classList.toggle('active', !isOpen);
    });

    // Save settings
    const saveSettings = () => {
        const activePreset = document.querySelector('.enhance-preset-btn.active');
        localStorage.setItem('audio-enhance', JSON.stringify({
            bass: parseInt(bassSlider?.value || 0),
            treble: parseInt(trebleSlider?.value || 0),
            surround: parseInt(surroundSlider?.value || 0),
            preset: activePreset ? activePreset.dataset.preset : 'flat'
        }));
    };

    // Apply enhancement to audio context
    const applyEnhancement = () => {
        if (!playerState.audioContext || !playerState.sourceNode) return;

        // Initialize filters if needed
        if (!enhanceState.initialized) {
            enhanceState.bassFilter = playerState.audioContext.createBiquadFilter();
            enhanceState.bassFilter.type = 'lowshelf';
            enhanceState.bassFilter.frequency.value = 200;

            enhanceState.trebleFilter = playerState.audioContext.createBiquadFilter();
            enhanceState.trebleFilter.type = 'highshelf';
            enhanceState.trebleFilter.frequency.value = 3000;

            enhanceState.surroundDelay = playerState.audioContext.createDelay(0.05);
            enhanceState.surroundDelay.delayTime.value = 0.03;
            enhanceState.surroundGain = playerState.audioContext.createGain();
            enhanceState.surroundGain.gain.value = 0;

            enhanceState.initialized = true;
        }

        // Set values
        enhanceState.bassFilter.gain.value = parseInt(bassSlider?.value || 0);
        enhanceState.trebleFilter.gain.value = parseInt(trebleSlider?.value || 0);
        enhanceState.surroundGain.gain.value = parseInt(surroundSlider?.value || 0) / 100;

        // Reconnect audio chain: source -> bass -> treble -> analyser -> dest
        // Also branch: source -> delay -> surroundGain -> dest (for surround effect)
        try {
            playerState.sourceNode.disconnect();
            if (playerState.analyser) playerState.analyser.disconnect();
            enhanceState.bassFilter.disconnect();
            enhanceState.trebleFilter.disconnect();
            enhanceState.surroundDelay.disconnect();
            enhanceState.surroundGain.disconnect();
        } catch (e) { }

        playerState.sourceNode.connect(enhanceState.bassFilter);
        enhanceState.bassFilter.connect(enhanceState.trebleFilter);

        if (playerState.analyser) {
            enhanceState.trebleFilter.connect(playerState.analyser);
            playerState.analyser.connect(playerState.audioContext.destination);
        } else {
            enhanceState.trebleFilter.connect(playerState.audioContext.destination);
        }

        // Surround effect chain
        playerState.sourceNode.connect(enhanceState.surroundDelay);
        enhanceState.surroundDelay.connect(enhanceState.surroundGain);
        enhanceState.surroundGain.connect(playerState.audioContext.destination);

        updateDisplayValues();
        saveSettings();
    };

    // Sliders
    bassSlider?.addEventListener('input', () => {
        clearActivePreset();
        applyEnhancement();
    });
    trebleSlider?.addEventListener('input', () => {
        clearActivePreset();
        applyEnhancement();
    });
    surroundSlider?.addEventListener('input', () => {
        clearActivePreset();
        applyEnhancement();
    });

    const clearActivePreset = () => {
        presetBtns.forEach(btn => btn.classList.remove('active'));
    };

    // Presets
    const presets = {
        'flat': { bass: 0, treble: 0, surround: 0 },
        'bass-boost': { bass: 8, treble: 2, surround: 20 },
        'vocal': { bass: -2, treble: 5, surround: 10 },
        'concert': { bass: 4, treble: 4, surround: 60 }
    };

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = presets[btn.dataset.preset];
            if (!preset) return;

            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (bassSlider) bassSlider.value = preset.bass;
            if (trebleSlider) trebleSlider.value = preset.treble;
            if (surroundSlider) surroundSlider.value = preset.surround;

            applyEnhancement();
        });
    });

    // Reset
    resetBtn?.addEventListener('click', () => {
        if (bassSlider) bassSlider.value = 0;
        if (trebleSlider) trebleSlider.value = 0;
        if (surroundSlider) surroundSlider.value = 0;
        presetBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.preset === 'flat'));
        applyEnhancement();
    });

    // Expose applyEnhancement globally so startAudioVisualization can call it
    window._applyAudioEnhancement = applyEnhancement;
}

// =====================================================
// Donation Popup
// =====================================================

function setupDonation() {
    const donationBtn = document.getElementById('donation-btn');
    const overlay = document.getElementById('donation-overlay');
    const closeBtn = document.getElementById('donation-close');
    const dismissBtn = document.getElementById('donation-dismiss');
    const copyBtn = document.getElementById('donation-copy-btn');
    const githubBtn = document.getElementById('donation-github-btn');

    if (!donationBtn || !overlay) return;

    donationBtn.addEventListener('click', () => {
        overlay.classList.add('active');
    });

    const closeDonation = () => overlay.classList.remove('active');

    closeBtn?.addEventListener('click', closeDonation);
    dismissBtn?.addEventListener('click', closeDonation);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDonation();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeDonation();
        }
    });

    // Copy number
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const numberEl = document.getElementById('donation-number');
            if (!numberEl) return;
            navigator.clipboard.writeText(numberEl.textContent.trim()).then(() => {
                copyBtn.classList.add('copied');
                const spanEl = copyBtn.querySelector('span');
                if (spanEl) spanEl.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    if (spanEl) spanEl.textContent = 'Copy';
                }, 2000);
            }).catch(() => {
                // Fallback
                const range = document.createRange();
                range.selectNodeContents(numberEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('copy');
                sel.removeAllRanges();
            });
        });
    }

    // GitHub star
    if (githubBtn) {
        githubBtn.addEventListener('click', () => {
            window.electronAPI.openExternalUrl('https://github.com/Hasan580/universial-file-converter');
        });
    }
}

// =====================================================
// What's New / Notification Bell
// =====================================================

function setupWhatsNew() {
    const bellBtn = document.getElementById('notification-bell-btn');
    const overlay = document.getElementById('whats-new-overlay');
    const closeBtn = document.getElementById('whats-new-close');
    const dismissBtn = document.getElementById('whats-new-dismiss');

    if (!bellBtn || !overlay) return;

    // Bell icon click - show the What's New modal
    bellBtn.addEventListener('click', () => {
        showWhatsNewModal();
    });

    // Close modal
    closeBtn?.addEventListener('click', () => closeWhatsNewModal());
    dismissBtn?.addEventListener('click', () => closeWhatsNewModal());

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeWhatsNewModal();
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeWhatsNewModal();
        }
    });

    // Telegram contact link
    const telegramLink = document.getElementById('telegram-contact-link');
    if (telegramLink) {
        telegramLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.openExternalUrl('https://t.me/HassanF_1');
        });
    }

    // GitHub support link
    const githubLink = document.getElementById('github-support-link');
    if (githubLink) {
        githubLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.openExternalUrl('https://github.com/Hasan580/universial-file-converter');
        });
    }
}

async function showWhatsNewModal() {
    const overlay = document.getElementById('whats-new-overlay');
    const body = document.getElementById('whats-new-body');
    const versionLabel = document.getElementById('whats-new-version');
    const badge = document.getElementById('bell-badge');

    if (!overlay || !body) return;

    // Show modal with loading state
    body.innerHTML = '<div class="whats-new-loading"><div class="whats-new-spinner"></div><p>Loading release notes...</p></div>';
    overlay.classList.add('active');

    // Hide the badge once user opens the modal
    if (badge) badge.style.display = 'none';

    // Mark this version as seen
    try {
        const currentVersion = await window.electronAPI.getAppVersion();
        localStorage.setItem('whats-new-seen-version', currentVersion);
    } catch (e) { }

    try {
        const releases = await window.electronAPI.getReleaseNotes();
        const currentVersion = await window.electronAPI.getAppVersion();
        const normalizedCurrentVersion = normalizeVersionString(currentVersion) || currentVersion;

        if (versionLabel) {
            versionLabel.textContent = 'Version ' + currentVersion;
        }

        if (!releases || releases.length === 0) {
            body.innerHTML = '<div class="whats-new-loading"><p>No release notes available.</p></div>';
            return;
        }

        // Find the release matching the current version
        const currentRelease = releases.find(r => {
            const ver = getReleaseVersion(r);
            return ver && compareVersions(ver, normalizedCurrentVersion) === 0;
        });

        // Use the current version release, or fall back to the newest semver release.
        const latestRelease = [...releases].sort((a, b) => {
            const av = getReleaseVersion(a);
            const bv = getReleaseVersion(b);
            if (av && bv) {
                const byVersion = compareVersions(bv, av);
                if (byVersion !== 0) return byVersion;
            } else if (av) {
                return -1;
            } else if (bv) {
                return 1;
            }
            const aDate = a.date ? new Date(a.date).getTime() : 0;
            const bDate = b.date ? new Date(b.date).getTime() : 0;
            return bDate - aDate;
        })[0];

        const release = currentRelease || latestRelease || releases[0];

        if (!release) {
            body.innerHTML = '<div class="whats-new-loading"><p>No release notes for this version.</p></div>';
            return;
        }

        // Parse the release body (markdown to simple HTML)
        let releaseBody = release.body || 'No release notes provided.';
        // Convert markdown headers
        releaseBody = releaseBody.replace(/^### (.+)$/gm, '<strong>$1</strong>');
        releaseBody = releaseBody.replace(/^## (.+)$/gm, '<strong>$1</strong>');
        releaseBody = releaseBody.replace(/^# (.+)$/gm, '<strong>$1</strong>');
        // Convert markdown bold
        releaseBody = releaseBody.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Convert markdown links
        releaseBody = releaseBody.replace(/\[(.+?)\]\((.+?)\)/g, '$1');
        // Convert markdown lists
        releaseBody = releaseBody.replace(/^- (.+)$/gm, '<div class="whats-new-item">\u2022 $1</div>');
        releaseBody = releaseBody.replace(/^\* (.+)$/gm, '<div class="whats-new-item">\u2022 $1</div>');
        // Convert newlines to breaks for remaining text
        releaseBody = releaseBody.replace(/\n\n/g, '<br><br>');
        releaseBody = releaseBody.replace(/\n/g, '<br>');

        const releaseName = release.name || release.version || 'Latest Release';
        const releaseDate = release.date ? new Date(release.date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        }) : '';

        body.innerHTML = `
            <div style="margin-bottom: 8px; color: var(--text-secondary); font-size: 0.85em;">${releaseDate}</div>
            <div>${releaseBody}</div>
        `;

    } catch (err) {
        console.error('Failed to load What\'s New:', err);
        body.innerHTML = '<div class="whats-new-loading"><p>Could not load release notes.</p><p style="font-size:0.85em;margin-top:8px;">Check your internet connection.</p></div>';
    }
}

function closeWhatsNewModal() {
    const overlay = document.getElementById('whats-new-overlay');
    if (overlay) overlay.classList.remove('active');
}

async function checkFirstTimeVersion() {
    try {
        const currentVersion = await window.electronAPI.getAppVersion();
        const seenVersion = localStorage.getItem('whats-new-seen-version');
        const badge = document.getElementById('bell-badge');

        if (seenVersion !== currentVersion) {
            // First time opening this version - show badge and auto-popup
            if (badge) badge.style.display = 'block';

            // Small delay to let the app fully load before showing the popup
            setTimeout(() => {
                showWhatsNewModal();
            }, 1500);
        }
    } catch (e) {
        console.log('Could not check version for What\'s New:', e);
    }
}

// =====================================================
// Initialize App
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    init();
    setupOrganizer();
    setupAutoOrganizer();
    setupDownloader();
    setupPlaylist();
    setupSpotify();
    setupLogs();
    setupStorage();
    setupDownloadManager();
    setupIDMDownloadManager();
    setupAI();
    setupGeminiKey();
    setupAutoUpdateListeners();
    setupUpdatesPage();
    setupWhatsNew();
    setupDonation();
    setupAudioEnhancement();
    setupVideoAdvancedMode();
    setupAudioAdvancedMode();
    setupImageAdvancedMode();
    setupImageQrScanner();
    setupBooks();
    setupUniversalPlayer();
    setupStreamSearch();
    setupPlaylistImport();
    setupQuickChips();
    setupSurfWeb();
    setupLiveWallpaperTab();
    loadRemoteAlerts();
    checkFirstTimeVersion();
    setupContextMenuHandler();
    setupPDFTools();
    setupDocumentEditor();
    setupClipboardDetection();
});

// =====================================================
// PDF Tools (Lock & Merge)
// =====================================================

function setupPDFTools() {
    // PDF Lock
    const lockCard = document.getElementById('pdf-lock-card');
    const lockForm = document.getElementById('pdf-lock-form');
    const lockDropzone = document.getElementById('pdf-lock-dropzone');
    const lockFileInput = document.getElementById('pdf-lock-file');
    const lockFileName = document.getElementById('pdf-lock-file-name');
    const lockPassword = document.getElementById('pdf-lock-password');
    const lockConfirm = document.getElementById('pdf-lock-confirm');
    const lockBtn = document.getElementById('pdf-lock-btn');

    let lockFilePath = null;

    if (lockCard && lockForm) {
        lockCard.addEventListener('click', (e) => {
            if (lockForm.style.display === 'none') {
                lockForm.style.display = 'flex';
                lockCard.classList.add('expanded');
            }
        });

        lockDropzone.addEventListener('click', () => lockFileInput.click());
        lockFileInput.addEventListener('change', () => {
            if (lockFileInput.files[0]) {
                lockFilePath = lockFileInput.files[0].path;
                lockFileName.textContent = lockFileInput.files[0].name;
                validateLockForm();
            }
        });

        function validateLockForm() {
            const pw = lockPassword.value;
            const confirm = lockConfirm.value;
            lockBtn.disabled = !lockFilePath || !pw || pw.length < 1 || pw !== confirm;
        }

        lockPassword.addEventListener('input', validateLockForm);
        lockConfirm.addEventListener('input', validateLockForm);

        lockBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!lockFilePath || !lockPassword.value) return;

            lockBtn.disabled = true;
            lockBtn.querySelector('span').textContent = 'Locking...';

            try {
                const outputDir = await window.electronAPI.getOutputDirectory();
                const baseName = lockFilePath.split(/[/\\]/).pop().replace('.pdf', '');
                const outputPath = outputDir + '/' + baseName + '_locked.pdf';

                const result = await window.electronAPI.lockPDF({
                    inputPath: lockFilePath,
                    outputPath: outputPath,
                    userPassword: lockPassword.value,
                    ownerPassword: lockPassword.value
                });

                if (result && result.success) {
                    showToast('PDF locked successfully!', 'success');
                } else {
                    showToast('Failed to lock PDF', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            } finally {
                lockBtn.disabled = false;
                lockBtn.querySelector('span').textContent = 'Lock PDF';
            }
        });
    }

    // PDF Merge
    const mergeCard = document.getElementById('pdf-merge-card');
    const mergeForm = document.getElementById('pdf-merge-form');
    const mergeDropzone = document.getElementById('pdf-merge-dropzone');
    const mergeFileInput = document.getElementById('pdf-merge-files');
    const mergeList = document.getElementById('pdf-merge-list');
    const mergeBtn = document.getElementById('pdf-merge-btn');

    let mergeFiles = [];

    if (mergeCard && mergeForm) {
        mergeCard.addEventListener('click', (e) => {
            if (mergeForm.style.display === 'none') {
                mergeForm.style.display = 'flex';
                mergeCard.classList.add('expanded');
            }
        });

        mergeDropzone.addEventListener('click', (e) => {
            e.stopPropagation();
            mergeFileInput.click();
        });

        mergeFileInput.addEventListener('change', () => {
            const files = Array.from(mergeFileInput.files);
            files.forEach(f => {
                if (f.path && !mergeFiles.find(mf => mf.path === f.path)) {
                    mergeFiles.push({ name: f.name, path: f.path });
                }
            });
            renderMergeList();
        });

        function renderMergeList() {
            mergeList.innerHTML = mergeFiles.map((f, i) => `
                <div class="pdf-merge-item" data-index="${i}">
                    <span class="pdf-merge-name">${i + 1}. ${f.name}</span>
                    <button class="pdf-merge-remove" data-index="${i}">&times;</button>
                </div>
            `).join('');

            mergeList.querySelectorAll('.pdf-merge-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.index);
                    mergeFiles.splice(idx, 1);
                    renderMergeList();
                });
            });

            mergeBtn.disabled = mergeFiles.length < 2;
        }

        mergeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (mergeFiles.length < 2) return;

            mergeBtn.disabled = true;
            mergeBtn.querySelector('span').textContent = 'Merging...';

            try {
                const outputDir = await window.electronAPI.getOutputDirectory();
                const outputPath = outputDir + '/Merged_' + Date.now() + '.pdf';

                const result = await window.electronAPI.mergePDFs({
                    inputPaths: mergeFiles.map(f => f.path),
                    outputPath: outputPath
                });

                if (result && result.success) {
                    showToast(`PDFs merged! ${result.pageCount} pages total`, 'success');
                    mergeFiles = [];
                    renderMergeList();
                } else {
                    showToast('Failed to merge PDFs', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            } finally {
                mergeBtn.disabled = false;
                mergeBtn.querySelector('span').textContent = 'Merge PDFs';
            }
        });
    }
}

function setupDocumentEditor() {
    const editorCard = document.getElementById('doc-editor-card');
    const editorForm = document.getElementById('doc-editor-form');
    const editorCloseBtn = document.getElementById('doc-editor-close-btn');
    const modeToggle = document.getElementById('doc-editor-mode-toggle');
    const openBtn = document.getElementById('doc-editor-open-btn');
    const fileNameEl = document.getElementById('doc-editor-file-name');

    const htmlWorkspace = document.getElementById('doc-html-workspace');
    const htmlToolbar = document.getElementById('doc-html-toolbar');
    const htmlLinkBtn = document.getElementById('doc-html-link-btn');
    const htmlUndoBtn = document.getElementById('doc-html-undo-btn');
    const htmlRedoBtn = document.getElementById('doc-html-redo-btn');
    const htmlText = document.getElementById('doc-html-editor-text');
    const htmlPreview = document.getElementById('doc-html-preview');
    const htmlRemoveBtn = document.getElementById('doc-html-remove-selection-btn');
    const htmlSaveBtn = document.getElementById('doc-html-save-btn');

    const pdfWorkspace = document.getElementById('doc-pdf-workspace');
    const pdfPreview = document.getElementById('doc-pdf-preview');
    const pdfOpenNativeBtn = document.getElementById('doc-pdf-open-native-btn');
    const pdfRefreshBtn = document.getElementById('doc-pdf-refresh-btn');

    if (!editorCard || !editorForm || !openBtn || !modeToggle) return;

    const state = {
        mode: 'html',
        filePath: null,
        htmlDirty: false,
        htmlEditorReady: false,
        htmlSyncLocked: false
    };

    let htmlPreviewTimer = null;

    function basename(filePath) {
        if (!filePath) return '';
        return filePath.split(/[/\\]/).pop();
    }

    function updateFileLabel() {
        fileNameEl.textContent = state.filePath ? basename(state.filePath) : 'No file selected';
    }

    function extname(filePath) {
        const name = basename(filePath);
        const idx = name.lastIndexOf('.');
        return idx >= 0 ? name.slice(idx).toLowerCase() : '';
    }

    function buildOutputPdfPath(inputPath) {
        const index = inputPath.lastIndexOf('.');
        const base = index >= 0 ? inputPath.slice(0, index) : inputPath;
        return `${base}_edited_${Date.now()}.pdf`;
    }

    function filePathToFileUrl(filePath) {
        return 'file:///' + String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    }

    function buildHtmlDocumentString(raw) {
        const source = String(raw || '');
        if (/<!doctype\s+html/i.test(source)) return source;
        return '<!doctype html>\n' + source;
    }

    function updateHtmlPreview() {
        htmlPreview.srcdoc = buildHtmlDocumentString(htmlText.value || '');
    }

    function scheduleHtmlPreviewUpdate(delay = 120) {
        if (htmlPreviewTimer) clearTimeout(htmlPreviewTimer);
        htmlPreviewTimer = setTimeout(() => {
            updateHtmlPreview();
            htmlPreviewTimer = null;
        }, delay);
    }

    function setupEditableHtmlFrame() {
        const frameDoc = htmlPreview.contentDocument;
        if (!frameDoc) return;
        try {
            frameDoc.designMode = 'on';
            if (frameDoc.body) {
                frameDoc.body.contentEditable = 'true';
                frameDoc.body.style.background = '#ffffff';
                frameDoc.body.style.color = '#111111';
                frameDoc.body.style.minHeight = '100%';
                frameDoc.body.style.outline = 'none';
            }
            frameDoc.documentElement.style.background = '#ffffff';
            state.htmlEditorReady = true;
            frameDoc.removeEventListener('input', handleHtmlFrameInput);
            frameDoc.addEventListener('input', handleHtmlFrameInput);
        } catch (_) {
            state.htmlEditorReady = false;
        }
    }

    function readHtmlFrameSource() {
        const frameDoc = htmlPreview.contentDocument;
        if (!frameDoc) return htmlText.value || '';
        return `<!doctype html>\n${frameDoc.documentElement.outerHTML}`;
    }

    function handleHtmlFrameInput() {
        if (state.htmlSyncLocked) return;
        state.htmlSyncLocked = true;
        htmlText.value = readHtmlFrameSource();
        state.htmlDirty = true;
        state.htmlSyncLocked = false;
    }

    function execHtmlCommand(command) {
        const frameDoc = htmlPreview.contentDocument;
        if (!frameDoc || !state.htmlEditorReady) return;
        frameDoc.execCommand(command, false, null);
        handleHtmlFrameInput();
    }

    function closestFromEventTarget(target, selector) {
        if (!target) return null;
        if (target instanceof Element) return target.closest(selector);
        const parent = target.parentElement || target.parentNode;
        return parent instanceof Element ? parent.closest(selector) : null;
    }

    function setMode(mode) {
        state.mode = mode === 'pdf' ? 'pdf' : 'html';
        modeToggle.querySelectorAll('.doc-editor-mode-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === state.mode);
        });
        htmlWorkspace.style.display = state.mode === 'html' ? 'flex' : 'none';
        pdfWorkspace.style.display = state.mode === 'pdf' ? 'flex' : 'none';
        if (state.mode === 'html') {
            htmlSaveBtn.disabled = !state.filePath || !['.html', '.htm'].includes(extname(state.filePath));
        }
    }

    function openEditorWindow() {
        editorForm.classList.add('active');
        editorCard.classList.add('expanded');
        document.body.classList.add('modal-open');
    }

    function closeEditorWindow() {
        editorForm.classList.remove('active');
        editorCard.classList.remove('expanded');
        document.body.classList.remove('modal-open');
    }

    function wrapHtmlSelection(openTag, closeTag) {
        const start = htmlText.selectionStart;
        const end = htmlText.selectionEnd;
        const value = htmlText.value;
        const selected = value.slice(start, end) || 'text';
        const wrapped = `${openTag}${selected}${closeTag}`;
        htmlText.value = value.slice(0, start) + wrapped + value.slice(end);
        htmlText.focus();
        htmlText.setSelectionRange(start + openTag.length, start + openTag.length + selected.length);
        state.htmlDirty = true;
        updateHtmlPreview();
    }

    editorCard.addEventListener('click', (e) => {
        if (closestFromEventTarget(e.target, '#doc-editor-form')) return;
        openEditorWindow();
    });

    editorCloseBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeEditorWindow();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && editorForm.classList.contains('active')) closeEditorWindow();
    });

    editorForm.addEventListener('click', (e) => {
        if (e.target === editorForm) closeEditorWindow();
    });

    const editorWindow = editorForm.querySelector('.doc-editor-window');
    editorWindow?.addEventListener('click', (e) => e.stopPropagation());

    modeToggle.addEventListener('click', (e) => {
        const btn = closestFromEventTarget(e.target, '.doc-editor-mode-btn');
        if (!btn) return;
        e.stopPropagation();
        setMode(btn.dataset.mode);
    });

    htmlToolbar?.addEventListener('click', (e) => {
        const button = closestFromEventTarget(e.target, 'button[data-wrap]');
        if (!button) return;
        e.stopPropagation();
        const tpl = String(button.dataset.wrap || '');
        const [openTag, closeTag] = tpl.split('|');
        if (!openTag || closeTag == null) return;
        wrapHtmlSelection(openTag, closeTag);
    });

    htmlLinkBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = prompt('Enter URL for selected text:', 'https://');
        if (!url) return;
        wrapHtmlSelection(`<a href="${url}">`, '</a>');
    });

    htmlUndoBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        execHtmlCommand('undo');
    });

    htmlRedoBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        execHtmlCommand('redo');
    });

    htmlPreview.addEventListener('load', () => setupEditableHtmlFrame());

    openBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            const selected = await window.electronAPI.selectFiles('document');
            const filePath = Array.isArray(selected) ? selected[0] : null;
            if (!filePath) return;

            const ext = extname(filePath);
            if (state.mode === 'html' && !['.html', '.htm'].includes(ext)) {
                showToast('Please choose an HTML file in HTML mode', 'warning');
                return;
            }
            if (state.mode === 'pdf' && ext !== '.pdf') {
                showToast('Please choose a PDF file in PDF mode', 'warning');
                return;
            }

            state.filePath = filePath;
            updateFileLabel();
            openEditorWindow();

            if (state.mode === 'html') {
                const result = await window.electronAPI.readEditableDocument({ filePath });
                htmlText.value = result.content || '';
                state.htmlDirty = false;
                htmlSaveBtn.disabled = false;
                scheduleHtmlPreviewUpdate(0);
                showToast('HTML file loaded', 'success');
            } else {
                pdfPreview.src = filePathToFileUrl(filePath);
                showToast('PDF loaded. Click "Edit PDF Directly" to modify text.', 'success');
            }
        } catch (err) {
            showToast('Error opening file: ' + err.message, 'error');
        }
    });

    htmlText.addEventListener('input', () => {
        state.htmlDirty = true;
        if (!state.htmlSyncLocked) scheduleHtmlPreviewUpdate();
    });

    htmlRemoveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const start = htmlText.selectionStart;
        const end = htmlText.selectionEnd;
        if (start === end) {
            showToast('Select text to remove', 'info');
            return;
        }
        const value = htmlText.value;
        htmlText.value = value.slice(0, start) + value.slice(end);
        htmlText.focus();
        htmlText.setSelectionRange(start, start);
        state.htmlDirty = true;
        scheduleHtmlPreviewUpdate(0);
    });

    htmlSaveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!state.filePath || !['.html', '.htm'].includes(extname(state.filePath))) return;
        try {
            htmlSaveBtn.disabled = true;
            htmlSaveBtn.querySelector('span').textContent = 'Saving...';
            const content = state.htmlEditorReady ? readHtmlFrameSource() : htmlText.value;
            await window.electronAPI.saveEditableDocument({ filePath: state.filePath, content });
            htmlText.value = content;
            state.htmlDirty = false;
            showToast('HTML saved successfully', 'success');
        } catch (err) {
            showToast('Error saving HTML: ' + err.message, 'error');
        } finally {
            htmlSaveBtn.disabled = false;
            htmlSaveBtn.querySelector('span').textContent = 'Save HTML';
        }
    });

    pdfOpenNativeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.filePath || extname(state.filePath) !== '.pdf') {
            showToast('Open a PDF file first', 'warning');
            return;
        }
        window.electronAPI.openFile(state.filePath);
        showToast('Opened PDF in your default editor. Save there, then click Refresh Preview.', 'info');
    });

    pdfRefreshBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.filePath || extname(state.filePath) !== '.pdf') {
            showToast('Open a PDF file first', 'warning');
            return;
        }
        try {
            const url = filePathToFileUrl(state.filePath);
            pdfPreview.src = '';
            setTimeout(() => {
                pdfPreview.src = url;
            }, 30);
            showToast('PDF preview refreshed', 'success');
        } catch (err) {
            showToast('Failed to refresh PDF preview: ' + err.message, 'error');
        }
    });

    updateFileLabel();
    setMode('html');
}

// =====================================================
// Context Menu File Handler
// =====================================================

function setupContextMenuHandler() {
    if (!window.electronAPI.onContextMenuConvert) return;

    window.electronAPI.onContextMenuConvert((filePath) => {
        if (!filePath) return;
        const ext = filePath.split('.').pop().toLowerCase();
        const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'aiff', 'opus', 'ac3', 'dts', 'amr', 'wv', 'ape', 'mka'];
        const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'm4v', '3gp', 'ts', 'vob', 'mts', 'ogv'];
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'ico', 'svg', 'avif', 'heif', 'heic', 'jxl', 'jp2'];
        const docExts = ['pdf', 'docx', 'doc', 'txt', 'rtf', 'html', 'htm', 'xlsx', 'xls', 'pptx', 'csv', 'json', 'md', 'xml'];

        let type = 'unknown';
        if (audioExts.includes(ext)) type = 'audio';
        else if (videoExts.includes(ext)) type = 'video';
        else if (imageExts.includes(ext)) type = 'image';
        else if (docExts.includes(ext)) type = 'document';

        if (type === 'unknown') {
            showToast('Unsupported file type: .' + ext, 'error');
            return;
        }

        navigateTo(type);
        const fileName = filePath.split('\\').pop().split('/').pop();
        const file = { name: fileName, path: filePath };
        handleFiles([file], type);
        showToast('File added for conversion: ' + fileName, 'success');
    });
}

// =====================================================
// Clipboard Link Detection
// =====================================================

function setupClipboardDetection() {
    let lastClipboardText = '';
    let clipboardToastActive = false;

    const URL_PATTERNS = [
        /https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/i,
        /https?:\/\/(www\.)?youtube\.com\/playlist\?list=/i,
        /https?:\/\/open\.spotify\.com\/(track|album|playlist)\//i,
        /https?:\/\/spotify\.link\//i
    ];

    function isDownloadableLink(text) {
        return URL_PATTERNS.some(pattern => pattern.test(text));
    }

    function getLinkType(url) {
        if (/spotify/i.test(url)) return 'Spotify';
        if (/playlist/i.test(url)) return 'YouTube Playlist';
        return 'Video';
    }

    function checkClipboard() {
        if (clipboardToastActive) return;

        navigator.clipboard.readText().then(text => {
            text = (text || '').trim();
            if (!text || text === lastClipboardText) return;
            if (!isDownloadableLink(text)) {
                lastClipboardText = text;
                return;
            }

            lastClipboardText = text;
            clipboardToastActive = true;

            const linkType = getLinkType(text);
            const isSpotify = linkType === 'Spotify';

            // Show inline prompt toast
            showClipboardPrompt(text, linkType, isSpotify);
        }).catch(() => {
            // Clipboard read failed silently (permissions)
        });
    }

    function showClipboardPrompt(url, linkType, isSpotify) {
        const container = document.getElementById('toast-container');
        if (!container) { clipboardToastActive = false; return; }
        const shortUrl = url.length > 46 ? url.substring(0, 43) + '...' : url;

        const toast = document.createElement('div');
        toast.className = 'toast clipboard-toast';
        toast.innerHTML = `
            <div class="clipboard-prompt">
                <div class="clipboard-prompt-text">
                    <strong class="clipboard-prompt-title">${linkType} link ready</strong>
                    <span class="clipboard-url">${shortUrl}</span>
                </div>
                <div class="clipboard-prompt-actions">
                    <button class="clipboard-paste-btn">${isSpotify ? 'Open' : 'Use Link'}</button>
                    <button class="clipboard-dismiss-btn" aria-label="Dismiss popup">&times;</button>
                </div>
            </div>
        `;

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        const pasteBtn = toast.querySelector('.clipboard-paste-btn');
        const dismissBtn = toast.querySelector('.clipboard-dismiss-btn');
        let removed = false;
        let autoDismissId = null;

        function removeToast() {
            if (removed) return;
            removed = true;
            if (autoDismissId) clearTimeout(autoDismissId);
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
                clipboardToastActive = false;
            }, 300);
        }

        pasteBtn.addEventListener('click', () => {
            if (isSpotify) {
                navigateTo('download');
                // Navigate to Spotify tab if it exists
                const spotifyTabBtn = document.querySelector('[data-tab="spotify"]') || document.querySelector('.download-tab-btn[data-tab="spotify"]');
                if (spotifyTabBtn) spotifyTabBtn.click();
                const spotifyInput = document.getElementById('spotify-search-input');
                if (spotifyInput) {
                    spotifyInput.value = url;
                    spotifyInput.dispatchEvent(new Event('input'));
                    const spotifySearchBtn = document.getElementById('spotify-search-btn');
                    if (spotifySearchBtn) spotifySearchBtn.click();
                }
            } else {
                navigateTo('download');
                const urlInput = document.getElementById('download-url');
                if (urlInput) {
                    urlInput.value = url;
                    const fetchBtn = document.getElementById('fetch-info-btn');
                    if (fetchBtn) fetchBtn.click();
                }
            }
            removeToast();
        });

        dismissBtn.addEventListener('click', removeToast);

        // Auto-dismiss after 5 seconds
        autoDismissId = setTimeout(() => {
            if (toast.parentNode) removeToast();
        }, 5000);
    }

    // Poll clipboard every 2 seconds when window is focused
    let clipboardInterval = null;

    function startClipboardMonitor() {
        if (clipboardInterval) return;
        clipboardInterval = setInterval(checkClipboard, 2000);
    }

    function stopClipboardMonitor() {
        if (clipboardInterval) {
            clearInterval(clipboardInterval);
            clipboardInterval = null;
        }
    }

    window.addEventListener('focus', startClipboardMonitor);
    window.addEventListener('blur', stopClipboardMonitor);

    // Start immediately if window is focused
    if (document.hasFocus()) startClipboardMonitor();
}

// =====================================================
// Remote Alert System
// =====================================================

async function loadRemoteAlerts() {
    try {
        if (!window.electronAPI.getRemoteAlerts) return;
        await resetDismissedAlertsForAppVersion();
        const alerts = await window.electronAPI.getRemoteAlerts();
        renderRemoteAlerts(alerts);
    } catch (e) {
        console.error('Failed to load remote alerts:', e);
    }
}

function getDismissedAlerts() {
    try {
        const raw = JSON.parse(localStorage.getItem('dismissed-alerts') || '[]');
        return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

async function resetDismissedAlertsForAppVersion() {
    try {
        if (!window.electronAPI.getAppVersion) return;
        const appVersion = await window.electronAPI.getAppVersion();
        const key = 'dismissed-alerts-app-version';
        const lastVersion = localStorage.getItem(key) || '';
        if (appVersion && lastVersion !== appVersion) {
            localStorage.removeItem('dismissed-alerts');
            localStorage.setItem(key, appVersion);
        }
    } catch {
        // Ignore version reset failures.
    }
}

function normalizeAlertType(type) {
    const value = String(type || '').trim().toLowerCase();
    if (!value) return 'info';
    if (value === 'critical' || value === 'crictal') return 'error';
    if (['info', 'warning', 'error', 'success'].includes(value)) return value;
    return 'info';
}

function isCriticalAlertType(type) {
    const value = String(type || '').trim().toLowerCase();
    return value === 'critical' || value === 'crictal';
}

function normalizeRemoteAlert(alert, index) {
    const id = String(alert?.id || `remote-alert-${index}`).trim();
    const version = Number(alert?.version || 0);
    const critical = isCriticalAlertType(alert?.type);
    return {
        ...alert,
        id,
        type: normalizeAlertType(alert?.type),
        critical,
        version: Number.isFinite(version) ? version : 0,
        active: alert?.active !== false,
        dismissible: critical ? false : alert?.dismissible !== false,
        message: String(alert?.message || '').trim()
    };
}

function getAlertDismissKey(alert) {
    const id = String(alert?.id || '').trim();
    const version = Number(alert?.version || 0);
    if (!id) return '';
    if (Number.isFinite(version) && version > 0) {
        return `${id}::v${version}`;
    }
    return id;
}

function renderRemoteAlerts(alerts) {
    const container = document.getElementById('app-alert-container');
    if (!container) return;

    // Normalize and filter active alerts only.
    const active = (alerts || [])
        .map((alert, index) => normalizeRemoteAlert(alert, index))
        .filter((alert) => alert.active && !!alert.id && !!alert.message);

    // Get dismissed alerts from localStorage
    let dismissed = getDismissedAlerts();

    const visible = active.filter((alert) => {
        if (alert.critical) return true;

        const dismissKey = getAlertDismissKey(alert);
        if (!dismissKey) return true;

        // Versioned alerts must use version-aware keys so newer versions can reappear.
        if (dismissKey.includes('::v')) {
            return !dismissed.includes(dismissKey);
        }

        return !dismissed.includes(dismissKey) && !dismissed.includes(alert.id);
    });

    if (visible.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = visible.map(alert => {
        const typeClass = normalizeAlertType(alert.type);
        const iconMap = {
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        };
        return `
            <div class="app-alert app-alert-${typeClass}" data-alert-id="${alert.id}">
                <span class="app-alert-icon">${iconMap[typeClass] || iconMap.info}</span>
                <span class="app-alert-msg">${alert.message || ''}</span>
                ${alert.dismissible ? `<button class="app-alert-close" data-dismiss-alert="${alert.id}" title="Dismiss">&times;</button>` : ''}
            </div>
        `;
    }).join('');

    // Attach dismiss handlers
    container.querySelectorAll('[data-dismiss-alert]').forEach(btn => {
        btn.addEventListener('click', () => {
            const alertId = btn.dataset.dismissAlert;
            const alert = visible.find(a => String(a.id) === String(alertId));
            const dismissKey = getAlertDismissKey(alert || { id: alertId });
            if (dismissKey && !dismissed.includes(dismissKey)) {
                dismissed.push(dismissKey);
            }
            try { localStorage.setItem('dismissed-alerts', JSON.stringify(dismissed)); } catch {}
            const el = btn.closest('.app-alert');
            if (el) el.remove();
            // Hide container if no more alerts
            if (container.querySelectorAll('.app-alert').length === 0) container.style.display = 'none';
        });
    });
}
