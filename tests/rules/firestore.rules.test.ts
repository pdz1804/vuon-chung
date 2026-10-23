import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { arrayUnion, deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const future = () => new Date(Date.now() + 86_400_000);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-vuon-chung',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'worlds', 'w1'), {
      members: ['alice'],
      profiles: { alice: { name: 'A', look: 'phu' } },
      farm: {},
    });
    await setDoc(doc(db, 'invites', 'code1'), { worldId: 'w1', createdBy: 'alice', expiresAt: future() });
    await setDoc(doc(db, 'invites', 'old'), { worldId: 'w1', createdBy: 'alice', expiresAt: new Date(0) });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

function join(uid: string, code: string) {
  const db = as(uid);
  const b = writeBatch(db);
  b.update(doc(db, 'worlds', 'w1'), {
    members: arrayUnion(uid),
    [`profiles.${uid}`]: { name: uid, look: 'su' },
    joinCode: code,
  });
  b.delete(doc(db, 'invites', code));
  return b.commit();
}

describe('worlds', () => {
  it('lets members read and edit the farm', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'worlds', 'w1')));
    await assertSucceeds(updateDoc(doc(as('alice'), 'worlds', 'w1'), { farm: { coins: 9 } }));
  });

  it('hides a world from strangers and signed-out users', async () => {
    await assertFails(getDoc(doc(as('mallory'), 'worlds', 'w1')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'worlds', 'w1')));
    await assertFails(updateDoc(doc(as('mallory'), 'worlds', 'w1'), { farm: {} }));
  });

  it('only lets you create a world where you are the sole member', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'worlds', 'w2'), { members: ['bob'], profiles: { bob: {} }, farm: {} }));
    await assertFails(setDoc(doc(as('bob'), 'worlds', 'w3'), { members: ['bob', 'eve'], profiles: {}, farm: {} }));
  });

  it('keeps the farm a map so one bad write cannot brick the partner', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'worlds', 'w1'), { farm: 5 }));
  });

  it('never lets a member change membership or delete the world', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'worlds', 'w1'), { members: ['alice', 'eve'] }));
    await assertFails(deleteDoc(doc(as('alice'), 'worlds', 'w1')));
  });
});

describe('joining with an invite', () => {
  it('joins with a live invite and consumes it', async () => {
    await assertSucceeds(join('bob', 'code1'));
    await assertSucceeds(getDoc(doc(as('bob'), 'worlds', 'w1')));
  });

  it('rejects a made-up or expired code', async () => {
    await assertFails(join('bob', 'nope'));
    await assertFails(join('bob', 'old'));
  });

  it('rejects a third player even with a valid code', async () => {
    await assertSucceeds(join('bob', 'code1'));
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'invites', 'code2'), { worldId: 'w1', createdBy: 'alice', expiresAt: future() }),
    );
    await assertFails(join('carol', 'code2'));
  });

  it('rejects joining while also changing the farm', async () => {
    const db = as('bob');
    const b = writeBatch(db);
    b.update(doc(db, 'worlds', 'w1'), { members: arrayUnion('bob'), joinCode: 'code1', farm: { coins: 1e9 } });
    b.delete(doc(db, 'invites', 'code1'));
    await assertFails(b.commit());
  });
});

describe('invites', () => {
  it('can be read by code', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'invites', 'code1')));
  });

  it('can only be created by a member of that world', async () => {
    await assertSucceeds(
      setDoc(doc(as('alice'), 'invites', 'c3'), { worldId: 'w1', createdBy: 'alice', expiresAt: future() }),
    );
    await assertFails(
      setDoc(doc(as('mallory'), 'invites', 'c4'), { worldId: 'w1', createdBy: 'mallory', expiresAt: future() }),
    );
  });
});

describe('users', () => {
  it('keeps each user document private', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'users', 'bob'), { worldId: 'w1' }));
    await assertFails(getDoc(doc(as('eve'), 'users', 'bob')));
  });
});
