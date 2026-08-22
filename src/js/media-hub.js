// File: src/js/media-hub.js
// Handles functionality for the Media Hub tab (Audio, Video, PDF with annotations)

import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';

// Setup pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

class MediaHub {
    constructor() {
        this.currentType = null;
        this.currentFile = null;

        // DOM Elements
        this.dropzone = document.getElementById('media-dropzone');
        this.container = document.getElementById('media-container');
        this.toolbar = document.getElementById('media-toolbar');
        this.pdfTools = document.getElementById('pdf-tools');
        this.displayArea = document.getElementById('media-display-area');
        this.audioPanel = document.getElementById('audio-enhancement-panel');

        // Audio specific
        this.audioContext = null;
        this.audioElement = null;
        this.sourceNode = null;
        this.bassFilter = null;
        this.gainNode = null;

        // PDF specific
        this.pdfDoc = null;
        this.pageNum = 1;
        this.pageRendering = false;
        this.pageNumPending = null;
        this.scale = 1.0;
        this.canvas = null;
        this.ctx = null;
        this.overlayCanvas = null;
        this.overlayCtx = null;

        // Drawing state
        this.isDrawing = false;
        this.currentTool = 'pan'; // pan, pen, highlight
        this.lastX = 0;
        this.lastY = 0;
        // Store ink paths for each page: { pageNum: [ { tool, color, width, path: [{x,y}, ...] } ] }
        this.inkData = {};
        this.currentPath = null;

        this.init();
    }

    init() {
        this.setupDropzone();
        this.setupAudioControls();
        this.setupPdfControls();
        this.setupGlobalControls();
        this.setupKeyboardShortcuts();
    }

    setupGlobalControls() {
        // Close button
        const closeBtn = document.getElementById('media-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.reset();
            });
        }

        // Open button
        const openBtn = document.getElementById('media-open-btn');
        if (openBtn) {
            openBtn.addEventListener('click', async () => {
                try {
                    const files = await window.electronAPI.selectFiles('all');
                    if (files && files.length > 0) {
                        const path = files[0];
                        const name = path.split('\\').pop().split('/').pop();
                        this.handleFile({ path, name });
                    }
                } catch (error) {
                    console.error("Open file error:", error);
                }
            });
        }
    }

    setupDropzone() {
        this.dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropzone.classList.add('dragover');
        });

        this.dropzone.addEventListener('dragleave', () => {
            this.dropzone.classList.remove('dragover');
        });

        this.dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropzone.classList.remove('dragover');

            if (e.dataTransfer.files.length > 0) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });

        // Click to open
        this.dropzone.addEventListener('click', async () => {
            try {
                const files = await window.electronAPI.selectFiles('all');
                if (files && files.length > 0) {
                    const path = files[0];
                    const name = path.split('\\').pop().split('/').pop();
                    this.handleFile({ path, name });
                }
            } catch (error) {
                console.error("Open file error:", error);
            }
        });
    }

    async handleFile(file) {
        this.currentFile = file;
        this.currentType = this.getFileType(file.name);

        // Reset UI
        this.dropzone.style.display = 'none';
        this.container.style.display = 'flex';
        this.displayArea.innerHTML = '';
        this.toolbar.style.display = 'flex'; // Show global toolbar for all media
        this.pdfTools.style.display = 'none';
        this.audioPanel.style.display = 'none';

        // Cleanup previous instances
        this.cleanup();

        if (this.currentType === 'audio') {
            this.loadAudio(file.path);
        } else if (this.currentType === 'video') {
            this.loadVideo(file.path);
        } else if (this.currentType === 'pdf') {
            this.loadPdf(file.path);
        } else {
            alert('Unsupported file type.');
            this.reset();
        }
    }

    getFileType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
        if (['mp4', 'webm', 'ogg', 'mkv', 'avi'].includes(ext)) return 'video';
        if (ext === 'pdf') return 'pdf';
        return 'unknown';
    }

    updateSliderTrack(slider) {
        const min = parseFloat(slider.min) || 0;
        const max = parseFloat(slider.max) || 100;
        const val = parseFloat(slider.value) || 0;
        const percent = ((val - min) / (max - min)) * 100;
        slider.style.setProperty('--slider-percent', `${percent}%`);
    }

    // --- Media Handling ---

    loadAudio(filePath) {
        this.audioPanel.style.display = 'flex';
        this.createCustomPlayer(filePath, 'audio');
    }

    loadVideo(filePath) {
        this.createCustomPlayer(filePath, 'video');
    }

    createCustomPlayer(filePath, type) {
        this.displayArea.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = `custom-media-wrapper ${type}-mode`;

        const media = document.createElement(type);
        const properPath = 'file:///' + filePath.replace(/\\/g, '/');
        media.src = properPath;
        media.className = `custom-${type}-element`;
        media.controls = false;

        if (type === 'video') {
            media.style.width = '100%';
            media.style.height = '100%';
            media.style.objectFit = 'contain';
        } else if (type === 'audio') {
            const visualizer = document.createElement('canvas');
            visualizer.className = 'audio-visualizer';
            visualizer.style.width = '100%';
            visualizer.style.height = '100%';
            visualizer.style.position = 'absolute';
            visualizer.style.top = '0';
            visualizer.style.left = '0';
            visualizer.style.opacity = '0.6';
            visualizer.style.pointerEvents = 'none';
            wrapper.appendChild(visualizer);
        }

        const controls = document.createElement('div');
        controls.className = 'custom-media-controls';
        controls.innerHTML = `
            <button class="media-play-btn">
                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="media-time current">0:00</span>
            <div class="media-progress-wrapper quality-slider">
                <input type="range" class="media-progress" min="0" max="100" value="0" step="0.1">
            </div>
            <span class="media-time duration">0:00</span>
            <div class="media-volume-wrapper quality-slider" style="display: flex; align-items: center; gap: 8px; margin-left: 10px;">
                <svg viewBox="0 0 24 24" fill="none" class="text-secondary" stroke="currentColor" stroke-width="2" width="20" height="20">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
                <input type="range" class="media-volume" min="0" max="100" value="100" style="width: 80px;" title="Volume">
            </div>
            ${type === 'video' ? `
            <button class="media-fullscreen-btn" style="background: none; border: none; color: white; cursor: pointer; margin-left: auto;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                </svg>
            </button>
            ` : ''}
        `;

        wrapper.appendChild(media);
        wrapper.appendChild(controls);
        this.displayArea.appendChild(wrapper);

        const playBtn = controls.querySelector('.media-play-btn');
        const progress = controls.querySelector('.media-progress');
        const currentLabel = controls.querySelector('.current');
        const durationLabel = controls.querySelector('.duration');
        const volumeSlider = controls.querySelector('.media-volume');
        const fullscreenBtn = controls.querySelector('.media-fullscreen-btn');

        let isDragging = false;

        const formatTime = (time) => {
            if (isNaN(time) || !isFinite(time)) return '0:00';
            const m = Math.floor(time / 60);
            const s = Math.floor(time % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };

        this.updateSliderTrack(progress);

        media.addEventListener('loadedmetadata', () => {
            durationLabel.textContent = formatTime(media.duration);
        });

        media.addEventListener('timeupdate', () => {
            if (!isDragging && media.duration) {
                const percent = (media.currentTime / media.duration) * 100 || 0;
                progress.value = percent;
                this.updateSliderTrack(progress);
                currentLabel.textContent = formatTime(media.currentTime);
            }
        });

        playBtn.addEventListener('click', () => {
            if (media.paused) {
                media.play();
            } else {
                media.pause();
            }
        });

        media.addEventListener('play', () => {
            playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        });

        media.addEventListener('pause', () => {
            playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>`;
        });

        progress.addEventListener('mousedown', () => isDragging = true);
        progress.addEventListener('mouseup', () => isDragging = false);
        progress.addEventListener('input', (e) => {
            this.updateSliderTrack(e.target);
            const time = (e.target.value / 100) * media.duration;
            currentLabel.textContent = formatTime(time);
        });
        progress.addEventListener('change', (e) => {
            media.currentTime = (e.target.value / 100) * media.duration;
        });

        // Volume controls
        if (volumeSlider) {
            this.updateSliderTrack(volumeSlider);
            volumeSlider.addEventListener('input', (e) => {
                this.updateSliderTrack(e.target);
                media.volume = e.target.value / 100;
            });
        }

        // Fullscreen controls
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    wrapper.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable fullscreen: ${err.message}`);
                    });
                } else {
                    document.exitFullscreen();
                }
            });
        }

        if (type === 'audio') {
            this.audioElement = media;
            this.setupWebAudio(media);
        } else {
            this.audioElement = null;
        }

        this.mediaElement = media;

        // Setup Media Session API (OS level media controls)
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.currentFile ? this.currentFile.name : 'Unknown Media',
                artist: 'Universal Player'
            });

            navigator.mediaSession.setActionHandler('play', () => media.play().catch(() => { }));
            navigator.mediaSession.setActionHandler('pause', () => media.pause());
            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                media.currentTime = Math.max(media.currentTime - (details.seekOffset || 10), 0);
            });
            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                media.currentTime = Math.min(media.currentTime + (details.seekOffset || 10), media.duration || 0);
            });
            navigator.mediaSession.setActionHandler('stop', () => {
                media.pause();
                if (media.duration) media.currentTime = media.duration;
            });
        }

        // Auto play
        media.play().catch(e => console.log('Autoplay prevented', e));
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (!this.mediaElement) return;

            // Allow default behavior if user is typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case ' ':
                case 'MediaPlayPause':
                    e.preventDefault();
                    if (this.mediaElement.paused) {
                        this.mediaElement.play().catch(err => console.error(err));
                    } else {
                        this.mediaElement.pause();
                    }
                    break;
                case 'ArrowRight':
                case 'MediaTrackNext':
                    e.preventDefault();
                    if (this.mediaElement.duration) {
                        this.mediaElement.currentTime = Math.min(this.mediaElement.currentTime + 10, this.mediaElement.duration);
                    }
                    break;
                case 'ArrowLeft':
                case 'MediaTrackPrevious':
                    e.preventDefault();
                    this.mediaElement.currentTime = Math.max(this.mediaElement.currentTime - 10, 0);
                    break;
                case 'End':
                case 'Escape':
                case 'MediaStop':
                    e.preventDefault();
                    this.mediaElement.pause();
                    if (this.mediaElement.duration) {
                        this.mediaElement.currentTime = this.mediaElement.duration;
                    }
                    break;
            }
        });
    }

    setupWebAudio(audio) {
        try {
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Disconnect old nodes if they exist
            if (this.sourceNode) {
                this.sourceNode.disconnect();
            }
            // Need to recreate source only if audio element changed, but we recreate element each time

            this.sourceNode = this.audioContext.createMediaElementSource(audio);

            this.bassFilter = this.audioContext.createBiquadFilter();
            this.bassFilter.type = 'lowshelf';
            this.bassFilter.frequency.value = 200;
            const bassVal = document.getElementById('bass-boost-slider');
            this.bassFilter.gain.value = bassVal ? parseFloat(bassVal.value) : 0;

            this.gainNode = this.audioContext.createGain();
            const volVal = document.getElementById('volume-slider');
            this.gainNode.gain.value = volVal ? parseInt(volVal.value) / 100 : 1;

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;

            this.sourceNode.connect(this.bassFilter);
            this.bassFilter.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            audio.addEventListener('play', () => {
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                this.startVisualizer();
            });
            audio.addEventListener('pause', () => {
                cancelAnimationFrame(this.visualizerFrame);
            });
        } catch (e) {
            console.error("Web Audio error", e);
        }
    }

    startVisualizer() {
        const canvas = document.querySelector('.audio-visualizer');
        if (!canvas || !this.analyser) return;

        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            this.visualizerFrame = requestAnimationFrame(draw);

            this.analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height;

                // Create a purple/pink gradient
                const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
                gradient.addColorStop(0, 'rgba(236, 72, 153, 0.8)'); // Pink
                gradient.addColorStop(1, 'rgba(124, 58, 237, 0.8)'); // Purple

                ctx.fillStyle = gradient;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

                x += barWidth + 2;
            }
        };

        draw();
    }

    setupAudioControls() {
        const bassSlider = document.getElementById('bass-boost-slider');
        const bassVal = document.getElementById('bass-boost-val');
        const volSlider = document.getElementById('volume-slider');
        const volVal = document.getElementById('volume-val');

        if (bassSlider) {
            this.updateSliderTrack(bassSlider);
            bassSlider.addEventListener('input', (e) => {
                this.updateSliderTrack(e.target);
                const val = e.target.value;
                bassVal.textContent = val;
                if (this.bassFilter) {
                    this.bassFilter.gain.value = parseFloat(val);
                }
            });
        }

        if (volSlider) {
            this.updateSliderTrack(volSlider);
            volSlider.addEventListener('input', (e) => {
                this.updateSliderTrack(e.target);
                const val = e.target.value;
                volVal.textContent = val;
                if (this.gainNode) {
                    this.gainNode.gain.value = parseInt(val) / 100;
                }
            });
        }
    }

    // --- PDF Handling ---

    async loadPdf(filePath) {
        this.toolbar.style.display = 'flex';
        this.pdfTools.style.display = 'flex';

        try {
            const buffer = await window.electronAPI.getFileBuffer(filePath);
            const uint8Array = new Uint8Array(buffer);
            this.pdfDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
            document.getElementById('pdf-page-info').textContent = `1 / ${this.pdfDoc.numPages}`;
            this.pageNum = 1;
            this.renderPage(this.pageNum);
        } catch (error) {
            console.error('Error loading PDF:', error);
            alert(`Could not load PDF file: ${error.message}\n\nStack: ${error.stack}`);
        }
    }

    async renderPage(num) {
        this.pageRendering = true;

        const page = await this.pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale: this.scale });

        // Setup wrapper and canvases if they don't exist
        if (!this.canvas) {
            this.displayArea.innerHTML = '';

            const wrapper = document.createElement('div');
            wrapper.className = 'pdf-wrapper';

            const container = document.createElement('div');
            container.className = 'pdf-page-container';

            this.canvas = document.createElement('canvas');
            this.canvas.className = 'pdf-render';
            this.ctx = this.canvas.getContext('2d');

            this.overlayCanvas = document.createElement('canvas');
            this.overlayCanvas.className = 'pdf-overlay';
            this.overlayCtx = this.overlayCanvas.getContext('2d');

            container.appendChild(this.canvas);
            container.appendChild(this.overlayCanvas);
            wrapper.appendChild(container);
            this.displayArea.appendChild(wrapper);

            // Bind mouse events for drawing
            this.bindDrawingEvents();
        }

        // Resize canvases to match viewport
        this.canvas.height = viewport.height;
        this.canvas.width = viewport.width;
        this.overlayCanvas.height = viewport.height;
        this.overlayCanvas.width = viewport.width;

        // Container sizing
        const container = this.canvas.parentElement;
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;

        // Render PDF page into canvas context
        const renderContext = {
            canvasContext: this.ctx,
            viewport: viewport
        };

        await page.render(renderContext).promise;

        this.pageRendering = false;

        if (this.pageNumPending !== null) {
            this.renderPage(this.pageNumPending);
            this.pageNumPending = null;
        }

        // Redraw existing inks for this page
        this.redrawInks();
    }

    queueRenderPage(num) {
        if (this.pageRendering) {
            this.pageNumPending = num;
        } else {
            this.renderPage(num);
        }
    }

    onPrevPage() {
        if (this.pageNum <= 1) return;
        this.pageNum--;
        this.queueRenderPage(this.pageNum);
        document.getElementById('pdf-page-info').textContent = `${this.pageNum} / ${this.pdfDoc.numPages}`;
    }

    onNextPage() {
        if (this.pageNum >= this.pdfDoc.numPages) return;
        this.pageNum++;
        this.queueRenderPage(this.pageNum);
        document.getElementById('pdf-page-info').textContent = `${this.pageNum} / ${this.pdfDoc.numPages}`;
    }

    onZoomIn() {
        this.scale += 0.2;
        this.updateZoomLabel();
        this.queueRenderPage(this.pageNum);
    }

    onZoomOut() {
        if (this.scale <= 0.4) return;
        this.scale -= 0.2;
        this.updateZoomLabel();
        this.queueRenderPage(this.pageNum);
    }

    updateZoomLabel() {
        document.getElementById('pdf-zoom-val').textContent = `${Math.round(this.scale * 100)}%`;
    }

    setupPdfControls() {
        document.getElementById('pdf-prev-page').addEventListener('click', () => this.onPrevPage());
        document.getElementById('pdf-next-page').addEventListener('click', () => this.onNextPage());
        document.getElementById('pdf-zoom-in').addEventListener('click', () => this.onZoomIn());
        document.getElementById('pdf-zoom-out').addEventListener('click', () => this.onZoomOut());

        const tools = ['pan', 'pen', 'highlight'];
        tools.forEach(tool => {
            document.getElementById(`pdf-tool-${tool}`).addEventListener('click', (e) => {
                this.setTool(tool);
                // Update active button state
                tools.forEach(t => document.getElementById(`pdf-tool-${t}`).classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });

        document.getElementById('pdf-clear-ink').addEventListener('click', () => {
            if (this.inkData[this.pageNum]) {
                this.inkData[this.pageNum] = [];
                this.redrawInks();
            }
        });
    }

    // --- PDF Drawing / Annotation ---

    setTool(tool) {
        this.currentTool = tool;
        if (!this.overlayCanvas) return;

        if (tool === 'pan') {
            this.overlayCanvas.style.pointerEvents = 'none';
        } else {
            this.overlayCanvas.style.pointerEvents = 'auto';
            if (tool === 'pen') {
                this.overlayCanvas.style.cursor = 'crosshair';
            } else if (tool === 'highlight') {
                this.overlayCanvas.style.cursor = 'text'; // Or custom cursor
            }
        }
    }

    bindDrawingEvents() {
        this.overlayCanvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.overlayCanvas.addEventListener('mousemove', (e) => this.draw(e));
        this.overlayCanvas.addEventListener('mouseup', () => this.stopDrawing());
        this.overlayCanvas.addEventListener('mouseout', () => this.stopDrawing());
    }

    getMousePos(e) {
        const rect = this.overlayCanvas.getBoundingClientRect();
        // Adjust for CSS scaling if any, but since we set width/height based on viewport, 
        // client coords relative to rect should match canvas coords.
        return {
            x: (e.clientX - rect.left) * (this.overlayCanvas.width / rect.width),
            y: (e.clientY - rect.top) * (this.overlayCanvas.height / rect.height)
        };
    }

    startDrawing(e) {
        if (this.currentTool === 'pan') return;
        this.isDrawing = true;
        const pos = this.getMousePos(e);
        this.lastX = pos.x;
        this.lastY = pos.y;

        this.currentPath = {
            tool: this.currentTool,
            color: this.currentTool === 'pen' ? '#ef4444' : 'rgba(250, 204, 21, 0.4)', // Red pen, yellow highlight
            width: this.currentTool === 'pen' ? 2 : 16,
            points: [{ x: pos.x, y: pos.y }]
        };

        // Setup initial context state for drawing preview
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(this.lastX, this.lastY);
        this.overlayCtx.lineTo(pos.x, pos.y);
        this.overlayCtx.strokeStyle = this.currentPath.color;
        this.overlayCtx.lineWidth = this.currentPath.width;
        this.overlayCtx.lineCap = 'round';
        this.overlayCtx.lineJoin = 'round';
        if (this.currentTool === 'highlight') {
            this.overlayCtx.globalCompositeOperation = 'multiply';
        } else {
            this.overlayCtx.globalCompositeOperation = 'source-over';
        }
        this.overlayCtx.stroke();
    }

    draw(e) {
        if (!this.isDrawing) return;
        const pos = this.getMousePos(e);

        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(this.lastX, this.lastY);
        this.overlayCtx.lineTo(pos.x, pos.y);
        this.overlayCtx.stroke();

        this.lastX = pos.x;
        this.lastY = pos.y;
        this.currentPath.points.push({ x: pos.x, y: pos.y });
    }

    stopDrawing() {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.currentPath && this.currentPath.points.length > 1) {
            if (!this.inkData[this.pageNum]) {
                this.inkData[this.pageNum] = [];
            }
            this.inkData[this.pageNum].push(this.currentPath);
        }
        this.currentPath = null;
    }

    redrawInks() {
        if (!this.overlayCtx) return;
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        const paths = this.inkData[this.pageNum] || [];
        paths.forEach(path => {
            if (path.points.length < 2) return;

            this.overlayCtx.beginPath();
            this.overlayCtx.moveTo(path.points[0].x, path.points[0].y);

            for (let i = 1; i < path.points.length; i++) {
                this.overlayCtx.lineTo(path.points[i].x, path.points[i].y);
            }

            this.overlayCtx.strokeStyle = path.color;
            this.overlayCtx.lineWidth = path.width;
            this.overlayCtx.lineCap = 'round';
            this.overlayCtx.lineJoin = 'round';
            if (path.tool === 'highlight') {
                this.overlayCtx.globalCompositeOperation = 'multiply';
            } else {
                this.overlayCtx.globalCompositeOperation = 'source-over';
            }
            this.overlayCtx.stroke();
        });

        // Reset composite operation
        this.overlayCtx.globalCompositeOperation = 'source-over';
    }

    // --- Utility ---

    reset() {
        this.dropzone.style.display = 'flex';
        this.container.style.display = 'none';
        this.cleanup();
    }

    cleanup() {
        if (this.mediaElement) {
            this.mediaElement.pause();
            this.mediaElement.src = '';
            this.mediaElement = null;
        }
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.pdfDoc = null;
        this.canvas = null;
        this.overlayCanvas = null;
        // Don't clear inkData if we just want to close the file, but we'll clear it here for simplicity
        this.inkData = {};
        this.scale = 1.0;
        this.updateZoomLabel();
    }
}

window.setupMediaHub = () => {
    window.mediaHubInstance = new MediaHub();
};
