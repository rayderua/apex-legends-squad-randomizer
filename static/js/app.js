const CONFIG = {
        classes: {
            "Assault": ["Bangalore", "Revenant", "Fuse", "Mad Maggie", "Ballistic"],
            "Skirmisher": ["Pathfinder", "Wraith", "Octane", "Horizon", "Ash", "Alter", "Axle"],
            "Recon": ["Bloodhound", "Crypto", "Valkyrie", "Seer", "Vantage", "Sparrow"],
            "Support": ["Gibraltar", "Lifeline", "Mirage", "Loba", "Newcastle", "Conduit"],
            "Controller": ["Caustic", "Wattson", "Rampart", "Catalyst"],
        },
        classIcons: { "Assault": "⚡", "Skirmisher": "🚀", "Recon": "👁", "Support": "✚", "Controller": "⭖" }
    };

    let playerNames = JSON.parse(localStorage.getItem('apex_names')) || ["P1", "P2", "P3"];
    let activePlayers = JSON.parse(localStorage.getItem('apex_active')) || [true, true, true];
    let lastSquad = [];
    let lastActiveIdxs = [];

    function getLegendImg(name) {
        const fileName = name.replace(/ /g, "_");
        return `static/images/Portrait_${fileName}_square.png`;
    }

    function saveWebhook() {
        localStorage.setItem('apex_webhook', document.getElementById('webhook-url').value);
    }

    function togglePlayer(id) {
        const idx = parseInt(id.slice(-1)) - 1;
        activePlayers[idx] = document.getElementById(`active-${id}`).checked;
        document.getElementById(`card-${id}`).classList.toggle('disabled', !activePlayers[idx]);
        localStorage.setItem('apex_active', JSON.stringify(activePlayers));
    }

    function updateNames() {
        ["p1", "p2", "p3"].forEach((id, i) => {
            playerNames[i] = document.getElementById(`name-${id}`).value || id;
            document.getElementById(`disp-${id}`).innerText = playerNames[i];
        });

        localStorage.setItem('apex_names', JSON.stringify(playerNames));
    }

    document.getElementById('webhook-url').value = localStorage.getItem('apex_webhook') || "";

    const container = document.getElementById('players-container');

    ["p1", "p2", "p3"].forEach((id, i) => {
        document.getElementById(`name-${id}`).value = playerNames[i];
        document.getElementById(`active-${id}`).checked = activePlayers[i];
        let html = `<div class="player-card ${activePlayers[i] ? '' : 'disabled'}" id="card-${id}"><h2 class="player-display-name" id="disp-${id}">${playerNames[i]}</h2>`;
        for (const [cls, members] of Object.entries(CONFIG.classes)) {
            html += `<div class="class-group"><div class="class-header"><span>${CONFIG.classIcons[cls]}</span> ${cls}</div><div class="legend-grid">`;
            members.forEach(m => html += `<label class="legend-opt"><input type="checkbox" name="${id}" value="${m}" checked><img src="${getLegendImg(m)}" title="${m}"></label>`);
            html += `</div></div>`;
        }
        container.innerHTML += html + `</div>`;
    });

    // Сколько легенд из пула игрока всегда остаются доступными.
    // Из N отмеченных легенд гарантируется N-reserve разных подряд (13, reserve 5 -> 8).
    const DEFAULT_RESERVE = 5;
    let historyReserve = parseInt(localStorage.getItem('apex_reserve'));
    if (isNaN(historyReserve)) historyReserve = DEFAULT_RESERVE;
    const HISTORY_MAX = 100;
    let rollHistory = JSON.parse(localStorage.getItem('apex_history')) || [[], [], []];

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Легенды, которые игроку сейчас нельзя выпадать (последние N-5-1 его роллов)
    function getBlocked(playerIdx, pool) {
        const window = pool.length - historyReserve;   // столько разных подряд
        const block = Math.max(0, window - 1);           // столько последних исключаем
        if (!block) return new Set();
        const recent = rollHistory[playerIdx].filter(n => pool.includes(n));
        return new Set(recent.slice(-block));
    }

    function pickSquad(pools, idxs) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const result = new Array(pools.length);
            const taken = new Set();
            let ok = true;
            // случайный порядок игроков, чтобы никто не имел приоритета
            for (const k of shuffle(pools.map((_, i) => i))) {
                const blocked = getBlocked(idxs[k], pools[k]);
                let candidates = pools[k].filter(n => !taken.has(n) && !blocked.has(n));
                // запасной вариант (только при очень маленьких/пересекающихся пулах)
                if (!candidates.length) candidates = pools[k].filter(n => !taken.has(n));
                if (!candidates.length) { ok = false; break; }
                result[k] = candidates[Math.floor(Math.random() * candidates.length)];
                taken.add(result[k]);
            }
            if (ok) return result;
        }
        return null;
    }

    function getPool(playerIdx) {
        return Array.from(document.querySelectorAll(`input[name="p${playerIdx+1}"]:checked`)).map(i => i.value);
    }

    // Подсвечивает серым легенд, которые сейчас на "кулдауне" и не участвуют в рандоме
    function refreshBlocked() {
        [0, 1, 2].forEach(p => {
            const blocked = getBlocked(p, getPool(p));
            document.querySelectorAll(`input[name="p${p+1}"]`).forEach(inp => {
                inp.closest('.legend-opt').classList.toggle('blocked', inp.checked && blocked.has(inp.value));
            });
        });
    }

    function saveReserve() {
        const el = document.getElementById('history-reserve');
        let v = parseInt(el.value);
        if (isNaN(v) || v < 0) v = 0;
        el.value = v;
        historyReserve = v;
        localStorage.setItem('apex_reserve', v);
        refreshBlocked();
    }

    function resetHistory() {
        rollHistory = [[], [], []];
        localStorage.removeItem('apex_history');
        refreshBlocked();
    }

    document.getElementById('history-reserve').value = historyReserve;
    container.addEventListener('change', refreshBlocked);
    refreshBlocked();

    async function startRoulette() {
        const btn = document.getElementById('rollBtn');
        const discBtn = document.getElementById('discordBtn');
        lastActiveIdxs = activePlayers.map((v, i) => v ? i : null).filter(v => v !== null);
        if (!lastActiveIdxs.length) return alert("Choose at least one player!");

        const pools = lastActiveIdxs.map(getPool);
        if (pools.some(p => !p.length)) return alert("Choose at least one legend!");

        btn.disabled = true;
        discBtn.style.display = 'none';

        const final = pickSquad(pools, lastActiveIdxs);

        if (final) {
            final.forEach((legend, k) => {
                const h = rollHistory[lastActiveIdxs[k]];
                h.push(legend);
                if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
            });
            localStorage.setItem('apex_history', JSON.stringify(rollHistory));
            refreshBlocked();

            lastSquad = final;
            updateResultUI(final, lastActiveIdxs, 1);
            discBtn.style.display = 'block';
        } else {
            alert("Can't build a squad without duplicates!");
        }

        btn.disabled = false;
    }

    function updateResultUI(sq, idxs, op) {
        document.getElementById('result').innerHTML = sq.map((n, i) => `
            <div class="res-item" style="opacity: ${op}">
                <img src="${getLegendImg(n)}">
                <div class="res-name">${n}</div>
                <div style="font-size: 7px; color: #444; margin-top: 1px;">${playerNames[idxs[i]]}</div>
            </div>`).join('');
    }

    function getAbsoluteUrl() {
        const baseUrl = window.location.href.split('#')[0].split('?')[0];
        const cleanBase = baseUrl.endsWith('/') ? baseUrl : baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
        return `${cleanBase}`;
    }

    function getAbsoluteImgUrl(name) {
        return `${getAbsoluteUrl()}${getLegendImg(name)}`;
    }

    function generateVisualGrid(selectedLegend) {
        const row1Classes = ["Assault", "Skirmisher", ];
        const row2Classes = ["Recon", "Support", "Controller"];

        const buildRow = (classList) => {
            return classList.map(cls => {
                const members = CONFIG.classes[cls];
                const icons = members.map(legend => (legend === selectedLegend ? "🟩" : "✖️"));

                return icons.join("");
            }).join("⬛");
        };
        const s_indent = "⬛⬛⬛";
        const e_indent = "⬛⬛⬛";
        const line1 = s_indent + buildRow(row1Classes) + e_indent;
        const line2 = buildRow(row2Classes);

        return `\`\`\`\n${line1}\n${line2}\n\`\`\``;
    }


    async function sendToDiscord() {
        const url = document.getElementById('webhook-url').value;
        if (!url) return alert("Insert discord webhook URL!");

        const btn = document.getElementById('discordBtn');
        btn.disabled = true;

       const embeds = lastSquad.map((legendName, i) => ({
            title: playerNames[lastActiveIdxs[i]],
            description: `Selected Legend: **${legendName}**\n${generateVisualGrid(legendName)}`,
            color: 16730955,
            thumbnail: {
                url: getAbsoluteImgUrl(legendName)
            }
        }));
        const avatar_url = getAbsoluteUrl()

        const payload = {
            username: "Apex Squad Bot",
            content: "🚀 **NEW TEAM HAS BEEN FORMED!**",
            avatar_url: getAbsoluteUrl() + "static/images/ApexIcon.png",
            embeds: embeds
        };

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (resp.ok) alert("The composition has been sent to Discord!");
            else alert("Error Discord: " + resp.status);
        } catch (e) { alert("Network error!"); }
        btn.disabled = false;
    }