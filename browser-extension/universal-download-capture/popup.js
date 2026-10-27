// Universal Download Manager – Popup v2
// Zero-config popup: just shows status + toggles

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const capturedEl = document.getElementById('stat-captured');
const failedEl = document.getElementById('stat-failed');
const toggleCapture = document.getElementById('toggle-capture');
const toggleAll = document.getElementById('toggle-all');
const captureTabBtn = document.getElementById('btn-capture-tab');
const resetStatsBtn = document.getElementById('btn-reset-stats');

function updateStatus(connected) {
    if (connected) {
        statusDot.classList.add('connected');
        statusText.innerHTML = '<strong>Connected</strong> to Universal File Converter';
    } else {
        statusDot.classList.remove('connected');
        statusText.innerHTML = '<strong>Disconnected</strong> — is the app running?';
    }
}

function loadStatus() {
    chrome.runtime.sendMessage({ type: 'udm_get_status' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (!res) return;

        updateStatus(res.connected);
        toggleCapture.checked = res.captureEnabled;
        toggleAll.checked = res.captureAll;
        if (res.stats) {
            capturedEl.textContent = res.stats.captured || 0;
            failedEl.textContent = res.stats.failed || 0;
        }
    });
}

toggleCapture.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'udm_toggle_capture', enabled: toggleCapture.checked });
});

toggleAll.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'udm_toggle_capture_all', enabled: toggleAll.checked });
});

captureTabBtn.addEventListener('click', () => {
    captureTabBtn.disabled = true;
    captureTabBtn.textContent = 'Sending...';
    chrome.runtime.sendMessage({ type: 'udm_capture_tab' }, (res) => {
        captureTabBtn.disabled = false;
        if (res?.ok) {
            captureTabBtn.textContent = 'Sent!';
            setTimeout(() => { captureTabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Send Current Page to App'; }, 1500);
        } else {
            captureTabBtn.textContent = res?.error || 'Failed';
            setTimeout(() => { captureTabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Send Current Page to App'; }, 2000);
        }
        loadStatus(); // refresh stats
    });
});

resetStatsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'udm_reset_stats' }, () => {
        capturedEl.textContent = '0';
        failedEl.textContent = '0';
    });
});

// Load on open
loadStatus();

loadConfig().catch((err) => {
    setStatus(`Load failed: ${err.message || err}`, true);
});
