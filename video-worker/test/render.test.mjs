import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../index.js';

const script = {
  title: 'Edited <story>', logline: 'A keeper & a letter.',
  scenes: [
    { scene_number: 1, description: 'The edited first scene.', voiceover: '</script><script>bad()</script>' },
    { scene_number: 2, description: 'The final scene.' },
  ],
};
const render = body => worker.fetch(new Request('https://filmline.cc/api/render', {
  method: 'POST', body: JSON.stringify(body),
}), { STORY_ENGINE: { fetch() { throw new Error('Rendering must not run inference'); } } });

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
  let click;
  const spoken = [];
  const context = {
    document: { getElementById() { return { addEventListener(event, fn) { assert.equal(event, 'click'); click = fn; } }; } },
    window: { speechSynthesis: { cancel() {}, speak(line) { spoken.push(line.text); } } },
    SpeechSynthesisUtterance: function(text) { this.text = text; },
  };
  vm.runInNewContext(data.page_html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  click();
  assert.deepEqual(spoken, [script.logline, script.scenes[0].voiceover, script.scenes[1].description]);
});

test('invalid scenes remain rejected before returning a page', async () => {
  const response = await render({ ...script, scenes: [{ scene_number: 2, description: 'Out of sequence' }] });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).page_html, undefined);
});
