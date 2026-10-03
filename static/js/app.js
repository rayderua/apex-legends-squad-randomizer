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

    /** Tiny element factory: h('div', { class: 'x', dataset: {...} }, child1, 'text', ...) */
    function h(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key === 'dataset') Object.assign(el.dataset, value);
            else if (key in el && typeof value !== 'string') el[key] = value;
            else el.setAttribute(key, value === true ? '' : value);
        }
        el.append(...children.filter(c => c !== null && c !== undefined));
        return el;
    }

    const legendImage = legend => `static/images/Portrait_${legend.replace(/ /g, '_')}_square.png`;

    const pluralRolls = n => (n === 1 ? 'roll' : 'rolls');

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    const dom = {
        toggles: $('player-toggles'),
        players: $('players-container'),
        result: $('result'),
        reserve: $('history-reserve'),
        resetHistory: $('reset-history'),
        webhook: $('webhook-url'),
        discordTheme: $('discord-theme'),
        previewPanel: $('discord-preview-panel'),
        preview: $('discord-preview'),
        rollBtn: $('roll-btn'),
        discordBtn: $('discord-btn'),
    };

    function renderPlayerToggles() {
        dom.toggles.replaceChildren(...PLAYER_IDS.map(player => h('div', { class: 'setting-group' },
            h('input', {
                type: 'checkbox',
                class: 'player-active',
                checked: state.active[player],
                dataset: { player },
                title: 'Include player in the roll',
            }),
            h('input', {
                type: 'text',
                class: 'player-name',
                value: state.names[player],
                placeholder: defaultName(player),
                dataset: { player },
            }),
        )));
    }

    function renderPlayerCard(player) {
        const classGroups = Object.entries(CONFIG.classes).map(([cls, legends]) =>
            h('div', { class: 'class-group' },
                h('div', { class: 'class-header' }, h('span', {}, CONFIG.classIcons[cls]), ` ${cls}`),
                h('div', { class: 'legend-grid' }, ...legends.map(legend =>
                    h('label', { class: 'legend-opt', dataset: { legend } },
                        h('input', {
                            type: 'checkbox',
                            class: 'legend-toggle',
                            checked: !state.disabled[player].has(legend),
                            dataset: { player, legend },
                        }),
                        h('img', { src: legendImage(legend), alt: legend, title: legend, loading: 'lazy' }),
                    ),
                )),
            ),
        );

        return h('div', {
            class: `player-card${state.active[player] ? '' : ' disabled'}`,
            dataset: { player },
        },
            h('h2', { class: 'player-display-name' }, state.names[player]),
            ...classGroups,
        );
    }

    function renderPlayerCards() {
        dom.players.replaceChildren(...PLAYER_IDS.map(renderPlayerCard));
    }

    const playerCard = player => dom.players.querySelector(`.player-card[data-player="${player}"]`);

    /** Marks legends on cooldown (grey + rolls-left counter) for every player. */
    function renderCooldowns() {
        for (const player of PLAYER_IDS) {
            const cooldowns = getCooldowns(player, getPool(player));

            playerCard(player).querySelectorAll('.legend-opt').forEach(opt => {
                const legend = opt.dataset.legend;
                const img = opt.querySelector('img');
                const rollsLeft = cooldowns.get(legend);   // undefined for unchecked legends too

                opt.classList.toggle('blocked', rollsLeft !== undefined);
                if (rollsLeft !== undefined) {
                    opt.dataset.cd = rollsLeft;
                    img.title = `${legend} — rolled recently, back in the pool in ${rollsLeft} ${pluralRolls(rollsLeft)}`;
                } else {
                    delete opt.dataset.cd;
                    img.title = legend;
                }
            });
        }
    }

    function renderResult() {
        if (state.lastSquad.length === 0) {
            dom.result.replaceChildren(h('div', { class: 'placeholder-text' }, 'READY UP?'));
            return;
        }
        dom.result.replaceChildren(...state.lastSquad.map(({ player, legend }) =>
            h('div', { class: 'res-item' },
                h('img', { src: legendImage(legend), alt: legend }),
                h('div', { class: 'res-name' }, legend),
                h('div', { class: 'res-player' }, state.names[player]),
            ),
        ));
    }

    // ---------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------

    function roll() {
        const players = PLAYER_IDS.filter(player => state.active[player]);
        if (players.length === 0) return alert('Choose at least one player!');
        if (players.some(player => getPool(player).length === 0)) return alert('Choose at least one legend!');

        const squad = pickSquad(players);
        if (!squad) return alert("Can't build a squad without duplicates!");

        addToHistory(squad);
        state.lastSquad = squad;
        renderResult();
        renderCooldowns();
        renderPreview();
        dom.discordBtn.hidden = false;
    }

    function setReserve(value) {
        state.reserve = parseReserve(value);
        dom.reserve.value = state.reserve;
        persist.reserve();
        renderCooldowns();
    }

    function resetHistory() {
        state.history = PLAYER_IDS.map(() => []);
        storage.remove(STORAGE_KEYS.history);
        renderCooldowns();
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
                img.onerror = () => reject(new Error(`Failed to load ${src}`));
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

    function roundRectPath(ctx, x, y, size, radius) {
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, radius);
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
        roundRectPath(ctx, x, y, size, radius);
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
            ctx.beginPath();
            ctx.roundRect(x + half, y + half, size - border, size - border, Math.max(0, radius - half));
            ctx.stroke();
        }
    }

    /** Accent border around a tile; drawn last so neighbours don't cover it. */
    function drawHighlight(ctx, x, y, size, radius, width) {
        const half = width / 2;
        ctx.strokeStyle = CONFIG.discord.image.accent;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.roundRect(x - half, y - half, size + width, size + width, radius + half);
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
            roundRectPath(ctx, tile.x, tile.y, t.overview.cell, t.overview.radius);
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
            label: 'Discord: Compact',
            text: (name, legend) => ({ title: name, description: `**${legend}**` }),
            images: async legend => ({ image: await renderClassFocusImage(legend) }),
        },
        detailed: {
            label: 'Discord: Detailed',
            text: (name, legend) => ({ title: `${name}: ${legend}` }),
            images: async legend => ({ image: await renderFullScreenImage(legend) }),
        },
    };

    const currentTheme = () => DISCORD_THEMES[state.discordTheme] ?? DISCORD_THEMES[CONFIG.discord.defaultTheme];

    /** Images depend only on theme + legend, so they are cached between preview and send. */
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
    async function buildDiscordMessage(squad) {
        const themeId = DISCORD_THEMES[state.discordTheme] ? state.discordTheme : CONFIG.discord.defaultTheme;
        const theme = DISCORD_THEMES[themeId];

        let images = null;
        try {
            images = await Promise.all(squad.map(({ legend }) => getThemeImages(themeId, legend)));
        } catch (error) {
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

        return { payload, files, hasImages: images !== null };
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
        const url = state.webhook.trim();
        if (!url) return alert('Insert Discord webhook URL!');
        if (state.lastSquad.length === 0) return alert('Roll a squad first!');

        dom.discordBtn.disabled = true;
        try {
            const message = await buildDiscordMessage(state.lastSquad);
            const response = await fetch(url, { method: 'POST', ...toWebhookRequest(message) });
            alert(response.ok ? 'The squad has been sent to Discord!' : `Discord error: ${response.status}`);
        } catch {
            alert('Network error!');
        } finally {
            dom.discordBtn.disabled = false;
        }
    }

    // ---------------------------------------------------------------------
    // Discord: preview (renders exactly what will be sent)
    // ---------------------------------------------------------------------

    let previewUrls = [];
    let previewToken = 0;
    let previewTimer = null;

    /** Minimal Discord markdown for embed text: only **bold** is used by the themes. */
    function renderMarkdown(text) {
        return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(part =>
            (part.startsWith('**') && part.endsWith('**') ? h('strong', {}, part.slice(2, -2)) : part));
    }

    function renderEmbed(embed, fileUrls) {
        const fileUrl = field => (embed[field] ? fileUrls.get(embed[field].url.replace('attachment://', '')) : null);
        const thumbnail = fileUrl('thumbnail');
        const image = fileUrl('image');

        return h('div', { class: 'dc-embed' },
            h('div', { class: 'dc-embed-head' },
                h('div', { class: 'dc-embed-text' },
                    h('div', { class: 'dc-embed-title' }, embed.title),
                    embed.description ? h('div', { class: 'dc-embed-desc' }, ...renderMarkdown(embed.description)) : null,
                ),
                thumbnail ? h('img', { class: 'dc-embed-thumb', src: thumbnail, alt: '' }) : null,
            ),
            image ? h('img', { class: 'dc-embed-image', src: image, alt: '' }) : null,
        );
    }

    async function renderPreview() {
        const token = ++previewToken;

        if (state.lastSquad.length === 0) {
            dom.previewPanel.hidden = true;
            return;
        }
        dom.previewPanel.hidden = false;

        const message = await buildDiscordMessage(state.lastSquad);
        if (token !== previewToken) return;   // a newer preview has started meanwhile

        previewUrls.forEach(url => URL.revokeObjectURL(url));
        previewUrls = [];
        const fileUrls = new Map(message.files.map(({ name, blob }) => {
            const url = URL.createObjectURL(blob);
            previewUrls.push(url);
            return [name, url];
        }));

        const { payload } = message;
        dom.preview.replaceChildren(...[
            h('div', { class: 'dc-message' },
                h('img', { class: 'dc-avatar', src: CONFIG.discord.avatarPath, alt: '' }),
                h('div', { class: 'dc-body' },
                    h('div', { class: 'dc-header' },
                        h('span', { class: 'dc-username' }, payload.username),
                        h('span', { class: 'dc-app-tag' }, 'APP'),
                    ),
                    h('div', { class: 'dc-subtext' },
                        h('a', { href: getSourceUrl(), target: '_blank', rel: 'noopener' }, 'Apex Squad Randomizer'),
                    ),
                    ...payload.embeds.map(embed => renderEmbed(embed, fileUrls)),
                ),
            ),
            message.hasImages ? null : h('div', { class: 'dc-note' },
                'Images are unavailable when the page is opened as a local file — only text will be sent.'),
        ].filter(Boolean));
    }

    /** Debounced preview update (e.g. while typing a player name). */
    function schedulePreview(delay = 300) {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreview, delay);
    }

    function renderThemeSelect() {
        dom.discordTheme.replaceChildren(...Object.entries(DISCORD_THEMES).map(([id, theme]) =>
            h('option', { value: id, selected: id === state.discordTheme }, theme.label)));
        if (!DISCORD_THEMES[state.discordTheme]) state.discordTheme = CONFIG.discord.defaultTheme;
        dom.discordTheme.value = state.discordTheme;
    }

    // ---------------------------------------------------------------------
    // Event wiring
    // ---------------------------------------------------------------------

    function bindEvents() {
        // Player on/off
        dom.toggles.addEventListener('change', event => {
            if (!event.target.matches('.player-active')) return;
            const player = Number(event.target.dataset.player);
            state.active[player] = event.target.checked;
            playerCard(player).classList.toggle('disabled', !state.active[player]);
            persist.active();
        });

        // Player names
        dom.toggles.addEventListener('input', event => {
            if (!event.target.matches('.player-name')) return;
            const player = Number(event.target.dataset.player);
            state.names[player] = event.target.value.trim() || defaultName(player);
            playerCard(player).querySelector('.player-display-name').textContent = state.names[player];
            persist.names();
            renderResult();
            schedulePreview();
        });

        // Legends a player owns
        dom.players.addEventListener('change', event => {
            if (!event.target.matches('.legend-toggle')) return;
            const { player, legend } = event.target.dataset;
            const disabled = state.disabled[Number(player)];
            if (event.target.checked) disabled.delete(legend);
            else disabled.add(legend);
            persist.disabled();
            renderCooldowns();
        });

        dom.reserve.addEventListener('change', () => setReserve(dom.reserve.value));
        dom.resetHistory.addEventListener('click', resetHistory);

        dom.webhook.addEventListener('input', () => {
            state.webhook = dom.webhook.value;
            persist.webhook();
        });

        dom.discordTheme.addEventListener('change', () => {
            state.discordTheme = dom.discordTheme.value;
            persist.discordTheme();
            renderPreview();
        });

        dom.rollBtn.addEventListener('click', roll);
        dom.discordBtn.addEventListener('click', sendToDiscord);
    }

    // ---------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------

    function init() {
        dom.reserve.value = state.reserve;
        dom.webhook.value = state.webhook;
        renderThemeSelect();
        renderPlayerToggles();
        renderPlayerCards();
        renderCooldowns();
        renderResult();
        bindEvents();
    }

    init();
})();