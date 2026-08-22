(function initWallpaper() {
    const video = document.getElementById('wallpaper-video');
    if (!video) return;

    const params = new URLSearchParams(window.location.search || '');
    const src = String(params.get('videoPath') || '');
    const muted = String(params.get('muted') || 'true') === 'true';
    const loop = String(params.get('loop') || 'true') === 'true';
    const fitModeRaw = String(params.get('fitMode') || 'cover').toLowerCase();
    const fitMode = ['cover', 'contain', 'fill'].includes(fitModeRaw) ? fitModeRaw : 'cover';

    const volumeValue = Number(params.get('volume'));
    const playbackRateValue = Number(params.get('playbackRate'));
    const volume = Number.isFinite(volumeValue) ? Math.max(0, Math.min(1, volumeValue / 100)) : 0;
    const playbackRate = Number.isFinite(playbackRateValue) ? Math.max(0.25, Math.min(3, playbackRateValue)) : 1;

    video.style.objectFit = fitMode;
    video.src = src;
    video.muted = muted;
    video.loop = loop;
    video.volume = muted ? 0 : volume;
    video.playbackRate = playbackRate;

    const ensurePlayback = () => {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                // Playback retries on next visibility/canplay events.
            });
        }
    };

    video.addEventListener('canplay', ensurePlayback);
    video.addEventListener('loadeddata', ensurePlayback);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) ensurePlayback();
    });

    ensurePlayback();
})();
