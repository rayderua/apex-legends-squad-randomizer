# Apex Legends Squad Randomizer

A tiny static web app that rolls a random legend for every player in an Apex Legends squad
and can post the result to a Discord channel.

**▶ Open the randomizer: https://rayderua.github.io/apex-legends-squad-randomizer/**

No build step, no backend, no dependencies — just open `index.html` or host the folder anywhere
(GitHub Pages works great).

## Features

- **Up to 3 players** — each can be switched on/off and renamed.
- **Per-player legend pool** — untick the legends a player doesn't own (or doesn't want to play).
- **No duplicates in a squad** — two players never get the same legend.
- **No-repeat window** — a player won't get the same legend again too soon (see below).
- **Clear tile states**
  - full colour, red border — available;
  - grey with a number — rolled recently, the number shows how many rolls until it's back in the pool;
  - dark with a grey "no entry" sign — not in the player's pool.
- **Discord webhook** — sends the result: one card per player with an image of the legend select screen
  where the rolled legend is highlighted, so it's easy to find in game. Two themes, with a live preview.
- **Everything is saved locally** in the browser (`localStorage`): names, active players, legend pools,
  reserve, roll history and the webhook URL.

## How the no-repeat window works

Each player has their own roll history. With **N** legends in a player's pool and a **Reserve** of **R**,
any **N − R** consecutive rolls for that player are guaranteed to be different legends.

| Legends in pool (N) | Reserve (R) | Different legends in a row |
|---------------------|-------------|----------------------------|
| 13                  | 5           | 8                          |
| 28 (all)            | 5           | 23                         |
| 10                  | 8           | 2                          |
| ≤ R + 1             | any         | no restriction             |

- **Reserve** is the number of legends that always stay available — a higher value means more randomness,
  a lower value means more rotation.
- **↺** resets the roll history for all players.
- Unticking a legend doesn't break the guarantee: history only counts legends that are currently in the pool.

## Discord

1. In Discord: *Server Settings → Integrations → Webhooks → New Webhook*, choose a channel, *Copy Webhook URL*.
2. Paste the URL into the **Discord Webhook URL** field.
3. Roll a squad and press **SEND TO DISCORD**.

Choose how the message looks with the **Discord theme** selector next to the webhook field.
After a roll, the **Discord preview** panel shows exactly what will be sent with the selected theme
(same images, same sizes as in Discord).

| Theme | Card text | Image |
|-------|-----------|-------|
| **Compact** | player name, legend in bold | grey schematic of the select screen with the legend's slot in red + the legend's class with large portraits |
| **Detailed** | `Player: Legend` | the whole select screen with portraits, grey grid, the legend highlighted |

Discord shrinks embed images to ~400px wide, so *Compact* is easier to read on phones,
while *Detailed* shows the exact in-game layout.

If the page is opened directly from a file (`file://`), browsers block exporting the canvas,
so the message is sent as text only. Host the page (GitHub Pages, or `python -m http.server` locally)
to get the images.

The images follow `CONFIG.classes` and `CONFIG.selectScreenRows` in `static/js/app.js`. When a new season
changes the order on the in-game select screen, update the config so the highlight stays accurate.

> The webhook URL is stored only in your browser, but anyone who has it can post to the channel —
> don't share it.

## Project structure

```
index.html            page markup
static/js/app.js      all logic: config, state, randomizer, rendering, Discord
static/css/style.css  styles
static/images/        legend portraits (Portrait_<Name>_square.png) and the app icon
```

## Adding a new legend

1. Add the name to the right class in `CONFIG.classes` at the top of `static/js/app.js`.
2. Put a square portrait into `static/images/` named `Portrait_<Name>_square.png`
   (spaces become underscores, e.g. `Mad Maggie` → `Portrait_Mad_Maggie_square.png`).

New legends are enabled for all players automatically.

## Deployment

Push to GitHub and enable *Settings → Pages → Deploy from a branch → `main` / root*.
The site is published at https://rayderua.github.io/apex-legends-squad-randomizer/

JS and CSS are loaded with a unique `?v=` query string on every page load, so a new release is picked
up immediately — there's no need to rename files. Only `index.html` itself may be cached by GitHub Pages
for a few minutes.

## License

No license specified yet.