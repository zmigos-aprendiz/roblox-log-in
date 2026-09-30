(function () {
    "use strict";

    const MODULE_ID = "photolive";

    // SHIMS — módulo Hub não usa APIs GM_*
    const GM_getValue = (key, def) => {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? def : JSON.parse(raw);
        } catch { return def; }
    };
    const GM_setValue = (key, val) => {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    };
    const GM_addStyle = (css) => {
        const s = document.createElement("style");
        s.setAttribute("data-livephoto", "1");
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
        return s;
    };

    // CONFIG
    const OUTPUT_SIZE = 320;
    const ICON_URL = "https://raw.githubusercontent.com/zBeyond5/assets/main/photo.png";
    // Fallback embutido — usado se o ícone remoto falhar. Cyan, alinhado ao aurora glass.
    const ICON_FALLBACK = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="2.5"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8.5 5V3.5h7V5"/></svg>'
    );

    const MIN_USER_SCALE = 0.2;
    const MAX_USER_SCALE = 8;

    const MIN_PANEL_SCALE = 0.7;
    const MAX_PANEL_SCALE = 1.7;

    const DRAG_HOLD_MS = 300;
    const DRAG_CANCEL_THRESHOLD = 6;

    const HIDE_TRANSITION_MS = 260;

    // TEARDOWN
    const ac = new AbortController();
    let killed = false;
    let origWebSocket = null;
    let origFetch = null;
    let origXhrOpen = null;
    let origXhrSend = null;
    let origToBlob = null;
    let origToDataURL = null;
    let frameResizeObserver = null;

    // ------------------------------------------------------------------
    // Estado
    // ------------------------------------------------------------------

    const state = {
        active: GM_getValue("hcprActive", false),
        canvasMinSize: GM_getValue("hcprCanvasMinSize", 64),
        canvasSquareOnly: GM_getValue("hcprCanvasSquareOnly", true),
        panelHidden: GM_getValue("hcprPanelHidden", false),
        panelPos: GM_getValue("hcprPanelPos", null),
        panelScale: GM_getValue("hcprPanelScale", 1),
        reopenPos: GM_getValue("hcprReopenPos", null),
        image: null,
        blob: null,
        dataUrl: null,
        token: null,
        previewObjectUrl: null,
    };

    const view = {
        frameSize: 0,
        naturalWidth: 0,
        naturalHeight: 0,
        baseScale: 1,
        userScale: 1,
        offsetX: 0,
        offsetY: 0,
    };

    let renderOutputScheduled = false;

    // ------------------------------------------------------------------
    // Debug log
    // ------------------------------------------------------------------

    const debug = (() => {
        let logStore = GM_getValue("hcprDebugLog", []);
        let flushTimer = null;
        let dirty = false;

        function scheduleFlush() {
            dirty = true;
            if (flushTimer) return;

            flushTimer = setTimeout(() => {
                flushTimer = null;
                if (!dirty) return;
                dirty = false;

                try {
                    GM_setValue("hcprDebugLog", logStore);
                } catch (error) {
                    console.warn("[PhotoLive] falha ao salvar log", error);
                }
            }, 800);
        }

        return {
            add(type, data = {}) {
                try {
                    logStore.push({ time: new Date().toISOString(), type, data });

                    if (logStore.length > 300) {
                        logStore.shift();
                    }

                    scheduleFlush();
                    console.log(`[PhotoLive] ${type}`, data);
                } catch (error) {
                    console.warn("[PhotoLive] erro ao registrar log", error);
                }
            },

            clear() {
                logStore = [];
                dirty = false;

                if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                }

                try {
                    GM_setValue("hcprDebugLog", []);
                } catch (error) {
                    console.warn("[PhotoLive] falha ao limpar log", error);
                }
            },

            print() {
                console.table(logStore);
            },

            dispose() {
                if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                }
                dirty = false;
            },
        };
    })();

    function saveState() {
        try {
            GM_setValue("hcprActive", state.active);
            GM_setValue("hcprCanvasMinSize", state.canvasMinSize);
            GM_setValue("hcprCanvasSquareOnly", state.canvasSquareOnly);
            GM_setValue("hcprPanelHidden", state.panelHidden);
            GM_setValue("hcprPanelPos", state.panelPos);
            GM_setValue("hcprPanelScale", state.panelScale);
            GM_setValue("hcprReopenPos", state.reopenPos);
        } catch (error) {
            debug.add("state_save_error", { message: String(error) });
        }
    }

    // ------------------------------------------------------------------
    // Utilidades de upload
    // ------------------------------------------------------------------

    function isUploadRequest(url) {
        if (!url) return false;

        const normalized = String(url).toLowerCase();

        return [
            "/upload",
            "/photo",
            "/avatar",
            "/image",
            "/camera",
            "/profile",
        ].some((path) => normalized.includes(path));
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Falha ao ler a imagem processada."));

            reader.readAsDataURL(blob);
        });
    }

    function revokePreviewUrl() {
        if (state.previewObjectUrl) {
            URL.revokeObjectURL(state.previewObjectUrl);
            state.previewObjectUrl = null;
        }
    }

    // ------------------------------------------------------------------
    // Editor de posição/zoom + geração do PNG final 320x320
    // ------------------------------------------------------------------

    function computeContainScale(frameSize, width, height) {
        if (!frameSize || !width || !height) return 1;
        return Math.min(frameSize / width, frameSize / height);
    }

    function clampUserScale(scale) {
        return Math.min(MAX_USER_SCALE, Math.max(MIN_USER_SCALE, scale));
    }

    function clampOffsets() {
        const drawWidth = view.naturalWidth * view.baseScale * view.userScale;
        const drawHeight = view.naturalHeight * view.baseScale * view.userScale;
        const minOverlap = 24;

        const maxOffsetX = drawWidth / 2 + view.frameSize / 2 - minOverlap;
        const maxOffsetY = drawHeight / 2 + view.frameSize / 2 - minOverlap;

        view.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, view.offsetX));
        view.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, view.offsetY));
    }

    function applyPreviewTransform() {
        const preview = document.querySelector("#hcpr-preview");
        const zoomBadge = document.querySelector("#hcpr-zoom-badge");

        if (!preview || !view.naturalWidth) return;

        const displayWidth = view.naturalWidth * view.baseScale;
        const displayHeight = view.naturalHeight * view.baseScale;

        preview.style.width = `${displayWidth}px`;
        preview.style.height = `${displayHeight}px`;
        preview.style.transform =
            `translate(-50%, -50%) translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.userScale})`;

        if (zoomBadge) {
            zoomBadge.textContent = `${Math.round(view.userScale * 100)}%`;
        }
    }

    function bumpZoomBadge() {
        const zoomBadge = document.querySelector("#hcpr-zoom-badge");
        if (!zoomBadge) return;

        zoomBadge.classList.remove("hcpr-bump");
        void zoomBadge.offsetWidth;
        zoomBadge.classList.add("hcpr-bump");
    }

    function renderOutputCanvas() {
        return new Promise((resolve, reject) => {
            try {
                if (!state.image || !view.frameSize) {
                    reject(new Error("Nenhuma imagem carregada."));
                    return;
                }

                const canvas = document.createElement("canvas");
                canvas.width = OUTPUT_SIZE;
                canvas.height = OUTPUT_SIZE;

                const ctx = canvas.getContext("2d");

                if (!ctx) {
                    reject(new Error("Canvas 2D não suportado neste navegador."));
                    return;
                }

                const exportRatio = OUTPUT_SIZE / view.frameSize;
                const drawWidth = view.naturalWidth * view.baseScale * view.userScale * exportRatio;
                const drawHeight = view.naturalHeight * view.baseScale * view.userScale * exportRatio;
                const centerX = OUTPUT_SIZE / 2 + view.offsetX * exportRatio;
                const centerY = OUTPUT_SIZE / 2 + view.offsetY * exportRatio;

                ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(
                    state.image,
                    centerX - drawWidth / 2,
                    centerY - drawHeight / 2,
                    drawWidth,
                    drawHeight
                );

                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error("Não foi possível gerar o blob da imagem."));
                        return;
                    }

                    resolve(blob);
                }, "image/png");
            } catch (error) {
                reject(error);
            }
        });
    }

    let pendingRenderPromise = null;

    async function commitOutput() {
        try {
            state.blob = await renderOutputCanvas();
            state.dataUrl = await blobToDataUrl(state.blob);
        } catch (error) {
            debug.add("render_output_error", { message: String(error) });
        }
    }

    function scheduleRenderOutput() {
        if (renderOutputScheduled) return;
        renderOutputScheduled = true;

        if (pendingRenderPromise) {
            pendingRenderPromise.then(() => {
                renderOutputScheduled = false;
                scheduleRenderOutput();
            });
            return;
        }

        pendingRenderPromise = new Promise((resolve) => {
            const finish = () => {
                pendingRenderPromise = null;
                resolve();
            };
            const safetyTimer = setTimeout(finish, 1000);

            requestAnimationFrame(async () => {
                renderOutputScheduled = false;
                await commitOutput();
                clearTimeout(safetyTimer);
                finish();
            });
        });
    }

    async function ensureOutputReady() {
        if (!pendingRenderPromise) return;

        await Promise.race([
            pendingRenderPromise,
            new Promise((resolve) => setTimeout(resolve, 1200)),
        ]);
    }

    // ------------------------------------------------------------------
    // Injeção em FormData / JSON
    // ------------------------------------------------------------------

    function findFileField(formData) {
        for (const [key, value] of formData.entries()) {
            const normalized = key.toLowerCase();

            const looksLikeFileKey =
                normalized.includes("file") ||
                normalized.includes("image") ||
                normalized.includes("photo") ||
                normalized.includes("avatar");

            const looksLikeFileValue = value instanceof Blob;

            if (looksLikeFileKey || looksLikeFileValue) {
                return key;
            }
        }

        return null;
    }

    function injectFormData(formData) {
        try {
            if (state.blob) {
                const fileField = findFileField(formData);

                if (fileField) {
                    formData.set(fileField, state.blob, "canvas-photo.png");
                } else {
                    formData.append("file", state.blob, "canvas-photo.png");
                }
            }

            if (state.token) {
                ["token", "upload_token", "access_token", "csrf_token"].forEach(
                    (field) => {
                        if (!formData.has(field)) {
                            formData.append(field, state.token);
                        }
                    }
                );
            }
        } catch (error) {
            debug.add("form_inject_error", { message: String(error) });
        }
    }

    function injectJson(body) {
        if (!body || typeof body !== "string") return body;

        try {
            const json = JSON.parse(body);

            if (!json || typeof json !== "object") return body;

            if (state.token) {
                ["token", "upload_token", "access_token", "csrf_token"].forEach(
                    (field) => {
                        if (field in json) {
                            json[field] = state.token;
                        }
                    }
                );
            }

            if (state.dataUrl) {
                ["file", "image", "photo"].forEach((field) => {
                    if (field in json) {
                        json[field] = state.dataUrl;
                    }
                });
            }

            return JSON.stringify(json);
        } catch (error) {
            debug.add("json_inject_error", { message: String(error) });
            return body;
        }
    }

    // ------------------------------------------------------------------
    // Hook de WebSocket
    // ------------------------------------------------------------------

    function setupWebSocketInterceptor() {
        if (origWebSocket) return;

        const NativeWebSocket = window.WebSocket;

        if (!NativeWebSocket) {
            debug.add("websocket_unavailable");
            return;
        }

        origWebSocket = NativeWebSocket;

        class HookedWebSocket extends NativeWebSocket {
            constructor(...args) {
                super(...args);

                this.addEventListener("message", (event) => {
                    try {
                        if (typeof event.data !== "string") return;

                        const match = event.data.match(/@([a-f0-9]{64})\b/i);

                        if (!match) return;

                        // Mesmo token — não refaz trabalho nem reflete UI novamente
                        if (state.token === match[1]) return;

                        state.token = match[1];
                        debug.add("connection_ready");
                        updateStatus("Conexão pronta", "success");
                    } catch (error) {
                        debug.add("ws_message_hook_error", { message: String(error) });
                    }
                });

                this.addEventListener("close", () => {
                    state.token = null;
                });
            }
        }

        window.WebSocket = HookedWebSocket;
    }

    // ------------------------------------------------------------------
    // Hook de fetch
    // ------------------------------------------------------------------

    function setupFetchInterceptor() {
        if (origFetch) return;

        const originalFetch = window.fetch;

        if (typeof originalFetch !== "function") {
            debug.add("fetch_unavailable");
            return;
        }

        origFetch = originalFetch;

        window.fetch = async function (input, init) {
            try {
                if (!state.active) {
                    return originalFetch.call(this, input, init);
                }

                const isRequestObject =
                    typeof Request !== "undefined" && input instanceof Request;

                const url = isRequestObject ? input.url : input?.url || input;

                if (!isUploadRequest(url)) {
                    return originalFetch.call(this, input, init);
                }

                debug.add("fetch_intercepted", {
                    method: (init && init.method) || (isRequestObject && input.method) || "GET",
                });

                await ensureOutputReady();

                if (isRequestObject) {
                    return rewriteRequestAndFetch(input, init, originalFetch, this);
                }

                const nextInit = { ...(init || {}) };

                if (nextInit.body instanceof FormData) {
                    injectFormData(nextInit.body);
                } else if (typeof nextInit.body === "string") {
                    nextInit.body = injectJson(nextInit.body);
                }

                updateStatus(
                    state.blob ? "Imagem substituída" : "Aguardando imagem",
                    state.blob ? "success" : "info"
                );

                return originalFetch.call(this, input, nextInit);
            } catch (error) {
                debug.add("fetch_hook_error", { message: String(error) });
                return originalFetch.call(this, input, init);
            }
        };
    }

    async function rewriteRequestAndFetch(request, init, originalFetch, ctx) {
        try {
            const contentType = request.headers.get("content-type") || "";

            if (contentType.includes("multipart/form-data")) {
                debug.add("fetch_request_formdata_unsupported");
                return originalFetch.call(ctx, request, init);
            }

            const text = await request.clone().text();
            const body = injectJson(text);
            const rewritten = new Request(request, { body });

            return originalFetch.call(ctx, rewritten, init);
        } catch (error) {
            debug.add("fetch_request_rewrite_error", { message: String(error) });
            return originalFetch.call(ctx, request, init);
        }
    }

    // ------------------------------------------------------------------
    // Hook de XHR
    // ------------------------------------------------------------------

    function setupXhrInterceptor() {
        if (origXhrOpen) return;

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        origXhrOpen = originalOpen;
        origXhrSend = originalSend;

        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            this.__hcprUrl = url;
            this.__hcprMethod = method;

            return originalOpen.call(this, method, url, ...args);
        };

        XMLHttpRequest.prototype.send = function (body) {
            if (state.active && isUploadRequest(this.__hcprUrl) && pendingRenderPromise) {
                const xhr = this;
                const capturedBody = body;
                let sent = false;
                const doSend = () => {
                    if (sent) return;
                    sent = true;
                    finalizeXhrSend(xhr, capturedBody);
                };
                pendingRenderPromise.then(doSend);
                setTimeout(doSend, 1200);
                return;
            }

            return finalizeXhrSend(this, body);
        };

        function finalizeXhrSend(xhr, body) {
            try {
                if (state.active && isUploadRequest(xhr.__hcprUrl)) {
                    debug.add("xhr_intercepted", { method: xhr.__hcprMethod || "GET" });

                    if (body instanceof FormData) {
                        injectFormData(body);
                    } else if (typeof body === "string") {
                        body = injectJson(body);
                    }

                    updateStatus(
                        state.blob ? "Imagem substituída" : "Aguardando imagem",
                        state.blob ? "success" : "info"
                    );
                }
            } catch (error) {
                debug.add("xhr_hook_error", { message: String(error) });
            }

            return originalSend.call(xhr, body);
        }
    }

    // ------------------------------------------------------------------
    // Hook de Canvas
    // ------------------------------------------------------------------

    function canvasMatchesFilter(canvas) {
        try {
            const { width, height } = canvas;

            if (!width || !height) return false;
            if (width < state.canvasMinSize || height < state.canvasMinSize) return false;
            if (state.canvasSquareOnly && width !== height) return false;

            return true;
        } catch {
            return false;
        }
    }

    function setupCanvasHooks() {
        if (origToBlob) return;

        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

        origToBlob = originalToBlob;
        origToDataURL = originalToDataURL;

        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
            try {
                if (state.active && (state.blob || pendingRenderPromise)) {
                    debug.add("canvas_toBlob_seen", {
                        width: this.width,
                        height: this.height,
                        matched: canvasMatchesFilter(this),
                    });

                    if (canvasMatchesFilter(this)) {
                        if (pendingRenderPromise) {
                            let called = false;
                            const doCallback = () => {
                                if (called) return;
                                called = true;
                                callback(state.blob);
                            };
                            pendingRenderPromise.then(doCallback);
                            setTimeout(doCallback, 1200);
                        } else {
                            setTimeout(() => callback(state.blob), 0);
                        }
                        return;
                    }
                }
            } catch (error) {
                debug.add("canvas_toBlob_hook_error", { message: String(error) });
            }

            return originalToBlob.call(this, callback, type, quality);
        };

        HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
            try {
                if (state.active && state.dataUrl) {
                    debug.add("canvas_toDataURL_seen", {
                        width: this.width,
                        height: this.height,
                        matched: canvasMatchesFilter(this),
                    });

                    if (canvasMatchesFilter(this)) {
                        return state.dataUrl;
                    }
                }
            } catch (error) {
                debug.add("canvas_toDataURL_hook_error", { message: String(error) });
            }

            return originalToDataURL.call(this, type, quality);
        };
    }

    // ------------------------------------------------------------------
    // UI — status
    // ------------------------------------------------------------------

    const STATUS_TO_STATE = {
        info: "idle",
        processing: "processing",
        success: "ready",
        error: "error",
        disabled: "disabled",
    };

    function updateStatus(message, type = "info") {
        const statusText = document.querySelector("#hcpr-status-text");
        const statusDot = document.querySelector("#hcpr-status-dot");
        const shell = document.querySelector("#hcpr-shell");
        const reopenDot = document.querySelector("#hcpr-reopen-dot");

        const nextState = STATUS_TO_STATE[type] || "idle";

        if (statusText) statusText.textContent = message;
        if (shell) shell.dataset.state = nextState;
        if (statusDot) statusDot.dataset.state = nextState;
        if (reopenDot) reopenDot.dataset.state = nextState;
    }

    function updateActiveDescription() {
        const desc = document.querySelector("#hcpr-active-desc");
        if (desc) {
            desc.textContent = state.active
                ? "A substituição de imagem está ativada"
                : "A substituição de imagem está desativada";
        }
    }

    function setDownloadEnabled(enabled) {
        const btn = document.querySelector("#hcpr-download");
        if (btn) btn.disabled = !enabled;
    }

    // ------------------------------------------------------------------
    // UI — carregar/limpar/restaurar imagem
    // ------------------------------------------------------------------

    function getFrameSize(frameInner) {
        return frameInner.clientWidth || frameInner.getBoundingClientRect().width || OUTPUT_SIZE;
    }

    function getPanelScaleFactor() {
        return state.panelScale || 1;
    }

    function waitForStableLayout() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }

    async function initViewForImage(image, frameInner) {
        await waitForStableLayout();

        view.frameSize = getFrameSize(frameInner);
        view.naturalWidth = image.naturalWidth || image.width;
        view.naturalHeight = image.naturalHeight || image.height;
        view.baseScale = computeContainScale(view.frameSize, view.naturalWidth, view.naturalHeight);
        view.userScale = 1;
        view.offsetX = 0;
        view.offsetY = 0;

        debug.add("view_init", { frameSize: view.frameSize, baseScale: view.baseScale });
    }

    function resetView() {
        view.frameSize = 0;
        view.naturalWidth = 0;
        view.naturalHeight = 0;
        view.baseScale = 1;
        view.userScale = 1;
        view.offsetX = 0;
        view.offsetY = 0;
    }

    function restoreDefaultFraming() {
        if (!state.image) return;

        view.userScale = 1;
        view.offsetX = 0;
        view.offsetY = 0;

        applyPreviewTransform();
        bumpZoomBadge();
        scheduleRenderOutput();
        debug.add("view_restored_default");
    }

    let selectionGeneration = 0;

    async function handleSelectedFile(file, root) {
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            updateStatus("Formato não suportado", "error");
            return;
        }

        const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

        if (file.size > MAX_SOURCE_BYTES) {
            updateStatus("Imagem muito grande (máx. 25MB)", "error");
            return;
        }

        const mySelection = ++selectionGeneration;

        const preview = root.querySelector("#hcpr-preview");
        const emptyState = root.querySelector("#hcpr-empty");
        const fileName = root.querySelector("#hcpr-file-name");
        const frameInner = root.querySelector("#hcpr-frame-inner");
        const zoomBadge = root.querySelector("#hcpr-zoom-badge");
        const restoreButton = root.querySelector("#hcpr-restore");

        updateStatus("Processando imagem", "processing");

        let objectUrl = null;

        try {
            const image = new Image();
            objectUrl = URL.createObjectURL(file);

            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
                image.src = objectUrl;
            });

            if (mySelection !== selectionGeneration) return;

            state.image = image;

            revokePreviewUrl();
            state.previewObjectUrl = URL.createObjectURL(file);

            if (preview) {
                preview.src = state.previewObjectUrl;
                preview.hidden = false;
                preview.classList.remove("hcpr-materialize");
                void preview.offsetWidth;
                preview.classList.add("hcpr-materialize");
            }

            if (emptyState) emptyState.hidden = true;
            if (fileName) fileName.textContent = file.name;
            if (zoomBadge) zoomBadge.hidden = false;
            if (restoreButton) restoreButton.hidden = false;

            await initViewForImage(image, frameInner);

            if (mySelection !== selectionGeneration) return;

            applyPreviewTransform();
            await commitOutput();

            if (mySelection !== selectionGeneration) return;

            updateStatus("Pronto · 320×320", "success");
            setDownloadEnabled(true);
            debug.add("image_ready", { type: file.type, size: file.size });
        } catch (error) {
            if (mySelection === selectionGeneration) {
                debug.add("image_error", { message: String(error) });
                updateStatus("Não foi possível processar a imagem", "error");
            }
        } finally {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
    }

    function clearPreview(root) {
        selectionGeneration++;
        revokePreviewUrl();
        state.image = null;
        state.blob = null;
        state.dataUrl = null;
        resetView();

        const preview = root.querySelector("#hcpr-preview");
        const emptyState = root.querySelector("#hcpr-empty");
        const fileName = root.querySelector("#hcpr-file-name");
        const zoomBadge = root.querySelector("#hcpr-zoom-badge");
        const restoreButton = root.querySelector("#hcpr-restore");

        if (preview) {
            preview.hidden = true;
            preview.classList.remove("hcpr-materialize");
            preview.style.transform = "";
            preview.style.width = "";
            preview.style.height = "";
        }

        if (emptyState) emptyState.hidden = false;
        if (fileName) fileName.textContent = "Nenhum arquivo selecionado";
        if (zoomBadge) zoomBadge.hidden = true;
        if (restoreButton) restoreButton.hidden = true;

        setDownloadEnabled(false);
        updateStatus("Imagem removida", "info");
        debug.add("image_reset");
    }

    function downloadImage() {
        if (!state.blob) return;
        try {
            const url = URL.createObjectURL(state.blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `photolive-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            debug.add("image_downloaded");
        } catch (error) {
            debug.add("image_download_error", { message: String(error) });
        }
    }

    function resetPanelPosition() {
        state.panelPos = null;
        state.reopenPos = null;
        saveState();

        const wrapper = document.querySelector("#hcpr-tool");
        const reopen = document.querySelector("#hcpr-reopen");

        if (wrapper) {
            wrapper.style.left = "";
            wrapper.style.top = "";
            wrapper.style.right = "";
            wrapper.style.bottom = "";
        }
        if (reopen) {
            reopen.style.left = "";
            reopen.style.top = "";
            reopen.style.right = "";
            reopen.style.bottom = "";
        }

        updateStatus("Posição do painel restaurada", "info");
        debug.add("panel_position_reset");
    }

    // ------------------------------------------------------------------
    // UI — painel: mostrar/esconder com transição
    // ------------------------------------------------------------------

    function setPanelHidden(hidden) {
        const tool = document.querySelector("#hcpr-tool");
        const shell = document.querySelector("#hcpr-shell");
        const reopen = document.querySelector("#hcpr-reopen");

        state.panelHidden = hidden;
        saveState();

        if (tool && shell) {
            if (hidden) {
                shell.classList.add("hcpr-shell-hiding");

                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    tool.classList.add("hcpr-hidden");
                    shell.removeEventListener("transitionend", onEnd);
                };
                const onEnd = (event) => {
                    if (event.target === shell) finish();
                };

                shell.addEventListener("transitionend", onEnd);
                setTimeout(finish, HIDE_TRANSITION_MS);
            } else {
                tool.classList.remove("hcpr-hidden");
                shell.classList.add("hcpr-shell-hiding");
                void shell.offsetWidth;
                shell.classList.remove("hcpr-shell-hiding");
            }
        }

        if (reopen) {
            if (hidden) {
                reopen.hidden = false;
                reopen.classList.remove("hcpr-reopen-enter");
                void reopen.offsetWidth;
                reopen.classList.add("hcpr-reopen-enter");
            } else {
                reopen.hidden = true;
                reopen.classList.remove("hcpr-reopen-enter");
            }
        }
    }

    function applyPanelPosition(panel) {
        if (!state.panelPos) return;

        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.left = `${state.panelPos.left}px`;
        panel.style.top = `${state.panelPos.top}px`;
    }

    function applyPanelScale(panel) {
        panel.style.transform = `scale(${state.panelScale})`;
    }

    function applyReopenPosition(reopen) {
        if (!state.reopenPos) return;

        reopen.style.right = "auto";
        reopen.style.bottom = "auto";
        reopen.style.left = `${state.reopenPos.left}px`;
        reopen.style.top = `${state.reopenPos.top}px`;
    }

    function makePanelDraggable(handle, panel) {
        let dragging = false;
        let holdTimer = null;
        let pending = false;
        let startClientX = 0;
        let startClientY = 0;
        let startLeft = 0;
        let startTop = 0;

        function cancelPending() {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            pending = false;
        }

        function beginDrag() {
            const rect = panel.getBoundingClientRect();

            dragging = true;
            startLeft = rect.left;
            startTop = rect.top;

            panel.style.right = "auto";
            panel.style.bottom = "auto";
            panel.style.left = `${startLeft}px`;
            panel.style.top = `${startTop}px`;

            handle.classList.add("hcpr-dragging");
            panel.classList.add("hcpr-panel-dragging");
        }

        handle.addEventListener("pointerdown", (event) => {
            if (event.target.closest("#hcpr-close")) return;

            startClientX = event.clientX;
            startClientY = event.clientY;
            pending = true;

            handle.setPointerCapture(event.pointerId);

            holdTimer = setTimeout(() => {
                holdTimer = null;
                if (pending) beginDrag();
            }, DRAG_HOLD_MS);
        });

        handle.addEventListener("pointermove", (event) => {
            if (dragging) {
                const deltaX = event.clientX - startClientX;
                const deltaY = event.clientY - startClientY;

                const maxLeft = window.innerWidth - panel.offsetWidth - 4;
                const maxTop = window.innerHeight - panel.offsetHeight - 4;

                const nextLeft = Math.min(Math.max(startLeft + deltaX, 4), Math.max(4, maxLeft));
                const nextTop = Math.min(Math.max(startTop + deltaY, 4), Math.max(4, maxTop));

                panel.style.left = `${nextLeft}px`;
                panel.style.top = `${nextTop}px`;
                return;
            }

            if (pending) {
                const moved = Math.hypot(event.clientX - startClientX, event.clientY - startClientY);
                if (moved > DRAG_CANCEL_THRESHOLD) cancelPending();
            }
        });

        function endInteraction(event) {
            cancelPending();

            if (dragging) {
                dragging = false;
                handle.classList.remove("hcpr-dragging");
                panel.classList.remove("hcpr-panel-dragging");

                state.panelPos = {
                    left: parseFloat(panel.style.left) || 0,
                    top: parseFloat(panel.style.top) || 0,
                };

                saveState();
            }

            try {
                handle.releasePointerCapture(event.pointerId);
            } catch {
                // ponteiro já liberado
            }
        }

        handle.addEventListener("pointerup", endInteraction);
        handle.addEventListener("pointercancel", endInteraction);
    }

    function makePanelResizable(handle, panel) {
        let resizing = false;
        let startClientX = 0;
        let startScale = 1;

        handle.addEventListener("pointerdown", (event) => {
            event.stopPropagation();

            resizing = true;
            startClientX = event.clientX;
            startScale = state.panelScale;

            handle.setPointerCapture(event.pointerId);
            handle.classList.add("hcpr-resizing");
            panel.classList.add("hcpr-panel-resizing");
        });

        handle.addEventListener("pointermove", (event) => {
            if (!resizing) return;

            const deltaX = event.clientX - startClientX;
            const nextScale = Math.min(
                MAX_PANEL_SCALE,
                Math.max(MIN_PANEL_SCALE, startScale + deltaX / 220)
            );

            state.panelScale = nextScale;
            applyPanelScale(panel);
        });

        function endResize(event) {
            if (!resizing) return;

            resizing = false;
            handle.classList.remove("hcpr-resizing");
            panel.classList.remove("hcpr-panel-resizing");

            try {
                handle.releasePointerCapture(event.pointerId);
            } catch {
                // ponteiro já liberado
            }

            saveState();
        }

        handle.addEventListener("pointerup", endResize);
        handle.addEventListener("pointercancel", endResize);
    }

    function makeReopenDraggable(reopen) {
        let dragging = false;
        let holdTimer = null;
        let pending = false;
        let startClientX = 0;
        let startClientY = 0;
        let startLeft = 0;
        let startTop = 0;

        function cancelPending() {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            pending = false;
        }

        function beginDrag() {
            const rect = reopen.getBoundingClientRect();

            dragging = true;
            startLeft = rect.left;
            startTop = rect.top;

            reopen.style.right = "auto";
            reopen.style.bottom = "auto";
            reopen.style.left = `${startLeft}px`;
            reopen.style.top = `${startTop}px`;

            reopen.classList.add("hcpr-dragging");
        }

        reopen.addEventListener("pointerdown", (event) => {
            startClientX = event.clientX;
            startClientY = event.clientY;
            pending = true;

            reopen.setPointerCapture(event.pointerId);

            holdTimer = setTimeout(() => {
                holdTimer = null;
                if (pending) beginDrag();
            }, DRAG_HOLD_MS);
        });

        reopen.addEventListener("pointermove", (event) => {
            if (dragging) {
                const deltaX = event.clientX - startClientX;
                const deltaY = event.clientY - startClientY;

                const maxLeft = window.innerWidth - reopen.offsetWidth - 4;
                const maxTop = window.innerHeight - reopen.offsetHeight - 4;

                const nextLeft = Math.min(Math.max(startLeft + deltaX, 4), Math.max(4, maxLeft));
                const nextTop = Math.min(Math.max(startTop + deltaY, 4), Math.max(4, maxTop));

                reopen.style.left = `${nextLeft}px`;
                reopen.style.top = `${nextTop}px`;
                return;
            }

            if (pending) {
                const moved = Math.hypot(event.clientX - startClientX, event.clientY - startClientY);
                if (moved > DRAG_CANCEL_THRESHOLD) cancelPending();
            }
        });

        function endInteraction(event) {
            const wasDragging = dragging;

            cancelPending();

            if (dragging) {
                dragging = false;
                reopen.classList.remove("hcpr-dragging");

                state.reopenPos = {
                    left: parseFloat(reopen.style.left) || 0,
                    top: parseFloat(reopen.style.top) || 0,
                };

                saveState();
            }

            try {
                reopen.releasePointerCapture(event.pointerId);
            } catch {
                // ponteiro já liberado
            }

            if (wasDragging) {
                reopen.dataset.suppressClick = "1";
                setTimeout(() => delete reopen.dataset.suppressClick, 0);
            }
        }

        reopen.addEventListener("pointerup", endInteraction);
        reopen.addEventListener("pointercancel", endInteraction);
    }

    // ------------------------------------------------------------------
    // UI — editor de pan/zoom da imagem
    // ------------------------------------------------------------------

    function bindImageEditor(root) {
        const frame = root.querySelector("#hcpr-frame");
        const frameInner = root.querySelector("#hcpr-frame-inner");

        let panning = false;
        let lastClientX = 0;
        let lastClientY = 0;

        frame.addEventListener("pointerdown", (event) => {
            if (!state.image) return;
            if (event.target.closest(".hcpr-link-button, .hcpr-frame-tool")) return;

            panning = true;
            lastClientX = event.clientX;
            lastClientY = event.clientY;

            frame.setPointerCapture(event.pointerId);
            frame.classList.add("hcpr-frame-panning");
        });

        frame.addEventListener("pointermove", (event) => {
            if (!panning) return;

            const scaleFactor = getPanelScaleFactor();

            view.offsetX += (event.clientX - lastClientX) / scaleFactor;
            view.offsetY += (event.clientY - lastClientY) / scaleFactor;
            lastClientX = event.clientX;
            lastClientY = event.clientY;

            clampOffsets();
            applyPreviewTransform();
            scheduleRenderOutput();
        });

        function endPan(event) {
            if (!panning) return;

            panning = false;
            frame.classList.remove("hcpr-frame-panning");

            try {
                frame.releasePointerCapture(event.pointerId);
            } catch {
                // ponteiro já liberado
            }
        }

        frame.addEventListener("pointerup", endPan);
        frame.addEventListener("pointercancel", endPan);

        frame.addEventListener(
            "wheel",
            (event) => {
                if (!state.image || !event.ctrlKey) return;

                event.preventDefault();

                const rect = frameInner.getBoundingClientRect();
                const scaleFactor = getPanelScaleFactor();
                const pointerX = (event.clientX - rect.left - rect.width / 2) / scaleFactor;
                const pointerY = (event.clientY - rect.top - rect.height / 2) / scaleFactor;

                const zoomFactor = Math.exp(-event.deltaY * 0.0018);
                const nextUserScale = clampUserScale(view.userScale * zoomFactor);

                const imagePointX = (pointerX - view.offsetX) / view.userScale;
                const imagePointY = (pointerY - view.offsetY) / view.userScale;

                view.userScale = nextUserScale;
                view.offsetX = pointerX - imagePointX * nextUserScale;
                view.offsetY = pointerY - imagePointY * nextUserScale;

                clampOffsets();
                applyPreviewTransform();
                bumpZoomBadge();
                scheduleRenderOutput();
            },
            { passive: false }
        );

        frame.addEventListener("dblclick", () => restoreDefaultFraming());

        frameResizeObserver = new ResizeObserver((entries) => {
            if (!state.image) return;

            const entry = entries[0];
            const newFrameSize = entry.contentRect.width;

            if (!newFrameSize || newFrameSize === view.frameSize) return;

            const ratio = newFrameSize / view.frameSize;

            view.offsetX *= ratio;
            view.offsetY *= ratio;
            view.frameSize = newFrameSize;
            view.baseScale = computeContainScale(view.frameSize, view.naturalWidth, view.naturalHeight);

            clampOffsets();
            applyPreviewTransform();
            scheduleRenderOutput();
        });

        frameResizeObserver.observe(frameInner);
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------

    function bindAccordion(root) {
        const trigger = root.querySelector("#hcpr-settings-toggle");
        const panel = root.querySelector("#hcpr-settings-panel");

        if (!trigger || !panel) return;

        trigger.addEventListener("click", () => {
            const isOpen = trigger.getAttribute("aria-expanded") === "true";
            const next = !isOpen;

            trigger.setAttribute("aria-expanded", String(next));
            panel.classList.toggle("hcpr-accordion-open", next);
        });
    }

    // ------------------------------------------------------------------
    // UI — montagem
    // ------------------------------------------------------------------

    function createInterface() {
        if (killed) return;
        if (!document.body || document.querySelector("#hcpr-tool")) {
            return;
        }

        const wrapper = document.createElement("div");
        wrapper.id = "hcpr-tool";
        wrapper.setAttribute("data-sang-ui", "");
        wrapper.setAttribute("data-hub", "1");

        wrapper.innerHTML = `
            <div class="hcpr-shell" id="hcpr-shell" data-state="idle">
                <div class="hcpr-ambient" aria-hidden="true"></div>

                <header class="hcpr-header" id="hcpr-header">
                    <div class="hcpr-mark">
                        <span class="hcpr-mark-glow" aria-hidden="true"></span>
                        <span class="hcpr-mark-ring" aria-hidden="true"></span>
                        <img src="${ICON_URL}" alt="" class="hcpr-mark-img">
                    </div>

                    <div class="hcpr-brand">
                        <span class="hcpr-eyebrow">Processador de Foto</span>
                        <strong class="hcpr-brand-name">LivePhoto</strong>
                    </div>

                    <button type="button" id="hcpr-close" class="hcpr-icon-btn" data-tooltip="Minimizar" aria-label="Minimizar painel">
                        <svg viewBox="0 0 24 24" fill="none"><path d="M6 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                    </button>
                </header>

                <div class="hcpr-status-row">
                    <span class="hcpr-status-dot" id="hcpr-status-dot" data-state="idle" aria-hidden="true"></span>
                    <span class="hcpr-status-text" id="hcpr-status-text">Em espera</span>
                </div>

                <section class="hcpr-frame" id="hcpr-frame">
                    <div class="hcpr-frame-inner" id="hcpr-frame-inner">
                        <img id="hcpr-preview" alt="Prévia da imagem selecionada" hidden>

                        <div id="hcpr-empty" class="hcpr-empty">
                            <span class="hcpr-empty-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            </span>
                            <strong class="hcpr-empty-title">Solte a imagem</strong>
                            <span class="hcpr-empty-sub">Arraste e solte, cole ou <label for="hcpr-file" class="hcpr-link-button">selecione</label></span>
                            <span class="hcpr-empty-caption hcpr-mono">PNG · JPG · WEBP · MÁX 25MB</span>
                        </div>

                        <div class="hcpr-drop-overlay" aria-hidden="true">
                            <span class="hcpr-drop-icon">
                                <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            </span>
                            <strong>Solte para enviar</strong>
                        </div>

                        <button type="button" id="hcpr-restore" class="hcpr-float-btn" data-tooltip="Restaurar enquadramento" aria-label="Restaurar enquadramento padrão" hidden>
                            <svg viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1 1 2.7 6M4 12v5m0-5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>

                        <span class="hcpr-zoom-badge hcpr-mono" id="hcpr-zoom-badge" hidden>100%</span>

                        <span class="hcpr-corner hcpr-corner-tl"></span>
                        <span class="hcpr-corner hcpr-corner-tr"></span>
                        <span class="hcpr-corner hcpr-corner-bl"></span>
                        <span class="hcpr-corner hcpr-corner-br"></span>
                    </div>
                </section>

                <div class="hcpr-info-strip">
                    <div class="hcpr-info-item">
                        <span class="hcpr-info-label">Saída</span>
                        <span class="hcpr-info-value hcpr-mono">320×320</span>
                    </div>
                    <span class="hcpr-info-sep" aria-hidden="true"></span>
                    <div class="hcpr-info-item">
                        <span class="hcpr-info-label">Arraste</span>
                        <span class="hcpr-info-value">Mover imagem</span>
                    </div>
                    <span class="hcpr-info-sep" aria-hidden="true"></span>
                    <div class="hcpr-info-item">
                        <span class="hcpr-info-label">Zoom</span>
                        <span class="hcpr-info-value">Ctrl + Scroll</span>
                    </div>
                </div>

                <input id="hcpr-file" class="hcpr-file-input" type="file" accept="image/png,image/jpeg,image/webp">

                <div class="hcpr-primary-row">
                    <div class="hcpr-primary-label">
                        <span class="hcpr-eyebrow">Substituição</span>
                        <strong>Ativa</strong>
                        <span class="hcpr-primary-desc" id="hcpr-active-desc">${state.active ? "A substituição de imagem está ativada" : "A substituição de imagem está desativada"}</span>
                    </div>

                    <label class="hcpr-switch">
                        <input id="hcpr-active" type="checkbox" ${state.active ? "checked" : ""}>
                        <span class="hcpr-slider"></span>
                    </label>
                </div>

                <div class="hcpr-file-badge hcpr-mono" id="hcpr-file-name">Nenhum arquivo selecionado</div>

                <div class="hcpr-accordion">
                    <button type="button" class="hcpr-accordion-trigger" id="hcpr-settings-toggle" aria-expanded="false" aria-controls="hcpr-settings-panel">
                        <span>Ajustes</span>
                        <svg class="hcpr-chevron" viewBox="0 0 24 24" fill="none"><path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>

                    <div class="hcpr-accordion-panel" id="hcpr-settings-panel">
                        <div class="hcpr-accordion-inner">
                            <div class="hcpr-group">
                                <span class="hcpr-group-title">Tela</span>

                                <div class="hcpr-setting-row">
                                    <div class="hcpr-setting-label">
                                        <span>Somente quadrado</span>
                                        <small>Processar apenas telas quadradas</small>
                                    </div>
                                    <label class="hcpr-switch hcpr-switch-sm">
                                        <input id="hcpr-square-only" type="checkbox" ${state.canvasSquareOnly ? "checked" : ""}>
                                        <span class="hcpr-slider"></span>
                                    </label>
                                </div>

                                <div class="hcpr-setting-row">
                                    <div class="hcpr-setting-label">
                                        <span>Tamanho mínimo</span>
                                    </div>
                                    <div class="hcpr-number-field">
                                        <input id="hcpr-min-size" class="hcpr-mono" type="number" min="1" step="1" value="${state.canvasMinSize}">
                                        <span class="hcpr-mono hcpr-unit">px</span>
                                    </div>
                                </div>
                            </div>

                            <div class="hcpr-group">
                                <span class="hcpr-group-title">Painel</span>
                                <div class="hcpr-text-actions">
                                    <button type="button" id="hcpr-reset-pos" class="hcpr-btn hcpr-btn-ghost">Resetar posição</button>
                                </div>
                            </div>

                            <div class="hcpr-group">
                                <span class="hcpr-group-title">Diagnóstico</span>
                                <div class="hcpr-text-actions">
                                    <button type="button" id="hcpr-logs" class="hcpr-btn hcpr-btn-ghost">Diagnóstico</button>
                                    <button type="button" id="hcpr-clear-logs" class="hcpr-btn hcpr-btn-ghost">Limpar registros</button>
                                </div>
                            </div>

                            <div class="hcpr-footnote hcpr-mono">LivePhoto by SANG · v9.1.0</div>
                        </div>
                    </div>
                </div>

                <div class="hcpr-footer-row">
                    <button type="button" id="hcpr-download" class="hcpr-btn hcpr-btn-ghost hcpr-btn-footer" data-tooltip="Baixar PNG 320×320" disabled>
                        <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 17v.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <span>Baixar PNG</span>
                    </button>
                    <button type="button" id="hcpr-reset" class="hcpr-btn hcpr-btn-danger hcpr-btn-footer" data-tooltip="Ctrl+Z">
                        <svg viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1 1 2.7 6M4 12v5m0-5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <span>Resetar imagem</span>
                    </button>
                </div>

                <div class="hcpr-resize-handle" id="hcpr-resize-handle" aria-hidden="true"></div>
            </div>
        `;

        const reopen = document.createElement("button");
        reopen.type = "button";
        reopen.id = "hcpr-reopen";
        reopen.setAttribute("data-sang-ui", "");
        reopen.setAttribute("data-hub", "1");
        reopen.setAttribute("aria-label", "Abrir painel LivePhoto");
        reopen.dataset.tooltip = "Abrir LivePhoto";
        reopen.hidden = !state.panelHidden;
        reopen.innerHTML = `
            <span class="hcpr-reopen-ring" aria-hidden="true"></span>
            <img src="${ICON_URL}" alt="" class="hcpr-reopen-img">
            <span class="hcpr-reopen-dot" id="hcpr-reopen-dot" data-state="idle" aria-hidden="true"></span>
        `;

        document.body.appendChild(wrapper);
        document.body.appendChild(reopen);

        // Fallback do ícone: se o remoto falhar, troca por SVG inline
        const markImg = wrapper.querySelector(".hcpr-mark-img");
        const reopenImg = reopen.querySelector(".hcpr-reopen-img");
        if (markImg) markImg.addEventListener("error", () => { markImg.src = ICON_FALLBACK; }, { once: true });
        if (reopenImg) reopenImg.addEventListener("error", () => { reopenImg.src = ICON_FALLBACK; }, { once: true });

        // Proteção contra Lite Mode do LiveBooster (idempotente — data-sang-ui já cobre)
        window._hubUI?.markProtected?.(wrapper);
        window._hubUI?.markProtected?.(reopen);

        applyPanelPosition(wrapper);
        applyPanelScale(wrapper);
        applyReopenPosition(reopen);

        if (state.panelHidden) {
            wrapper.style.transition = "none";
            wrapper.classList.add("hcpr-hidden");
            requestAnimationFrame(() => {
                wrapper.style.transition = "";
            });
        }

        bindInterface(wrapper, reopen);
    }

    function bindInterface(root, reopen) {
        const fileInput = root.querySelector("#hcpr-file");
        const frame = root.querySelector("#hcpr-frame");
        const header = root.querySelector("#hcpr-header");
        const resizeHandle = root.querySelector("#hcpr-resize-handle");
        const activeToggle = root.querySelector("#hcpr-active");
        const squareOnlyToggle = root.querySelector("#hcpr-square-only");
        const minSizeInput = root.querySelector("#hcpr-min-size");
        const closeButton = root.querySelector("#hcpr-close");
        const logsButton = root.querySelector("#hcpr-logs");
        const clearLogsButton = root.querySelector("#hcpr-clear-logs");
        const resetButton = root.querySelector("#hcpr-reset");
        const restoreButton = root.querySelector("#hcpr-restore");
        const downloadButton = root.querySelector("#hcpr-download");
        const resetPosButton = root.querySelector("#hcpr-reset-pos");

        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            handleSelectedFile(file, root);
        });

        ["dragenter", "dragover"].forEach((eventName) => {
            frame.addEventListener(eventName, (event) => {
                event.preventDefault();
                frame.classList.add("hcpr-frame-dragging");
            });
        });

        ["dragleave", "drop"].forEach((eventName) => {
            frame.addEventListener(eventName, (event) => {
                event.preventDefault();
                frame.classList.remove("hcpr-frame-dragging");
            });
        });

        frame.addEventListener("drop", (event) => {
            const file = event.dataTransfer?.files?.[0];
            if (file) handleSelectedFile(file, root);
        });

        document.addEventListener("paste", (event) => {
            if (state.panelHidden) return;

            const items = event.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (!item.type.startsWith("image/")) continue;

                const file = item.getAsFile();
                if (!file) continue;

                event.preventDefault();
                handleSelectedFile(file, root);
                updateStatus("Imagem colada", "info");
                break;
            }
        }, { signal: ac.signal });

        window.addEventListener("keydown", (event) => {
            if (state.panelHidden) return;
            if (!state.image) return;

            const isUndoCombo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.code === "KeyZ";

            if (!isUndoCombo) return;

            const target = event.composedPath ? event.composedPath()[0] : event.target;

            const isEditableTarget =
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable);

            if (isEditableTarget) return;

            event.preventDefault();
            clearPreview(root);
            debug.add("image_reset_shortcut");
        }, { signal: ac.signal, capture: true });

        activeToggle.addEventListener("change", () => {
            state.active = activeToggle.checked;
            saveState();
            updateActiveDescription();

            if (state.active) {
                updateStatus(state.blob ? "Imagem substituída" : "Aguardando imagem", state.blob ? "success" : "info");
            } else {
                updateStatus("Substituição desativada", "disabled");
            }

            debug.add(state.active ? "tool_enabled" : "tool_disabled");
        });

        squareOnlyToggle.addEventListener("change", () => {
            state.canvasSquareOnly = squareOnlyToggle.checked;
            saveState();
            debug.add("canvas_filter_changed", { squareOnly: state.canvasSquareOnly });
        });

        minSizeInput.addEventListener("change", () => {
            const parsed = parseInt(minSizeInput.value, 10);
            const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

            state.canvasMinSize = safeValue;
            minSizeInput.value = String(safeValue);
            saveState();

            debug.add("canvas_min_size_changed", { minSize: safeValue });
        });

        closeButton.addEventListener("click", () => setPanelHidden(true));
        reopen.addEventListener("click", () => {
            if (reopen.dataset.suppressClick) return;
            setPanelHidden(false);
        });

        logsButton.addEventListener("click", () => {
            debug.print();
            updateStatus("Diagnóstico registrado", "info");
        });

        clearLogsButton.addEventListener("click", () => {
            debug.clear();
            updateStatus("Registros limpos", "info");
        });

        resetButton.addEventListener("click", () => clearPreview(root));
        restoreButton.addEventListener("click", () => restoreDefaultFraming());
        downloadButton.addEventListener("click", downloadImage);
        resetPosButton.addEventListener("click", resetPanelPosition);

        makePanelDraggable(header, root);
        makePanelResizable(resizeHandle, root);
        makeReopenDraggable(reopen);
        bindImageEditor(root);
        bindAccordion(root);

        // Sincroniza estado inicial do botão de download
        setDownloadEnabled(!!state.blob);

        updateStatus(
            state.active ? "Aguardando imagem" : "Substituição desativada",
            state.active ? "info" : "disabled"
        );
    }

    GM_addStyle(`
        :where(#hcpr-tool, #hcpr-reopen) {
            /* ─── Aurora Glass — mesma família do hub2.js ─── */
            --hub-cyan: #22d3ee;
            --hub-violet: #a78bfa;
            --hub-ok: #34d399;
            --hub-err: #fb7185;
            --hub-muted: #8b8fa3;
            --hub-grad: linear-gradient(120deg, var(--hub-cyan), var(--hub-violet));

            /* superfícies */
            --hcpr-bg: #08090D;
            --hcpr-bg-soft: #0C0E14;
            --hcpr-surface: #11131B;
            --hcpr-surface-raised: #161925;
            --hcpr-surface-elevated: #1C2030;

            --hcpr-border: rgba(255,255,255,.10);
            --hcpr-border-subtle: rgba(255,255,255,.055);
            --hcpr-border-strong: rgba(255,255,255,.16);

            /* texto */
            --hcpr-text: #F7F8FF;
            --hcpr-text-secondary: #C7CADE;
            --hcpr-text-muted: #8B90A5;
            --hcpr-text-dim: #5A6079;

            /* accent — cyan primário, violet secundário */
            --hcpr-accent: var(--hub-cyan);
            --hcpr-accent-bright: #67e8f9;
            --hcpr-accent-deep: #06b6d4;
            --hcpr-accent-violet: var(--hub-violet);
            --hcpr-accent-soft: rgba(34,211,238,.16);

            --hcpr-success: var(--hub-ok);
            --hcpr-danger: var(--hub-err);
            --hcpr-danger-soft: rgba(251,113,133,.14);

            --hcpr-radius: 20px;
            --hcpr-radius-sm: 12px;
            --hcpr-radius-xs: 8px;

            --hcpr-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
            --hcpr-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;

            /* motion */
            --hcpr-ease-out: cubic-bezier(.16,1,.3,1);
            --hcpr-ease-in-out: cubic-bezier(.65,0,.35,1);
            --hcpr-t-fast: 120ms;
            --hcpr-t-base: 180ms;
            --hcpr-t-medium: 240ms;
            --hcpr-t-slow: 320ms;

            --hcpr-shadow-ambient: 0 20px 50px rgba(0,0,0,.55);
            --hcpr-shadow-contact: 0 2px 8px rgba(0,0,0,.4);
            --hcpr-shadow-inner: inset 0 1px 0 rgba(255,255,255,.06);
        }

        @media (prefers-reduced-motion: reduce) {
            #hcpr-tool, #hcpr-tool *, #hcpr-reopen, #hcpr-reopen * {
                animation-duration: .001ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: .001ms !important;
            }
        }

        #hcpr-tool {
            all: initial;
            position: fixed;
            z-index: 2147483647;
            right: 22px;
            bottom: 22px;
            width: 306px;
            max-height: calc(100vh - 44px);
            overflow-y: auto;
            overflow-x: hidden;
            color: var(--hcpr-text);
            font-family: var(--hcpr-sans);
            transform-origin: top left;
            scrollbar-width: thin;
            scrollbar-color: var(--hcpr-border) transparent;
        }

        #hcpr-tool::-webkit-scrollbar { width: 4px; }
        #hcpr-tool::-webkit-scrollbar-thumb {
            background: var(--hcpr-border);
            border-radius: 2px;
        }
        #hcpr-tool::-webkit-scrollbar-thumb:hover {
            background: var(--hcpr-border-strong);
        }

        #hcpr-tool *, #hcpr-tool *::before, #hcpr-tool *::after {
            box-sizing: border-box;
        }

        #hcpr-tool.hcpr-hidden { display: none; }

        .hcpr-shell {
            position: relative;
            overflow: visible;
            border: 1px solid rgba(255,255,255,.08);
            border-radius: var(--hcpr-radius);
            background: linear-gradient(175deg, rgba(20,20,28,.92) 0%, rgba(9,9,14,.97) 100%);
            backdrop-filter: blur(18px) saturate(140%);
            -webkit-backdrop-filter: blur(18px) saturate(140%);
            box-shadow:
                var(--hcpr-shadow-ambient),
                var(--hcpr-shadow-contact),
                0 0 24px rgba(34,211,238,.06),
                var(--hcpr-shadow-inner);
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
            transition:
                opacity var(--hcpr-t-medium) var(--hcpr-ease-out),
                transform var(--hcpr-t-medium) var(--hcpr-ease-out),
                filter var(--hcpr-t-medium) var(--hcpr-ease-out),
                box-shadow var(--hcpr-t-base) var(--hcpr-ease-out),
                border-color var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        /* top line — traço aurora centrado, com fade nas pontas */
        .hcpr-shell::before {
            content: '';
            position: absolute;
            top: 0;
            left: 12%;
            right: 12%;
            height: 2px;
            border-radius: 2px;
            background: var(--hub-grad);
            background-size: 200% 100%;
            animation: hcpr-hdr-shimmer 4s linear infinite;
            box-shadow: 0 0 12px rgba(34,211,238,.4);
            pointer-events: none;
            z-index: 3;
            -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
            mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
        }

        @keyframes hcpr-hdr-shimmer {
            0% { background-position: 0% 50%; }
            100% { background-position: 200% 50%; }
        }

        .hcpr-shell.hcpr-shell-hiding {
            opacity: 0;
            transform: translateY(6px) scale(.96);
            filter: blur(4px);
        }

        #hcpr-tool.hcpr-panel-dragging .hcpr-shell,
        #hcpr-tool.hcpr-panel-resizing .hcpr-shell {
            border-color: color-mix(in srgb, var(--hcpr-accent) 45%, var(--hcpr-border));
            box-shadow: 0 28px 80px rgba(0,0,0,.6), 0 0 0 1px var(--hcpr-accent-soft), 0 0 30px rgba(34,211,238,.12), var(--hcpr-shadow-inner);
        }

        #hcpr-tool.hcpr-panel-dragging .hcpr-shell { transform: scale(1.006); }

        .hcpr-ambient {
            position: absolute;
            inset: 0;
            overflow: hidden;
            border-radius: inherit;
            pointer-events: none;
            opacity: .5;
            background: radial-gradient(60% 40% at 50% 0%, rgba(34,211,238,.14), transparent 70%);
            transition: opacity var(--hcpr-t-medium) var(--hcpr-ease-out);
        }

        .hcpr-shell[data-state="ready"] .hcpr-ambient { opacity: .85; }
        .hcpr-shell[data-state="error"] .hcpr-ambient {
            background: radial-gradient(60% 40% at 50% 0%, rgba(251,113,133,.14), transparent 70%);
            opacity: .8;
        }

        /* ---------------- header ---------------- */

        .hcpr-header {
            position: relative;
            display: flex;
            align-items: center;
            gap: 11px;
            padding: 16px 15px 10px;
            cursor: grab;
            touch-action: none;
            user-select: none;
        }

        .hcpr-header.hcpr-dragging { cursor: grabbing; }

        .hcpr-mark {
            position: relative;
            display: grid;
            flex: 0 0 auto;
            width: 34px;
            height: 34px;
            place-items: center;
        }

        .hcpr-mark-glow {
            position: absolute;
            inset: -8px;
            border-radius: 14px;
            background: radial-gradient(circle, var(--hcpr-accent) 0%, transparent 70%);
            opacity: 0;
            filter: blur(6px);
            transition: opacity var(--hcpr-t-medium) var(--hcpr-ease-out);
        }

        .hcpr-shell[data-state="ready"] .hcpr-mark-glow { opacity: .55; }
        .hcpr-shell[data-state="processing"] .hcpr-mark-glow {
            opacity: .4;
            animation: hcpr-breathe 1.6s var(--hcpr-ease-in-out) infinite;
        }
        .hcpr-shell[data-state="error"] .hcpr-mark-glow {
            opacity: .5;
            background: radial-gradient(circle, var(--hcpr-danger) 0%, transparent 70%);
        }

        .hcpr-mark-ring {
            position: absolute;
            inset: 0;
            border-radius: 10px;
            border: 1px solid var(--hcpr-border-strong);
            background: linear-gradient(160deg, var(--hcpr-surface-elevated), var(--hcpr-surface));
            box-shadow: inset 0 1px 0 rgba(255,255,255,.08), inset 0 -6px 10px rgba(0,0,0,.35);
            transition: border-color var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-shell[data-state="ready"] .hcpr-mark-ring {
            border-color: color-mix(in srgb, var(--hcpr-accent) 55%, var(--hcpr-border-strong));
        }
        .hcpr-shell[data-state="error"] .hcpr-mark-ring {
            border-color: color-mix(in srgb, var(--hcpr-danger) 50%, var(--hcpr-border-strong));
        }

        .hcpr-mark-img {
            position: relative;
            width: 20px;
            height: 20px;
            object-fit: cover;
            border-radius: 5px;
            display: block;
        }

        .hcpr-brand {
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            min-width: 0;
            gap: 1px;
        }

        .hcpr-eyebrow {
            color: var(--hcpr-text-muted);
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: .09em;
            text-transform: uppercase;
        }

        .hcpr-brand-name {
            font-size: 14.5px;
            font-weight: 700;
            letter-spacing: .02em;
            background: linear-gradient(100deg, var(--hub-cyan) 0%, var(--hub-violet) 35%, #fff 50%, var(--hub-violet) 65%, var(--hub-cyan) 100%);
            background-size: 220% auto;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: hcpr-title-shine 3.2s linear infinite;
        }

        @keyframes hcpr-title-shine {
            to { background-position: -200% center; }
        }

        .hcpr-icon-btn {
            display: grid;
            flex: 0 0 auto;
            width: 27px;
            height: 27px;
            padding: 0;
            place-items: center;
            border: 1px solid transparent;
            border-radius: var(--hcpr-radius-xs);
            color: var(--hcpr-text-muted);
            background: transparent;
            cursor: pointer;
            transition: color var(--hcpr-t-fast) var(--hcpr-ease-out), background var(--hcpr-t-fast) var(--hcpr-ease-out), border-color var(--hcpr-t-fast) var(--hcpr-ease-out), transform var(--hcpr-t-fast) var(--hcpr-ease-out);
        }

        .hcpr-icon-btn svg { width: 14px; height: 14px; }
        .hcpr-icon-btn:hover {
            color: #0b0b10;
            background: var(--hub-grad);
            border-color: transparent;
            box-shadow: 0 0 14px rgba(34,211,238,.35);
        }
        .hcpr-icon-btn:active { transform: scale(.92); }
        .hcpr-icon-btn:focus-visible { outline: 2px solid var(--hcpr-accent); outline-offset: 2px; }

        /* ---------------- status ---------------- */

        .hcpr-status-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 0 15px 12px;
        }

        .hcpr-status-dot {
            position: relative;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--hcpr-text-dim);
            box-shadow: 0 0 0 3px transparent;
            transition: background var(--hcpr-t-base) var(--hcpr-ease-out), box-shadow var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-status-dot[data-state="ready"] { background: var(--hcpr-success); box-shadow: 0 0 0 3px rgba(52,211,153,.18); }
        .hcpr-status-dot[data-state="error"] { background: var(--hcpr-danger); box-shadow: 0 0 0 3px rgba(251,113,133,.18); }
        .hcpr-status-dot[data-state="disabled"] { background: var(--hcpr-text-dim); }
        .hcpr-status-dot[data-state="processing"] {
            background: var(--hcpr-accent-bright);
            animation: hcpr-breathe 1.3s var(--hcpr-ease-in-out) infinite;
        }

        .hcpr-status-text {
            color: var(--hcpr-text-secondary);
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: .01em;
            transition: color var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-shell[data-state="ready"] .hcpr-status-text { color: var(--hcpr-success); }
        .hcpr-shell[data-state="error"] .hcpr-status-text { color: var(--hcpr-danger); }

        @keyframes hcpr-breathe {
            0%, 100% { opacity: .4; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.15); }
        }

        /* ---------------- editor ---------------- */

        .hcpr-frame { padding: 0 15px; }

        .hcpr-frame-inner {
            position: relative;
            aspect-ratio: 1 / 1;
            overflow: hidden;
            border-radius: var(--hcpr-radius-sm);
            border: 1px solid var(--hcpr-border);
            background:
                linear-gradient(45deg, var(--hcpr-surface-elevated) 25%, transparent 25%),
                linear-gradient(-45deg, var(--hcpr-surface-elevated) 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, var(--hcpr-surface-elevated) 75%),
                linear-gradient(-45deg, transparent 75%, var(--hcpr-surface-elevated) 75%),
                var(--hcpr-surface);
            background-position: 0 0, 0 8px, 8px -8px, -8px 0;
            background-size: 16px 16px;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.05), inset 0 0 0 1px rgba(0,0,0,.3);
            transition: filter var(--hcpr-t-fast) var(--hcpr-ease-out), border-color var(--hcpr-t-base) var(--hcpr-ease-out), box-shadow var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-frame:hover .hcpr-frame-inner { border-color: var(--hcpr-border-strong); }
        .hcpr-shell[data-state="ready"] .hcpr-frame-inner {
            border-color: color-mix(in srgb, var(--hcpr-accent) 30%, var(--hcpr-border));
            box-shadow: inset 0 1px 0 rgba(255,255,255,.05), inset 0 0 0 1px rgba(0,0,0,.3), 0 0 20px rgba(34,211,238,.08);
        }

        .hcpr-frame-inner img {
            position: absolute;
            top: 50%;
            left: 50%;
            max-width: none;
            transform-origin: center;
            will-change: transform;
            pointer-events: none;
        }

        @keyframes hcpr-materialize-in {
            from { opacity: 0; transform: translate(-50%, -50%) scale(.985); filter: blur(6px); }
        }

        .hcpr-frame-inner img.hcpr-materialize {
            animation: hcpr-materialize-in var(--hcpr-t-medium) var(--hcpr-ease-out);
        }

        .hcpr-frame { cursor: default; }
        .hcpr-frame:has(#hcpr-preview:not([hidden])) { cursor: grab; touch-action: none; }
        .hcpr-frame-panning { cursor: grabbing !important; }
        .hcpr-frame-panning .hcpr-frame-inner { filter: brightness(1.06); }

        .hcpr-empty {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 16px;
            text-align: center;
            transition: transform var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-frame:hover .hcpr-empty { transform: translateY(-1px); }

        .hcpr-empty-icon {
            display: grid;
            width: 38px;
            height: 38px;
            place-items: center;
            border-radius: 11px;
            border: 1px solid var(--hcpr-border);
            background: linear-gradient(160deg, var(--hcpr-surface-elevated), var(--hcpr-surface));
            color: var(--hcpr-text-muted);
            box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
            transition: color var(--hcpr-t-base) var(--hcpr-ease-out), border-color var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-frame:hover .hcpr-empty-icon {
            color: var(--hcpr-accent-bright);
            border-color: color-mix(in srgb, var(--hcpr-accent) 40%, var(--hcpr-border));
        }

        .hcpr-empty-icon svg { width: 17px; height: 17px; }

        .hcpr-empty-title {
            font-size: 12.5px;
            font-weight: 700;
            color: var(--hcpr-text);
        }

        .hcpr-empty-sub {
            color: var(--hcpr-text-secondary);
            font-size: 10.5px;
        }

        .hcpr-empty-caption {
            color: var(--hcpr-text-muted);
            font-size: 9px;
            letter-spacing: .04em;
        }

        .hcpr-link-button { color: var(--hcpr-accent-bright); cursor: pointer; font-weight: 700; }
        .hcpr-link-button:hover { text-decoration: underline; }

        .hcpr-drop-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            border-radius: var(--hcpr-radius-sm);
            background: linear-gradient(180deg, rgba(34,211,238,.16), rgba(167,139,250,.10));
            border: 1.5px dashed color-mix(in srgb, var(--hcpr-accent) 60%, transparent);
            color: var(--hcpr-accent-bright);
            font-size: 12px;
            font-weight: 650;
            opacity: 0;
            transform: scale(.98);
            pointer-events: none;
            transition: opacity var(--hcpr-t-base) var(--hcpr-ease-out), transform var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-drop-icon svg { width: 22px; height: 22px; }

        .hcpr-frame-dragging .hcpr-drop-overlay { opacity: 1; transform: scale(1); }
        .hcpr-frame-dragging .hcpr-frame-inner { border-color: var(--hcpr-accent); }

        .hcpr-float-btn {
            position: absolute;
            top: 8px;
            left: 8px;
            display: grid;
            width: 26px;
            height: 26px;
            padding: 0;
            place-items: center;
            border: 1px solid var(--hcpr-border);
            border-radius: 8px;
            color: var(--hcpr-text-secondary);
            background: rgba(17,19,27,.7);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            box-shadow: 0 6px 16px rgba(0,0,0,.3);
            cursor: pointer;
            transition: color var(--hcpr-t-fast) var(--hcpr-ease-out), border-color var(--hcpr-t-fast) var(--hcpr-ease-out), transform var(--hcpr-t-fast) var(--hcpr-ease-out);
        }

        .hcpr-float-btn svg { width: 13px; height: 13px; }
        .hcpr-float-btn:hover {
            color: var(--hcpr-accent-bright);
            border-color: color-mix(in srgb, var(--hcpr-accent) 45%, var(--hcpr-border));
        }
        .hcpr-float-btn:active { transform: scale(.9); }

        .hcpr-zoom-badge {
            position: absolute;
            right: 8px;
            bottom: 8px;
            padding: 4px 7px;
            border: 1px solid var(--hcpr-border);
            border-radius: 7px;
            color: var(--hcpr-text);
            background: rgba(17,19,27,.7);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            box-shadow: 0 6px 16px rgba(0,0,0,.3);
            font-size: 9.5px;
            letter-spacing: .02em;
            transform: scale(1);
            transition: transform var(--hcpr-t-fast) var(--hcpr-ease-out);
        }

        .hcpr-zoom-badge.hcpr-bump { animation: hcpr-badge-bump var(--hcpr-t-base) var(--hcpr-ease-out); }

        @keyframes hcpr-badge-bump {
            0% { transform: scale(1); }
            45% { transform: scale(1.14); }
            100% { transform: scale(1); }
        }

        .hcpr-corner {
            position: absolute;
            width: 15px;
            height: 15px;
            border: 2px solid var(--hcpr-border-strong);
            transition: border-color var(--hcpr-t-base) var(--hcpr-ease-out);
            pointer-events: none;
        }

        .hcpr-shell[data-state="ready"] .hcpr-corner { border-color: var(--hcpr-accent); }
        .hcpr-shell[data-state="error"] .hcpr-corner { border-color: var(--hcpr-danger); }

        .hcpr-corner-tl { top: 6px; left: 6px; border-width: 2px 0 0 2px; border-radius: 5px 0 0 0; }
        .hcpr-corner-tr { top: 6px; right: 6px; border-width: 2px 2px 0 0; border-radius: 0 5px 0 0; }
        .hcpr-corner-bl { bottom: 6px; left: 6px; border-width: 0 0 2px 2px; border-radius: 0 0 0 5px; }
        .hcpr-corner-br { bottom: 6px; right: 6px; border-width: 0 2px 2px 0; border-radius: 0 0 5px 0; }

        /* ---------------- info strip ---------------- */

        .hcpr-info-strip {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 10px 15px 4px;
        }

        .hcpr-info-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1px;
        }

        .hcpr-info-label {
            color: var(--hcpr-text-muted);
            font-size: 8.5px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .hcpr-info-value {
            color: var(--hcpr-text-secondary);
            font-size: 10px;
            font-weight: 500;
        }

        .hcpr-info-value.hcpr-mono { color: var(--hcpr-text); font-weight: 600; }

        .hcpr-info-sep {
            width: 1px;
            height: 18px;
            background: var(--hcpr-border-subtle);
        }

        .hcpr-mono { font-family: var(--hcpr-mono); }

        /* ---------------- primary control ---------------- */

        .hcpr-file-input { display: none; }

        .hcpr-primary-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 12px 15px 0;
            padding: 13px 14px;
            border: 1px solid var(--hcpr-border);
            border-radius: var(--hcpr-radius-sm);
            background: linear-gradient(160deg, var(--hcpr-surface-raised), var(--hcpr-surface));
            transition: border-color var(--hcpr-t-base) var(--hcpr-ease-out), box-shadow var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-shell[data-state="ready"] .hcpr-primary-row,
        .hcpr-shell[data-state="processing"] .hcpr-primary-row {
            border-color: color-mix(in srgb, var(--hcpr-accent) 35%, var(--hcpr-border));
            box-shadow: 0 0 0 1px var(--hcpr-accent-soft);
        }

        .hcpr-primary-label {
            display: flex;
            flex-direction: column;
            min-width: 0;
            gap: 2px;
        }

        .hcpr-primary-label strong { font-size: 12.5px; font-weight: 700; }

        .hcpr-primary-desc {
            overflow: hidden;
            color: var(--hcpr-text-secondary);
            font-size: 10px;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .hcpr-file-badge {
            margin: 7px 15px 0;
            padding: 6px 10px;
            border: 1px solid var(--hcpr-border-subtle);
            border-radius: var(--hcpr-radius-xs);
            background: var(--hcpr-bg-soft);
            color: var(--hcpr-text-muted);
            font-size: 9.5px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* ---------------- toggle ---------------- */

        .hcpr-switch { position: relative; display: block; flex: 0 0 auto; width: 36px; height: 21px; }
        .hcpr-switch-sm { width: 28px; height: 16px; }
        .hcpr-switch input { position: absolute; width: 1px; height: 1px; opacity: 0; }

        .hcpr-slider {
            position: absolute;
            inset: 0;
            border: 1px solid var(--hcpr-border);
            border-radius: 99px;
            background: var(--hcpr-bg-soft);
            box-shadow: inset 0 1px 2px rgba(0,0,0,.4);
            cursor: pointer;
            transition: background var(--hcpr-t-base) var(--hcpr-ease-out), border-color var(--hcpr-t-base) var(--hcpr-ease-out), box-shadow var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-slider::before {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 15px;
            height: 15px;
            border-radius: 50%;
            background: linear-gradient(160deg, #e9eaf4, #c7cadb);
            box-shadow: 0 1px 3px rgba(0,0,0,.4);
            content: "";
            transition: transform var(--hcpr-t-base) var(--hcpr-ease-out), background var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-switch-sm .hcpr-slider::before { width: 12px; height: 12px; }

        .hcpr-switch input:checked + .hcpr-slider {
            border-color: color-mix(in srgb, var(--hub-cyan) 55%, var(--hcpr-border));
            background: var(--hub-grad);
            box-shadow: inset 0 1px 2px rgba(0,0,0,.2), 0 0 14px rgba(34,211,238,.25);
        }

        .hcpr-switch input:checked + .hcpr-slider::before {
            background: #fff;
            transform: translateX(15px);
        }

        .hcpr-switch-sm input:checked + .hcpr-slider::before { transform: translateX(12px); }

        .hcpr-switch input:active + .hcpr-slider::before { width: 17px; }
        .hcpr-switch-sm input:active + .hcpr-slider::before { width: 13px; }

        .hcpr-switch input:focus-visible + .hcpr-slider {
            outline: 2px solid var(--hcpr-accent);
            outline-offset: 2px;
        }

        /* ---------------- accordion / settings ---------------- */

        .hcpr-accordion {
            margin: 12px 0 0;
            border-top: 1px solid var(--hcpr-border-subtle);
        }

        .hcpr-accordion-trigger {
            display: flex;
            width: 100%;
            align-items: center;
            justify-content: space-between;
            padding: 12px 15px;
            border: 0;
            background: transparent;
            color: var(--hcpr-text-secondary);
            font: inherit;
            font-size: 11.5px;
            font-weight: 650;
            cursor: pointer;
            transition: color var(--hcpr-t-fast) var(--hcpr-ease-out);
        }

        .hcpr-accordion-trigger:hover { color: var(--hcpr-text); }
        .hcpr-accordion-trigger:focus-visible { outline: 2px solid var(--hcpr-accent); outline-offset: -2px; }

        .hcpr-chevron { width: 14px; height: 14px; transition: transform var(--hcpr-t-base) var(--hcpr-ease-out); }
        .hcpr-accordion-trigger[aria-expanded="true"] .hcpr-chevron { transform: rotate(180deg); }

        .hcpr-accordion-panel {
            display: grid;
            grid-template-rows: 0fr;
            opacity: 0;
            transition: grid-template-rows var(--hcpr-t-medium) var(--hcpr-ease-out), opacity var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-accordion-panel.hcpr-accordion-open {
            grid-template-rows: 1fr;
            opacity: 1;
        }

        .hcpr-accordion-inner {
            overflow: hidden;
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: 14px;
            padding: 0 15px 14px;
        }

        .hcpr-group {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 12px;
            border: 1px solid var(--hcpr-border-subtle);
            border-radius: var(--hcpr-radius-sm);
            background: var(--hcpr-bg-soft);
        }

        .hcpr-group-title {
            color: var(--hcpr-text-muted);
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: .1em;
            text-transform: uppercase;
        }

        .hcpr-setting-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .hcpr-setting-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
            font-size: 11.5px;
            font-weight: 600;
            color: var(--hcpr-text);
        }

        .hcpr-setting-label small {
            color: var(--hcpr-text-muted);
            font-size: 9.5px;
            font-weight: 500;
        }

        .hcpr-number-field {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 9px;
            border: 1px solid var(--hcpr-border);
            border-radius: var(--hcpr-radius-xs);
            background: var(--hcpr-surface);
            transition: border-color var(--hcpr-t-fast) var(--hcpr-ease-out);
        }

        .hcpr-number-field:focus-within {
            border-color: color-mix(in srgb, var(--hcpr-accent) 50%, var(--hcpr-border));
        }

        .hcpr-number-field input {
            width: 42px;
            border: 0;
            background: transparent;
            color: var(--hcpr-text);
            font-size: 11px;
            font-weight: 600;
            text-align: right;
        }

        .hcpr-number-field input:focus-visible { outline: none; }
        .hcpr-unit { color: var(--hcpr-text-muted); font-size: 9.5px; }

        .hcpr-text-actions { display: flex; flex-wrap: wrap; gap: 8px; }

        .hcpr-footnote {
            color: var(--hcpr-text-dim);
            font-size: 8.5px;
            letter-spacing: .03em;
            text-align: center;
        }

        /* ---------------- rodapé fixo (download + reset) ---------------- */

        .hcpr-footer-row {
            display: flex;
            gap: 8px;
            margin: 12px 15px 15px;
            padding-top: 12px;
            border-top: 1px solid var(--hcpr-border-subtle);
        }

        .hcpr-btn-footer {
            display: flex;
            flex: 1;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 10px 12px;
        }

        .hcpr-btn-footer svg { width: 14px; height: 14px; flex: 0 0 auto; }

        .hcpr-btn-footer span {
            font-size: 11.5px;
            font-weight: 700;
        }

        /* ---------------- button system ---------------- */

        .hcpr-btn {
            padding: 7px 11px;
            border: 1px solid var(--hcpr-border);
            border-radius: var(--hcpr-radius-xs);
            background: var(--hcpr-surface);
            color: var(--hcpr-text-secondary);
            font: inherit;
            font-size: 10.5px;
            font-weight: 650;
            cursor: pointer;
            transition: color var(--hcpr-t-fast) var(--hcpr-ease-out), background var(--hcpr-t-fast) var(--hcpr-ease-out), border-color var(--hcpr-t-fast) var(--hcpr-ease-out), transform var(--hcpr-t-fast) var(--hcpr-ease-out), box-shadow var(--hcpr-t-fast) var(--hcpr-ease-out);
        }

        .hcpr-btn:active { transform: scale(.96); }
        .hcpr-btn:focus-visible { outline: 2px solid var(--hcpr-accent); outline-offset: 2px; }
        .hcpr-btn:disabled { opacity: .45; cursor: not-allowed; }

        .hcpr-btn-ghost { background: transparent; border-color: transparent; }
        .hcpr-btn-ghost:hover:not(:disabled) {
            color: var(--hcpr-accent-bright);
            background: rgba(34,211,238,.06);
            border-color: color-mix(in srgb, var(--hcpr-accent) 30%, var(--hcpr-border));
        }
        .hcpr-btn-ghost:disabled:hover { background: transparent; border-color: transparent; color: var(--hcpr-text-secondary); }

        .hcpr-btn-danger {
            color: var(--hcpr-text-secondary);
            background: var(--hcpr-danger-soft);
            border-color: color-mix(in srgb, var(--hcpr-danger) 30%, var(--hcpr-border));
        }
        .hcpr-btn-danger:hover {
            color: var(--hcpr-danger);
            background: var(--hcpr-danger-soft);
            border-color: color-mix(in srgb, var(--hcpr-danger) 55%, var(--hcpr-border));
        }

        /* ---------------- tooltips (puramente CSS) ---------------- */

        [data-tooltip] { position: relative; }

        [data-tooltip]::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: calc(100% + 9px);
            left: 50%;
            transform: translateX(-50%) translateY(3px);
            padding: 5px 8px;
            border: 1px solid var(--hcpr-border);
            border-radius: 7px;
            background: rgba(15,15,22,.94);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            box-shadow: 0 8px 20px rgba(0,0,0,.4);
            color: var(--hcpr-text);
            font-size: 9.5px;
            font-weight: 500;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity var(--hcpr-t-fast) var(--hcpr-ease-out), transform var(--hcpr-t-fast) var(--hcpr-ease-out);
            transition-delay: 0s;
            z-index: 5;
        }

        [data-tooltip]:hover::after,
        [data-tooltip]:focus-visible::after {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
            transition-delay: .25s;
        }

        /* ---------------- resize handle ---------------- */

        .hcpr-resize-handle {
            position: absolute;
            right: 2px;
            bottom: 2px;
            width: 16px;
            height: 16px;
            border-bottom: 2px solid var(--hcpr-border);
            border-right: 2px solid var(--hcpr-border);
            border-radius: 0 0 10px 0;
            cursor: nwse-resize;
            touch-action: none;
            transition: border-color var(--hcpr-t-fast) var(--hcpr-ease-out);
        }

        .hcpr-resize-handle:hover,
        .hcpr-resize-handle.hcpr-resizing {
            border-color: var(--hcpr-accent);
        }

        /* ---------------- reopen orb ---------------- */

        #hcpr-reopen {
            all: initial;
            position: fixed;
            z-index: 2147483647;
            right: 22px;
            bottom: 22px;
            display: grid;
            width: 46px;
            height: 46px;
            place-items: center;
            border: 1px solid rgba(255,255,255,.10);
            border-radius: 15px;
            background: linear-gradient(175deg, rgba(20,20,28,.92), rgba(9,9,14,.97));
            backdrop-filter: blur(18px) saturate(140%);
            -webkit-backdrop-filter: blur(18px) saturate(140%);
            box-shadow:
                0 16px 40px rgba(0,0,0,.5),
                0 0 20px rgba(34,211,238,.08),
                inset 0 1px 0 rgba(255,255,255,.06);
            cursor: pointer;
            font-family: var(--hcpr-sans);
            touch-action: none;
            user-select: none;
            transition: transform var(--hcpr-t-fast) var(--hcpr-ease-out), box-shadow var(--hcpr-t-base) var(--hcpr-ease-out), border-color var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        #hcpr-reopen:hover {
            transform: scale(1.05);
            border-color: color-mix(in srgb, var(--hcpr-accent) 45%, var(--hcpr-border-strong));
            box-shadow: 0 18px 46px rgba(0,0,0,.55), 0 0 0 5px var(--hcpr-accent-soft), 0 0 30px rgba(34,211,238,.18);
        }

        #hcpr-reopen:active { transform: scale(.94); }

        #hcpr-reopen.hcpr-dragging {
            cursor: grabbing;
            box-shadow: 0 0 0 4px var(--hcpr-accent-soft), 0 16px 40px rgba(0,0,0,.5);
        }

        @keyframes hcpr-reopen-enter {
            from { opacity: 0; transform: scale(.9); }
        }

        #hcpr-reopen.hcpr-reopen-enter { animation: hcpr-reopen-enter var(--hcpr-t-medium) var(--hcpr-ease-out); }

        .hcpr-reopen-ring {
            position: absolute;
            inset: -3px;
            border-radius: 17px;
            border: 1px solid var(--hcpr-accent-soft);
            opacity: 0;
            transition: opacity var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        #hcpr-reopen:hover .hcpr-reopen-ring { opacity: 1; }

        .hcpr-reopen-img {
            width: 24px;
            height: 24px;
            object-fit: cover;
            border-radius: 7px;
            display: block;
            pointer-events: none;
        }

        .hcpr-reopen-dot {
            position: absolute;
            top: 6px;
            right: 6px;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            border: 2px solid var(--hcpr-surface);
            background: var(--hcpr-text-dim);
            transition: background var(--hcpr-t-base) var(--hcpr-ease-out);
        }

        .hcpr-reopen-dot[data-state="ready"] { background: var(--hcpr-success); }
        .hcpr-reopen-dot[data-state="error"] { background: var(--hcpr-danger); }
        .hcpr-reopen-dot[data-state="processing"] { background: var(--hcpr-accent-bright); animation: hcpr-breathe 1.3s var(--hcpr-ease-in-out) infinite; }

        @media (max-width: 480px) {
            #hcpr-tool { right: 12px; bottom: 12px; left: 12px !important; top: auto !important; width: auto; }
            #hcpr-reopen { right: 12px; bottom: 12px; }
        }
    `);

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------

    try { setupWebSocketInterceptor(); } catch (error) { debug.add("websocket_setup_error", { message: String(error) }); }
    try { setupFetchInterceptor(); } catch (error) { debug.add("fetch_setup_error", { message: String(error) }); }
    try { setupXhrInterceptor(); } catch (error) { debug.add("xhr_setup_error", { message: String(error) }); }
    try { setupCanvasHooks(); } catch (error) { debug.add("canvas_setup_error", { message: String(error) }); }

    function waitForBody() {
        if (killed) return;

        if (document.body) {
            createInterface();
        } else {
            requestAnimationFrame(waitForBody);
        }
    }

    waitForBody();

    debug.add("script_initialized");

    // ------------------------------------------------------------------
    // Ciclo de vida do módulo (kill + sang:module-close)
    // ------------------------------------------------------------------

    function kill() {
        if (killed) return;
        killed = true;

        try { ac.abort(); } catch {}

        if (origWebSocket) {
            try { window.WebSocket = origWebSocket; } catch {}
            origWebSocket = null;
        }
        if (origFetch) {
            try { window.fetch = origFetch; } catch {}
            origFetch = null;
        }
        if (origXhrOpen) {
            try { XMLHttpRequest.prototype.open = origXhrOpen; } catch {}
            origXhrOpen = null;
        }
        if (origXhrSend) {
            try { XMLHttpRequest.prototype.send = origXhrSend; } catch {}
            origXhrSend = null;
        }
        if (origToBlob) {
            try { HTMLCanvasElement.prototype.toBlob = origToBlob; } catch {}
            origToBlob = null;
        }
        if (origToDataURL) {
            try { HTMLCanvasElement.prototype.toDataURL = origToDataURL; } catch {}
            origToDataURL = null;
        }

        if (frameResizeObserver) {
            try { frameResizeObserver.disconnect(); } catch {}
            frameResizeObserver = null;
        }

        debug.dispose();
        try { revokePreviewUrl(); } catch {}

        document
            .querySelectorAll("#hcpr-tool, #hcpr-reopen, style[data-livephoto]")
            .forEach((el) => el.remove());

        window.dispatchEvent(
            new CustomEvent("sang:module-close", { detail: { id: MODULE_ID } })
        );
    }

    window._livePhoto = {
        kill,
        show: () => setPanelHidden(false),
        hide: () => setPanelHidden(true)
    };
})();
