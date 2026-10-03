# Apex Legends Squad Randomizer

A tiny static web app that rolls a random legend for every player in an Apex Legends squad
and can post the result to a Discord channel.

**▶ Open the randomizer: https://rayderua.github.io/apex-legends-squad-randomizer/**

No build step, no backend, no dependencies — just open `index.html` or host the folder anywhere
(GitHub Pages works great).

## Features

- **Up to 3 players** — rename a player right in the card header, the switch turns them on/off.
- **Per-player legend pool** — click a portrait to mark legends a player doesn't own (or doesn't want to play).
- **No duplicates in a squad** — two players never get the same legend.
- **No-repeat window** — a player won't get the same legend again too soon (see below).
- **Clear tile states**
  - full colour — available;
  - grey with a number — rolled recently, the number shows how many rolls until it's back in the pool;
  - dark with a grey "no entry" sign — not in the player's pool;
  - red outline — rolled in the last roll.
- **Discord webhook** — sends the result: one card per player with an image of the legend select screen
  where the rolled legend is highlighted, so it's easy to find in game. Two themes, with a live preview.
- **One-click flow** — set up players and a theme once, then just *Randomize → Send to Discord*.
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
- Reserve and **↺ Reset history** are in the settings (⚙ in the top bar).
- Unticking a legend doesn't break the guarantee: history only counts legends that are currently in the pool.

## Discord

1. In Discord: *Server Settings → Integrations → Webhooks → New Webhook*, choose a channel, *Copy Webhook URL*.
2. Open the settings (⚙ in the top bar) and paste the URL into **Discord webhook URL**.
3. Pick a look with **🎨 Theme** — it shows a preview of every theme; click one to select it.
4. Roll a squad and press **Send to Discord** — it's sent right away with the selected theme.

The **🎨 Theme** window shows each theme as it will look in Discord (same images and sizes),
using your last roll or a sample legend.

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
index.html            page shell (the UI itself is rendered by app.js)
static/js/app.js      all logic: config, state, randomizer, UI, Discord
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
