# CrowdFeed

CrowdFeed turns the time people spend waiting in a queue into a short, rewarded feedback session for the venue they are queueing at. The venue places a QR code or an NFC tag where people wait. Scanning it opens a survey of five to eight questions that adapt to the type of venue, the time of day, the person's optional profile and the answers already given. On completion the app issues a signed QR coupon that staff validate once at the counter, and the venue reads the results on a dashboard.

The first CrowdFeed was built and evaluated at the Lahore University of Management Sciences in 2016 as a native Android notification app paired with a PHP survey site. This repository is the web-native rebuild. It is a progressive web app with a small Node.js backend, so there is nothing to install from an app store, it works from a link, it can be added to the home screen, saved rewards are available offline, and venues reach past participants through Web Push.

## What is in the box

- Participant app at `/`. Scan or tap to open a venue, confirm presence by location once (optional), answer the adaptive questions, receive a QR coupon, keep it under My rewards, opt in to notifications from that venue.
- Venue dashboard at `/admin`. Venues, question bank with follow-up rules, results with charts and CSV export, QR poster generator, push invitations to subscribers.
- Staff scanner at `/scan`. Reads coupon QR codes with the camera and marks them used, protected by a per-venue PIN. Scanning a coupon with an ordinary camera app also works, since the QR encodes a page that shows the status and offers the PIN form.
- Backend in `server/`. Express 5, SQLite through libsql (local file or hosted Turso), Web Push, HMAC-signed coupons, rate limits and a strict content security policy.

## How the survey adapts

Questions live in a bank per venue type (restaurant, cafe, grocery, clothing, shoes, pharmacy, bank, general) and can be overridden per venue. Each question has a priority, an answer type and optional conditions. Conditions can restrict a question to a gender, an age band, a visit frequency, a time of day or a presence state, and `requires` rules make a question a follow-up to an earlier answer, for example

```json
{ "requires": [ { "key": "taste", "op": "<=", "value": 2 } ] }
```

After every answer the server drops questions that are not eligible, then scores the rest by priority, gives a large boost to a follow-up whose trigger was the answer just given, penalises repeating the previous answer type so short sessions stay varied, and slightly favours questions that have been asked less often across all respondents. The best scoring question is served next. The procedure is in `server/engine.js` and is covered by unit tests.

The nine answer types are the ones from the original study: single choice list, segmented control, ranking, stars, smileys, 0 to 10 slider, smiley slider, thumbs up or down and free text.

## Running it locally

Requirements are Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. The database is created at `data/crowdfeed.db` and seeded with three venues (PDC, Jammin Java, Super Store, the venues of the 2016 study) and the question bank. The development admin password is `admin` and the staff PIN of the seeded venues is `1234`. Push notifications stay off until VAPID keys are set.

Camera and geolocation need a secure context, so on a phone use HTTPS or a tunnel such as `npx localtunnel --port 3000` while testing.

## Deploying

Set these variables on any host.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` makes the secrets below mandatory and turns on HSTS and secure cookies |
| `BASE_URL` | public origin written into QR codes and notifications |
| `ADMIN_PASSWORD`, `SESSION_SECRET`, `COUPON_SECRET` | long random strings |
| `DATABASE_URL` | `file:data/crowdfeed.db` on a host with a disk, or a `libsql://` Turso URL plus `DATABASE_AUTH_TOKEN` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys, create them with `npm run vapid` |

Three ways that have been set up here.

**Render (free tier) with Turso.** Render's free web services have no persistent disk, so the database goes to Turso, which is also free at this scale. Create a database at turso.tech, copy its URL and a token, then in Render choose New, Blueprint, point it at this repository and fill in the `sync: false` variables from `render.yaml`. After the first deploy set `BASE_URL` to the address Render gave you. Free services sleep after fifteen minutes of inactivity and take a few seconds to wake, which matters for people in a queue; a free uptime monitor pinging `/api/config` every ten minutes keeps it awake.

**Fly.io with a volume.** `fly launch --copy-config --no-deploy`, `fly volumes create crowdfeed_data --size 1`, `fly secrets set ADMIN_PASSWORD=... SESSION_SECRET=... COUPON_SECRET=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... BASE_URL=https://crowdfeed.fly.dev`, then `fly deploy`. The SQLite file lives on the volume.

**Azure App Service (works with Azure for Students).** Create a Web App with Publish set to Code, runtime Node 22 LTS, operating system Linux and region North Europe, on the Free F1 plan to try it out or Basic B1 for Always On. Under Deployment connect the GitHub repository and branch; Azure adds a GitHub Actions workflow that builds and deploys on every push. Under Settings, Environment variables, add the variables from the table above with `DATABASE_URL=file:/home/data/crowdfeed.db` (the `/home` folder of an App Service persists across restarts and deployments), `TRUST_PROXY=true` and `SCM_DO_BUILD_DURING_DEPLOYMENT=true`, then set `BASE_URL` to the hostname Azure gave the app. Turn on HTTPS Only under Configuration. The F1 plan sleeps after twenty minutes without visitors and has a daily CPU quota; B1 removes both and costs about thirteen dollars a month, which the student credit covers.

**Docker or a plain Linux box.** `docker build -t crowdfeed . && docker run -p 3000:3000 --env-file .env -v crowdfeed-data:/app/data crowdfeed`, or run `node server/index.js` under systemd behind any reverse proxy that terminates TLS.

## Setting up a venue

1. Sign in at `/admin` and add the venue with its coordinates, the reward and a staff PIN. The venue type decides which question templates apply; add venue-specific questions on the Questions tab if needed.
2. Open the QR poster from the venue's form, print it and place it where people wait. The same address can be written to an NFC tag with any tag-writer app.
3. Give staff the PIN. They open `/scan` on any phone, enter the PIN once per shift and scan coupons.
4. Once people have opted in, send an invitation from the Notify tab when a reward survey is open.

## Data and privacy

The server stores answers, the venue, the time of day, the device class and connection type, the display mode (browser or installed), and the optional age band, gender and visit frequency. When a participant agrees to share location, only the presence result and the distance to the venue in metres are kept, never the coordinates. No names, emails or phone numbers are collected. Coupons are stored on the participant's phone and on the server by code. Push subscriptions are kept per venue until withdrawn. The privacy notice shown to participants is at `/privacy`.

## Notes on browser capabilities

The web platform cannot watch location while the app is closed, so the silent geofence trigger of the 2016 Android app has no direct equivalent. CrowdFeed replaces it with triggers the venue controls, a QR code or NFC tag at the queue and push invitations to people who opted in, and confirms presence with a single foreground geolocation reading when the survey starts. Web Push works in Chrome, Edge, Firefox and Samsung Internet on Android, and on iPhone from iOS 16.4 once the app has been added to the home screen. QR scanning inside the app uses the BarcodeDetector API where available and falls back to the bundled jsQR decoder.

## Development

`npm test` runs the unit tests for the selection engine and the coupon codes. `npm run simulate [venueType] [respondents] [seed]` replays the engine over the seeded bank with synthetic respondents and prints how each scoring term changes the sessions; `npm run simulate restaurant 2000 2016` reproduces the table in the paper. `npm run dev` restarts the server on changes. Third-party browser libraries are vendored under `public/vendor` with their licences.

## Licence

MIT, see `LICENSE`.
