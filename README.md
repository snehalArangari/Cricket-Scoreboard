# 🏏 Cricket Live

Real-time cricket scoring. One person scores from their phone; anyone with the
share link watches the score update live.

React + TypeScript + Tailwind v4 · Node + Express + Socket.IO · MongoDB Atlas.

---

## The one idea worth knowing

**The list of balls is the only source of truth.** Every total, every batting
card and every bowling card is re-derived by folding over that list from
scratch, on every single change. Nothing is incrementally mutated.

That one property is what makes undo, edit and delete correct — and it is why
the live viewer can never drift out of sync. It is also why the server
broadcasts **complete state** rather than deltas: correcting a mistake makes the
score go *down*, and a delta cannot express that safely.

The match status (`innings1 → innings1-complete → innings2 → complete`) is
derived the same way, so undoing the ball that ended a match correctly reopens it.

## Features

**Scoring**
- Quick taps for 0/1/2/3/4/6, wicket, wide, no ball, dead ball
- A composer for anything awkward — delivery type, runs and wicket are three
  independent axes, so a no-ball hit for six, a stumping off a wide, or a run-out
  on the second run of a no-ball all just work
- Undo, plus edit or delete any ball in the current over
- Overs are stored as integer legal-ball counts, never decimals (14.3, not 14.5)

**Players**
- Named squads per team; every ball records striker, non-striker and bowler
- Automatic strike rotation — odd runs, end of over, and a new batter taking the
  dismissed batter's end
- Batting card: runs, balls, 4s, 6s, strike rate
- Bowling card: overs, maidens, runs, wickets, economy

**Live**
- Share one link; unlimited read-only viewers
- Viewers joining mid-innings or after the match ends get full state immediately
- Server is authoritative; the scorer applies optimistically so taps never wait
  on the network
- Offline: balls queue locally and replay on reconnect, and replays are
  idempotent so nothing double-counts

## Running locally

```bash
npm install
cp .env.example .env          # then put your Atlas URI in it
npm run dev                   # server on :3000, client on :5173
```

Open http://localhost:5173.

| Route | |
|---|---|
| `/` | Set up a match |
| `/score/:matchId` | Score it (needs the token, stored on the creating device) |
| `/live/:matchId` | Watch it — this is the link you share |

## Tests

```bash
npm test                      # 93 engine assertions, no server needed
npm start                     # in one terminal
npx tsx scripts/e2e.ts        # in another: 27 live socket checks
```

The engine suite covers the cricket edge cases; the e2e suite covers the socket
protocol, scorer/viewer authorisation, live propagation, and the score-goes-down
case that the whole full-state design exists for.

## Deploying

One service serves the API, the SPA and the WebSocket on the same origin, which
removes CORS, API base URLs and websocket-origin issues entirely.

**MongoDB Atlas (free M0)** — create a cluster and a database user, then set
Network Access to `0.0.0.0/0` (free hosts have no static IP, so there is nothing
narrower to allowlist). Two things that bite people: use an alphanumeric-only
password, and put the database name in the path *before* the `?` — omit it and
Mongo silently writes to a database called `test`.

**Render (free)** — `render.yaml` is committed. Build
`npm install --include=dev && npm run build`, start `npm start`, and set
`MONGODB_URI` in the dashboard. `--include=dev` matters: Render sets
`NODE_ENV=production`, which prunes devDependencies, and Vite lives there.

Free instances sleep after ~15 minutes idle, so the first load of the day can
take up to a minute. During a match the socket traffic keeps it awake.

## Not in this version

Wicket-type taxonomy (only "who is out" and "does the bowler get credit", which
is the minimum for correct cards), byes and leg-byes, free hits, commentary,
tournaments and points tables, and user accounts.

The previous single-file prototype is kept at `legacy/index-v1.html` for reference.
