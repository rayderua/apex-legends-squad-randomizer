/**
 * Apex Legends Squad Randomizer
 * https://github.com/rayderua/apex-legends-squad-randomizer
 *
 * Rolls a random legend for each active player:
 *  - no duplicate legends inside one squad;
 *  - per-player "no repeat" window: with N selected legends a player gets
 *    N - reserve different legends in a row (e.g. 13 selected, reserve 5 -> 8).
 *
 * All settings are stored in the browser's localStorage.
 */
(() => {
    'use strict';

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    const CONFIG = {
        classes: {
            Assault: ['Bangalore', 'Revenant', 'Fuse', 'Mad Maggie', 'Ballistic'],
            Skirmisher: ['Pathfinder', 'Wraith', 'Octane', 'Horizon', 'Ash', 'Alter', 'Axle'],
            Recon: ['Bloodhound', 'Crypto', 'Valkyrie', 'Seer', 'Vantage', 'Sparrow'],
            Support: ['Gibraltar', 'Lifeline', 'Mirage', 'Loba', 'Newcastle', 'Conduit'],
            Controller: ['Caustic', 'Wattson', 'Rampart', 'Catalyst'],
        },
        classIcons: { Assault: '⚡', Skirmisher: '🚀', Recon: '👁', Support: '✚', Controller: '⭖' },

        playerCount: 3,
        defaultReserve: 5,      // legends that always stay available in a player's pool
        historyMax: 100,        // roll history entries kept per player
        maxPickAttempts: 200,   // retries when building a squad without duplicates

        repoUrl: 'https://github.com/rayderua/apex-legends-squad-randomizer',

        // Legend select screen layout in game: classes per row, legends in CONFIG.classes order.
        // Update it when a new season changes the in-game order, otherwise Discord images point to the wrong slot.
        selectScreenRows: [['Assault', 'Skirmisher'], ['Recon', 'Support', 'Controller']],

        discord: {
            username: 'Apex Squad Bot',
            avatarPath: 'static/images/ApexIcon.png',
            embedColor: 0xFF4B4B,
            defaultTheme: 'compact',

            // Shared look of generated images
            image: {
                background: '#0d0d0d',
                accent: '#ff4b4b',
                dimOverlay: 'rgba(0, 0, 0, 0.7)',
                jpegQuality: 0.9,
            },

            // Note: Discord shrinks embed images to ~400px wide and shows thumbnails at up to 80px
            themes: {
                // Theme 1: schematic of the select screen + the rolled legend's class with large portraits
                compact: {
                    padding: 20,
                    overview: { cell: 40, gap: 6, classGapCells: 1, radius: 6, color: '#464646' },
                    label: { font: 'bold 44px "Segoe UI", Roboto, Arial, sans-serif', color: '#969696', height: 70 },
                    strip: { cell: 150, gap: 10, radius: 12, border: 7 },
                },
                // Theme 2: full select screen with portraits
                detailed: {
                    padding: 32,
                    cell: 144,
                    gap: 12,
                    classGapCells: 1,
                    radius: 12,
                    border: 8,               // highlight border of the rolled legend
                    gridBorder: 6,           // grey border of every other legend
                    gridBorderColor: '#5a5a5a',
                },
            },
        },
    };

    const ALL_LEGENDS = Object.values(CONFIG.classes).flat();
    const PLAYER_IDS = Array.from({ length: CONFIG.playerCount }, (_, i) => i);

    // Keys are kept compatible with older versions of the app
    const STORAGE_KEYS = {
        names: 'apex_names',
        active: 'apex_active',
        disabled: 'apex_disabled',   // legends a player does NOT have (unchecked)
        reserve: 'apex_reserve',
        history: 'apex_history',
        webhook: 'apex_webhook',
        discordTheme: 'apex_discord_theme',
    };

    // ---------------------------------------------------------------------
    // Storage helpers
    // ---------------------------------------------------------------------

    const storage = {
        load(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch {
                return fallback;
            }
        },
        save(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        },
        remove(key) {
            localStorage.removeItem(key);
        },
    };

    /** Returns an array of exactly `length` items, filling gaps via `makeDefault(index)`. */
    function normalizeList(value, length, makeDefault, isValid) {
        const list = Array.isArray(value) ? value : [];
        return Array.from({ length }, (_, i) => (isValid(list[i]) ? list[i] : makeDefault(i)));
    }

    const defaultName = i => `P${i + 1}`;
    const isStringList = v => Array.isArray(v) && v.every(x => typeof x === 'string');

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    const state = {
        names: normalizeList(storage.load(STORAGE_KEYS.names), CONFIG.playerCount, defaultName,
            v => typeof v === 'string' && v.trim() !== ''),
        active: normalizeList(storage.load(STORAGE_KEYS.active), CONFIG.playerCount, () => true,
            v => typeof v === 'boolean'),
        // Stored as "disabled" so that newly added legends are enabled by default
        disabled: normalizeList(storage.load(STORAGE_KEYS.disabled), CONFIG.playerCount, () => [], isStringList)
            .map(list => new Set(list)),
        history: normalizeList(storage.load(STORAGE_KEYS.history), CONFIG.playerCount, () => [], isStringList),
        reserve: parseReserve(storage.load(STORAGE_KEYS.reserve, CONFIG.defaultReserve)),
        webhook: localStorage.getItem(STORAGE_KEYS.webhook) || '',   // stored as a plain string
        discordTheme: migrateThemeId(storage.load(STORAGE_KEYS.discordTheme, CONFIG.discord.defaultTheme)),
        lastSquad: [],   // [{ player, legend }]
    };

    /** Theme ids were renamed: classFocus -> compact, fullScreen -> detailed. */
    function migrateThemeId(id) {
        return { classFocus: 'compact', fullScreen: 'detailed' }[id] ?? id;
    }

    function parseReserve(value) {
        const n = parseInt(value, 10);
        return Number.isNaN(n) || n < 0 ? CONFIG.defaultReserve : n;
    }

    const persist = {
        names: () => storage.save(STORAGE_KEYS.names, state.names),
        active: () => storage.save(STORAGE_KEYS.active, state.active),
        disabled: () => storage.save(STORAGE_KEYS.disabled, state.disabled.map(set => [...set])),
        history: () => storage.save(STORAGE_KEYS.history, state.history),
        reserve: () => storage.save(STORAGE_KEYS.reserve, state.reserve),
        webhook: () => localStorage.setItem(STORAGE_KEYS.webhook, state.webhook),
        discordTheme: () => storage.save(STORAGE_KEYS.discordTheme, state.discordTheme),
    };

    // ---------------------------------------------------------------------
    // Randomizer logic (pure functions, no DOM access)
    // ---------------------------------------------------------------------

    /** Legends the player owns (checked), in config order. */
    function getPool(player) {
        return ALL_LEGENDS.filter(legend => !state.disabled[player].has(legend));
    }

    /**
     * Legends on cooldown for a player.
     * Returns Map<legend, rollsLeft> — how many rolls until the legend is back in the pool.
     *
     * With N legends in the pool, any (N - reserve) consecutive rolls must be different,
     * so the last (N - reserve - 1) rolled legends are excluded.
     */
    function getCooldowns(player, pool) {
        const cooldowns = new Map();
        const blockCount = Math.max(0, pool.length - state.reserve - 1);
        if (blockCount === 0) return cooldowns;

        // Ignore history entries for legends that were unchecked afterwards
        const recent = state.history[player].filter(legend => pool.includes(legend)).slice(-blockCount);

        // j = 0 is the most recent roll -> longest cooldown
        for (let j = 0; j < recent.length; j++) {
            const legend = recent[recent.length - 1 - j];
            if (!cooldowns.has(legend)) cooldowns.set(legend, blockCount - j);
        }
        return cooldowns;
    }

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    const randomItem = array => array[Math.floor(Math.random() * array.length)];

    /**
     * Picks one legend per player with no duplicates in the squad.
     * Players pick in random order so nobody gets priority on shared legends.
     * Returns [{ player, legend }] in the order of `players`, or null if impossible.
     */
    function pickSquad(players) {
        const pools = players.map(getPool);
        const cooldowns = players.map((player, k) => getCooldowns(player, pools[k]));

        for (let attempt = 0; attempt < CONFIG.maxPickAttempts; attempt++) {
            const picks = new Array(players.length);
            const taken = new Set();
            let success = true;

            for (const k of shuffle(players.map((_, i) => i))) {
                const free = pools[k].filter(legend => !taken.has(legend));
                let candidates = free.filter(legend => !cooldowns[k].has(legend));
                // Fallback for tiny or heavily overlapping pools: ignore cooldowns
                if (candidates.length === 0) candidates = free;
                if (candidates.length === 0) {
                    success = false;
                    break;
                }
                picks[k] = randomItem(candidates);
                taken.add(picks[k]);
            }

            if (success) return players.map((player, k) => ({ player, legend: picks[k] }));
        }
        return null;
    }

    function addToHistory(squad) {
        for (const { player, legend } of squad) {
            const history = state.history[player];
            history.push(legend);
            if (history.length > CONFIG.historyMax) history.splice(0, history.length - CONFIG.historyMax);
        }
        persist.history();
    }

    // ---------------------------------------------------------------------
    // DOM helpers
    // ---------------------------------------------------------------------

    const $ = id => document.getElementById(id);

    /** Tiny element factory: h('div', { class: 'x', dataset: {...}, onclick: fn }, child1, 'text', ...) */
    function h(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key === 'dataset') Object.assign(el.dataset, value);
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
            else if (key in el && typeof value !== 'string') el[key] = value;
            else el.setAttribute(key, value === true ? '' : value);
        }
        el.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
        return el;
    }

    const legendImage = legend => `static/images/Portrait_${legend.replace(/ /g, '_')}_square.png`;

    const pluralRolls = n => (n === 1 ? 'roll' : 'rolls');

    // ---------------------------------------------------------------------
    // UI: layout
    // ---------------------------------------------------------------------

    const dom = {};

    /** Root element. The whole UI is built here, so index.html and app.js can't get out of sync. */
    function getRoot() {
        let root = $('app');
        if (!root) {   // older/cached index.html without #app
            root = h('div', { id: 'app' });
            document.body.replaceChildren(root);
        }
        return root;
    }

    function renderLayout() {
        dom.reserveValue = h('b');
        dom.discordStatus = h('b');
        dom.themeName = h('b');

        dom.settingsPanel = renderSettingsPanel();
        dom.settingsBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Settings', 'aria-label': 'Settings' }, '⚙');

        dom.result = h('section', { class: 'hero' });
        dom.rollBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'RANDOMIZE');
        dom.discordBtn = h('button', { type: 'button', class: 'btn btn-discord' },
            h('span', { class: 'btn-icon' }, '◆'), 'Send to Discord');
        dom.players = h('section', { class: 'players' });
        dom.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });

        getRoot().replaceChildren(
            h('div', { class: 'wrap' },
                h('header', { class: 'topbar' },
                    h('div', { class: 'logo' },
                        h('img', { src: CONFIG.discord.avatarPath, alt: '' }),
                        h('span', {}, 'APEX ', h('em', {}, 'SQUAD'), ' RANDOMIZER'),
                    ),
                    h('div', { class: 'spacer' }),
                    h('button', { type: 'button', class: 'chip', title: 'No-repeat settings', onclick: () => toggleSettings(true) },
                        'No-repeat reserve ', dom.reserveValue),
                    h('button', { type: 'button', class: 'chip', title: 'Discord webhook settings', onclick: () => toggleSettings(true) },
                        'Discord ', dom.discordStatus),
                    h('button', { type: 'button', class: 'chip chip-theme', title: 'Choose how the squad looks in Discord', onclick: openThemePicker },
                        '🎨 Theme: ', dom.themeName),
                    h('div', { class: 'settings-anchor' }, dom.settingsBtn, dom.settingsPanel),
                ),
                dom.result,
                h('div', { class: 'actions' }, dom.rollBtn, dom.discordBtn),
                dom.players,
                h('div', { class: 'legend-key' },
                    h('span', {}, h('i', { class: 'key-available' }), 'available'),
                    h('span', {}, h('i', { class: 'key-cooldown' }), 'cooldown — rolls left'),
                    h('span', {}, h('i', { class: 'key-off' }), 'not owned — click to toggle'),
                    h('span', {}, h('i', { class: 'key-last' }), 'last roll'),
                ),
                h('footer', { class: 'footer' },
                    h('a', { href: CONFIG.repoUrl, target: '_blank', rel: 'noopener' }, 'GitHub')),
            ),
            dom.toasts,
        );
    }

    /** Top bar chips reflect the current settings. */
    function renderStatus() {
        dom.reserveValue.textContent = state.reserve;
        const ready = state.webhook.trim() !== '';
        dom.discordStatus.textContent = ready ? '● ready' : '○ not set';
        dom.discordStatus.className = ready ? 'ok' : 'muted';
        dom.themeName.textContent = DISCORD_THEMES[currentThemeId()].label;
        dom.discordBtn.disabled = state.lastSquad.length === 0;
        dom.discordBtn.title = state.lastSquad.length ? `Send with the "${DISCORD_THEMES[currentThemeId()].label}" theme` : 'Roll a squad first';
    }

    // ---------------------------------------------------------------------
    // UI: settings popover
    // ---------------------------------------------------------------------

    function renderSettingsPanel() {
        dom.reserveInput = h('input', { type: 'number', min: '0', max: '50', value: String(state.reserve) });
        dom.webhookInput = h('input', {
            type: 'text', value: state.webhook, placeholder: 'https://discord.com/api/webhooks/…', autocomplete: 'off', spellcheck: 'false',
        });

        dom.reserveInput.addEventListener('change', () => setReserve(dom.reserveInput.value));
        dom.webhookInput.addEventListener('input', () => {
            state.webhook = dom.webhookInput.value;
            persist.webhook();
            renderStatus();
        });

        return h('div', { class: 'popover', hidden: true },
            h('div', { class: 'field' },
                h('label', {}, 'No-repeat reserve'),
                h('div', { class: 'field-row' },
                    dom.reserveInput,
                    h('button', { type: 'button', class: 'btn btn-small', onclick: resetHistory }, '↺ Reset history'),
                ),
                h('p', { class: 'hint' },
                    'Legends that always stay in the pool. With N legends selected, a player gets N − reserve different legends in a row.'),
            ),
            h('div', { class: 'field' },
                h('label', {}, 'Discord webhook URL'),
                dom.webhookInput,
                h('p', { class: 'hint' }, 'Server Settings → Integrations → Webhooks → Copy Webhook URL. Stored only in this browser.'),
            ),
        );
    }

    function toggleSettings(open = dom.settingsPanel.hidden) {
        dom.settingsPanel.hidden = !open;
        dom.settingsBtn.classList.toggle('active', open);
    }

    // ---------------------------------------------------------------------
    // UI: rolled squad
    // ---------------------------------------------------------------------

    function renderResult() {
        const activePlayers = PLAYER_IDS.filter(player => state.active[player]);

        if (state.lastSquad.length === 0) {
            dom.result.replaceChildren(...activePlayers.map(player =>
                h('div', { class: 'pick pick-empty' },
                    h('div', { class: 'pick-info' },
                        h('div', { class: 'pick-player' }, state.names[player]),
                        h('div', { class: 'pick-legend' }, 'Ready up?'),
                    ),
                ),
            ));
            return;
        }

        dom.result.replaceChildren(...state.lastSquad.map(({ player, legend }) => {
            const cls = classOf(legend);
            return h('div', { class: 'pick' },
                h('img', { src: legendImage(legend), alt: legend }),
                h('span', { class: 'pick-class' }, `${CONFIG.classIcons[cls]} ${cls}`),
                h('div', { class: 'pick-info' },
                    h('div', { class: 'pick-player' }, state.names[player]),
                    h('div', { class: 'pick-legend' }, legend),
                ),
            );
        }));
    }

    // ---------------------------------------------------------------------
    // UI: player cards
    // ---------------------------------------------------------------------

    function renderPlayerCard(player) {
        const classGroups = Object.entries(CONFIG.classes).map(([cls, legends]) => [
            h('div', { class: 'cls-label' }, `${CONFIG.classIcons[cls]} ${cls}`),
            h('div', { class: 'grid' }, ...legends.map(legend =>
                h('label', { class: 'tile', dataset: { legend } },
                    h('input', {
                        type: 'checkbox',
                        class: 'legend-toggle',
                        checked: !state.disabled[player].has(legend),
                        dataset: { player, legend },
                    }),
                    h('img', { src: legendImage(legend), alt: legend, loading: 'lazy' }),
                ),
            )),
        ]);

        return h('div', { class: 'card', dataset: { player } },
            h('div', { class: 'card-head' },
                h('input', {
                    type: 'text',
                    class: 'name',
                    value: state.names[player],
                    placeholder: defaultName(player),
                    maxlength: '24',
                    title: 'Player name',
                    dataset: { player },
                }),
                h('span', { class: 'count' }),
                h('label', { class: 'switch', title: 'Include player in the roll' },
                    h('input', { type: 'checkbox', class: 'player-active', checked: state.active[player], dataset: { player } }),
                    h('span'),
                ),
            ),
            ...classGroups.flat(),
        );
    }

    function renderPlayerCards() {
        dom.players.replaceChildren(...PLAYER_IDS.map(renderPlayerCard));
        PLAYER_IDS.forEach(renderCardState);
    }

    const playerCard = player => dom.players.querySelector(`.card[data-player="${player}"]`);

    /** Tile states (owned / cooldown / last roll), counter and active state of one player card. */
    function renderCardState(player) {
        const card = playerCard(player);
        const pool = getPool(player);
        const cooldowns = getCooldowns(player, pool);
        const lastLegend = state.lastSquad.find(pick => pick.player === player)?.legend;

        card.classList.toggle('inactive', !state.active[player]);
        card.querySelector('.count').textContent = `${pool.length}/${ALL_LEGENDS.length}`;

        card.querySelectorAll('.tile').forEach(tile => {
            const legend = tile.dataset.legend;
            const owned = !state.disabled[player].has(legend);
            const rollsLeft = owned ? cooldowns.get(legend) : undefined;

            tile.classList.toggle('off', !owned);
            tile.classList.toggle('cd', rollsLeft !== undefined);
            tile.classList.toggle('last', legend === lastLegend);

            if (rollsLeft !== undefined) {
                tile.dataset.cd = rollsLeft;
                tile.title = `${legend} — rolled recently, back in the pool in ${rollsLeft} ${pluralRolls(rollsLeft)}`;
            } else {
                delete tile.dataset.cd;
                tile.title = owned ? legend : `${legend} — not owned (click to add)`;
            }
        });
    }

    const renderAllCardStates = () => PLAYER_IDS.forEach(renderCardState);

    // ---------------------------------------------------------------------
    // UI: toasts and modal
    // ---------------------------------------------------------------------

    function toast(message, type = 'info') {
        const el = h('div', { class: `toast toast-${type}` }, message);
        dom.toasts.append(el);
        setTimeout(() => el.classList.add('hide'), 2600);
        setTimeout(() => el.remove(), 3000);
    }

    let closeActiveModal = null;

    function openModal(title, body, { onClose } = {}) {
        closeActiveModal?.();

        const backdrop = h('div', { class: 'backdrop' });
        const close = () => {
            backdrop.remove();
            closeActiveModal = null;
            onClose?.();
        };
        backdrop.addEventListener('click', event => {
            if (event.target === backdrop) close();
        });
        backdrop.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
            h('div', { class: 'modal-head' },
                h('h3', {}, title),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕'),
            ),
            body,
        ));
        document.body.append(backdrop);
        closeActiveModal = close;
        return close;
    }

    // ---------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------

    function roll() {
        const players = PLAYER_IDS.filter(player => state.active[player]);
        if (players.length === 0) return toast('Turn on at least one player', 'error');
        if (players.some(player => getPool(player).length === 0)) return toast('Every active player needs at least one legend', 'error');

        const squad = pickSquad(players);
        if (!squad) return toast("Can't build a squad without duplicates", 'error');

        addToHistory(squad);
        state.lastSquad = squad;
        renderResult();
        renderAllCardStates();
        renderStatus();

        // Warm up Discord images in the background so sending is instant
        squad.forEach(({ legend }) => getThemeImages(currentThemeId(), legend).catch(() => {}));
    }

    function setReserve(value) {
        state.reserve = parseReserve(value);
        dom.reserveInput.value = state.reserve;
        persist.reserve();
        renderAllCardStates();
        renderStatus();
    }

    function resetHistory() {
        state.history = PLAYER_IDS.map(() => []);
        storage.remove(STORAGE_KEYS.history);
        renderAllCardStates();
        toast('Roll history has been reset');
    }

    // ---------------------------------------------------------------------
    // Discord: image rendering (canvas)
    // ---------------------------------------------------------------------

    /** Base URL of the page (directory), used for absolute links. */
    function getBaseUrl() {
        const url = new URL(window.location.href);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/[^/]*$/, '');
        return url.href;
    }

    /** Public page link when hosted, otherwise the GitHub repo. */
    function getSourceUrl() {
        return /^https?:$/.test(window.location.protocol) ? getBaseUrl() : CONFIG.repoUrl;
    }

    const imageCache = new Map();

    /** Loads a portrait once and reuses it everywhere. */
    function loadImage(src) {
        if (!imageCache.has(src)) {
            imageCache.set(src, new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => {
                    imageCache.delete(src);   // allow a retry later
                    reject(new Error(`Failed to load ${src}`));
                };
                img.src = src;
            }));
        }
        return imageCache.get(src);
    }

    async function loadPortraits(legends) {
        return new Map(await Promise.all(legends.map(async legend => [legend, await loadImage(legendImage(legend))])));
    }

    const classOf = legend => Object.keys(CONFIG.classes).find(cls => CONFIG.classes[cls].includes(legend));

    /** Width of `count` cells in a row. */
    const cellsWidth = (count, cell, gap) => count * cell + Math.max(0, count - 1) * gap;

    /** Width of one select-screen row, including empty cells between classes. */
    function selectScreenRowWidth(row, { cell, gap, classGapCells }) {
        const cells = row.reduce((sum, cls) => sum + CONFIG.classes[cls].length, 0) + (row.length - 1) * classGapCells;
        return cellsWidth(cells, cell, gap);
    }

    function selectScreenSize(grid) {
        const rows = CONFIG.selectScreenRows;
        return {
            width: Math.max(...rows.map(row => selectScreenRowWidth(row, grid))),
            height: cellsWidth(rows.length, grid.cell, grid.gap),
        };
    }

    /** Position of every legend on the select screen; rows are centred within `width`, like in game. */
    function layoutSelectScreen(grid, left, top, width) {
        const { cell, gap, classGapCells } = grid;
        const tiles = [];
        CONFIG.selectScreenRows.forEach((row, rowIndex) => {
            let x = left + (width - selectScreenRowWidth(row, grid)) / 2;
            const y = top + rowIndex * (cell + gap);
            row.forEach(cls => {
                for (const legend of CONFIG.classes[cls]) {
                    tiles.push({ legend, x, y });
                    x += cell + gap;
                }
                x += classGapCells * (cell + gap);
            });
        });
        return tiles;
    }

    function createCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = CONFIG.discord.image.background;
        ctx.fillRect(0, 0, width, height);
        return { canvas, ctx };
    }

    /**
     * Rounded rectangle path. Own implementation instead of the canvas roundRect() method,
     * which is missing in older Safari (< 16) and Firefox (< 112).
     */
    function roundRectPath(ctx, x, y, width, height = width, radius = 0) {
        const r = Math.max(0, Math.min(radius, width / 2, height / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    /** Draws an image into a square, cropping it like CSS object-fit: cover. */
    function drawCover(ctx, img, x, y, size) {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, x, y, size, size);
    }

    /** Rounded portrait; optionally dimmed and with an inner border. */
    function drawPortraitTile(ctx, img, x, y, size, { radius, dim = false, border = 0, borderColor = null }) {
        ctx.save();
        roundRectPath(ctx, x, y, size, size, radius);
        ctx.clip();
        drawCover(ctx, img, x, y, size);
        if (dim) {
            ctx.fillStyle = CONFIG.discord.image.dimOverlay;
            ctx.fillRect(x, y, size, size);
        }
        ctx.restore();

        if (border && borderColor) {
            const half = border / 2;
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = border;
            roundRectPath(ctx, x + half, y + half, size - border, size - border, radius - half);
            ctx.stroke();
        }
    }

    /** Accent border around a tile; drawn last so neighbours don't cover it. */
    function drawHighlight(ctx, x, y, size, radius, width) {
        const half = width / 2;
        ctx.strokeStyle = CONFIG.discord.image.accent;
        ctx.lineWidth = width;
        roundRectPath(ctx, x - half, y - half, size + width, size + width, radius + half);
        ctx.stroke();
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            // toBlob throws when the canvas is "tainted" (e.g. page opened via file://)
            try {
                canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Empty image'))), type, quality);
            } catch (error) {
                reject(error);
            }
        });
    }

    const toJpeg = canvas => canvasToBlob(canvas, 'image/jpeg', CONFIG.discord.image.jpegQuality);

    /** Theme 1 image: grey schematic of the select screen + the rolled legend's class with large portraits. */
    async function renderClassFocusImage(selected) {
        const t = CONFIG.discord.themes.compact;
        const cls = classOf(selected);
        const legends = CONFIG.classes[cls];

        // Same width for every class, so all players' images are shown at the same scale in Discord
        const overview = selectScreenSize(t.overview);
        const maxClassSize = Math.max(...Object.values(CONFIG.classes).map(list => list.length));
        const contentWidth = Math.max(overview.width, cellsWidth(maxClassSize, t.strip.cell, t.strip.gap));

        const { canvas, ctx } = createCanvas(
            contentWidth + t.padding * 2,
            t.padding + overview.height + t.label.height + t.strip.cell + t.padding,
        );
        const portraits = await loadPortraits(legends);

        // 1) Schematic: where to click
        let y = t.padding;
        for (const tile of layoutSelectScreen(t.overview, t.padding, y, contentWidth)) {
            ctx.fillStyle = tile.legend === selected ? CONFIG.discord.image.accent : t.overview.color;
            roundRectPath(ctx, tile.x, tile.y, t.overview.cell, t.overview.cell, t.overview.radius);
            ctx.fill();
        }
        y += overview.height;

        // 2) Class name
        ctx.fillStyle = t.label.color;
        ctx.font = t.label.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cls.toUpperCase(), canvas.width / 2, y + t.label.height / 2);
        y += t.label.height;

        // 3) Class portraits
        const { cell, gap, radius, border } = t.strip;
        let x = t.padding + (contentWidth - cellsWidth(legends.length, cell, gap)) / 2;
        let highlightX = null;
        for (const legend of legends) {
            drawPortraitTile(ctx, portraits.get(legend), x, y, cell, { radius, dim: legend !== selected });
            if (legend === selected) highlightX = x;
            x += cell + gap;
        }
        if (highlightX !== null) drawHighlight(ctx, highlightX, y, cell, radius, border);

        return toJpeg(canvas);
    }

    /** Theme 2 image: the whole select screen with portraits, grey grid and the rolled legend highlighted. */
    async function renderFullScreenImage(selected) {
        const t = CONFIG.discord.themes.detailed;
        const size = selectScreenSize(t);
        const { canvas, ctx } = createCanvas(size.width + t.padding * 2, size.height + t.padding * 2);
        const portraits = await loadPortraits(ALL_LEGENDS);

        let highlight = null;
        for (const tile of layoutSelectScreen(t, t.padding, t.padding, size.width)) {
            const isSelected = tile.legend === selected;
            drawPortraitTile(ctx, portraits.get(tile.legend), tile.x, tile.y, t.cell, {
                radius: t.radius,
                dim: !isSelected,
                border: isSelected ? 0 : t.gridBorder,
                borderColor: t.gridBorderColor,
            });
            if (isSelected) highlight = tile;
        }
        if (highlight) drawHighlight(ctx, highlight.x, highlight.y, t.cell, t.radius, t.border);

        return toJpeg(canvas);
    }

    // ---------------------------------------------------------------------
    // Discord: themes and message
    // ---------------------------------------------------------------------

    /**
     * Each theme defines the embed text and the images for one player.
     * `images()` keys are embed fields: `image` (large, below the text) and `thumbnail` (small, on the right).
     */
    const DISCORD_THEMES = {
        compact: {
            label: 'Compact',
            description: 'Select-screen map + big portraits of the class. Easy to read on phones.',
            text: (name, legend) => ({ title: name, description: `**${legend}**` }),
            images: async legend => ({ image: await renderClassFocusImage(legend) }),
        },
        detailed: {
            label: 'Detailed',
            description: 'The whole select screen with portraits, exactly as in game.',
            text: (name, legend) => ({ title: `${name}: ${legend}` }),
            images: async legend => ({ image: await renderFullScreenImage(legend) }),
        },
    };

    const currentThemeId = () => (DISCORD_THEMES[state.discordTheme] ? state.discordTheme : CONFIG.discord.defaultTheme);

    /** Images depend only on theme + legend, so they are cached between theme previews and sending. */
    const themeImageCache = new Map();

    function getThemeImages(themeId, legend) {
        const key = `${themeId}|${legend}`;
        if (!themeImageCache.has(key)) {
            const promise = DISCORD_THEMES[themeId].images(legend);
            promise.catch(() => themeImageCache.delete(key));   // don't cache failures
            themeImageCache.set(key, promise);
        }
        return themeImageCache.get(key);
    }

    /**
     * Builds the Discord message for the squad: payload + files to upload.
     * Falls back to text only if images can't be generated (e.g. page opened via file://).
     */
    async function buildDiscordMessage(squad, themeId = currentThemeId()) {
        const theme = DISCORD_THEMES[themeId];

        let images = null;
        let imageError = null;
        try {
            images = await Promise.all(squad.map(({ legend }) => getThemeImages(themeId, legend)));
        } catch (error) {
            imageError = describeImageError(error);
            console.warn('Images are unavailable, sending text only:', error);
        }

        const files = [];
        const embeds = squad.map(({ player, legend }, i) => {
            const embed = { color: CONFIG.discord.embedColor, ...theme.text(state.names[player], legend) };
            for (const [field, blob] of Object.entries(images?.[i] ?? {})) {
                const name = `${field}-${i + 1}.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
                files.push({ name, blob });
                embed[field] = { url: `attachment://${name}` };
            }
            return embed;
        });

        const payload = {
            username: CONFIG.discord.username,
            avatar_url: getBaseUrl() + CONFIG.discord.avatarPath,
            // "-#" = small grey subtext; <url> disables the link preview
            content: `-# [Apex Squad Randomizer](<${getSourceUrl()}>)`,
            embeds,
        };

        return { payload, files, imageError };
    }

    /** Human-readable reason why Discord images couldn't be generated. */
    function describeImageError(error) {
        if (window.location.protocol === 'file:') {
            return 'Images need the page opened over http(s) — e.g. GitHub Pages or a local server. '
                + 'Browsers block them for pages opened as a local file.';
        }
        return `Images couldn't be generated: ${error?.message || error}`;
    }

    /** fetch() options for the webhook: JSON, or multipart when there are files. */
    function toWebhookRequest({ payload, files }) {
        if (files.length === 0) {
            return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
        }
        const form = new FormData();
        form.append('payload_json', JSON.stringify({
            ...payload,
            attachments: files.map(({ name }, id) => ({ id, filename: name })),
        }));
        files.forEach(({ blob, name }, id) => form.append(`files[${id}]`, blob, name));
        return { body: form };   // the browser sets the multipart Content-Type itself
    }

    async function sendToDiscord() {
        if (state.lastSquad.length === 0) return toast('Roll a squad first', 'error');
        const url = state.webhook.trim();
        if (!url) {
            toast('Add a Discord webhook URL first', 'error');
            toggleSettings(true);
            dom.webhookInput.focus();
            return;
        }

        dom.discordBtn.disabled = true;
        dom.discordBtn.classList.add('loading');
        try {
            const message = await buildDiscordMessage(state.lastSquad);
            const response = await fetch(url, { method: 'POST', ...toWebhookRequest(message) });
            if (response.ok && message.imageError) toast('Sent to Discord without images — see the theme window for details', 'error');
            else if (response.ok) toast('Sent to Discord', 'success');
            else toast(`Discord error: ${response.status}`, 'error');
        } catch {
            toast('Network error', 'error');
        } finally {
            dom.discordBtn.classList.remove('loading');
            renderStatus();
        }
    }

    // ---------------------------------------------------------------------
    // Theme picker: previews of every theme, click to choose
    // ---------------------------------------------------------------------

    /** Minimal Discord markdown for embed text: only **bold** is used by the themes. */
    function renderMarkdown(text) {
        return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(part =>
            (part.startsWith('**') && part.endsWith('**') ? h('strong', {}, part.slice(2, -2)) : part));
    }

    /** Discord-like embed; `fileUrls` maps attachment names to object URLs. */
    function renderEmbed(embed, fileUrls) {
        const fileUrl = field => (embed[field] ? fileUrls.get(embed[field].url.replace('attachment://', '')) : null);
        const thumbnail = fileUrl('thumbnail');
        const image = fileUrl('image');

        return h('div', { class: 'dc-embed' },
            h('div', { class: 'dc-embed-head' },
                h('div', {},
                    h('div', { class: 'dc-embed-title' }, embed.title),
                    embed.description ? h('div', { class: 'dc-embed-desc' }, renderMarkdown(embed.description)) : null,
                ),
                thumbnail ? h('img', { class: 'dc-embed-thumb', src: thumbnail, alt: '' }) : null,
            ),
            image ? h('img', { class: 'dc-embed-image', src: image, alt: '' }) : null,
        );
    }

    /** Discord message mock with one embed: shows how a theme looks. */
    async function renderThemePreview(themeId, sample, objectUrls) {
        const message = await buildDiscordMessage([sample], themeId);
        const fileUrls = new Map(message.files.map(({ name, blob }) => {
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            return [name, url];
        }));

        return h('div', { class: 'dc-message' },
            h('img', { class: 'dc-avatar', src: CONFIG.discord.avatarPath, alt: '' }),
            h('div', { class: 'dc-body' },
                h('div', { class: 'dc-header' },
                    h('span', { class: 'dc-username' }, message.payload.username),
                    h('span', { class: 'dc-app-tag' }, 'APP'),
                ),
                h('div', { class: 'dc-subtext' }, 'Apex Squad Randomizer'),
                ...message.payload.embeds.map(embed => renderEmbed(embed, fileUrls)),
                message.imageError ? h('p', { class: 'hint hint-warning' }, message.imageError) : null,
            ),
        );
    }

    function openThemePicker() {
        // Preview with the current roll if there is one, otherwise with a sample legend
        const sample = state.lastSquad[0] ?? { player: PLAYER_IDS.find(p => state.active[p]) ?? 0, legend: 'Bloodhound' };
        const objectUrls = [];

        const options = Object.entries(DISCORD_THEMES).map(([id, theme]) => {
            const preview = h('div', { class: 'theme-preview' }, h('div', { class: 'skeleton' }));
            renderThemePreview(id, sample, objectUrls)
                .then(node => preview.replaceChildren(node))
                .catch(error => preview.replaceChildren(
                    h('p', { class: 'hint hint-warning' }, `Preview is unavailable: ${error?.message || error}`)));

            return h('button', {
                type: 'button',
                class: `theme-option${id === currentThemeId() ? ' selected' : ''}`,
                onclick: () => {
                    state.discordTheme = id;
                    persist.discordTheme();
                    renderStatus();
                    closeModal();
                    toast(`Theme: ${theme.label}`, 'success');
                },
            },
                h('div', { class: 'theme-option-head' },
                    h('span', { class: 'theme-name' }, theme.label),
                    h('span', { class: 'theme-check' }, '✓ selected'),
                ),
                h('p', { class: 'hint' }, theme.description),
                preview,
            );
        });

        const closeModal = openModal('Discord theme', h('div', { class: 'theme-options' }, ...options), {
            onClose: () => objectUrls.forEach(url => URL.revokeObjectURL(url)),
        });
    }

    // ---------------------------------------------------------------------
    // Event wiring
    // ---------------------------------------------------------------------

    function bindEvents() {
        dom.rollBtn.addEventListener('click', roll);
        dom.discordBtn.addEventListener('click', sendToDiscord);
        dom.settingsBtn.addEventListener('click', () => toggleSettings());

        // Player cards: names, on/off switch, owned legends
        dom.players.addEventListener('input', event => {
            if (!event.target.matches('.name')) return;
            const player = Number(event.target.dataset.player);
            state.names[player] = event.target.value.trim() || defaultName(player);
            persist.names();
            renderResult();
        });

        dom.players.addEventListener('change', event => {
            const { target } = event;
            const player = Number(target.dataset.player);

            if (target.matches('.player-active')) {
                state.active[player] = target.checked;
                persist.active();
                renderCardState(player);
                if (state.lastSquad.length === 0) renderResult();
            } else if (target.matches('.legend-toggle')) {
                const disabled = state.disabled[player];
                if (target.checked) disabled.delete(target.dataset.legend);
                else disabled.add(target.dataset.legend);
                persist.disabled();
                renderCardState(player);
            }
        });

        // Close popover / modal on outside click and Escape
        document.addEventListener('click', event => {
            // Ignore controls that open the popover themselves
            if (!dom.settingsPanel.hidden && !event.target.closest('.settings-anchor, .chip, .btn-discord')) toggleSettings(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            if (closeActiveModal) closeActiveModal();
            else toggleSettings(false);
        });
    }

    // ---------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------

    function init() {
        renderLayout();
        renderPlayerCards();
        renderResult();
        renderStatus();
        bindEvents();
    }

    init();
})();
