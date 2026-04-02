# ClinCollab Demo — OBS Studio Recording Guide

Complete step-by-step instructions to record a polished customer demo video
using Playwright + OBS Studio on Windows.

---

## Prerequisites

| Tool | Download |
|------|---------|
| OBS Studio | https://obsproject.com |
| Node.js 20+ | Already installed |
| Playwright | Already installed (in apps/web) |
| Chrome | Already installed |

---

## Part 1 — One-Time OBS Setup

### 1.1 Open OBS Studio

Launch OBS Studio. On first launch, run the Auto-Configuration Wizard
and choose **Optimise for recording, I will not be streaming**.

---

### 1.2 Create a Demo Scene

In the **Scenes** panel (bottom-left):
1. Click **+** → name it `ClinCollab Demo`

In the **Sources** panel:
1. Click **+** → **Window Capture**
2. Name it `Chrome Browser`
3. In the dropdown, select **Google Chrome** (or Chromium)
4. Tick **Capture Cursor** → OK

> 💡 If Window Capture shows a black screen, try **Display Capture** instead
> and select your primary monitor.

---

### 1.3 OBS Output Settings

Go to **Settings** → **Output**:

| Setting | Value |
|---------|-------|
| Recording Path | `C:\Users\Avinash\Videos\ClinCollab-Demo\` |
| Recording Format | `mkv` (most reliable; convert to mp4 after) |
| Encoder | `x264` (software) or `NVENC` (if NVIDIA GPU) |
| Rate Control | CRF |
| CRF Value | `18` (high quality) |
| Preset | `veryfast` |

Go to **Settings** → **Video**:

| Setting | Value |
|---------|-------|
| Base Resolution | `1280x720` |
| Output Resolution | `1920x1080` (OBS upscales — looks crisp) |
| FPS | `30` |

---

### 1.4 Audio (optional — for voiceover)

Go to **Settings** → **Audio**:
- Set your **Desktop Audio** to the correct output (speakers/headphones)
- Set **Mic/Auxiliary Audio** to your microphone (if narrating live)
- Or leave mic off and add narration in post-editing

---

## Part 2 — Authenticate the Demo Browser

Before recording, Playwright needs a saved login session.

Open a terminal and run:

```bash
cd C:\Users\Avinash\Documents\clincollab\apps\web

# Run auth setup (opens Chrome, log in with Google, saves session)
npx playwright test e2e/auth.setup.ts --project=setup --headed
```

When Chrome opens:
1. Navigate to `https://app.clincollab.com`
2. Click **Sign in with Google**
3. Complete Google login
4. Playwright saves the session to `.auth/user.json`

> ✅ You only need to do this once (or when the session expires).

---

## Part 3 — Recording Options

### Option A — Full 12-Module Demo (~12–15 min)

Records all 11 modules + intro + outro in one continuous video.

**Terminal command:**
```bash
cd C:\Users\Avinash\Documents\clincollab\apps\web

npx playwright test demo/clincollab-full-demo.spec.ts \
  --config demo/playwright.demo.config.ts \
  --project=demo-chromium
```

**In OBS:** Click **Start Recording** → run the command above → click **Stop Recording** when Playwright finishes.

---

### Option B — Individual Module Videos

Record one module at a time for shorter, focused videos.

| Module | Command |
|--------|---------|
| M1 Identity | `npx playwright test demo/modules/m1-identity.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M2 Network | `npx playwright test demo/modules/m2-network.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M3 Referrals | `npx playwright test demo/modules/m3-referrals.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M4 Chatbot | `npx playwright test demo/modules/m4-chatbot.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M5 Triage | `npx playwright test demo/modules/m5-triage.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M6 Synthesis | `npx playwright test demo/modules/m6-synthesis.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M7 Transcription | `npx playwright test demo/modules/m7-transcription.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M8 Procedures | `npx playwright test demo/modules/m8-procedures.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M9 Comms | `npx playwright test demo/modules/m9-communications.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M10 Content | `npx playwright test demo/modules/m10-content.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |
| M11 Config | `npx playwright test demo/modules/m11-config.spec.ts --config demo/playwright.demo.config.ts --project=demo-chromium` |

---

### Option C — Quick Test (Dry Run, No OBS)

Preview a single module before recording:

```bash
cd C:\Users\Avinash\Documents\clincollab\apps\web
npx playwright test demo/modules/m1-identity.spec.ts \
  --config demo/playwright.demo.config.ts \
  --project=demo-chromium \
  --headed
```

---

## Part 4 — Recording Workflow (Step-by-Step)

1. **Position Chrome window** to fill the OBS capture area. Make it exactly 1280×720.
   - Chrome: press F11 for fullscreen, then F11 again to exit, resize to 1280×720

2. **In OBS:** Check the preview looks correct — Chrome window fills the frame.

3. **Click `Start Recording`** in OBS (or press `Ctrl+Shift+R` if you set a hotkey).

4. **Wait 3 seconds** (give OBS time to buffer).

5. **Run the Playwright command** in your terminal.

6. **Watch the demo play** — chapter cards, feature banners, and navigation happen automatically.

7. **When Playwright finishes**, wait 3 seconds, then click **Stop Recording** in OBS.

8. OBS saves the file to `C:\Users\Avinash\Videos\ClinCollab-Demo\`.

---

## Part 5 — Post-Processing (Optional)

### Convert MKV → MP4

OBS records in MKV. To convert:
```bash
# In OBS: File → Remux Recordings → select .mkv → Remux
# OR use FFmpeg:
ffmpeg -i input.mkv -c copy output.mp4
```

### Add Intro/Outro in DaVinci Resolve (free)

1. Download DaVinci Resolve (free) from https://www.blackmagicdesign.com
2. Import your recorded `.mp4`
3. Add your logo as intro (first 5 seconds)
4. Add a CTA slide as outro ("Book a demo at clincollab.com")
5. Export as H.264 1080p

### Compress for WhatsApp/Email sharing

```bash
ffmpeg -i clincollab-demo.mp4 -vf scale=1280:720 -crf 28 -preset fast clincollab-demo-compressed.mp4
```

---

## Part 6 — Keyboard Shortcuts Cheatsheet

| Action | Shortcut |
|--------|----------|
| Start/Stop Recording (set in OBS) | `Ctrl+Shift+R` |
| Pause Recording | `Ctrl+Shift+P` |
| Switch OBS scene | Click scene name |
| Chrome fullscreen | `F11` |
| Open terminal quickly | `Win+R` → `cmd` |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Black screen in OBS Window Capture | Use Display Capture instead, or run Chrome as Administrator |
| "Auth file not found" error | Re-run `auth.setup.ts` first |
| Page redirects to login | Session expired — re-run auth setup |
| Demo too fast | Increase `T.feature` and `T.longRead` in `demo-helpers.ts` |
| Demo too slow | Decrease values in `demo-helpers.ts` |
| Chapter cards not showing | Check that `storageState` in playwright config points to correct `.auth/user.json` |
| Playwright can't find `demo-helpers` | Ensure you `cd` to `apps/web` before running |

---

## File Structure

```
apps/web/demo/
├── clincollab-full-demo.spec.ts   ← Full 12-module demo (all-in-one)
├── demo-helpers.ts                ← Shared overlays & utilities
├── playwright.demo.config.ts      ← Demo-specific Playwright config
├── OBS-RECORDING-GUIDE.md         ← This file
└── modules/
    ├── m1-identity.spec.ts        ← M1 standalone (~2 min)
    ├── m2-network.spec.ts         ← M2 standalone (~2 min)
    ├── m3-referrals.spec.ts       ← M3 standalone (~2.5 min)
    ├── m4-chatbot.spec.ts         ← M4 standalone (~2 min)
    ├── m5-triage.spec.ts          ← M5 standalone (~2 min)
    ├── m6-synthesis.spec.ts       ← M6 standalone (~2 min)
    ├── m7-transcription.spec.ts   ← M7 standalone (~2 min)
    ├── m8-procedures.spec.ts      ← M8 standalone (~2.5 min)
    ├── m9-communications.spec.ts  ← M9 standalone (~2 min)
    ├── m10-content.spec.ts        ← M10 standalone (~2 min)
    └── m11-config.spec.ts         ← M11 standalone (~2 min)
```
