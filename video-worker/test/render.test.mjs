import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../index.js';

const script = {
  title: 'Edited <story>',
  logline: 'A keeper & a letter.',
  scenes: [
    { scene_number: 1, description: 'The edited first scene.', voiceover: '</script><script>bad()</script>' },
    { scene_number: 2, description: 'The final scene.' },
  ],
};
const render = body => worker.fetch(new Request('https://filmline.cc/api/render', {
  method: 'POST', body: JSON.stringify(body),
}), { STORY_ENGINE: { fetch() { throw new Error('Rendering must not run inference'); } } });

function loadPlayback(page, svg, speechSynthesis) {
  const buttons = {};
  let click;
  const context = {
    document: {
      querySelector(selector) {
        assert.equal(selector, 'svg');
        return svg;
      },
      getElementById(id) {
        return buttons[id] = {
          addEventListener(event, fn) {
            this[event] = fn;
            if (id === 'narrate' && event === 'click') click = fn;
          },
        };
      },
    },
    window: speechSynthesis ? { speechSynthesis } : {},
    SpeechSynthesisUtterance: function(text) { this.text = text; },
  };
  vm.runInNewContext(page.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  buttons._triggerNarrate = click;
  return buttons;
}

test('edited scripts yield a standalone page with the exact SVG and safely embedded narration', async () => {
  const response = await render(script);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.scenes, script.scenes);
  assert.equal(data.video.total_seconds, 9);
  assert.ok(data.page_html.includes(data.video.svg));
  assert.ok(data.page_html.includes('Edited &lt;story&gt;'));
  assert.equal((data.page_html.match(/<script>/g) || []).length, 1);
  assert.deepEqual(data.narration, { engine: 'browser-web-speech-api', server_rendered_audio: false });

  const spoken = [];
  const svg = { setCurrentTime() {}, unpauseAnimations() {} };
  const buttons = loadPlayback(data.page_html, svg, {
    cancel() {},
    speak(line) { spoken.push(line.text); },
  });
  assert.ok(typeof buttons._triggerNarrate === 'function');
  buttons._triggerNarrate();
  assert.deepEqual(spoken, [script.logline, script.scenes[0].voiceover, script.scenes[1].description]);
});

test('invalid scenes remain rejected before returning a page', async () => {
  const response = await render({ ...script, scenes: [{ scene_number: 2, description: 'Out of sequence' }] });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).page_html, undefined);
});

test('replay cancels old narration and restarts a finished or paused reel repeatedly', async () => {
  const data = await (await render(script)).json();
  assert.match(data.page_html, /<button id="replay" type="button">Replay storyboard<\/button>/);
  const events = [];
  const svg = {
    setCurrentTime(time) { events.push(['seek', time]); },
    unpauseAnimations() { events.push(['play']); },
  };
  const buttons = loadPlayback(data.page_html, svg, { cancel() { events.push(['cancel']); } });
  assert.equal(buttons.replay.disabled, false);
  buttons.replay.click();
  buttons.replay.click();
  assert.deepEqual(events, [['cancel'], ['seek', 0], ['play'], ['cancel'], ['seek', 0], ['play']]);
});

test('visual replay works without speech support and disables on non-SMIL viewers', async () => {
  const data = await (await render(script)).json();
  let seeks = 0;
  const buttons = loadPlayback(data.page_html, {
    setCurrentTime(time) { assert.equal(time, 0); seeks++; },
    unpauseAnimations() {},
  });
  buttons.replay.click();
  assert.equal(seeks, 1);
  for (const svg of [null, {}]) {
    const unsupported = loadPlayback(data.page_html, svg);
    assert.equal(unsupported.replay.disabled, true);
    assert.doesNotThrow(() => unsupported.replay.click?.());
  }
});

test('standalone transcript preserves long descriptions and distinct voiceover as text', async () => {
  const description = 'A keeper examines a letter. '.repeat(20) + 'FINAL DETAIL <img src=x onerror=bad()> & silence.';
  const voiceover = 'A separate voice says "Remember." </script><script>bad()</script>';
  const response = await render({ ...script, scenes: [
    { scene_number: 1, description, voiceover },
    { scene_number: 2, description: 'Second scene without voiceover.' },
  ] });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(!data.video.svg.includes('FINAL DETAIL'), 'fixture must exceed the card layout');
  const transcript = data.page_html.match(/<ol>([\s\S]*?)<\/ol>/)[1];
  const escaped = value => value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char]));
  assert.ok(transcript.includes(escaped(description)));
  assert.ok(transcript.includes(escaped(voiceover)));
  assert.ok(transcript.includes('Second scene without voiceover.'));
  assert.equal((transcript.match(/<li>/g) || []).length, 2);
  assert.equal((transcript.match(/<strong>Voiceover:<\/strong>/g) || []).length, 1);
  assert.ok(!transcript.includes('<img'));
  assert.ok(!transcript.includes('<script>'));
  assert.deepEqual(data.scenes[0], { scene_number: 1, description, voiceover });
});

test('generated scripts expose the same replayable page without changing the inference contract', async () => {
  let calls = 0;
  const response = await worker.fetch(new Request('https://filmline.cc/api/generate', {
    method: 'POST', body: JSON.stringify({ premise: 'A keeper receives a letter.' }),
  }), { STORY_ENGINE: { async fetch(url, options) {
    calls++;
    assert.equal(url, 'https://filmline.cc/api/story-treatment');
    assert.deepEqual(JSON.parse(options.body), { premise: 'A keeper receives a letter.' });
    return Response.json({ parsed: script });
  } } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(calls, 1);
  assert.deepEqual(data.scenes, script.scenes);
  const events = [];
  const buttons = loadPlayback(data.page_html, {
    setCurrentTime(time) { events.push(time); },
    unpauseAnimations() { events.push('playing'); },
  });
  buttons.replay.click();
  assert.deepEqual(events, [0, 'playing']);
});
