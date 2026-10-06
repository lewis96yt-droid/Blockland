# Blockland Classic (online)

A 2008-style blocky third-person game that runs in the browser. One small Node.js server serves the page and connects every player together, so anyone with the link can join.

```
blockland-online/
  server.js        web server + WebSocket game server
  package.json
  public/
    index.html     the game (three.js loads from a CDN)
```

## 1. Try it on your own computer

You need [Node.js](https://nodejs.org) 18 or newer.

```
cd blockland-online
npm install
npm start
```

Open http://localhost:3000 in two browser tabs. You should see the top bar say "Online - 2 players" and each tab's character appear in the other.

Friends on the same Wi-Fi can join with `http://YOUR-COMPUTER-IP:3000`.

## 2. Put it on the internet

You need a host that can run a long-lived Node.js process and supports WebSockets. Static-only hosts (GitHub Pages, plain Netlify, etc.) will **not** work, because the game needs the server.

The steps are almost the same on any host (Render, Railway, Fly.io, a VPS):

1. Put this folder in a GitHub repository.
2. Create a new "Web Service" (or equivalent) on the host and connect that repository.
3. Set the build command to `npm install` and the start command to `npm start`.
4. Deploy. The host gives you a public https:// address. Share it with anyone.

The game automatically uses `wss://` on https sites, so there is nothing to configure. The server reads the port from the `PORT` environment variable, which hosts set for you.

Free plans often put the app to sleep when nobody is using it, so the first visitor may wait about a minute while it wakes up. Check your host's current plan limits before you rely on it.

## Settings (optional environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 3000 | Port to listen on (hosts set this) |
| `MAX_PLAYERS` | 50 | Most players at once. Extra visitors play solo. |
| `MAX_PER_IP` | 8 | Most connections from one IP address |

## What the server checks

- Names are limited to 16 letters, numbers, spaces, dots, dashes and underscores.
- Chat is limited to 100 characters, with control characters removed, and one message per second per player. There is **no word filter**, so players can type anything. The game page shows chat as plain text, so it can't inject code.
- Positions are clamped to the map, and position updates faster than about 40 per second are ignored.
- Connections that go silent are dropped automatically.

## Good to know

- **Cheating:** each browser reports its own position and points, so a technical player could fake them. That's fine for a casual game but not for competitive ones. Making the server decide positions and coins would be the next step.
- **Moderation:** with open public chat and no filter, you may want to keep an eye on it. A word filter can be added in one place: the `chat` case in `server.js`.
- **Coins** are per player and not shared.
- **Players walk through each other** (no player collision).
- Everything lives in memory. If the server restarts, everyone reconnects automatically within a few seconds.

## Controls

W A S D / arrows to move, Space to jump, drag with the mouse to look, scroll to zoom, `/` or Enter to chat, Esc for the menu.
