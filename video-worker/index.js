/**
 * filmline-video-worker — real "video generation and editing" shared
 * capability for the conglomerate, following the weyland-ocr-worker
 * pattern (see ~/weyland.ai/ocr-worker): built once, deployed standalone,
 * callable from any other venture's Worker via a same-account Cloudflare
 * Service Binding. No hosted API dependency this account doesn't have a
 * key for — bundled/self-hosted logic only, same standard as OCR.
 *
 * HONEST SCOPE — read before calling this "video generation."
 * Checked 2026-09-06: `env | grep -iE "openai|elevenlabs|runway|synthesia"`
 * on this account returns nothing. There is no provisioned key for any
 * hosted generative video, image, or TTS-audio API. This worker does NOT
 * produce a photorealistic video file (no .mp4/.webm, no video codec, no
 * diffusion/frame-generation model, no server-rendered audio). Faking that
 * would repeat the exact overclaiming mistake (Math.random() dressed up as
 * "holomorphic crypto") that this portfolio's CLAUDE.md exists to catch.
 *
 * What this worker DOES produce, for real, end-to-end:
 *   1. A script (title / logline / scene beats) generated from a one-line
 *      premise, via the SAME self-hosted Qwen3-8B JITAGI bridge already
 *      live and verified in mobley-venture-fleet-a's STORY_TREATMENT_CLUSTER
 *      (animetrope.com, filmline.cc; see ventures.json commit 6063890 and
 *      nginx/workers/venture-fleet/src/worker.js). Reached here via a
 *      same-account Service Binding (env.STORY_ENGINE ->
 *      mobley-venture-fleet-a), not re-implemented or re-keyed — this
 *      worker never talks to llama.mobleysoft.com directly and never
 *      needs the LLAMA_ACCESS_CLIENT_ID/SECRET pair.
 *   2. A deterministic animated SVG "storyboard reel" built from that
 *      script, server-side, from string templates only (native SVG
 *      <animate>/<animateTransform> SMIL — no Canvas API, no WASM, no
 *      binary image codec, nothing that needs a runtime dependency this
 *      Worker doesn't bundle). It genuinely plays as a moving sequence of
 *      titled scene cards in any SVG-capable renderer (every evergreen
 *      browser) — real motion, just not an encoded video file.
 *   3. A self-contained HTML page wrapping that SVG with an optional
 *      "Narrate" control that reads the logline/scenes aloud using the
 *      VIEWER's own browser's native Web Speech API
 *      (window.speechSynthesis) — real and keyless, but strictly
 *      client-side: this worker never synthesizes, stores, or serves
 *      audio bytes itself.
 *
 * That is the whole real capability. ventures.json's old platform_products
 * claim ("TTS + visuals + synthesis for 20+ ventures") was fabricated —
 * zero real code dependency existed anywhere before this file. What's true
 * as of 2026-09-06 instead: "script + animated-storyboard + optional
 * client-side narration, real and deployed, with exactly the consumers
 * listed in ventures.json's used_by and nowhere else." Don't grow that
 * list without a real second Service Binding call to match, same rule as
 * every other entry this portfolio corrected in Loop E.
 */

const MAX_PREMISE_LEN = 1000;
const SCENE_SECONDS = 4.5; // fixed per-scene display duration for the SMIL timeline
const DEFAULT_ACCENT = "#d99a3b";
const PALETTE = ["#1b2735", "#22314a", "#2b3f5c", "#33495f", "#3b5266", "#2a3a4a"];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

// Word-wrap plain text into <tspan> lines for an SVG <text> block — no
// external layout engine available inside a Worker, so this is a simple
// character-budget wrap, not real font-metric measurement.
function wrapTspans(text, x, maxCharsPerLine = 40) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxCharsPerLine && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) lines.push("");
  return lines
    .slice(0, 6)
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`)
    .join("");
}

function buildScenePanel(scene, index, total, accent) {
  const t0 = (index * SCENE_SECONDS).toFixed(2);
  const bg = PALETTE[index % PALETTE.length];
  const label = `SCENE ${scene?.scene_number ?? index + 1} / ${total}`;
  return `
  <g opacity="0">
    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.9;1"
      begin="${t0}s" dur="${SCENE_SECONDS}s" fill="freeze" repeatCount="1" />
    <rect width="1280" height="720" fill="${bg}" />
    <circle cx="1150" cy="130" r="90" fill="${accent}" opacity="0.14">
      <animateTransform attributeName="transform" type="rotate" from="0 1150 130" to="360 1150 130"
        begin="${t0}s" dur="${(SCENE_SECONDS * 2.4).toFixed(2)}s" repeatCount="indefinite" />
    </circle>
    <text x="90" y="110" font-family="Georgia, 'Times New Roman', serif" font-size="20" fill="${accent}" letter-spacing="4">${escapeXml(label)}</text>
    <text x="90" y="320" font-family="Georgia, 'Times New Roman', serif" font-size="38" font-weight="700" fill="#f4f1ea">${wrapTspans(scene?.description, 90)}</text>
  </g>`;
}

function buildStoryboardSvg(title, logline, scenes, accent) {
  const total = scenes.length;
  const totalDur = (total * SCENE_SECONDS).toFixed(2);
  const panels = scenes.map((s, i) => buildScenePanel(s, i, total, accent)).join("\n");
  return `<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(title)}">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(logline)}</desc>
  <rect width="1280" height="720" fill="#10151c" />
  <g>${panels}
  </g>
  <text x="90" y="672" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#8a94a6">${escapeXml(title)} — ${total} scene${total === 1 ? "" : "s"} — ${totalDur}s reel — filmline.cc</text>
</svg>`;
}

function buildHtmlPage(title, logline, scenes, svg) {
  // Prefer a real per-scene voiceover script when the caller has one (e.g.
  // audiovizai.com's av-treatment produces a distinct voiceover line
  // separate from the visual description, matching its own "synchronized
  // audio-visual experience" promise) - fall back to description for
  // callers like filmline.cc's story-treatment that only have one field.
  const narrationLines = [logline, ...scenes.map((s) => s?.voiceover || s?.description || "")].filter(Boolean);
  // Keep complete caller text available when the visual card's six-line
  // layout clips it. Escape each field: the transcript is HTML, not markup
  // supplied by the caller. This also works without JavaScript or speech.
  const transcript = scenes.map((scene, index) => `<li>
<h3>Scene ${index + 1}</h3>
<p class="scene-text">${escapeXml(scene.description || "")}</p>
${scene.voiceover ? `<p class="scene-text"><strong>Voiceover:</strong> ${escapeXml(scene.voiceover)}</p>` : ""}
</li>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeXml(title)} — filmline.cc storyboard reel</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{background:#10151c;color:#f4f1ea;font-family:Helvetica,Arial,sans-serif;margin:0;padding:24px;}
  .wrap{max-width:960px;margin:0 auto;}
  svg{width:100%;height:auto;border-radius:8px;display:block;}
  button{margin-top:16px;padding:10px 18px;background:#d99a3b;color:#10151c;border:0;border-radius:6px;font-weight:700;cursor:pointer;font-size:14px;}
  button:disabled{opacity:0.5;cursor:default;}
  .scene-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;}
  .note{margin-top:14px;font-size:13px;color:#8a94a6;line-height:1.5;}
</style></head>
<body><div class="wrap">
<h1 style="margin-bottom:4px;">${escapeXml(title)}</h1>
<p style="color:#c9d2de;">${escapeXml(logline)}</p>
${svg}
<button id="replay" type="button">Replay storyboard</button>
<button id="narrate">Narrate (browser text-to-speech)</button>
<p class="note">Narration uses your browser's built-in Web Speech API (window.speechSynthesis) — nothing is sent to a server for this step, and no audio file is generated or stored anywhere. This page is an animated SVG storyboard reel (real motion via native SVG SMIL animation), not an encoded video file (.mp4/.webm) — that would need a video-encoding pipeline or hosted API this deployment doesn't have.</p>
<section aria-labelledby="transcript-title">
<h2 id="transcript-title">Full scene transcript</h2>
<p class="note">The animated cards show up to six lines. Complete descriptions and any separate voiceover are preserved below.</p>
<ol>${transcript}</ol>
</section>
</div>
<script>
  var lines = ${JSON.stringify(narrationLines).replace(/</g, '\\u003c')};
  var replay = document.getElementById('replay');
  var storyboard = document.querySelector('svg');
  // Reset the existing SMIL time container, including all scene offsets.
  // Narration is independent of the fixed-duration visual reel.
  replay.disabled = !storyboard || typeof storyboard.setCurrentTime !== 'function';
  replay.addEventListener('click', function () {
    if (replay.disabled) return;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    storyboard.setCurrentTime(0);
    storyboard.unpauseAnimations();
  });
  var btn = document.getElementById('narrate');
  btn.addEventListener('click', function () {
    if (!('speechSynthesis' in window)) { alert('This browser has no speechSynthesis support.'); return; }
    window.speechSynthesis.cancel();
    lines.forEach(function (line) {
      if (line) window.speechSynthesis.speak(new SpeechSynthesisUtterance(line));
    });
  });
</script>
</body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Structured callers already own the script. Do not run another model
    // that would discard their manuscript-derived beats.
    if (url.pathname === '/api/render' && request.method === 'POST') {
      const reader = request.body?.getReader();
      if (!reader) return jsonResponse({ error: 'JSON required' }, 400);
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 32768) { await reader.cancel(); return jsonResponse({ error: 'Body too large' }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let body;
      try {
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
      const validText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
      const validOptionalText = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);
      if (!validText(body?.title, 160) || !validText(body?.logline, 600) ||
          !Array.isArray(body.scenes) || body.scenes.length < 1 || body.scenes.length > 24 ||
          body.scenes.some((s, i) => s?.scene_number !== i + 1 || !validText(s.description, 700) || !validOptionalText(s.voiceover, 700))) {
        return jsonResponse({ error: 'A title, logline and 1-24 sequential scenes (each needing a description, and optionally a real per-scene voiceover string) are required' }, 422);
      }
      const accent = /^#[0-9a-f]{6}$/i.test(body.accent || '') ? body.accent : DEFAULT_ACCENT;
      const svg = buildStoryboardSvg(body.title, body.logline, body.scenes, accent);
      return jsonResponse({ title: body.title, logline: body.logline, scenes: body.scenes,
        video: { format: 'animated-svg-storyboard', scene_seconds: SCENE_SECONDS,
          total_seconds: body.scenes.length * SCENE_SECONDS,
          svg },
        page_html: buildHtmlPage(body.title, body.logline, body.scenes, svg),
        narration: { engine: 'browser-web-speech-api', server_rendered_audio: false },
        display_note: 'Cards show up to six lines; full descriptions remain in the scene data.',
        script_source: { via: 'Validated caller-supplied scene beats; no additional inference' } });
    }

    if ((url.pathname === "/health" || url.pathname === "/") && request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "filmline-video-worker",
        real_capabilities: [
          "script generation (title/logline/scenes) via a same-account Service Binding (STORY_ENGINE) to mobley-venture-fleet-a's live /api/story-treatment JITAGI endpoint",
          "deterministic animated-SVG storyboard reel, server-generated (native SMIL animation, no Canvas/WASM/video codec)",
          "self-contained HTML wrapper page with optional client-side narration via the viewer's browser Web Speech API",
        ],
        explicitly_not_implemented: [
          "photorealistic video or frame generation (no generative image/video API key provisioned on this account)",
          "server-rendered or stored audio (TTS is client-side only, in the viewer's own browser, nothing generated or stored server-side)",
          "encoded video file output (.mp4/.webm) — would need ffmpeg or a hosted video-encoding API not present in this deployment",
        ],
      });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ detail: { message: "invalid JSON body" } }, 400);
      }
      const premise = typeof body?.premise === "string" ? body.premise.trim().slice(0, MAX_PREMISE_LEN) : "";
      if (!premise) return jsonResponse({ detail: { message: "premise is required" } }, 400);
      const accent = typeof body?.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent) ? body.accent : DEFAULT_ACCENT;

      if (!env.STORY_ENGINE) {
        return jsonResponse({ detail: { message: "STORY_ENGINE binding not configured on this Worker" } }, 500);
      }

      let scriptResult;
      try {
        // Host must be a domain mobley-venture-fleet-a actually recognizes
        // in its VENTURES map (filmline.cc is one of the two ventures in
        // its real STORY_TREATMENT_CLUSTER) — Service Bindings route by
        // script name, not by hostname, so this URL only has to satisfy
        // the destination Worker's own internal routing.
        const upstream = await env.STORY_ENGINE.fetch("https://filmline.cc/api/story-treatment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ premise }),
        });
        scriptResult = await upstream.json();
        if (!upstream.ok || !scriptResult?.parsed) {
          return jsonResponse({ detail: { message: "upstream script generation failed", upstream: scriptResult } }, 502);
        }
      } catch (err) {
        return jsonResponse({ detail: { message: `STORY_ENGINE call failed: ${err.message}` } }, 502);
      }

      const { title, logline, scenes } = scriptResult.parsed;
      if (!Array.isArray(scenes) || scenes.length === 0) {
        return jsonResponse({ detail: { message: "script generation returned no usable scenes" } }, 502);
      }

      const svg = buildStoryboardSvg(title, logline, scenes, accent);
      const html = buildHtmlPage(title, logline, scenes, svg);

      return jsonResponse({
        title,
        logline,
        scenes,
        video: {
          format: "animated-svg-storyboard",
          scene_seconds: SCENE_SECONDS,
          total_seconds: Number((scenes.length * SCENE_SECONDS).toFixed(2)),
          svg,
        },
        page_html: html,
        narration: { engine: "browser-web-speech-api", server_rendered_audio: false },
        script_source: {
          via: "Service Binding -> mobley-venture-fleet-a /api/story-treatment",
          repaired: !!scriptResult.repaired,
          latency_ms: scriptResult.latency_ms ?? null,
        },
      });
    }

    return jsonResponse({ detail: { message: "not found" } }, 404);
  },
};
