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

        discord: {
            username: 'Apex Squad Bot',
            avatarPath: 'static/images/ApexIcon.png',
            embedColor: 0xFF4B4B,
            // Layout of the emoji "class grid" shown in each embed
            gridRows: [['Assault', 'Skirmisher'], ['Recon', 'Support', 'Controller']],
            gridIndent: '⬛⬛⬛',
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
        lastSquad: [],   // [{ player, legend }]
    };

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
    // Discord
    // ---------------------------------------------------------------------

    /** Base URL of the page (directory), used for absolute image links. */
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

    /** Emoji grid with the selected legend highlighted inside its class. */
    function buildClassGrid(selectedLegend) {
        const { gridRows, gridIndent } = CONFIG.discord;
        const buildRow = classes => classes
            .map(cls => CONFIG.classes[cls].map(legend => (legend === selectedLegend ? '🟩' : '✖️')).join(''))
            .join('⬛');

        const [firstRow, ...otherRows] = gridRows;
        const lines = [gridIndent + buildRow(firstRow) + gridIndent, ...otherRows.map(buildRow)];
        return '```\n' + lines.join('\n') + '\n```';
    }

    function buildDiscordPayload(squad) {
        const baseUrl = getBaseUrl();
        const sourceUrl = getSourceUrl();

        // <url> inside a masked link prevents Discord from adding a link preview
        const sourceLinks = sourceUrl === CONFIG.repoUrl
            ? `🎲 Rolled with [Apex Squad Randomizer](<${CONFIG.repoUrl}>)`
            : `🎲 Rolled with [Apex Squad Randomizer](<${sourceUrl}>) · [source code](<${CONFIG.repoUrl}>)`;

        return {
            username: CONFIG.discord.username,
            avatar_url: baseUrl + CONFIG.discord.avatarPath,
            content: `🚀 **NEW TEAM HAS BEEN FORMED!**\n${sourceLinks}`,
            embeds: squad.map(({ player, legend }) => ({
                title: state.names[player],
                description: `Selected Legend: **${legend}**\n${buildClassGrid(legend)}`,
                color: CONFIG.discord.embedColor,
                thumbnail: { url: baseUrl + legendImage(legend) },
            })),
        };
    }

    async function sendToDiscord() {
        const url = state.webhook.trim();
        if (!url) return alert('Insert Discord webhook URL!');
        if (state.lastSquad.length === 0) return alert('Roll a squad first!');

        dom.discordBtn.disabled = true;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildDiscordPayload(state.lastSquad)),
            });
            alert(response.ok ? 'The squad has been sent to Discord!' : `Discord error: ${response.status}`);
        } catch {
            alert('Network error!');
        } finally {
            dom.discordBtn.disabled = false;
        }
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

        dom.rollBtn.addEventListener('click', roll);
        dom.discordBtn.addEventListener('click', sendToDiscord);
    }

    // ---------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------

    function init() {
        dom.reserve.value = state.reserve;
        dom.webhook.value = state.webhook;
        renderPlayerToggles();
        renderPlayerCards();
        renderCooldowns();
        renderResult();
        bindEvents();
    }

    init();
})();