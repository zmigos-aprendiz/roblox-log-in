// modules/phone/apps.js
// Abrir/fechar apps, app bar, apps internos (Chamadas + Ajustes com fluxo de PIN),
// call view com polling de phase. Não monta home nem lock.
(function() {
    'use strict';
    const ctx = window._phoneCtx = window._phoneCtx || {};
    const P   = ctx._phone   = ctx._phone   || {};
    if (!P.config || !P.core || !P.state) { console.warn('[Phone/apps] pré-requisitos ausentes.'); return; }
    if (P.apps) return;

    const C = P.config;
    const S = P.state;
    const el = ctx.el, esc = ctx.esc;

    // DEFINIÇÕES DE APPS BUILTIN (usadas por home.js via P.apps.resolveAppDef)
    function _builtinCallsDef() {
        return {
            id: 'calls', name: 'Chamadas',
            icon: ctx.I.phone, accent: '#eafff4',
            bg: 'linear-gradient(135deg, #86efac 0%, #22c55e 100%)',
            appBg: 'linear-gradient(180deg, #143a2c 0%, #0a1a14 100%)',
            appBgSolid: '#0f2820',
            builtin: 'calls', dock: true, order: 0
        };
    }
    function _builtinSettingsDef() {
        return {
            id: 'settings', name: 'Ajustes',
            icon: ctx.I.gear, accent: '#94a3b8',
            bg: 'linear-gradient(135deg, #94a3b8, #64748b)',
            appBg: 'linear-gradient(180deg, #1a1a20 0%, #0e0e12 100%)',
            appBgSolid: '#14141a',
            builtin: 'settings', order: 10
        };
    }
    function _builtinFallbacks() {
        const list = [];
        if (!ctx.apps.get('calls'))    list.push(_builtinCallsDef());
        if (!ctx.apps.get('settings')) list.push(_builtinSettingsDef());
        return list;
    }
    function _resolveAppDef(id) {
        const reg = ctx.apps.get(id);
        if (reg) return reg;
        if (id === 'calls')    return _builtinCallsDef();
        if (id === 'settings') return _builtinSettingsDef();
        return null;
    }

    // OPEN APP
    function _openApp(id) {
        if (S.dying) return;
        const app = _resolveAppDef(id);
        if (!app) return;

        if (S.activeAppId && S.activeAppId !== id) _unmountActiveApp();
        S.activeAppId = id;
        P.core.showView('app');

        const view = S.frameEl.querySelector('#phViewApp');
        if (!view) return;
        view.innerHTML = '';

        view.style.setProperty('--app-bg', app.appBg || C.DEFAULT_APP_BG);
        S.screenEl.style.setProperty('--active-app-bg-solid',
            app.appBgSolid || app.appBg || C.DEFAULT_APP_BG_SOLID);

        const bar = el('div', { class: 'ph-app-bar' });
        const showNumPill = app.builtin === 'calls';
        bar.innerHTML = `
            <button class="ph-app-back" title="Voltar">${ctx.I.back}</button>
            <span class="ph-app-title">${esc(app.name || id)}</span>
            ${showNumPill ? `<button class="ph-app-num loading" id="phAppMyNum" title="Copiar meu número">··· — ···</button>` : ''}
        `;
        bar.querySelector('.ph-app-back').addEventListener('click', _goHome);
        if (showNumPill) {
            bar.querySelector('#phAppMyNum').addEventListener('click', _copyMyNumber);
            _updateMyNumberUI();
        }
        view.appendChild(bar);

        if (app.builtin === 'calls')         _mountCallsApp(view);
        else if (app.builtin === 'settings') _mountSettingsApp(view);
        else                                 _mountGenericApp(view, app);
    }

    function _unmountActiveApp() {
        if (!S.activeAppId) return;
        const app = ctx.apps.get(S.activeAppId);
        try { app?.unmount?.(); } catch(_) {}
        S.activeAppId = null;
    }

    function _goHome() {
        _unmountActiveApp();
        try { S.screenEl?.style?.removeProperty('--active-app-bg-solid'); } catch(_) {}
        P.core.showView('home');
        P.home?.renderHome?.();
    }

    // PUBLIC NAV
    function _goToTab(tabId) {
        if (!S.frameEl) return false;
        if (!['contatos','discar','recentes','recados'].includes(tabId)) return false;
        S.chamadasTab = tabId;
        if (S.view !== 'app' || S.activeAppId !== 'calls') { _openApp('calls'); return true; }
        const tabs = S.frameEl.querySelector('#phViewApp .ph-tabs');
        if (tabs) tabs.querySelectorAll('.ph-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
        _renderChamadasContent();
        return true;
    }

    function _renderTab() {
        if (S.view === 'app' && S.activeAppId === 'calls') _renderChamadasContent();
    }

    // APP CHAMADAS
    function _mountCallsApp(view) {
        const tabs = el('div', { class: 'ph-tabs' });
        tabs.innerHTML = `
            <button class="ph-tab${S.chamadasTab === 'contatos' ? ' active' : ''}" data-tab="contatos">Contatos</button>
            <button class="ph-tab${S.chamadasTab === 'discar'   ? ' active' : ''}" data-tab="discar">Discar</button>
            <button class="ph-tab${S.chamadasTab === 'recentes' ? ' active' : ''}" data-tab="recentes">Recentes</button>
            <button class="ph-tab${S.chamadasTab === 'recados'  ? ' active' : ''}" data-tab="recados" title="Recados de voz">Recados<span class="tab-badge" id="phBadgeRecados"></span></button>
        `;
        view.appendChild(tabs);
        view.appendChild(S.contentEl);

        tabs.querySelectorAll('.ph-tab').forEach(t => {
            t.addEventListener('click', () => {
                S.chamadasTab = t.dataset.tab;
                tabs.querySelectorAll('.ph-tab').forEach(b => b.classList.toggle('active', b === t));
                _renderChamadasContent();
            });
        });
        _renderChamadasContent();
        _refreshRecadosBadge();
    }

    function _renderChamadasContent() {
        if (S.chamadasTab === 'discar')        ctx.contacts.renderDial?.();
        else if (S.chamadasTab === 'recentes') ctx.contacts.renderHistory?.();
        else if (S.chamadasTab === 'recados')  _renderRecadosTab();
        else                                    ctx.contacts.renderContacts?.();
    }

    function _renderRecadosTab() {
        if (!S.contentEl) return;
        S.contentEl.innerHTML = '';
        const inboxRoot = document.createElement('div');
        inboxRoot.className = 'ph-inbox-root';
        inboxRoot.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';
        S.contentEl.appendChild(inboxRoot);
        if (ctx.notes?.renderInbox) {
            try { ctx.notes.renderInbox(inboxRoot); }
            catch(e) {
                console.warn('[Phone/apps] renderInbox falhou:', e);
                inboxRoot.innerHTML = '<div class="ph-list"><div class="ph-empty">Erro ao abrir recados.</div></div>';
            }
        } else {
            inboxRoot.innerHTML = '<div class="ph-list"><div class="ph-empty">Módulo de recados indisponível.</div></div>';
        }
    }

    function _refreshRecadosBadge() {
        const badge = S.frameEl?.querySelector('#phBadgeRecados');
        if (!badge) return;
        let n = 0;
        try { n = ctx.notes?.getUnreadCount?.() || 0; } catch(_) {}
        if (n > 0) {
            badge.textContent = n > 9 ? '9+' : String(n);
            badge.classList.add('on');
        } else {
            badge.textContent = '';
            badge.classList.remove('on');
        }
    }

    // APP AJUSTES + FLUXO DE PIN
    // O PIN é validado no lock (home.js) contra S.pinSet; aqui é definido/alterado/removido.
    // Sempre que S.pinSet muda, persistimos em localStorage (LS_PIN).
    let _pinFlow = null, _pinBufFlow = '', _pinFirstFlow = '';

    function _mountSettingsApp(view) {
        view.innerHTML = '';
        const wrap = el('div', { class: 'ph-settings' });
        view.appendChild(wrap);

        const hasPin = !!S.pinSet;
        wrap.innerHTML = `
            <div class="ph-settings-group-title">Segurança</div>
            ${hasPin ? `
                <button class="ph-setting-item" data-act="change-pin">
                    <span>
                        <span class="ph-setting-item-lbl">Alterar PIN</span>
                        <div class="ph-setting-item-sub">Trocar o PIN de desbloqueio</div>
                    </span>
                    <span class="ph-setting-item-val">›</span>
                </button>
                <button class="ph-setting-item danger" data-act="remove-pin">
                    <span>
                        <span class="ph-setting-item-lbl">Remover PIN</span>
                        <div class="ph-setting-item-sub">Sem PIN, a tela desbloqueia só com toque</div>
                    </span>
                    <span class="ph-setting-item-val">›</span>
                </button>
                <button class="ph-setting-item" data-act="lock-now">
                    <span>
                        <span class="ph-setting-item-lbl">Bloquear agora</span>
                        <div class="ph-setting-item-sub">Volta para a tela de bloqueio</div>
                    </span>
                    <span class="ph-setting-item-val">›</span>
                </button>
            ` : `
                <button class="ph-setting-item" data-act="set-pin">
                    <span>
                        <span class="ph-setting-item-lbl">Definir PIN</span>
                        <div class="ph-setting-item-sub">Protege o desbloqueio com 4 dígitos</div>
                    </span>
                    <span class="ph-setting-item-val">›</span>
                </button>
            `}
            <div class="ph-settings-group-title">Sobre</div>
            <div class="ph-setting-item" style="cursor:default">
                <span>
                    <span class="ph-setting-item-lbl">Android</span>
                    <div class="ph-setting-item-sub">Versão do sistema</div>
                </span>
                <span class="ph-setting-item-val">${C.ANDROID_VERSION}</span>
            </div>
            <div class="ph-setting-item" style="cursor:default">
                <span>
                    <span class="ph-setting-item-lbl">Sang Phone</span>
                    <div class="ph-setting-item-sub">Versão do app</div>
                </span>
                <span class="ph-setting-item-val">v${C.PHONE_VERSION}</span>
            </div>
        `;
        wrap.querySelectorAll('.ph-setting-item[data-act]').forEach(btn => {
            btn.addEventListener('click', () => _handleSettingAction(btn.dataset.act, view));
        });
    }

    function _handleSettingAction(act, view) {
        if (act === 'set-pin') {
            _pinFlow = 'set-new'; _pinBufFlow = ''; _pinFirstFlow = '';
            _openPinModal(view, 'Definir PIN', 'Escolha 4 dígitos');
        } else if (act === 'change-pin') {
            _pinFlow = 'remove-current'; _pinBufFlow = '';
            _openPinModal(view, 'PIN atual', 'Digite o PIN atual para continuar', {
                afterCheck: () => {
                    _pinFlow = 'set-new'; _pinBufFlow = ''; _pinFirstFlow = '';
                    _openPinModal(view, 'Novo PIN', 'Escolha 4 dígitos');
                }
            });
        } else if (act === 'remove-pin') {
            _pinFlow = 'remove-current'; _pinBufFlow = '';
            _openPinModal(view, 'Confirmar', 'Digite o PIN atual para remover', {
                onSuccess: () => {
                    S.pinSet = '';
                    try { localStorage.removeItem(C.LS_PIN); } catch(_) {}
                    try { ctx.tone.unlock?.(); } catch(_) {}
                    ctx.toast('PIN removido', 'ok');
                    _mountSettingsApp(view);
                }
            });
        } else if (act === 'lock-now') {
            _goHome();
            setTimeout(() => P.home?.lock?.(), 60);
        }
    }

    function _openPinModal(view, title, sub, opts) {
        view.querySelector('.ph-pin-modal')?.remove();
        const modal = el('div', { class: 'ph-pin-modal' });
        modal.innerHTML = `
            <div class="ph-pin-modal-title">${esc(title)}</div>
            <div class="ph-pin-modal-sub">${esc(sub)}</div>
            <div class="ph-lock-pin-wrap ph-lock-pin">
                <div class="ph-lock-pin-dots" id="phModalDots">
                    <span class="ph-lock-pin-dot"></span>
                    <span class="ph-lock-pin-dot"></span>
                    <span class="ph-lock-pin-dot"></span>
                    <span class="ph-lock-pin-dot"></span>
                </div>
            </div>
            <div class="ph-keypad" id="phModalPad" style="width:100%;max-width:200px"></div>
            <button class="ph-pin-modal-cancel" id="phModalCancel">Cancelar</button>
        `;
        view.appendChild(modal);

        const dots       = modal.querySelectorAll('#phModalDots .ph-lock-pin-dot');
        const updateDots = n => dots.forEach((d, i) => d.classList.toggle('filled', i < n));
        const clearBuf   = () => { _pinBufFlow = ''; updateDots(0); };

        const pad = modal.querySelector('#phModalPad');
        const keys = [
            { d:'1',sub:'' }, { d:'2',sub:'ABC' }, { d:'3',sub:'DEF' },
            { d:'4',sub:'GHI' }, { d:'5',sub:'JKL' }, { d:'6',sub:'MNO' },
            { d:'7',sub:'PQRS' }, { d:'8',sub:'TUV' }, { d:'9',sub:'WXYZ' },
            { util:'back', svg: ctx.I.backspace }, { d:'0',sub:'' }, { util:'ok', svg:'✓' }
        ];
        pad.innerHTML = keys.map(k => k.util
            ? `<button class="ph-key util${k.util === 'ok' ? ' ok' : ''}" data-util="${k.util}">${k.svg}</button>`
            : `<button class="ph-key" data-digit="${k.d}"><span>${k.d}</span>${k.sub ? `<span class="sub">${k.sub}</span>` : ''}</button>`
        ).join('');

        const closeModal = () => {
            modal.remove();
            _pinFlow = null; _pinBufFlow = ''; _pinFirstFlow = '';
        };

        const pinWrong = () => {
            try { ctx.tone.errorPin(); } catch(_) {}
            const w = modal.querySelector('.ph-lock-pin');
            if (w) { w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); }
            modal.querySelector('.ph-pin-modal-sub').textContent = 'PIN incorreto.';
            clearBuf();
            setTimeout(() => { modal.querySelector('.ph-pin-modal-sub').textContent = sub; }, 800);
        };

        const handleComplete = () => {
            const pin = _pinBufFlow;
            if (_pinFlow === 'remove-current') {
                if (pin !== S.pinSet) return pinWrong();
                if (opts?.onSuccess)  return opts.onSuccess();
                if (opts?.afterCheck) return opts.afterCheck();
            }
            if (_pinFlow === 'set-new') {
                _pinFirstFlow = pin;
                _pinFlow = 'set-confirm'; _pinBufFlow = '';
                modal.querySelector('.ph-pin-modal-title').textContent = 'Confirmar PIN';
                modal.querySelector('.ph-pin-modal-sub').textContent   = 'Repita os 4 dígitos';
                updateDots(0);
                return;
            }
            if (_pinFlow === 'set-confirm') {
                if (pin !== _pinFirstFlow) {
                    try { ctx.tone.errorPin(); } catch(_) {}
                    modal.querySelector('.ph-pin-modal-sub').textContent = 'PINs não coincidem. Tente de novo.';
                    _pinFirstFlow = ''; _pinFlow = 'set-new'; _pinBufFlow = '';
                    setTimeout(() => updateDots(0), 400);
                    return;
                }
                S.pinSet = pin;
                try { localStorage.setItem(C.LS_PIN, pin); } catch(_) {}
                try { ctx.tone.unlock(); } catch(_) {}
                ctx.toast('PIN definido', 'ok');
                closeModal();
                _mountSettingsApp(view);
                return;
            }
        };

        pad.querySelectorAll('.ph-key').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
                if (btn.dataset.digit != null) {
                    try { ctx.tone.key(); } catch(_) {}
                    if (_pinBufFlow.length < 4) _pinBufFlow += btn.dataset.digit;
                } else if (btn.dataset.util === 'back') {
                    try { ctx.tone.key(); } catch(_) {}
                    _pinBufFlow = _pinBufFlow.slice(0, -1);
                } else if (btn.dataset.util === 'ok') {
                    if (_pinBufFlow.length === 4) handleComplete();
                    return;
                }
                updateDots(_pinBufFlow.length);
                if (_pinBufFlow.length === 4) setTimeout(handleComplete, 60);
            });
        });
        modal.querySelector('#phModalCancel').addEventListener('click', closeModal);
    }

    // GENERIC APP
    function _mountGenericApp(view, app) {
        const root = document.createElement('div');
        root.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;';
        view.appendChild(root);
        try { app.mount(root, ctx); }
        catch(e) {
            root.innerHTML = `<div class="ph-home-empty">Erro ao abrir app.</div>`;
            console.warn('[Phone/apps] mount falhou:', e);
        }
    }

    // CALL VIEW
    let _phasePollTimer = null;

    function _checkPhase() {
        const active = ctx.phase !== 'idle' && ctx.phase !== 'busy';
        if (active && !S.inCallView) {
            S.inCallView = true;
            const prevView = S.view;
            P.core.showView('call');
            const view = S.frameEl.querySelector('#phViewCall');
            if (view) {
                view.innerHTML = '';
                view.appendChild(S.contentEl);
            }
            S._prevView = prevView;
        } else if (!active && S.inCallView) {
            S.inCallView = false;
            if (S._prevView === 'app' && S.activeAppId) {
                const view = S.frameEl.querySelector('#phViewApp');
                if (view) view.appendChild(S.contentEl);
                P.core.showView('app');
            } else {
                _goHome();
            }
            S._prevView = null;
        }
    }

    function _startPhasePoll() {
        if (_phasePollTimer) return;
        _phasePollTimer = setInterval(_checkPhase, 250);
    }

    function _stopPhasePoll() {
        if (_phasePollTimer) { clearInterval(_phasePollTimer); _phasePollTimer = null; }
    }

    // NÚMERO / UI HELPERS
    async function _copyMyNumber() {
        if (!ctx.myNumber) { ctx.toast('Número ainda sendo gerado', 'err'); return; }
        const formatted = ctx.contacts.fmtNumber ? ctx.contacts.fmtNumber(ctx.myNumber) : ctx.myNumber;
        try { await navigator.clipboard.writeText(formatted); ctx.toast('Número copiado', 'ok'); }
        catch(_) { ctx.toast('Falha ao copiar', 'err'); }
    }

    function _updateMyNumberUI() {
        const pill = S.frameEl?.querySelector('#phAppMyNum');
        if (!pill) return;
        if (ctx.myNumber) {
            pill.textContent = ctx.contacts.fmtNumber ? ctx.contacts.fmtNumber(ctx.myNumber) : ctx.myNumber;
            pill.classList.remove('loading');
        } else {
            pill.textContent = '··· — ···';
            pill.classList.add('loading');
        }
    }

    function _teardown() {
        _stopPhasePoll();
        _unmountActiveApp();
    }

    // EXPORT — nome do namespace
    P.apps = {
        openApp:            _openApp,
        goHome:             _goHome,
        goToTab:            _goToTab,
        renderTab:          _renderTab,
        updateMyNumberUI:   _updateMyNumberUI,
        refreshRecadosBadge:_refreshRecadosBadge,
        startPhasePoll:     _startPhasePoll,
        stopPhasePoll:      _stopPhasePoll,
        resolveAppDef:      _resolveAppDef,
        builtinFallbacks:   _builtinFallbacks,
        teardown:           _teardown
    };

    // CONTRATO EXTERNO ctx.* — nomes preservados exatamente como antes
    ctx.openApp          = _openApp;
    ctx.goHome           = _goHome;
    ctx.goToTab          = _goToTab;
    ctx.renderTab        = _renderTab;
    ctx.updateMyNumberUI = _updateMyNumberUI;
    ctx.setNotifDot      = (on) => {
        const d = S.frameEl?.querySelector('#phNotifDot');
        if (d) d.classList.toggle('on', !!on);
    };
    ctx.announceCall  = () => S.frameEl?.classList.add('ringing');
    ctx.clearCallGlow = () => S.frameEl?.classList.remove('ringing');
    ctx.setRecording  = (on) => S.frameEl?.classList.toggle('recording', on);
})();
