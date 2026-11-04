# How Reel works

## The project document

Everything about a reel is one JSON document (`backend/reel/models.py`, mirrored in `frontend/src/types.ts`):

| Part | What it holds |
|---|---|
| `brief` | product, pitch, audience, call to action, end-card link |
| `messages` | ranked key messages; the first is the hero |
| `references` | each link's status and, once learnt, its style DNA and contact sheet |
| `mix` | for each of six traits, where it comes from: `theme`, `blend`, or a reference id |
| `settings` | length, shape, theme, framework, tone, narration mode, music |
| `brand` | logo, colours, font, intro / end card / corner, watermark |
| `assets` | uploaded and captured media, recorded voice, with size, length and tempo |
| `scenes` | beat, narration, title, sub, visual, asset, length, camera, transition, messages, voice |
| `renders` | finished films |

The studio edits the document locally and saves the changed parts shortly after (`PATCH /api/projects/{id}`). Slow work runs as jobs in background threads, and the studio polls them.

## Learning a style

`style/fetch.py` asks yt-dlp for the video's metadata first and refuses anything over the limit before downloading. Then it downloads the smallest format at 480p or below, and checks the real length again with ffprobe (direct links often have no metadata).

`style/analyse.py` measures:

- **Cuts.** Hard cuts from ffmpeg's `select='gt(scene,0.3)'`. Soft changes, such as crossfades, wipes and moves onto new content, come from frames sampled at 4 fps: each is compared with the frame a second earlier, and peaks above a threshold, at least 1.2 s apart, count as changes. The two lists are merged. Shot count, cuts per minute, average shot and rhythm follow: steady, varied, or accelerating when the second half cuts much faster.
- **Palette.** k-means on the sampled pixels, seeded from luminance quantiles so it's deterministic, most common colour first.
- **Brightness, saturation, contrast.** From HSV and luma statistics.
- **Energy.** Mean frame difference half a second apart, blended with the cut rate.
- **Tempo.** An onset envelope from the audio's energy, autocorrelated over 60 to 180 bpm, folded into 80 to 160. If the peak is weak, there's no tempo.
- **Contact sheet.** Nine evenly spaced frames, tiled 3x3.

The director then reads the sheet and the numbers (`read_style`) and returns the mood, typography, transitions, camera and caption style. With Claude this uses vision and a strict JSON schema. The scripted director derives the same fields from the numbers. The source video is deleted.

## Resolving the look

`frontend/src/film/resolve.ts` builds the look from three layers:

1. **The theme:** stage, ink, accents, font, weight, tracking, case, energy, shot length, tempo, mood, transition, camera, backdrop, grain, letterbox.
2. **The mix.** Each trait overrides its part of the theme:
   - pace sets the shot length;
   - palette sets the stage, ink and accents, by luminance, saturation and contrast;
   - energy sets the motion intensity;
   - music sets the tempo and mood;
   - type sets the font, weight and tracking;
   - motion sets the transition, camera and caption style.

   `blend` averages numbers and takes the most common category.
3. **The brand:** accents and font, if you choose to use them.

## Writing the script

`plan_slots` turns a framework into a slot plan:

1. **Count the scenes:** the length divided by a scene length taken from the mix's pace (1.8 times the reference's shot, between 3.2 and 8 s).
2. **Share them out:** each beat gets scenes by its share of the running time, at least one, using largest remainder.
3. **Budget each slot:** a length, and a word budget at 2.5 words a second, kept a little under.
4. **Mark the peak:** the slot where the framework peaks lands the hero message.
5. **Close:** the last slot is always the end card.

The writer gets the brief, the ranked messages, the tone, the narration mode, the media with your notes, and the slots, then returns one scene per slot as structured output. `finish` applies the plan's timing, drops any asset or message ids the model invented, keeps the brand logo out of scene media, and forces the end card.

A rewrite sends one scene, its word budget, the messages it lands and your instruction, and gets back new narration, title and sub.

## The engine

`frontend/src/film/engine.ts` builds the whole film as DOM once: a layer per scene, plus a backdrop and overlays for the letterbox, grain, watermark, corner logo and subtitles. `renderAt(t)` then poses everything for time t:

- **Kinetic type.** Word by word, staggered by energy. Bouncy for the playful theme, blurred in for neon.
- **Stats.** Numbers count up.
- **Camera.** Push, pan, handheld (deterministic sine noise) or float, on the media or gently on the type.
- **Framing.** Screens sit in a browser window or a phone frame, beside the headline on wide canvases and under it on tall ones. Photos and footage close to the canvas's shape fill it.
- **Transitions.** Cut, fade, slide, zoom or whip, over a time that shortens as energy rises.
- **Subtitles.** Timed word by word to the voice or the scene, with the current word lit in kinetic mode.
- **Video.** In render mode, each video is seeked to its exact frame and the engine waits for `seeked`. In preview it plays in real time and is corrected if it drifts.

Because nothing depends on wall-clock time, a scrubbed frame in the studio and a rendered frame are identical.

## Rendering

`render.py` runs `renderer/render.mjs`. It opens `render.html?project=…` in headless Chrome, which fetches the project, resolves it, builds the film and exposes `READY`, `TIMELINE` and `renderAt`. The renderer:

1. Writes the timeline.
2. Prints `timeline`, which starts the score in a thread.
3. Steps through every frame, screenshotting JPEGs into ffmpeg.

**The score.** `score.py` is an original track synthesised sample by sample. Its sections are placed on the timeline's marks:

- `reveal`, the end of the hook;
- `heroIn` and `hero`, the build and the drop on the hero message;
- `heroEnd`;
- `outro`, the end card;
- `hits`, impacts on emphasis scenes.

Its style comes from the mood, and its tempo from the mix. An uploaded track is looped or trimmed to length instead.

**The mix:**

- voice clips are delayed to their scenes;
- the music is side-chain compressed under the voice;
- a two-pass loudnorm (measure, then one linear gain) reaches -14 LUFS with the true peak under -1.5 dB;
- a limiter below the ceiling catches what AAC adds.

A poster is taken just after the hero lands.
