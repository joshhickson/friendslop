import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSignedOff } from '../shared/signed-off.js';
import { parseRef } from '../shared/gameref.js';

const SHA = 'a'.repeat(40);

test('the Control Points demo is signed off, at any commit and in any case', () => {
  assert.equal(isSignedOff(parseRef(`gh:joshhickson/friendslop@${SHA}/games/cp`)), true);
  assert.equal(isSignedOff(parseRef(`gh:JoshHickson/FriendSlop@${'b'.repeat(40)}/games/cp`)), true);
});

test('other games, forks and folders still get the banner', () => {
  assert.equal(isSignedOff(parseRef(`gh:joshhickson/friendslop@${SHA}/templates/starter`)), false);
  assert.equal(isSignedOff(parseRef(`gh:joshhickson/friendslop@${SHA}/games/cp/extra`)), false);
  assert.equal(isSignedOff(parseRef(`gh:someone/friendslop@${SHA}/games/cp`)), false);
  assert.equal(isSignedOff(null), false);
});
