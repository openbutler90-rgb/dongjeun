import assert from 'node:assert/strict';
import {
  buildCharacterReferencePrompt,
  buildWebtoonImagePrompt,
  getPendingApprovalKind,
  getWebtoonStepState,
  isWebtoonApprovalStatus,
  nextApprovalStatus,
} from './webtoonWorkflow';

assert.equal(isWebtoonApprovalStatus('awaiting_character_approval'), true);
assert.equal(isWebtoonApprovalStatus('completed'), false);

assert.equal(nextApprovalStatus('characters'), 'awaiting_character_approval');
assert.equal(nextApprovalStatus('cover'), 'awaiting_cover_approval');
assert.equal(nextApprovalStatus('episode_preview'), 'awaiting_episode_approval');

assert.equal(getPendingApprovalKind('awaiting_cover_approval'), 'cover');
assert.equal(getPendingApprovalKind('planning'), null);

assert.deepEqual(getWebtoonStepState('awaiting_episode_approval').map(step => step.state), [
  'done',
  'done',
  'done',
  'active',
]);

const characterPrompt = buildCharacterReferencePrompt({
  artStyle: 'premium Korean webtoon',
  name: 'Minsu',
  role: 'main character',
  visualPrompt: 'black hair, sharp eyes, red jacket',
});

assert.match(characterPrompt, /360-degree turnaround/i);
assert.match(characterPrompt, /full body/i);
assert.match(characterPrompt, /upper body/i);
assert.match(characterPrompt, /expression sheet/i);
assert.match(characterPrompt, /Minsu/);

const panelPrompt = buildWebtoonImagePrompt({
  kind: 'panelPage',
  artStyle: 'premium Korean webtoon',
  prompt: 'two characters arguing in a rainy alley',
  characters: ['Minsu: black hair, red jacket', 'Jihan: silver hair, blue coat'],
  vibeMemo: 'make the lighting more dramatic',
});

assert.match(panelPrompt.prompt, /character consistency lock/i);
assert.match(panelPrompt.prompt, /safe negative space/i);
assert.match(panelPrompt.prompt, /Minsu/);
assert.match(panelPrompt.negativePrompt, /readable text/i);

console.log('webtoonWorkflow tests passed');
