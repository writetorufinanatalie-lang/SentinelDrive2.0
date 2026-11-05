# SentinelDrive (Hackathon edition)

Installable app with English, Tamil and Hindi.

Road safety operations for Indian cities, in one web app:

- **Pothole reporting to repair.** Upload a road photo or dashcam clip. A fine-tuned YOLOv8 model finds every pothole, estimates its size, and prices the repair from an editable INR rate card with GST. Each site gets an address from OpenStreetMap, a priority score, a status workflow (reported → verified → scheduled → repaired) and a printable PDF work order with the photo evidence.
- **Driver alertness.** The browser camera tracks the driver’s eyes and head (MediaPipe, on the device; video never leaves it). Thresholds are calibrated to each driver. When drowsy, the driver gets a spoken question and answers by voice; no answer sounds an alarm.
- **Crash detection.** A phone on the dashboard watches for impacts and confirms them with GPS speed and the impact sound before anything is escalated. The driver gets 20 seconds to tap “I’m OK”, then one-tap buttons to call 112 or text a contact their location.
- **Emergency vehicles.** The microphone recognises wail, yelp and hi-lo sirens and tells the driver to give way.

No numbers in the app are made up. If a sensor is off, the screen says so.

---

## Languages (English, தமிழ், हिन्दी)

Use the language buttons at the top of every page. The choice is remembered on the device.
Translations live in `frontend/src/lib/strings.js` (one entry per sentence, with `en`, `ta`, `hi`).
Spoken prompts use a Tamil or Hindi voice if the phone has one installed, otherwise English.
Still in English: the PDF work order, the spoken alertness question, crash reasons, timeline events, addresses and notes.
The Tamil and Hindi wording was machine-written and should be checked by a native speaker before real use.
Run `npm test` in `frontend/` to check that no sentence is missing in any language.

## Community impact and repair evidence (hackathon additions)

- **One case, many citizens.** Reports within `SENTINEL_DEDUP_RADIUS_M` of an open site are merged into that site. Each browser gets a random id, so the same person reporting twice counts once. The site shows "Citizens" next to the total reports.
- **Priority 0-100 with reasons.** Weights: citizens 30, safety 30, size 15, time unresolved 10 (road importance has no data yet, so the rest is rescaled). The citizen part is logarithmic and capped at 15 citizens. The drawer shows each factor's points.
- **My reports** page: read-only list of what this browser reported, with progress and before/after photos. There is no sign-in yet, so it is tied to the browser, not a person.
- **Repair needs a photo.** "Mark repaired" asks for an after-repair photo (and optional actual cost). The citizen's original photos are kept. Before/after is shown side by side.
- **Stricter detection.** `SENTINEL_MIN_CONFIDENCE` now defaults to 0.50 (was 0.30) because low-confidence boxes on snow and shadows were reported as potholes. Lower it if real potholes are missed.

Not built: logins and roles, a separate municipality area, a verifier step, notifications, analytics page. Anyone with the link can change a site's status.

## Two apps, one home page

Opening the site shows a home page with two doors:
- **Citizen app:** sign in with a name plus phone or email, or continue as a guest. This is a demo sign-in: no password or code is checked, so anyone who knows your details could open your report list. The same details show the same "My reports" on any device. Real use needs a one-time code by SMS or email.
- **Municipal dashboard:** staff sign-in at `/#/municipality` (see below). There is no staff link inside the citizen app.

Both apps run from one server and share one database, so a citizen report appears in the staff queue at once.

## Municipal dashboard (staff only)

Open `/#/municipality` or use the "Staff sign-in" card on the home page. Citizens can only *report and follow* cases; only staff can change a case.

| Username | Role | Can do |
|---|---|---|
| `officer` | Municipal officer | acknowledge, assign team and target date, override priority (reason required), reject duplicates/false reports, reopen |
| `repairteam` | Repair team | start repair, upload the "after" photo, mark completed |
| `verifier` | Verifier / administrator | everything an officer can, plus accept or reject a finished repair, manage staff accounts and alert routes |

The first time the server starts it creates these three demo accounts, all with the password in `SENTINEL_STAFF_PASSWORD` (on Render: service > **Environment**; locally set it yourself; if unset a random one is printed in the server log). After that, a verifier opens **Teams and audit** and creates a real account for each person, resets passwords, or disables people. Changing a password or disabling an account signs that person out at once. Anyone can change their own password from the sidebar.

Pages: Command centre (counts and priority queue), All cases (filters, search, CSV), Map, Analytics, Teams and audit.
Workflow: reported, acknowledged, assigned, in progress, completed (after photo required), verified. A rejected repair reopens the case.
Priority score = community reports 30%, safety context 30%, size 15%, time open 10% (rescaled). Duplicates are matched by location (8 m) plus photo similarity; if unsure the citizen is asked.

### Alerts to the municipality

With either channel set up, the municipality does not have to keep the dashboard open. Both are optional; set them as environment variables on the server:

- **Email:** `SENTINEL_SMTP_HOST` (for Gmail `smtp.gmail.com`), `SENTINEL_SMTP_PORT` (587), `SENTINEL_SMTP_USER`, `SENTINEL_SMTP_PASSWORD` (a Gmail *app password*), optional `SENTINEL_SMTP_FROM`, and `SENTINEL_ALERT_EMAIL` (the default recipient).
- **Webhook:** `SENTINEL_CASE_WEBHOOK` = a Slack, Discord, Teams or n8n incoming-webhook URL. No email account needed.

Sent for: a new case, a rise to high or critical priority, an overdue case, a finished repair waiting for verification, and a rejected repair. In **Teams and audit** a verifier adds ward rules ("if the address contains *Adyar*, send to *adyar@city.gov*"), sends a test, and sees what was sent. Citizens who registered with an email also get an email when their case changes status. Nothing is sent until you set one of these; the page says so.

## Security

What is in place:
- Passwords (staff and citizens) are stored only as salted PBKDF2-SHA256 hashes. Sign-in is locked for a while after 8 wrong attempts from one address. Sessions last 12 hours and die when the account is disabled or its password changes.
- Every staff action checks the role on the server. A citizen's token can never act as staff.
- A signed-in citizen's reports are tied to a random account id the server assigns. A guest cannot pose as an account, and "My reports" and notifications are only readable by their owner.
- Public pages and the CSV never include reporter ids, internal notes or staff names.
- Security headers on every response (content security policy, no framing, no sniffing, HSTS over https, no caching of API data), the API is not open to other websites, uploads and the live socket have size and rate limits, and the partner API (`/api/b2g/work-orders`) stays switched off until you set a private `SENTINEL_API_KEY`.
- Faces and number-plate-like areas are blurred in the browser before a photo is uploaded; if the blur model cannot load, uploading is blocked.
- Account changes and sign-ins are in the audit trail.

What is not (say so if asked): no email or SMS verification of citizen accounts and no password reset by email, rate limits are per server process, photos are public to anyone who has their link, the blur is done on the device so a modified client could skip it, there is no formal privacy policy or legal review, and the free Render plan wipes data on restart (a paid plan with a disk and `SENTINEL_DATA_DIR` pointing at it fixes that).

## Several vehicles at once

Each vehicle has a **vehicle code** (shown under "This device" in the citizen app). A phone in the car and a screen watching it must use the same code (press "Change code" on the second device and type the first one's code). Different codes never see each other's driver, alertness check or siren. The emergency contact and driving side are still shared settings.

Other limits: the municipal pages are English only, photo similarity for duplicates is a simple heuristic, and on the free Render plan the database and photos are wiped on restart.

## Run it

You need **Python 3.10+** and **Node.js 18+**.

### 1. Backend (port 8000)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

**Install the pothole model (one time, recommended).** Without it the app falls back to a basic image method that misses many potholes.

```bash
pip install -r requirements-ml.txt     # ultralytics + onnx, only needed for this step
python scripts/get_model.py            # downloads and converts to models/pothole.onnx
```

After this the backend only needs OpenCV to run the model. You can uninstall `ultralytics` if you want.

Start the server:

```bash
uvicorn app.main:app --reload --port 8000
```

Check http://localhost:8000/api/health. It should say `"tier": "yolo-onnx"`.

### 2. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open the **https** address Vite prints. Your browser warns once about the self-signed certificate; choose *Advanced → Proceed*. HTTPS is required because browsers only allow the camera, microphone, motion sensor and GPS on secure pages.

### 3. Use a phone as the in-car device

1. Put the phone and laptop on the same Wi-Fi (or the phone’s hotspot).
2. On the phone, open the **Network** address Vite printed, e.g. `https://192.168.1.20:5173`, and accept the certificate warning.
3. Tap **Start monitoring** and allow camera, microphone, motion and location.
4. Mount it facing the driver. The laptop dashboard updates live.

Crash detection needs a real phone; laptops have no accelerometer. On iPhone, motion access is asked for when you tap Start monitoring.

### One-process demo

`npm run build` in `frontend/`, then the backend serves the built app at http://localhost:8000 (no Vite needed). Use the Vite HTTPS setup when a phone is involved.

---

## Deploy online (free, with a real HTTPS link)

The `Dockerfile` builds the website, downloads and converts the pothole model, and serves everything from one port. `render.yaml` sets it up on [Render](https://render.com).

1. Push this folder to a GitHub repository.
2. On Render: **New → Blueprint**, pick the repository, then **Apply**. The first build takes about 10–15 minutes.
3. Open the `https://…onrender.com` address. `/api/health` should show `"tier": "yolo-onnx"`.
4. Open the same address on a phone; it already has a valid certificate, so the sensors work.

Free-plan limits: the service sleeps after 15 minutes without visitors and takes about a minute to wake, and its disk is wiped when it sleeps or redeploys, so reports disappear. For data that stays, use a paid instance and attach a persistent disk mounted at `/data`.

The same image runs anywhere Docker runs (Railway, Fly.io, a VPS): `docker build -t sentineldrive . && docker run -p 8000:8000 -v sentinel-data:/data sentineldrive`.

---

## Trying each feature

| Feature | How to try it |
|---|---|
| Pothole detection | **Report a pothole** → take or choose a photo of a damaged road (or a short MP4 dashcam clip). |
| Duplicate merging | Report the same spot twice with location on: the second is added to the first site. |
| Missing location | Upload without location → open the site → click on the map to place it. |
| Work order PDF | Open a site → **Work order PDF**. |
| Rate card | Settings → change a rate → Save. All open sites are re-priced. |
| Alertness | Driver monitor → Start monitoring → look ahead 5 s to calibrate → close your eyes for 4–5 s. |
| Siren | Play an ambulance siren video near the microphone while monitoring. |
| Crash | On a phone with monitoring on, give it a sharp knock against your palm near the mic. A knock is checked and usually filtered as “not a crash”; a hard impact with a loud bang is confirmed. Never test in a moving vehicle. |

---

## How it works

```
Phone / laptop browser                         Backend (FastAPI, SQLite)
──────────────────────                         ─────────────────────────
Camera → MediaPipe face mesh → eye & head      /ws   live events both ways
  scores (video stays on device)  ─────────▶   alertness check, crash checks,
Microphone → siren & impact-sound analysis        siren events
Accelerometer + GPS → impact candidates
Photo/clip → faces & plates blurred ───────▶   /api/potholes/upload
  on device, then uploaded                        YOLOv8 (ONNX via OpenCV)
                                                  → size estimate → rate card
                                                  → OpenStreetMap address
                                                  → site, PDF work order
```

- **Storage.** `backend/data/sentinel.db` (SQLite) and `backend/data/media/` for photos. Delete the folder to start fresh.
- **Pothole size** is estimated from one camera using the camera height, field of view and the horizon line in the frame. It is labelled as an estimate everywhere; confirm on site before cutting. Stereo cameras or LiDAR would be needed for measured volumes.
- **Severity:** high if deeper than 50 mm or larger than 0.5 m²; medium from 25 mm or 0.15 m²; otherwise low.
- **Priority (0–100):** severity band plus total area, number of potholes, repeat reports and days waiting.
- **Cost:** material tonnes (volume × density × wastage) × rate + tack coat + edge cutting + labour + barricading, then GST. Every rate is editable.
- **Alertness score (0–10):** PERCLOS (share of the last minute with eyes closed) scaled so 20 % → 5 and 32 % → 8, plus a bonus for an eye closure longer than 1.5 s, or a sustained head drop, whichever is higher. The eye threshold is 72 % of the driver’s own open-eye level.
- **Crash rule:** ≥ 8 g on its own, or ≥ 4 g with a GPS speed drop of 20 km/h or an impact sound 20 dB over the cabin level.

## Configuration

Environment variables (see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `SENTINEL_GEOCODER` | `nominatim` | `off` to skip address lookups (no internet at a venue) |
| `SENTINEL_API_KEY` | `change-me` | Key for `GET /api/b2g/work-orders` (municipal integration) |
| `SENTINEL_ALERT_WEBHOOK` | empty | URL that receives a JSON POST when a crash is escalated (Slack, n8n, Zapier, a Telegram bot) |
| `SENTINEL_DEDUP_RADIUS_M` | `8` | Reports closer than this join the same site |
| `SENTINEL_MIN_CONFIDENCE` | `0.30` | Detector confidence cut-off |
| `SENTINEL_DATA_DIR` | `backend/data` | Where the database and photos live |

## API

| Method | Path | |
|---|---|---|
| POST | `/api/potholes/upload` | multipart `file` (+ `frames`, `lat`, `lng`, `accuracy_m`, `note`) |
| GET | `/api/potholes` | all sites; `?status=reported,verified` |
| GET/PATCH/DELETE | `/api/potholes/{id}` | PATCH `{status, note, lat, lng}` |
| GET | `/api/potholes/{id}/work-order.pdf` | printable work order |
| GET | `/api/potholes/export.csv` | spreadsheet export |
| GET | `/api/b2g/work-orders` | open work orders by priority, header `X-API-Key` |
| GET | `/api/incidents`, `/api/alertness-checks`, `/api/stats`, `/api/health` | |
| GET/PUT | `/api/settings/rate-card`, `/api/settings/preferences` | |
| WS | `/ws` | live events |

## Tests

```bash
cd backend && pip install pytest httpx && python -m pytest
cd frontend && npm test
```

## Model and data credits

- Pothole model: YOLOv8n fine-tuned by [Shushruth18/pothole-detection-project](https://github.com/Shushruth18/pothole-detection-project) on the [Annotated Potholes Image Dataset](https://www.kaggle.com/datasets/chitholian/annotated-potholes-dataset) (A. R. Chitholian). Held-out test: precision 0.63, recall 0.70, mAP@50 0.72. It is downloaded at setup rather than bundled because its author has not declared a licence; Ultralytics YOLO weights are AGPL-3.0. For a commercial deployment, train your own model on Indian road images you have rights to (Ultralytics `yolo train` on a YOLO-format dataset, then export to ONNX and save as `backend/models/pothole.onnx`).
- Face tracking: Google MediaPipe Tasks (Apache-2.0).
- Maps and addresses: © OpenStreetMap contributors (map tiles and addresses; fine for demos and light use, see the OSM tile usage policy before heavy traffic). Nominatim allows at most one request per second; results are cached.

## Known limits

- Sizes are camera estimates (see above). Night, rain glare and heavy shadow reduce detection quality.
- Siren detection can be triggered by music with siren-like sweeps. It only gives advice; it never takes control.
- Crash detection depends on the phone being firmly mounted. It is a driver aid, not a certified eCall system.
- Driver state is kept per vehicle code, but the emergency number and driving side are shared by everyone on the server.
