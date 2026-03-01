    const CONFIG = {
        classes: {
            "Assault": ["Bangalore", "Revenant", "Fuse", "Mad Maggie", "Ballistic"],
            "Skirmisher": ["Pathfinder", "Wraith", "Octane", "Horizon", "Ash", "Alter"],
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
        fileName = name.replace(/ /g, "_");
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

    async function startRoulette() {
        const btn = document.getElementById('rollBtn');
        const discBtn = document.getElementById('discordBtn');
        lastActiveIdxs = activePlayers.map((v, i) => v ? i : null).filter(v => v !== null);
        if (!lastActiveIdxs.length) return alert("Choose at least one player!");

        const pools = lastActiveIdxs.map(idx => Array.from(document.querySelectorAll(`input[name="p${idx+1}"]:checked`)).map(i => i.value));
        if (pools.some(p => !p.length)) return alert("Choose at least one legend!");

        btn.disabled = true;
        discBtn.style.display = 'none';

        let final = null;
        for (let j = 0; j < 500; j++) {
            let attempt = pools.map(p => p[Math.floor(Math.random()*p.length)]);
            if (new Set(attempt).size === attempt.length) { final = attempt; break; }
        }

        if (final) {
            lastSquad = final;
            updateResultUI(final, lastActiveIdxs, 1);
            discBtn.style.display = 'block';
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

    function getAbsoluteImgUrl(name) {
        const baseUrl = window.location.href.split('#')[0].split('?')[0];
        const cleanBase = baseUrl.endsWith('/') ? baseUrl : baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
        return `${cleanBase}${getLegendImg(name)}`;
    }

    async function sendToDiscord() {
        const url = document.getElementById('webhook-url').value;
        if (!url) return alert("Insert discord webhook URL!");

        const btn = document.getElementById('discordBtn');
        btn.disabled = true;

       const embeds = lastSquad.map((legendName, i) => ({
            title: playerNames[lastActiveIdxs[i]],
            description: `Selected Legend: **${legendName}**`,
            color: 16730955,
            thumbnail: {
                url: getAbsoluteImgUrl(legendName)
            }
        }));

        const payload = {
            username: "Apex Squad Bot",
            content: "🚀 **NEW TEAM HAS BEEN FORMED!**",
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
