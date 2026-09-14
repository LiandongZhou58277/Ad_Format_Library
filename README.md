# NewsBreak Ad Format Library

An internal web app for cataloging the ad formats running across NewsBreak's apps. Anyone on the team can browse formats, drill into variants and specs, and add or edit formats with screenshots and videos.

## What it does

- **Browse & search** a gallery of ad formats, filterable by placement (Feed, Article, Full screen, Video / Rewards, Other) and status (Live, Beta, In development, Deprecated).
- **Format detail pages** with description, owning team, platforms, and a media gallery.
- **Variants** under each format — capture dimensions, aspect ratio, file types, max file size, duration, behavior/interaction, placement, and status for every size/treatment.
- **Media uploads** — attach screenshots and videos at the format or variant level; pick a cover image; view full size in a lightbox.
- **Everyone can edit** — no login. Add, edit, and delete formats, variants, and media directly in the UI.

## Tech stack

- **Backend:** Node.js + Express
- **Storage:** a single JSON file at `data/library.json` (no database server, no native build — installs and runs anywhere Node does)
- **Uploads:** `multer`, stored on disk in `uploads/`
- **Frontend:** plain HTML/CSS/JS (no build step)

> The JSON store keeps setup zero-friction for an internal tool. If the library grows large or you need heavy concurrent writes, the storage layer is isolated in `store.js` and can be swapped for SQLite/Postgres without touching the API or frontend.

## Run it locally

Requires Node.js 18+.

```bash
npm install        # install dependencies
npm run seed       # (optional) load a starter set of NewsBreak formats
npm start          # start the server
```

Then open http://localhost:3000.

Use `npm run dev` for auto-restart while editing the server.

## Project structure

```
server.js        Express app + REST API
store.js         JSON-file data store (formats, variants, media)
seed.js          Optional starter data
public/          Frontend (index.html, styles.css, app.js)
uploads/         Uploaded screenshots & videos  (gitignored)
data/            library.json data file          (gitignored)
```

## API overview

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET    | `/api/meta` | Categories & statuses |
| GET    | `/api/formats` | List formats (with cover + variant count) |
| GET    | `/api/formats/:id` | Format detail with variants & media |
| POST   | `/api/formats` | Create format |
| PUT    | `/api/formats/:id` | Update format |
| DELETE | `/api/formats/:id` | Delete format (cascades) |
| POST   | `/api/formats/:id/variants` | Add variant |
| PUT    | `/api/variants/:id` | Update variant |
| DELETE | `/api/variants/:id` | Delete variant |
| POST   | `/api/formats/:id/media` | Upload media (multipart `files[]`, optional `variant_id`) |
| PUT    | `/api/media/:id/cover` | Set a media item as the format cover |
| DELETE | `/api/media/:id` | Delete a media item |

## Deploying for the team

The app is a standard Node server, so it runs anywhere Node does. A few options:

- **Render / Railway / Fly.io:** point it at this repo, set the start command to `npm start`. Attach a persistent disk/volume mounted at the project root so `data/` (database) and `uploads/` (media) survive restarts.
- **Internal VM / container:** run `npm install && npm start` behind a reverse proxy (nginx/Caddy). Set the `PORT` env var if needed.
- **Docker:** a minimal `node:20-slim` image works; persist `data/` and `uploads/` as volumes.

Two things to keep in mind when deploying:

1. **Persist `data/` and `uploads/`.** They hold the `library.json` data file and uploaded media. On ephemeral filesystems (most PaaS), mount a volume or they'll reset on each deploy.
2. **No auth is built in.** It's designed for internal trusted use ("everyone can edit"). If exposed beyond the team, put it behind your SSO/VPN or a reverse-proxy auth layer. For larger media volumes, consider moving uploads to S3/GCS.

## Notes

- File uploads are capped at 200MB each; images and videos only.
- Deleting a format removes its variants and media (files on disk are cleaned up too).
