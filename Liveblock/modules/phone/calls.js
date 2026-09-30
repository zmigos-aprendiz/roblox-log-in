// modules/phone/calls.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Phone/calls] shell não inicializado.'); return; }
    if (ctx.calls._loaded) return;
    ctx.calls._loaded = true;

    const bridge = window._hubBridge;
    if (!bridge) return;

    // ═══ CONFIG ═══
    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];
    const POLL_MS = 400;
    const CALL_TIMEOUT_MS = 45000;
    const OFFER_STALE_MS = 60000;
    const RINGBACK_CYCLE_MS = 4000;
    const RING_CYCLE_MS = 1500;
    const BUSY_CYCLE_MS = 500;
    const GROUP_POLL_MS = 1500;
    const MAX_GROUP_MEMBERS = 5;
    const SPEAKING_THRESHOLD = 0.055;
    const SPEAKING_RELEASE_MS = 600;
    const ICE_RESTART_WINDOW_MS = 3000;
    const RTDB_GCALL = 'gcall';
    const LS_NOTIF = 'sanghub_phone_notif_asked';
    const COL_MISSED = 'phone_missed';
    const OFFER_RETRIES = 1;
    const OFFER_RETRY_DELAY_MS = 900;
    const MAX_MISSED_PER_HOUR = 20;

    // ═══ STATE ═══
    let _pc = null;
    let _localStream = null;
    let _voiceHandle = null;
    let _remoteAudio = null;
    let _pollTimer = null;
    let _durTimer = null;
    let _timeoutTimer = null;
    let _ringTimer = null;
    let _groupPollTimer = null;
    let _startedAt = 0;
    let _peer = null;
    let _incomingOffer = null;
    let _answered = false;
    let _iceSeen = new Set();
    let _busyDismissTimer = null;
    let _iceRestartTimer = null;
    let _groupRosterSig = '';
    let _myAvatarCache = '';

    let _hostState = { callId: null, createdAt: 0 };
    const _hostMembers = new Map();
    let _isGroupCaller = false;
    let _groupRosterCache = null;
    let _vadRaf = null;
    const _speakingSet = new Set();
    const _individualMutes = new Set();

    const esc = ctx.esc;
    const I = ctx.I;
    const tone = ctx.tone;
    function setPhase(p) { ctx.phase = p; }

    // ═══ RTDB HELPERS ═══
    const sigPath = (targetId, sub) => 'signaling/' + targetId + (sub ? '/' + sub : '');
    const sigGet = (targetId, sub) => bridge.rtdb.get(sigPath(targetId, sub));
    const sigPut = (targetId, sub, v) => bridge.rtdb.put(sigPath(targetId, sub), v);
    const sigPost = (targetId, sub, v) => bridge.rtdb.post(sigPath(targetId, sub), v);
    const sigDel = (targetId, sub) => bridge.rtdb.del(sigPath(targetId, sub));
    const gcallPath = (callId) => RTDB_GCALL + '/' + callId;
    const gcallPut = (payload) => bridge.rtdb.put(gcallPath(_hostState.callId), payload);
    const gcallMemberPut = (devId, payload) => bridge.rtdb.put(gcallPath(_hostState.callId) + '/members/' + devId, payload);
    const gcallSpeakPut = (devId, speaking) => bridge.rtdb.put(gcallPath(_hostState.callId) + '/speaking/' + devId, { s: speaking ? 1 : 0, ts: Date.now() });

    async function _sigPutRetry(devId, sub, payload, retries) {
        let r = retries != null ? retries : OFFER_RETRIES;
        let attempt = 0;
        while (attempt <= r) {
            const ok = await sigPut(devId, sub, payload).catch(() => false);
            if (ok) return true;
            if (attempt === r) return false;
            attempt++;
            await new Promise(res => setTimeout(res, OFFER_RETRY_DELAY_MS * attempt));
        }
        return false;
    }

    // ═══ WEBRTC CORE ═══
    function _waitIce(pc, timeoutMs) {
        return new Promise(resolve => {
            if (pc.iceGatheringState === 'complete') return resolve();
            const onChange = () => {
                if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', onChange); resolve(); }
            };
            pc.addEventListener('icegatheringstatechange', onChange);
            setTimeout(() => { try { pc.removeEventListener('icegatheringstatechange', onChange); } catch(_) {} resolve(); }, timeoutMs || 2500);
        });
    }

    // ═══ VOICE ACQUIRE ═══
    async function _acquireVoiceHandle(purpose) {
        if (ctx.voice && typeof ctx.voice.acquire === 'function') {
            try {
                return await ctx.voice.acquire({ purpose: purpose || 'call' });
            } catch(e) {
                console.warn('[Phone/calls] voice.acquire falhou, caindo pro getUserMedia:', e.message);
            }
        } else {
            console.warn('[Phone/calls] ctx.voice indisponível — fallback getUserMedia');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
        });
        return {
            id: 'legacy',
            stream,
            release: () => {
                try { stream.getTracks().forEach(t => t.stop()); } catch(_) {}
            }
        };
    }

    async function _ensureStream() {
        if (_localStream && _localStream.active && _voiceHandle) return _localStream;

        if (_voiceHandle) {
            try { _voiceHandle.release(); } catch(_) {}
            _voiceHandle = null;
        }

        const handle = await _acquireVoiceHandle('call');
        _voiceHandle = handle;
        _localStream = handle.stream;
        return _localStream;
    }

    async function _resolveMyAvatar() {
        let av = bridge.player?.avatarUrl || '';
        if (av) { _myAvatarCache = av; return av; }
        const num = ctx.myNumber;
        if (!num) return '';
        try {
            const doc = await bridge.firestore.request('GET', '/phone_numbers/' + num);
            if (doc?.fields) {
                const parsed = bridge.firestore.parseDoc(doc);
                const url = parsed.avatarUrl || '';
                if (url) _myAvatarCache = url;
                return url;
            }
        } catch(_) {}
        return '';
    }

    function _promoteToActiveIfReady() {
        if (ctx.phase !== 'outgoing') return false;
        let ready = false;
        for (const [, e] of _hostMembers) {
            if (!e.answered) continue;
            const cs = e.pc.connectionState;
            const ics = e.pc.iceConnectionState;
            if (cs === 'connected' || ics === 'connected' || ics === 'completed') { ready = true; break; }
        }
        if (!ready) return false;
        setPhase('active');
        _startedAt = Date.now();
        _stopRingLoop();
        ctx.clearCallGlow();
        tone.pickup();
        _startTimers();
        _renderCall();
        return true;
    }

    // ═══ MISSED CALL REGISTRY ═══
    function _missedRateLimited(payload) {
        try {
            const k = 'sang_phone_missed_rl_' + (payload.fromNumber || '_') + '_' + (payload.toNumber || '_');
            const raw = sessionStorage.getItem(k);
            const now = Date.now();
            let hits = [];
            if (raw) { try { hits = JSON.parse(raw) || []; } catch(_) { hits = []; } }
            hits = hits.filter(t => now - t < 3600000);
            if (hits.length >= MAX_MISSED_PER_HOUR) return true;
            hits.push(now);
            sessionStorage.setItem(k, JSON.stringify(hits));
            return false;
        } catch(_) { return false; }
    }

    async function _registerMissedFirestore(payload) {
        try {
            if (!payload || !payload.toNumber) return false;
            const fromNumber = payload.fromNumber || ctx.myNumber || '';
            if (!fromNumber) return false;
            if (_missedRateLimited({ fromNumber, toNumber: payload.toNumber })) return false;

            const fields = {};
            const full = {
                fromNumber,
                fromName: payload.fromName || bridge.player?.name || '',
                fromAvatar: payload.fromAvatar || _myAvatarCache || bridge.player?.avatarUrl || '',
                toNumber: payload.toNumber,
                toName: payload.toName || '',
                ts: payload.ts || Date.now()
            };
            for (const k in full) fields[k] = bridge.firestore.value(full[k]);
            await bridge.firestore.request('POST', '/' + COL_MISSED, { fields });
            return true;
        } catch(e) {
            console.warn('[Phone/calls] registerMissed falhou:', e);
            return false;
        }
    }

    function _registerMissedForOffline(payload) {
        try {
            if (bridge.phone?.registerMissedCall) return Promise.resolve(bridge.phone.registerMissedCall(payload));
        } catch(_) {}
        return _registerMissedFirestore(payload);
    }

    // ═══ MIXER ═══
    function _ensureMixCtx() {
        return ctx.getAudioCtx?.() || null;
    }

    function _rebuildMixerFor(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.pc) return;
        const c = _ensureMixCtx();
        if (!c) return;
        if (entry.mixer) {
            entry.mixer.sources.forEach(s => { try { s.disconnect(); } catch(_){} });
            try { entry.mixer.dest.disconnect(); } catch(_) {}
        }
        const dest = c.createMediaStreamDestination();
        const sources = [];
        if (_localStream) { try { const src = c.createMediaStreamSource(_localStream); src.connect(dest); sources.push(src); } catch(_) {} }
        for (const [otherId, other] of _hostMembers) {
            if (otherId === devId) continue;
            if (_individualMutes.has(otherId)) continue;
            if (!other.remoteStream) continue;
            try { const src = c.createMediaStreamSource(other.remoteStream); src.connect(dest); sources.push(src); } catch(_) {}
        }
        entry.mixer = { dest, sources };
        const newTrack = dest.stream.getAudioTracks()[0];
        const sender = entry.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
        else try { entry.pc.addTrack(newTrack, dest.stream); } catch(_) {}
    }
    function _rebuildAllHostMixers() { for (const devId of _hostMembers.keys()) _rebuildMixerFor(devId); }
    function _disposeHostMixer(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.mixer) return;
        entry.mixer.sources.forEach(s => { try { s.disconnect(); } catch(_) {} });
        try { entry.mixer.dest.disconnect(); } catch(_) {}
        entry.mixer = null;
    }

    // ═══ VAD ═══
    function _startVadFor(devId, stream) {
        const c = _ensureMixCtx();
        if (!c) return;
        try {
            const src = c.createMediaStreamSource(stream);
            const an = c.createAnalyser();
            an.fftSize = 256;
            an.smoothingTimeConstant = 0.5;
            src.connect(an);
            const entry = _hostMembers.get(devId);
            if (!entry) return;
            entry.vad = { an, src, buf: new Uint8Array(an.fftSize), speaking: false, lastLoudAt: 0 };
            if (!_vadRaf) _vadRaf = requestAnimationFrame(_vadTick);
        } catch(_) {}
    }
    function _stopVadFor(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.vad) return;
        try { entry.vad.src.disconnect(); } catch(_) {}
        entry.vad = null;
    }
    function _vadTick() {
        if (!_hostMembers.size) { _vadRaf = null; return; }
        const now = Date.now();
        for (const [devId, entry] of _hostMembers) {
            if (!entry.vad) continue;
            const buf = entry.vad.buf;
            entry.vad.an.getByteTimeDomainData(buf);
            let rms = 0;
            for (let i = 0; i < buf.length; i++) { const v = (buf[i]-128)/128; rms += v*v; }
            rms = Math.sqrt(rms / buf.length);
            if (rms > SPEAKING_THRESHOLD) entry.vad.lastLoudAt = now;
            const isSpeaking = (now - entry.vad.lastLoudAt) < SPEAKING_RELEASE_MS;
            if (isSpeaking !== entry.vad.speaking) {
                entry.vad.speaking = isSpeaking;
                gcallSpeakPut(devId, isSpeaking).catch(() => {});
                _updateSpeakingUI();
            }
        }
        _vadRaf = requestAnimationFrame(_vadTick);
    }
    function _updateSpeakingUI() {
        const root = ctx.root;
        if (!root) return;
        root.querySelectorAll('.ph-roster .chip[data-dev-id]').forEach(chip => {
            const devId = chip.dataset.devId;
            const entry = _hostMembers.get(devId);
            const isSpk = entry ? !!entry.vad?.speaking : _speakingSet.has(devId);
            chip.classList.toggle('speaking', isSpk);
        });
    }

    function _applyCalleeIdentity(entry, source) {
        if (!entry || !source) return false;
        let changed = false;
        if (source.fromAvatar && entry.avatarUrl !== source.fromAvatar) { entry.avatarUrl = source.fromAvatar; changed = true; }
        if (source.fromName && (!entry.name || entry.name === 'Sem nome')) { entry.name = source.fromName; changed = true; }
        if (source.fromNumber && !entry.number) { entry.number = source.fromNumber; changed = true; }
        if (_peer && entry === _hostMembers.get(_peer.id)) {
            if (source.fromAvatar) { _peer.avatarUrl = source.fromAvatar; changed = true; }
            if (source.fromName && (!_peer.name || _peer.name === 'Sem nome')) { _peer.name = source.fromName; changed = true; }
            if (source.fromNumber && !_peer.number) { _peer.number = source.fromNumber; changed = true; }
        }
        return changed;
    }

    // ═══ HOST: iniciar chamada ═══
    async function _call(targets) {
        if (ctx.phase !== 'idle' || !targets.length) return;
        if (targets.length > MAX_GROUP_MEMBERS) {
            _busyTone('Máximo excedido', 'Limite de ' + MAX_GROUP_MEMBERS + ' participantes.');
            return;
        }
        if (ctx.getMinimized()) ctx.setMinimized(false);

        let stream;
        try { stream = await _ensureStream(); }
        catch (e) { _busyTone('Sem microfone', 'Permissão negada.'); return; }

        try { await _resolveMyAvatar(); } catch(_) {}

        for (const t of targets) {
            if (t.avatarUrl) continue;
            if (!t.number) continue;
            try {
                const doc = await bridge.firestore.request('GET', '/phone_numbers/' + t.number);
                if (doc?.fields) {
                    const parsed = bridge.firestore.parseDoc(doc);
                    if (parsed.avatarUrl) t.avatarUrl = parsed.avatarUrl;
                }
            } catch(_) {}
        }

        _hostState.callId = targets.length > 1 ? ('g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) : null;
        _hostState.createdAt = Date.now();
        _isGroupCaller = targets.length > 1;
        _answered = false;
        _iceSeen.clear();
        _hostMembers.clear();
        _individualMutes.clear();
        _groupRosterSig = '';

        if (_hostState.callId) {
            try {
                await gcallPut({
                    hostId: bridge.deviceId || '', hostName: bridge.player?.name || 'Host',
                    hostAvatar: _myAvatarCache || bridge.player?.avatarUrl || '',
                    hostNumber: ctx.myNumber || '',
                    createdAt: _hostState.createdAt, status: 'active', members: {}, speaking: {}
                });
                await gcallMemberPut(bridge.deviceId, {
                    name: bridge.player?.name || 'Host',
                    avatarUrl: _myAvatarCache || bridge.player?.avatarUrl || '',
                    number: ctx.myNumber || '', joinedAt: _hostState.createdAt, isHost: true
                });
            } catch(_) {}
        }
        _peer = { id: targets[0].id, name: targets[0].name, avatarUrl: targets[0].avatarUrl || '', number: targets[0].number };
        setPhase('outgoing');
        ctx.announceCall();
        _renderCall();

        for (let i = 0; i < targets.length; i++) _spawnHostPeer(targets[i], i === 0);

        _startRingbackLoop();
    }

    function _spawnHostPeer(target, isPrimary) {
        const devId = target.id;
        if (_hostMembers.has(devId)) return;
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const entry = {
            pc, remoteStream: null, mixer: null, vad: null,
            name: target.name || 'Sem nome',
            avatarUrl: target.avatarUrl || '',
            number: target.number || '',
            joinedAt: Date.now(), answered: false,
            iceSeen: new Set(),
            icePending: [],
            icePendingKeys: new Set(),
            disconnectedAt: 0,
            ringTimeout: null
        };
        _hostMembers.set(devId, entry);

        const mixCtx = _ensureMixCtx();
        if (mixCtx && _localStream) {
            const tmpDest = mixCtx.createMediaStreamDestination();
            const tmpSrc = mixCtx.createMediaStreamSource(_localStream);
            tmpSrc.connect(tmpDest);
            entry.mixer = { dest: tmpDest, sources: [tmpSrc] };
        }
        if (entry.mixer) {
            entry.mixer.dest.stream.getAudioTracks().forEach(t => pc.addTrack(t, entry.mixer.dest.stream));
        } else if (_localStream) {
            _localStream.getAudioTracks().forEach(t => pc.addTrack(t, _localStream));
        }

        const remote = new MediaStream();
        pc.ontrack = (ev) => {
            ev.streams[0].getAudioTracks().forEach(t => remote.addTrack(t));
            entry.remoteStream = remote;
            if (!entry.audioEl) {
                entry.audioEl = new Audio();
                entry.audioEl.srcObject = remote;
                entry.audioEl.autoplay = true;
                entry.audioEl.play().catch(() => {});
            }
            _rebuildAllHostMixers();
            _startVadFor(devId, remote);
        };
        pc.onicecandidate = (ev) => { if (!ev.candidate) return; sigPost(devId, 'ice/caller', ev.candidate.toJSON()).catch(() => {}); };

        pc.onconnectionstatechange = () => {
            const s = pc.connectionState;
            if (s === 'connected') {
                entry.disconnectedAt = 0;
                if (entry.iceRestartTimer) { clearTimeout(entry.iceRestartTimer); entry.iceRestartTimer = null; }
                if (!entry.answered) {
                    entry.answered = true;
                    if (entry.ringTimeout) { clearTimeout(entry.ringTimeout); entry.ringTimeout = null; }
                    if (ctx.phase === 'active') { tone.join(); _renderCall(); }
                }
                _promoteToActiveIfReady();
            } else if (s === 'disconnected') {
                if (!entry.disconnectedAt) {
                    entry.disconnectedAt = Date.now();
                    try { entry.pc.restartIce(); } catch(_) {}
                    if (entry.iceRestartTimer) clearTimeout(entry.iceRestartTimer);
                    entry.iceRestartTimer = setTimeout(() => {
                        if (entry.pc.connectionState !== 'connected') _removeHostMember(devId, true);
                    }, ICE_RESTART_WINDOW_MS);
                }
            } else if (s === 'failed') {
                _removeHostMember(devId, true);
            }
        };
        pc.oniceconnectionstatechange = () => {
            const ics = pc.iceConnectionState;
            if (ics === 'connected' || ics === 'completed') {
                if (!entry.answered) return;
                _promoteToActiveIfReady();
            }
        };

        entry.ringTimeout = setTimeout(() => {
            entry.ringTimeout = null;
            if (entry.answered) return;
            if (ctx.phase === 'idle') return;
            if (!_hostMembers.has(devId)) return;

            const nm = entry.name || 'Sessão';
            _registerMissedForOffline({
                fromNumber: ctx.myNumber || '',
                fromName: bridge.player?.name || 'Usuário',
                fromAvatar: _myAvatarCache || bridge.player?.avatarUrl || '',
                toNumber: entry.number || '',
                toName: nm,
                ts: Date.now()
            }).catch(() => {});
            _removeHostMember(devId, true);
            if (_hostMembers.size > 0) ctx.toast(nm + ' não respondeu', 'warn');
        }, CALL_TIMEOUT_MS);

        (async () => {
            try {
                await sigDel(devId, '');
                await new Promise(r => setTimeout(r, 60));
                const offer = await pc.createOffer({ offerToReceiveAudio: true });
                await pc.setLocalDescription(offer);
                await _waitIce(pc, 2200);
                const myAvatar = await _resolveMyAvatar();
                const payload = {
                    type: 'offer', kind: 'phone', sdp: pc.localDescription.sdp,
                    fromId: bridge.deviceId || '',
                    fromName: bridge.player?.name || 'Usuário',
                    fromAvatar: myAvatar || bridge.player?.avatarUrl || '',
                    fromNumber: ctx.myNumber || '',
                    ts: Date.now()
                };
                if (_hostState.callId) { payload.groupId = _hostState.callId; payload.groupSize = _hostMembers.size; }
                const ok = await _sigPutRetry(devId, 'offer', payload, OFFER_RETRIES);
                if (!ok) { _removeHostMember(devId, false); return; }
            } catch (e) { _removeHostMember(devId, false); }
        })();

        entry.pollTimer = setInterval(() => _pollHostSignal(devId), POLL_MS);
        _pollHostSignal(devId);
    }

    async function _pollHostSignal(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.pc) return;
        const doc = await sigGet(devId, '');
        if (!doc) return;

        if (doc.offer && doc.offer.type === 'hangup' && doc.offer.fromId && doc.offer.fromId !== bridge.deviceId) {
            _removeHostMember(devId, true);
            return;
        }

        if (!entry.answered && doc.answer) {
            if (doc.answer.type === 'reject') {
                const reason = doc.answer.reason || 'rejected';
                const label = reason === 'busy' ? 'Ocupado'
                            : reason === 'blocked' ? 'Bloqueada'
                            : reason === 'stale' ? 'Expirada'
                            : reason === 'timeout' ? 'Sem resposta'
                            : 'Recusada';
                if (entry.ringTimeout) { clearTimeout(entry.ringTimeout); entry.ringTimeout = null; }
                if (_hostMembers.size <= 1) {
                    _endCall(false, label);
                } else {
                    ctx.toast((entry.name || 'Membro') + ' recusou', 'err');
                    _removeHostMember(devId, false);
                }
                return;
            }
            if (doc.answer.sdp) {
                try {
                    await entry.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: doc.answer.sdp }));
                    entry.answered = true;
                    if (entry.ringTimeout) { clearTimeout(entry.ringTimeout); entry.ringTimeout = null; }
                    const changed = _applyCalleeIdentity(entry, doc.answer);

                    if (entry.icePending?.length) {
                        for (const cand of entry.icePending) {
                            try { await entry.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(_) {}
                        }
                        entry.icePendingKeys.forEach(k => entry.iceSeen.add(k));
                        entry.icePending = [];
                        entry.icePendingKeys.clear();
                    }

                    _promoteToActiveIfReady();
                    if (changed || ctx.phase === 'outgoing') _renderCall();
                } catch(_) {}
            }
        }

        const remoteIce = await sigGet(devId, 'ice/callee');
        if (remoteIce) {
            for (const k in remoteIce) {
                if (entry.iceSeen.has(k)) continue;
                const cand = remoteIce[k];
                if (!cand || !cand.candidate) continue;
                if (entry.pc.remoteDescription) {
                    try {
                        await entry.pc.addIceCandidate(new RTCIceCandidate(cand));
                        entry.iceSeen.add(k);
                    } catch(_) {}
                } else {
                    if (!entry.icePendingKeys.has(k)) {
                        entry.icePendingKeys.add(k);
                        entry.icePending.push(cand);
                    }
                }
            }
        }
    }

    function _removeHostMember(devId, notify) {
        const entry = _hostMembers.get(devId);
        if (!entry) return;
        if (entry.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null; }
        if (entry.iceRestartTimer) { clearTimeout(entry.iceRestartTimer); entry.iceRestartTimer = null; }
        if (entry.ringTimeout) { clearTimeout(entry.ringTimeout); entry.ringTimeout = null; }
        _stopVadFor(devId);
        _disposeHostMixer(devId);
        if (entry.audioEl) { try { entry.audioEl.pause(); entry.audioEl.srcObject = null; } catch(_) {} }
        try { entry.pc.close(); } catch(_) {}
        _hostMembers.delete(devId);
        _individualMutes.delete(devId);

        if (notify) {
            sigPut(devId, 'offer', { type: 'hangup', kind: 'phone', fromId: bridge.deviceId || '', ts: Date.now() }).catch(() => {});
        }
        if (_hostState.callId && bridge.rtdb?.del) {
            bridge.rtdb.del(gcallPath(_hostState.callId) + '/members/' + devId).catch(() => {});
            bridge.rtdb.del(gcallPath(_hostState.callId) + '/speaking/' + devId).catch(() => {});
        }
        _rebuildAllHostMixers();
        if (_hostMembers.size === 0 && ctx.phase !== 'idle') {
            const label = _startedAt === 0 ? 'Sem resposta' : 'Encerrada';
            _endCall(false, label);
            return;
        }
        _renderCall();
    }

    async function _addMemberToCall(target) {
        if (!target?.id) return false;
        if (_hostMembers.has(target.id)) return false;

        if (!_hostState.callId) {
            _hostState.callId = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            _hostState.createdAt = Date.now();
            _isGroupCaller = true;
            try {
                const okRoot = await gcallPut({
                    hostId: bridge.deviceId || '', hostName: bridge.player?.name || 'Host',
                    hostAvatar: _myAvatarCache || bridge.player?.avatarUrl || '',
                    hostNumber: ctx.myNumber || '',
                    createdAt: _hostState.createdAt, status: 'active', members: {}, speaking: {}
                });
                if (!okRoot) throw new Error('gcall root');
                const okSelf = await gcallMemberPut(bridge.deviceId, {
                    name: bridge.player?.name || 'Host',
                    avatarUrl: _myAvatarCache || bridge.player?.avatarUrl || '',
                    number: ctx.myNumber || '', joinedAt: _hostState.createdAt, isHost: true
                });
                if (!okSelf) throw new Error('gcall self');
                for (const [devId, e] of _hostMembers) {
                    const ok = await gcallMemberPut(devId, {
                        name: e.name, avatarUrl: e.avatarUrl, number: e.number, joinedAt: e.joinedAt
                    });
                    if (!ok) throw new Error('gcall member ' + devId);
                }
            } catch(e) {
                console.warn('[Phone/calls] promover a grupo falhou:', e);
                _hostState.callId = null;
                _isGroupCaller = false;
                ctx.toast('Falha ao criar grupo', 'err');
                return false;
            }
        } else {
            const ok = await gcallMemberPut(target.id, {
                name: target.name, avatarUrl: target.avatarUrl,
                number: target.number, joinedAt: Date.now()
            }).catch(() => false);
            if (!ok) { ctx.toast('Falha ao registrar membro', 'err'); return false; }
        }

        _spawnHostPeer(target, false);
        return true;
    }

    function _toggleMuteMember(devId) {
        if (_individualMutes.has(devId)) _individualMutes.delete(devId);
        else _individualMutes.add(devId);
        _rebuildAllHostMixers();
        _renderCall();
    }

    // ═══ INCOMING ═══
    function _onIncoming(offer) {
        if (!offer) return;

        if (offer.type === 'hangup') {
            if (_peer && offer.fromId === _peer.id) _endCall(false, 'Encerrada');
            else if (_incomingOffer && _incomingOffer.fromId === offer.fromId) _rejectCall('canceled');
            return;
        }
        if (offer.type !== 'offer' || !offer.sdp) return;

        if (offer.ts && Date.now() - offer.ts > OFFER_STALE_MS) {
            try { sigPut(bridge.deviceId, 'answer', { type: 'reject', reason: 'stale', ts: Date.now() }); } catch(_) {}
            return;
        }
        if (offer.fromNumber && ctx.contacts.isBlocked?.(offer.fromNumber)) {
            try { sigPut(bridge.deviceId, 'answer', { type: 'reject', reason: 'blocked', ts: Date.now() }); } catch(_) {}
            return;
        }
        if (ctx.phase !== 'idle') {
            try { sigPut(bridge.deviceId, 'answer', { type: 'reject', reason: 'busy', ts: Date.now() }); } catch(_) {}
            return;
        }

        if (ctx.getMinimized()) ctx.setMinimized(false);
        _notifyIncoming(offer);
        _maybeNotify(offer.fromName, offer.fromAvatar);

        _incomingOffer = offer;
        _peer = { id: offer.fromId || '', name: offer.fromName || 'Sem nome', avatarUrl: offer.fromAvatar || '', number: offer.fromNumber || '' };
        _isGroupCaller = false;
        setPhase('incoming');
        ctx.announceCall();
        _renderCall();
        _startRingLoop();
        tone.notify();
        _startTimeout(CALL_TIMEOUT_MS, () => { _rejectCall('timeout'); });
    }

    function _notifyIncoming(offer) {
        const phone = window._phone;
        if (!phone?.notify?.push) return;
        const num = offer.fromNumber || '';
        const name = offer.fromName
            || ctx.contacts?.getContact?.(num)?.savedName
            || (num ? ctx.contacts?.fmtNumber?.(num) : '')
            || num || 'Chamada';
        try {
            phone.notify.push({
                appId:    'phone',
                appName:  'Telefone',
                accent:   '#22d3ee',
                title:    name,
                body:     offer.groupId ? 'Chamada em grupo recebida' : 'Chamada de voz recebida',
                priority: 'high',
                meta:     { kind: 'call', from: num, deviceId: offer.fromId || '', groupId: offer.groupId || null }
            });
        } catch(_) {}
    }

    function _maybeNotify(name, avatar) {
        try {
            if (!document.hidden) return;
            if (typeof Notification === 'undefined') return;
            if (Notification.permission === 'granted') {
                const opts = { body: 'Chamando no celular…', tag: 'sang-phone-call' };
                if (avatar) opts.icon = avatar;
                const n = new Notification(name || 'Chamada', opts);
                n.onclick = () => { window.focus(); if (ctx.getMinimized()) ctx.setMinimized(false); n.close(); };
            } else if (Notification.permission === 'default' && !localStorage.getItem(LS_NOTIF)) {
                localStorage.setItem(LS_NOTIF, '1');
                Notification.requestPermission().catch(() => {});
            }
        } catch(_) {}
    }

    // ═══ ACEITAR ═══
    async function _acceptCall() {
        const offer = _incomingOffer;
        if (!offer || ctx.phase !== 'incoming') return;
        _stopRingLoop(); _cancelTimeout();

        let stream;
        try { stream = await _ensureStream(); } catch (e) { _rejectCall('no-mic'); return; }

        setPhase('active');
        ctx.clearCallGlow();
        _startedAt = Date.now();
        _answered = true;
        _iceSeen.clear();
        _renderCall();
        _startTimers();

        if (offer.groupId) {
            _groupRosterCache = { callId: offer.groupId, host: offer.fromId, members: [] };
            _groupRosterSig = '';
            _groupPollTimer = setInterval(_pollGroupRoster, GROUP_POLL_MS);
            _pollGroupRoster();
        }

        try {
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            _pc = pc;
            stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));

            const remote = new MediaStream();
            pc.ontrack = (ev) => {
                ev.streams[0].getAudioTracks().forEach(t => remote.addTrack(t));
                _remoteAudio = new Audio();
                _remoteAudio.srcObject = remote;
                _remoteAudio.autoplay = true;
                _remoteAudio.play().catch(() => {});
                window._phoneRemoteEl = _remoteAudio;
            };
            pc.onicecandidate = (ev) => { if (!ev.candidate) return; sigPost(bridge.deviceId, 'ice/callee', ev.candidate.toJSON()).catch(() => {}); };
            pc.onconnectionstatechange = () => {
                const s = pc.connectionState;
                if (s === 'disconnected' && !_iceRestartTimer) {
                    _iceRestartTimer = setTimeout(() => {
                        _iceRestartTimer = null;
                        if (_pc && _pc.connectionState !== 'connected' && ctx.phase !== 'idle') _endCall(true, 'Conexão perdida');
                    }, ICE_RESTART_WINDOW_MS);
                    try { pc.restartIce(); } catch(_) {}
                } else if (s === 'connected') {
                    if (_iceRestartTimer) { clearTimeout(_iceRestartTimer); _iceRestartTimer = null; }
                } else if (s === 'failed') {
                    _endCall(true, 'Conexão perdida');
                }
            };

            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offer.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            const myAvatar = await _resolveMyAvatar();
            const ok = await _sigPutRetry(bridge.deviceId, 'answer', {
                type: 'answer', sdp: answer.sdp, fromId: bridge.deviceId,
                fromName: bridge.player?.name || '',
                fromAvatar: myAvatar || bridge.player?.avatarUrl || '',
                fromNumber: ctx.myNumber || '',
                ts: Date.now()
            }, 1);
            if (!ok) { _endCall(true, 'Erro ao conectar'); return; }

            _pollTimer = setInterval(() => _pollSignal(bridge.deviceId, 'callee'), POLL_MS);
            _pollSignal(bridge.deviceId, 'callee');
        } catch (e) { _endCall(true, 'Erro ao atender'); }
    }

    async function _pollGroupRoster() {
        if (!_groupRosterCache || ctx.phase !== 'active') return;
        try {
            const doc = await bridge.rtdb.get(RTDB_GCALL + '/' + _groupRosterCache.callId);
            if (!doc) return;
            const members = doc.members ? Object.entries(doc.members).map(([id, m]) => ({ id, ...m })) : [];
            if (doc.status === 'ended') { _endCall(false, 'Encerrada'); return; }

            _speakingSet.clear();
            if (doc.speaking) for (const devId in doc.speaking) if (doc.speaking[devId]?.s === 1) _speakingSet.add(devId);

            const sig = members.map(m => m.id + '|' + (m.name || '') + '|' + (m.avatarUrl || '') + '|' + (m.isHost ? 1 : 0)).sort().join('#')
                      + '#' + Array.from(_speakingSet).sort().join(',');
            if (sig === _groupRosterSig) return;

            _groupRosterCache.members = members;
            _groupRosterSig = sig;
            _renderCall();
        } catch(_) {}
    }

    function _rejectCall(reason) {
        const offer = _incomingOffer;
        _stopRingLoop(); _cancelTimeout();
        try { sigPut(bridge.deviceId, 'answer', { type: 'reject', reason: reason || 'rejected', ts: Date.now() }); } catch(_) {}
        setTimeout(() => { sigDel(bridge.deviceId, '').catch(() => {}); }, 2500);

        const labelForHistory = reason === 'timeout' ? 'Sem resposta'
                              : reason === 'blocked' ? 'Bloqueada'
                              : reason === 'stale'   ? 'Expirada'
                              : 'Recusada';
        _recordHistory(labelForHistory);

        _cleanupCall();
        setPhase('idle');
        _incomingOffer = null;
        _peer = null;
        ctx.clearCallGlow();
        ctx.renderTab();
    }

    async function _pollSignal(targetId, role) {
        if (ctx.phase === 'idle') return;
        const doc = await sigGet(targetId, '');
        if (!doc) return;
        if (doc.offer && doc.offer.type === 'hangup' && doc.offer.fromId && doc.offer.fromId !== bridge.deviceId) {
            _endCall(false, 'Encerrada');
            return;
        }
        if (role === 'caller' && doc.answer && !_answered) {
            if (doc.answer.type === 'reject') {
                const reason = doc.answer.reason || 'rejected';
                const label = reason === 'busy' ? 'Ocupado'
                            : reason === 'blocked' ? 'Bloqueada'
                            : reason === 'stale' ? 'Expirada'
                            : reason === 'timeout' ? 'Sem resposta'
                            : 'Recusada';
                _endCall(true, label);
                return;
            }
            if (doc.answer.sdp && _pc) {
                try { await _pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: doc.answer.sdp })); _answered = true; } catch(_) {}
            }
        }
        const remoteIceKey = role === 'caller' ? 'ice/callee' : 'ice/caller';
        const remoteIce = await sigGet(targetId, remoteIceKey);
        if (remoteIce && _pc) {
            for (const k in remoteIce) {
                if (_iceSeen.has(k)) continue;
                const cand = remoteIce[k];
                if (cand && cand.candidate) {
                    try { await _pc.addIceCandidate(new RTCIceCandidate(cand)); _iceSeen.add(k); } catch(_) {}
                }
            }
        }
    }

    // ═══ ENCERRAR ═══
    function _endCall(notifyRemote, label) {
        if (ctx.phase === 'idle') return;
        _stopRingLoop(); _cancelTimeout();
        _recordHistory(label);

        if (_hostMembers.size) {
            for (const devId of _hostMembers.keys()) {
                if (notifyRemote) sigPut(devId, 'offer', { type: 'hangup', kind: 'phone', fromId: bridge.deviceId || '', ts: Date.now() }).catch(() => {});
                setTimeout(() => { sigDel(devId, '').catch(() => {}); }, 1500);
            }
            if (_hostState.callId) {
                bridge.rtdb.put(gcallPath(_hostState.callId) + '/status', 'ended').catch(() => {});
                setTimeout(() => { bridge.rtdb.del(gcallPath(_hostState.callId)).catch(() => {}); }, 4000);
            }
        } else if (_peer && _peer.id) {
            if (notifyRemote) sigPut(bridge.deviceId, 'offer', { type: 'hangup', kind: 'phone', fromId: bridge.deviceId || '', ts: Date.now() }).catch(() => {});
            setTimeout(() => { sigDel(bridge.deviceId, '').catch(() => {}); }, 1500);
        }

        tone.hangup();
        _cleanupCall();
        setPhase('idle');
        _peer = null;
        _incomingOffer = null;
        _isGroupCaller = false;
        _groupRosterCache = null;
        _groupRosterSig = '';
        ctx.clearCallGlow();
        ctx.renderTab();
        if (label) _busyTone(label, '');
    }

    function _recordHistory(label) {
        if (!_peer && !_hostMembers.size) return;
        const dur = _startedAt ? (Date.now() - _startedAt) : 0;
        const wasGroup = _hostMembers.size > 1 || (_hostMembers.size === 1 && _isGroupCaller) || (_incomingOffer?.groupId && (_groupRosterCache?.members?.length || 0) > 2);
        const members = [];
        if (_hostMembers.size) for (const [, e] of _hostMembers) members.push({ number: e.number || '', name: e.name || '', avatarUrl: e.avatarUrl || '' });
        else if (_peer) members.push({ number: _peer.number || '', name: _peer.name || '', avatarUrl: _peer.avatarUrl || '' });
        if (!members.length) return;
        const dir = _incomingOffer ? 'incoming' : 'outgoing';
        let status = 'answered';
        if (dur === 0) {
            if (label === 'Recusada' || label === 'Bloqueada' || label === 'canceled') status = 'rejected';
            else if (['Sem resposta','Ocupado','Fora de área','Expirada','Encerrada'].includes(label)) status = 'missed';
            else status = 'answered';
        }
        ctx.contacts.pushHistory?.({
            id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            direction: dir, kind: wasGroup ? 'group' : '1:1',
            members, at: Date.now(), durationMs: dur, status
        });

        if (status === 'missed' && dir === 'incoming') {
            const main = members[0] || {};
            const phone = window._phone;
            const who = main.name
                || (main.number ? ctx.contacts.fmtNumber?.(main.number) : '')
                || main.number || 'Desconhecido';
            try {
                phone?.notify?.push?.({
                    appId:    'phone',
                    appName:  'Telefone',
                    accent:   '#fb7185',
                    title:    'Chamada perdida',
                    body:     who,
                    priority: 'high',
                    meta:     { kind: 'missed-call', number: main.number || '', direction: dir }
                });
            } catch(_) {}
        }
    }

    function _cleanupCall() {
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
        if (_durTimer) { clearInterval(_durTimer); _durTimer = null; }
        if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; }
        if (_groupPollTimer) { clearInterval(_groupPollTimer); _groupPollTimer = null; }
        if (_iceRestartTimer) { clearTimeout(_iceRestartTimer); _iceRestartTimer = null; }
        if (_vadRaf) { cancelAnimationFrame(_vadRaf); _vadRaf = null; }
        for (const devId of Array.from(_hostMembers.keys())) {
            const entry = _hostMembers.get(devId);
            if (entry.pollTimer) clearInterval(entry.pollTimer);
            if (entry.iceRestartTimer) clearTimeout(entry.iceRestartTimer);
            if (entry.ringTimeout) clearTimeout(entry.ringTimeout);
            if (entry.audioEl) { try { entry.audioEl.pause(); entry.audioEl.srcObject = null; } catch(_) {} }
            _stopVadFor(devId);
            _disposeHostMixer(devId);
            try { entry.pc.close(); } catch(_) {}
        }
        _hostMembers.clear();
        _hostState.callId = null;
        _individualMutes.clear();
        _speakingSet.clear();
        _groupRosterCache = null;
        _groupRosterSig = '';
        if (_pc) {
            try { _pc.getSenders().forEach(s => { try { s.track?.stop?.(); } catch(e) {} }); } catch(e) {}
            try { _pc.close(); } catch(e) {}
            _pc = null;
        }
        if (_remoteAudio) { try { _remoteAudio.pause(); _remoteAudio.srcObject = null; } catch(e) {} _remoteAudio = null; delete window._phoneRemoteEl; }

        if (_voiceHandle) {
            try { _voiceHandle.release(); } catch(_) {}
            _voiceHandle = null;
        }
        if (_localStream) {
            _localStream = null;
        }

        _startedAt = 0;
        _answered = false;
        _iceSeen.clear();
    }

    function _startTimeout(ms, cb) { _cancelTimeout(); _timeoutTimer = setTimeout(cb, ms); }
    function _cancelTimeout() { if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; } }
    function _startTimers() {
        if (_durTimer) clearInterval(_durTimer);
        _durTimer = setInterval(() => {
            const elt = ctx.root?.querySelector('#phTimer');
            if (elt) {
                const s = Math.floor((Date.now() - _startedAt) / 1000);
                const m = Math.floor(s / 60), ss = s % 60;
                elt.textContent = String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
            }
        }, 250);
    }

    function _stopRingLoop() { if (_ringTimer) { clearInterval(_ringTimer); _ringTimer = null; } }
    function _startRingbackLoop() { _stopRingLoop(); tone.ringback(); _ringTimer = setInterval(tone.ringback, RINGBACK_CYCLE_MS); }
    function _startRingLoop() { _stopRingLoop(); tone.ring(); _ringTimer = setInterval(tone.ring, RING_CYCLE_MS); }
    function _startBusyLoop() { _stopRingLoop(); let n = 0; tone.busy(); _ringTimer = setInterval(() => { tone.busy(); if (++n >= 10) _stopRingLoop(); }, BUSY_CYCLE_MS); }

    function _busyTone(title, sub) {
        setPhase('busy');
        _renderBusy(title, sub);
        _startBusyLoop();
        if (_busyDismissTimer) clearTimeout(_busyDismissTimer);
        _busyDismissTimer = setTimeout(() => {
            if (ctx.phase === 'busy') { setPhase('idle'); ctx.renderTab(); }
        }, 4500);
    }

    // ═══ UI — CHAMADA ═══
    function _renderCall() {
        const content = ctx.screenEl?.querySelector('#phContent');
        if (!content) return;
        const isGroup = _hostMembers.size > 1
            || (!_hostMembers.size && _groupRosterCache?.members && _groupRosterCache.members.length > 2);
        const members = _buildCallRoster();
        if (!isGroup && members.length <= 1) {
            const peer = members[0] || _peer || {};
            const initial = (peer.name || '?')[0] || '?';
            const av = peer.avatarUrl
                ? `<div class="ph-call-av"><img src="${esc(peer.avatarUrl)}" alt="" /></div>`
                : `<div class="ph-call-av">${esc(initial.toUpperCase())}</div>`;
            content.innerHTML = _renderCallShell(av, peer, false, []);
            _wireCallActions(content);
            return;
        }
        const stack = _renderAvatarStack(members);
        content.innerHTML = _renderCallShell(stack, { name: _groupLabel(members), number: '' }, true, members);
        _wireCallActions(content);
    }
    function _buildCallRoster() {
        if (_hostMembers.size) {
            const list = [];
            for (const [devId, e] of _hostMembers) list.push({ id: devId, name: e.name, avatarUrl: e.avatarUrl, number: e.number, joinedAt: e.joinedAt });
            return list;
        }
        if (_groupRosterCache && _groupRosterCache.members && _groupRosterCache.members.length) {
            const me = bridge.deviceId;
            return _groupRosterCache.members.filter(m => m.id !== me)
                .map(m => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, number: m.number, isHost: m.isHost }));
        }
        return _peer ? [{ id: _peer.id, name: _peer.name, avatarUrl: _peer.avatarUrl, number: _peer.number }] : [];
    }
    function _groupLabel(members) { return 'Grupo (' + (members.length + 1) + ')'; }
    function _renderAvatarStack(members) {
        const sorted = [...members].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
        const slots = sorted.slice(0, 4);
        const main = slots.shift();
        const parts = [];
        if (main) {
            const initial = (main.name || '?')[0] || '?';
            parts.push(main.avatarUrl
                ? `<div class="ph-call-av main stacked"><img src="${esc(main.avatarUrl)}" alt="" /></div>`
                : `<div class="ph-call-av main stacked">${esc(initial.toUpperCase())}</div>`);
        }
        slots.forEach(m => {
            const initial = (m.name || '?')[0] || '?';
            parts.push(m.avatarUrl
                ? `<div class="ph-call-av mini stacked"><img src="${esc(m.avatarUrl)}" alt="" /></div>`
                : `<div class="ph-call-av mini stacked">${esc(initial.toUpperCase())}</div>`);
        });
        const remaining = members.length - 4;
        const badge = remaining > 0 ? `<div class="ph-call-av mini stacked" style="background:rgba(52,211,153,.2);color:#a7f3d0;font-size:14px;">+${remaining}</div>` : '';
        return `<div class="ph-av-stack multi">${parts.join('')}${badge}</div>`;
    }
    function _renderCallShell(avHtml, peer, isGroup, members) {
        const phase = ctx.phase;
        let stateText = '', actions = '';
        if (phase === 'outgoing') {
            stateText = `<div class="ph-call-state">Chamando<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>`;
            actions = `<div class="ph-round-btn red" id="phHangup" title="Cancelar">${I.phoneDown}</div>`;
        } else if (phase === 'incoming') {
            stateText = `<div class="ph-call-state">${isGroup ? 'Chamada em grupo' : 'Recebendo chamada'}</div>`;
            actions = `
                <div class="ph-round-btn-wrap"><div class="ph-round-btn red incoming" id="phReject" title="Recusar">${I.phoneDown}</div><div class="ph-round-btn-label">Recusar</div></div>
                <div class="ph-round-btn-wrap"><div class="ph-round-btn green" id="phAccept" title="Atender">${I.phone}</div><div class="ph-round-btn-label">Atender</div></div>`;
        } else if (phase === 'active') {
            stateText = `<div class="ph-call-timer" id="phTimer">00:00</div>`;
            const isHost = _hostMembers.size > 0 || _isGroupCaller;
            const atMax = (_hostMembers.size + 1) >= MAX_GROUP_MEMBERS;
            const canAdd = isHost && !atMax;
            const addBtn = canAdd ? `<div class="ph-round-btn-wrap"><div class="ph-round-btn small add" id="phAdd" title="Adicionar">${I.plus}</div><div class="ph-round-btn-label">Adicionar</div></div>` : '';
            actions = `
                <div class="ph-round-btn-wrap"><div class="ph-round-btn small" id="phMute" title="Mudo">${I.mic}</div><div class="ph-round-btn-label">Mudo</div></div>
                ${addBtn}
                <div class="ph-round-btn-wrap"><div class="ph-round-btn red" id="phHangup" title="Desligar">${I.phoneDown}</div><div class="ph-round-btn-label">Desligar</div></div>`;
        }
        const numLine = peer.number ? `<div class="ph-call-num">${esc(ctx.contacts.fmtNumber?.(peer.number) || peer.number)}</div>` : '';
        const rosterHtml = isGroup && members.length ? _renderRosterChips(members) : '';
        return `<div class="ph-call ${phase} ${isGroup ? 'group' : ''}">
            <div class="ph-call-top">
                ${avHtml}
                <div class="ph-call-name">${esc(peer.name || '—')}</div>
                ${numLine}${stateText}${rosterHtml}
            </div>
            <div class="ph-call-actions">${actions}</div>
        </div>`;
    }
    function _renderRosterChips(members) {
        const isHost = _hostMembers.size > 0;
        const chips = members.slice(0, 6).map(m => {
            const initial = (m.name || '?')[0] || '?';
            const img = m.avatarUrl ? `<img src="${esc(m.avatarUrl)}" alt="" />` : `<span class="ini">${esc(initial.toUpperCase())}</span>`;
            const isSpeaking = isHost ? (!!_hostMembers.get(m.id)?.vad?.speaking) : _speakingSet.has(m.id);
            const muted = isHost && _individualMutes.has(m.id);
            const cls = ['chip'];
            if (m.isHost) cls.push('host');
            if (isSpeaking) cls.push('speaking');
            if (muted) cls.push('muted');
            const ctrl = isHost
                ? `<button class="mute-btn" data-mute="${esc(m.id)}" title="${muted ? 'Reativar' : 'Silenciar'}">${muted ? '🔇' : '🔊'}</button>
                   <button class="kick" data-kick="${esc(m.id)}" title="Remover">✕</button>`
                : '';
            return `<div class="${cls.join(' ')}" data-dev-id="${esc(m.id)}">
                ${img}<span>${esc(m.name || '—')}</span>${ctrl}
            </div>`;
        }).join('');
        const more = members.length > 6 ? `<div class="chip">+${members.length - 6}</div>` : '';
        return `<div class="ph-roster">${chips}${more}</div>`;
    }
    function _wireCallActions(content) {
        const hangup = content.querySelector('#phHangup');
        if (hangup) hangup.addEventListener('click', () => _endCall(true, 'Encerrada'));
        const accept = content.querySelector('#phAccept');
        if (accept) accept.addEventListener('click', () => _acceptCall());
        const reject = content.querySelector('#phReject');
        if (reject) reject.addEventListener('click', () => _rejectCall('rejected'));
        const mute = content.querySelector('#phMute');
        if (mute) mute.addEventListener('click', () => {
            if (!_localStream) return;
            const track = _localStream.getAudioTracks()[0];
            if (!track) return;
            track.enabled = !track.enabled;
            mute.classList.toggle('active', !track.enabled);
            mute.innerHTML = track.enabled ? I.mic : I.micOff;
        });
        const addBtn = content.querySelector('#phAdd');
        if (addBtn) addBtn.addEventListener('click', () => _openAddPicker());
        content.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const devId = b.dataset.kick;
            const name = _hostMembers.get(devId)?.name || 'Membro';
            _removeHostMember(devId, true);
            ctx.toast(name + ' removido', 'ok');
            _renderCall();
        }));
        content.querySelectorAll('[data-mute]').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            _toggleMuteMember(b.dataset.mute);
        }));
    }
    function _renderBusy(title, sub) {
        const content = ctx.screenEl?.querySelector('#phContent');
        if (!content) return;
        content.innerHTML = `<div class="ph-busy">
            <div class="ph-busy-icon">${I.off}</div>
            <div class="ph-busy-title">${esc(title || 'Ocupado')}</div>
            <div class="ph-busy-sub">${esc(sub || 'O contato não pode atender agora.')}</div>
        </div>`;
    }

    // ═══ ADD PICKER ═══
    async function _openAddPicker() {
        if (!ctx.screenEl || _openAddPicker._open) return;
        if (!_hostMembers.size) { ctx.toast('Você não é o anfitrião', 'err'); return; }
        if ((_hostMembers.size + 1) >= MAX_GROUP_MEMBERS) { ctx.toast('Limite de ' + MAX_GROUP_MEMBERS + ' pessoas', 'err'); return; }
        _openAddPicker._open = true;

        const ov = ctx.el('div', { class: 'ph-add-overlay' });
        ov.innerHTML = `<div class="ph-add-head"><div class="ph-add-title">Adicionar à chamada</div><button class="ph-add-close" id="phAddClose">✕</button></div>
            <div class="ph-add-body" id="phAddBody"><div class="ph-empty">Carregando…</div></div>`;
        ctx.screenEl.appendChild(ov);
        const body = ov.querySelector('#phAddBody');
        const close = () => { _openAddPicker._open = false; ov.remove(); };
        ov.querySelector('#phAddClose').addEventListener('click', close);

        await ctx.contacts.fetchSessions?.(false);

        const inCall = new Set(_hostMembers.keys());
        const contactsList = ctx.contacts.contacts || [];
        const candidates = [];

        for (const c of contactsList) {
            if (!c?.username) continue;
            if (ctx.contacts.isBlocked?.(c.number)) continue;
            const live = ctx.contacts.findLiveSession?.(c.username);
            if (!live) continue;
            if (inCall.has(live.id)) continue;
            candidates.push({
                id: live.id,
                name: live.name || c.savedName || c.username || '',
                avatarUrl: live.avatarUrl || c.savedAvatar || '',
                number: c.number
            });
        }
        candidates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        if (!candidates.length) {
            body.innerHTML = `<div class="ph-empty">Nenhum contato disponível.<br><span class="hint">Só é possível adicionar contatos online que ainda não estão na chamada.</span></div>`;
            return;
        }

        body.innerHTML = candidates.map(c => {
            const initial = (c.name || '?')[0] || '?';
            const av = c.avatarUrl
                ? `<div class="ph-av sm"><img src="${esc(c.avatarUrl)}" alt="" /><span class="dot-online"></span></div>`
                : `<div class="ph-av sm">${esc(initial.toUpperCase())}<span class="dot-online"></span></div>`;
            const numTxt = ctx.contacts.fmtNumber?.(c.number) || c.number || '';
            return `<div class="ph-contact" data-add-id="${esc(c.id)}" data-add-name="${esc(c.name)}" data-add-avatar="${esc(c.avatarUrl)}" data-add-number="${esc(c.number)}">
                ${av}
                <div class="ph-info"><div class="ph-name">${esc(c.name)}</div><div class="ph-meta">${numTxt ? `<span class="num">${esc(numTxt)}</span> · online` : 'online'}</div></div>
                <button class="ph-call-btn" style="border-color:rgba(34,211,238,.4);background:rgba(34,211,238,.1);color:#67e8f9;">${I.plus}</button>
            </div>`;
        }).join('');

        body.querySelectorAll('.ph-contact').forEach(row => {
            row.addEventListener('click', async () => {
                if (row.dataset._busy === '1') return;
                row.dataset._busy = '1';
                const target = {
                    id: row.dataset.addId, name: row.dataset.addName,
                    avatarUrl: row.dataset.addAvatar, number: row.dataset.addNumber
                };
                const ok = await _addMemberToCall(target);
                if (!ok) { row.dataset._busy = '0'; return; }
                ctx.toast(target.name + ' adicionado', 'ok');
                close();
                _renderCall();
            });
        });
    }

    // ═══ ESTILO ═══
    ctx.appendStyle(`
        .ph-call { position: absolute; inset: 0;
            display: flex; flex-direction: column; align-items: center; justify-content: space-between;
            padding: 34px 20px 30px;
            background: linear-gradient(180deg, rgba(20,18,40,0) 0%, rgba(20,18,40,.88) 100%);
            animation: phFadeIn .3s ease; z-index: 5; }
        .ph-call-top { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
        .ph-call-av { width: 96px; height: 96px; border-radius: 32px;
            background: linear-gradient(135deg, rgba(34,211,238,.26), rgba(167,139,250,.26));
            border: 2px solid rgba(255,255,255,.14);
            display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative; color: #a8aec4; font-size: 34px; font-weight: 800;
            box-shadow: 0 20px 50px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.14); }
        .ph-call-av img { position: absolute; top: 50%; left: 50%; width: 210%; height: 210%; object-fit: cover; transform: translate(-50%, -50%); }
        .ph-call.outgoing .ph-call-av { box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 0 0 6px rgba(34,211,238,.1), inset 0 1px 0 rgba(255,255,255,.14); }
        .ph-call.incoming .ph-call-av { box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 0 0 6px rgba(52,211,153,.18), inset 0 1px 0 rgba(255,255,255,.14); }
        .ph-call.active  .ph-call-av { box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 0 0 6px rgba(52,211,153,.28), inset 0 1px 0 rgba(255,255,255,.14); }
        .ph-av-stack { display: flex; align-items: center; justify-content: center; position: relative; height: 96px; width: 100%; }
        .ph-av-stack .stacked { position: absolute; animation: phStackIn .3s cubic-bezier(.22,1,.36,1); }
        .ph-av-stack .stacked:nth-child(1) { transform: translateX(-32px) scale(.78); z-index: 1; opacity: .85; }
        .ph-av-stack .stacked:nth-child(2) { transform: translateX(32px) scale(.78); z-index: 1; opacity: .85; }
        .ph-av-stack .stacked:nth-child(3) { transform: translateX(-64px) scale(.6); z-index: 0; opacity: .6; }
        .ph-av-stack .stacked:nth-child(4) { transform: translateX(64px) scale(.6); z-index: 0; opacity: .6; }
        .ph-av-stack .stacked:nth-child(5) { transform: translateY(40px) scale(.5); z-index: 0; opacity: .4; }
        .ph-av-stack .main { transform: none; z-index: 2; }
        .ph-av-stack.multi .ph-call-av { width: 88px; height: 88px; border-radius: 28px; font-size: 30px; }
        .ph-av-stack.multi .ph-call-av.mini { width: 62px; height: 62px; border-radius: 20px; font-size: 22px; }
        .ph-call-name { font-size: 15px; font-weight: 800; color: #f1f2f8; text-align: center; letter-spacing: .02em;
            max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ph-call-num { font-size: 10px; color: #67e8f9; letter-spacing: .08em; font-variant-numeric: tabular-nums; margin-top: 3px; }
        .ph-call-state { font-size: 10.5px; color: #a8aec4; display: flex; align-items: center; gap: 3px; letter-spacing: .04em; margin-top: 6px; }
        .ph-call-state .dot { animation: phDots 1.4s infinite; }
        .ph-call-state .dot:nth-child(2) { animation-delay: .2s; }
        .ph-call-state .dot:nth-child(3) { animation-delay: .4s; }
        .ph-call-timer { font-size: 22px; font-weight: 800; color: #a7f3d0; font-variant-numeric: tabular-nums; letter-spacing: .04em; margin-top: 4px; }
        .ph-roster { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; padding: 0 8px; margin-top: 6px; max-width: 100%; }
        .ph-roster .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 4px; border-radius: 12px;
            background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
            font-size: 9px; color: #c7cad6; max-width: 110px;
            transition: box-shadow .25s, border-color .25s, background .25s, transform .25s cubic-bezier(.22,1,.36,1); }
        .ph-roster .chip img { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
        .ph-roster .chip .ini { width: 18px; height: 18px; border-radius: 50%;
            background: linear-gradient(135deg, rgba(34,211,238,.34), rgba(167,139,250,.34));
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 9px; font-weight: 800; color: #f1f2f8; flex-shrink: 0; }
        .ph-roster .chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ph-roster .chip.host { border-color: rgba(167,139,250,.46); background: rgba(167,139,250,.12); }
        .ph-roster .chip.speaking { border-color: rgba(52,211,153,.7); background: linear-gradient(120deg, rgba(52,211,153,.18), rgba(34,211,238,.18)); animation: phSpeaking 1.4s ease-in-out infinite; }
        .ph-roster .chip.muted { border-color: rgba(251,113,133,.44); background: rgba(251,113,133,.1); opacity: .7; }
        .ph-roster .chip.muted span { text-decoration: line-through; }
        .ph-roster .chip .kick, .ph-roster .chip .mute-btn { width: 12px; height: 12px; margin-left: 1px;
            border-radius: 50%; background: transparent; border: none; cursor: pointer;
            color: #a8aec4; line-height: 1; padding: 0;
            display: inline-flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity .15s, color .15s, background .15s; font-family: inherit; }
        .ph-roster .chip .kick { font-size: 11px; }
        .ph-roster .chip .mute-btn { font-size: 9px; }
        .ph-roster .chip:hover .kick, .ph-roster .chip:hover .mute-btn { opacity: 1; }
        .ph-roster .chip .kick:hover { color: #fca5b1; background: rgba(251,113,133,.16); }
        .ph-roster .chip .mute-btn:hover { color: #67e8f9; background: rgba(34,211,238,.16); }
        .ph-roster .chip.muted .mute-btn { opacity: 1; color: #fca5b1; }
        .ph-call-actions { display: flex; gap: 22px; align-items: center; justify-content: center; }
        .ph-round-btn { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center; color: #fff; font-family: inherit;
            transition: transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.22,1,.36,1), filter .15s;
            position: relative; }
        .ph-round-btn:hover { transform: translateY(-2px) scale(1.04); }
        .ph-round-btn:active { transform: scale(.95); }
        .ph-round-btn svg { width: 24px; height: 24px; }
        .ph-round-btn.green { background: linear-gradient(135deg, #34d399, #22d3ee); box-shadow: 0 10px 26px rgba(52,211,153,.4), inset 0 1px 0 rgba(255,255,255,.25); }
        .ph-round-btn.red { background: linear-gradient(135deg, #fb7185, #f472b6); box-shadow: 0 10px 26px rgba(251,113,133,.4), inset 0 1px 0 rgba(255,255,255,.25); }
        .ph-round-btn.small { width: 46px; height: 46px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.14); box-shadow: none; color: #c7cad6; }
        .ph-round-btn.small:hover { background: rgba(255,255,255,.16); }
        .ph-round-btn.small.active { background: rgba(251,113,133,.2); color: #fca5b1; border-color: rgba(251,113,133,.44); }
        .ph-round-btn.small.add { color: #a7f3d0; border-color: rgba(52,211,153,.4); }
        .ph-round-btn.small.add:hover { background: rgba(52,211,153,.16); color: #fff; }
        .ph-round-btn-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .ph-round-btn-label { font-size: 8.5px; color: #a8aec4; letter-spacing: .05em; text-transform: uppercase; }
        .ph-busy { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 14px; padding: 30px; background: rgba(16,14,32,.94); animation: phFadeIn .25s ease; z-index: 6; }
        .ph-busy-icon { width: 68px; height: 68px; border-radius: 22px; background: rgba(251,113,133,.14);
            border: 1px solid rgba(251,113,133,.4); display: flex; align-items: center; justify-content: center; color: #fb7185; }
        .ph-busy-icon svg { width: 30px; height: 30px; }
        .ph-busy-title { font-size: 14px; font-weight: 800; color: #f1f2f8; text-align: center; }
        .ph-busy-sub { font-size: 10.5px; color: #a8aec4; text-align: center; line-height: 1.5; max-width: 200px; }
        .ph-add-overlay { position: absolute; inset: 0; background: rgba(16,14,32,.96); backdrop-filter: blur(8px);
            display: flex; flex-direction: column; z-index: 8; animation: phFadeIn .2s ease; }
        .ph-add-head { padding: 14px 16px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.08); }
        .ph-add-title { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #67e8f9; }
        .ph-add-close { width: 26px; height: 26px; border-radius: 7px; background: transparent; border: 1px solid rgba(255,255,255,.12);
            color: #a8aec4; cursor: pointer; font-size: 14px; line-height: 1; font-family: inherit;
            display: flex; align-items: center; justify-content: center; }
        .ph-add-close:hover { background: rgba(251,113,133,.16); color: #fca5b1; border-color: rgba(251,113,133,.4); }
        .ph-add-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 12px 12px; }
        .ph-add-body::-webkit-scrollbar { width: 4px; }
        .ph-add-body::-webkit-scrollbar-thumb { background: rgba(167,139,250,.35); border-radius: 2px; }
    `);

    // ═══ EXPORTAR ═══
    Object.assign(ctx.calls, {
        call: _call,
        onIncoming: _onIncoming,
        accept: _acceptCall,
        reject: _rejectCall,
        endCall: _endCall,
        renderCall: _renderCall,
        busyTone: _busyTone,
        cleanup: () => { _stopRingLoop(); _cleanupCall(); _cancelTimeout(); if (_busyDismissTimer) clearTimeout(_busyDismissTimer); },
        isGroupActive: () => !!_hostState.callId,
        isHost: () => _hostMembers.size > 0,
        registerMissedForOffline: (p) => _registerMissedForOffline(p)
    });

    try {
        if (typeof ctx._registerCleanup === 'function') {
            ctx._registerCleanup(() => { try { _cleanupCall(); } catch(_) {} });
        }
    } catch(_) {}
})();
