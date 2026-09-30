// modules/phone/apps/sangzap/common.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Sangzap/common] phone ctx ausente'); return; }
    if (window._sangzapCtx) return;

    const S = {};

    // ═══ IDS ═══
    S.chatIdFor = (a, b) => [String(a), String(b)].sort().join('-');
    S.groupChatId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    S.msgId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    // ═══ FORMAT — TEMPO ═══
    S.fmtTime = function(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        if (d.toDateString() === now.toDateString()) return hh + ':' + mm;
        const dd = String(d.getDate()).padStart(2, '0');
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        return dd + '/' + mo + ' ' + hh + ':' + mm;
    };
    S.fmtRelative = function(ts) {
        if (!ts) return '';
        const diff = Date.now() - ts;
        if (diff < 60000) return 'agora';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'min';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
        if (diff < 604800000) return Math.floor(diff / 86400000) + 'd';
        return S.fmtTime(ts);
    };
    S.timeAgo = function(ts) {
        if (!ts) return '';
        const diff = Date.now() - ts;
        const s = Math.floor(diff / 1000);
        if (s < 60) return 'agora';
        const m = Math.floor(s / 60);
        if (m < 60) return `há ${m} min`;
        const h = Math.floor(m / 60);
        if (h < 24) return `há ${h}h`;
        const d = Math.floor(h / 24);
        if (d < 7) return `há ${d}d`;
        return S.fmtTime(ts);
    };
    S.shortNum = (n) => String(n || '').replace(/^(\d{3})(\d{3})$/, '$1 $2');

    // ═══ FORMAT — DURAÇÃO / TAMANHO ═══
    S.fmtDur = function(ms) {
        if (!Number.isFinite(ms) || ms < 0) return '0:00';
        const total = Math.floor(ms / 1000);
        const s = total % 60;
        const m = Math.floor(total / 60) % 60;
        const h = Math.floor(total / 3600);
        const ss = String(s).padStart(2, '0');
        if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + ss;
        return m + ':' + ss;
    };
    S.fmtBytes = function(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
        if (bytes < 1024) return Math.floor(bytes) + ' B';
        const units = ['KB', 'MB', 'GB'];
        let v = bytes / 1024, i = 0;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' ' + units[i];
    };

    // ═══ FORMAT — DATA / SEPARADORES ═══
    S.dateLabel = function(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diff = Math.round((today - target) / 86400000);
        if (diff === 0) return 'Hoje';
        if (diff === 1) return 'Ontem';
        if (diff === 2) return 'Anteontem';
        if (d.getFullYear() === now.getFullYear()) {
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        }
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    S.sameDay = function(a, b) {
        if (!a || !b) return false;
        const da = new Date(a), db = new Date(b);
        return da.getFullYear() === db.getFullYear()
            && da.getMonth() === db.getMonth()
            && da.getDate() === db.getDate();
    };
    S.withDateSeparators = function(messages) {
        if (!Array.isArray(messages)) return [];
        const out = [];
        let lastTs = 0;
        for (const m of messages) {
            if (!m || !m.sentAt) { out.push(m); continue; }
            if (!lastTs || !S.sameDay(lastTs, m.sentAt)) {
                out.push({ _sep: true, ts: m.sentAt, label: S.dateLabel(m.sentAt) });
            }
            out.push(m);
            lastTs = m.sentAt;
        }
        return out;
    };

    // ═══ TEXT — SANITIZE / ESCAPE ═══
    S.sanitize = (text) => String(text || '').slice(0, 4000);
    S.escape = ctx.esc || (s => String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]));

    // ═══ TEXT — MARKUP ═══
    const SLOT = '\uE000';
    function applyMarkup(t) {
        const slots = [];
        t = t.replace(/`([^`\n]+)`/g, (_, inner) => {
            const i = slots.length;
            slots.push(inner);
            return SLOT + i + SLOT;
        });
        t = t.replace(/(^|[^\w])\*([^\s\*](?:[^\*\n]*?[^\s\*])?)\*(?=[^\w]|$)/g, '$1<strong>$2</strong>');
        t = t.replace(/(^|[^\w])_([^\s_](?:[^_\n]*?[^\s_])?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
        t = t.replace(/(^|[^\w])~([^\s~](?:[^~\n]*?[^\s~])?~)?/g, (m, pre, body) => {
            if (!body) return m;
            return pre + '<del>' + body.replace(/~$/, '') + '</del>';
        });
        t = t.replace(new RegExp(SLOT + '(\\d+)' + SLOT, 'g'), (_, i) =>
            '<code class="sz-code">' + slots[+i] + '</code>');
        return t;
    }

    // ═══ TEXT — LINKIFY + MENÇÕES + MARKUP ═══
    S.renderText = function(text, opts) {
        opts = opts || {};
        if (!text) return '';
        const s = S.escape(String(text));
        const myName = opts.myName ? String(opts.myName).toLowerCase() : '';

        const urlRe = /\b(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
        const parts = [];
        let last = 0, m;
        while ((m = urlRe.exec(s))) {
            if (m.index > last) parts.push({ u: false, v: s.slice(last, m.index) });
            let url = m[0];
            const tail = url.match(/[.,;:!?)\]}]+$/);
            if (tail) url = url.slice(0, -tail[0].length);
            parts.push({ u: true, v: url });
            last = m.index + url.length;
            urlRe.lastIndex = last;
        }
        if (last < s.length) parts.push({ u: false, v: s.slice(last) });

        return parts.map(p => {
            if (p.u) {
                const href = /^https?:/i.test(p.v) ? p.v : 'http://' + p.v;
                return `<a class="sz-link" href="${href}" target="_blank" rel="noopener noreferrer">${p.v}</a>`;
            }
            let t = p.v;
            t = t.replace(/(^|[^\w])@([\w\u00C0-\u017F]+)/g, (_, pre, name) => {
                const mine = myName && name.toLowerCase() === myName;
                return pre + `<span class="sz-mention"${mine ? ' data-me="1"' : ''}>@${name}</span>`;
            });
            t = applyMarkup(t);
            return t;
        }).join('');
    };

    // ═══ TEXT — PREVIEW ═══
    S.preview = function(msg) {
        if (!msg) return '';
        const kind = msg.kind || 'text';
        if (kind === 'audio') return '🎤 Áudio';
        if (kind === 'image') return '📷 Imagem';
        if (kind === 'video') return '🎬 Vídeo';
        if (kind === 'doc')   return '📄 Documento';
        if (kind === 'location') return '📍 Localização';
        if (kind === 'contact')  return '👤 Contato';
        if (kind === 'story-reply') return '💬 Respondeu ao story';
        if (kind === 'system') return msg.body || '';
        return S.sanitize(msg.body || '');
    };

    S.countUnread = function(messages, myNumber) {
        if (!Array.isArray(messages)) return 0;
        let n = 0;
        for (const m of messages) if (m && m.from !== myNumber && !m.readAt) n++;
        return n;
    };

    S.extractMentions = function(text) {
        const out = new Set();
        const re = /(^|[^\w])@([\w\u00C0-\u017F]+)/g;
        let m;
        while ((m = re.exec(String(text || '')))) out.add(m[2].toLowerCase());
        return [...out];
    };

    S.mentionsMe = function(text, myName) {
        if (!myName) return false;
        return S.extractMentions(text).includes(String(myName).toLowerCase());
    };

    S.recentEmojis = ['❤️', '😂', '😮', '😢', '👏', '🔥', '👍', '🎉'];

    // ═══ CONTATOS ═══
    S.getContacts = function() {
        const c = ctx.contacts;
        if (!c) return [];
        if (Array.isArray(c.contacts)) return c.contacts.slice();
        if (Array.isArray(c.list))     return c.list.slice();
        if (Array.isArray(c.all))      return c.all.slice();
        if (typeof c.list     === 'function') { try { return c.list()     || []; } catch(_) { return []; } }
        if (typeof c.all      === 'function') { try { return c.all()      || []; } catch(_) { return []; } }
        if (typeof c.getAll   === 'function') { try { return c.getAll()   || []; } catch(_) { return []; } }
        if (typeof c.getList  === 'function') { try { return c.getList()  || []; } catch(_) { return []; } }
        if (typeof c.getContacts === 'function') { try { return c.getContacts() || []; } catch(_) { return []; } }
        return [];
    };

    // ═══ STYLE (definido por style.js) ═══

    window._sangzapCtx = S;
})();
