 function init() {
        if (window._prozilla) return;

        const OS_URL = 'https://os.prozilla.dev/'; 

        const style = document.createElement('style');
        style.setAttribute('data-prozilla', '1');
        style.textContent = `
        #${UID}{position:fixed;top:60px;left:60px;width:900px;height:600px;min-width:420px;min-height:300px;
            background:#0b0b10;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;
            box-shadow:0 20px 50px rgba(0,0,0,0.6);z-index:2147483000;display:flex;flex-direction:column;
            resize:both}
        #${UID} .osl-hdr{height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;
            padding:0 10px;background:#15151d;cursor:grab;font:700 11px -apple-system,sans-serif;color:#e5e7eb;
            letter-spacing:.04em;user-select:none}
        #${UID} .osl-hdr:active{cursor:grabbing}
        #${UID} .osl-close{width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;
            cursor:pointer;color:#c7cad6;font-size:12px}
        #${UID} .osl-close:hover{background:#fb7185;color:#1a0505}
        #${UID} iframe{flex:1;border:0;width:100%;height:100%;background:#000}
        `;
        document.head.appendChild(style);

        const win = document.createElement('div');
        win.id = UID;
        win.innerHTML = `
            <div class="osl-hdr" id="${UID}hdr"><span>prozilla</span><span class="osl-close" id="${UID}close">✕</span></div>
            <iframe src="${OS_URL}" allow="clipboard-read; clipboard-write; cross-origin-isolated" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
        `;
        document.body.appendChild(win);

        // Drag pelo header
        let drag = null;
        const hdr = win.querySelector('#' + UID + 'hdr');
        hdr.addEventListener('mousedown', e => {
            const r = win.getBoundingClientRect();
            drag = { x: e.clientX - r.left, y: e.clientY - r.top };
        });
        document.addEventListener('mousemove', e => {
            if (!drag) return;
            win.style.left = Math.max(0, e.clientX - drag.x) + 'px';
            win.style.top = Math.max(0, e.clientY - drag.y) + 'px';
        });
        document.addEventListener('mouseup', () => { drag = null; });

        function kill() {
            win.remove();
            style.remove();
            delete window._prozilla;
        }
        win.querySelector('#' + UID + 'close').addEventListener('click', kill);

        window._prozilla = { kill };
    }

    if (document.body) {
