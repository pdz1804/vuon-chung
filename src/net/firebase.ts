// Firebase wiring. The web config is public by design; access is enforced by
// firestore.rules and database.rules.json. `?emu=1` targets local emulators.
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';

const config = {
  apiKey: 'AIzaSyDBlP-e6izzYx0qeOS4mBhpl7wcS1hOav0',
  authDomain: 'gen-lang-client-0992083758.firebaseapp.com',
  projectId: 'gen-lang-client-0992083758',
  appId: '1:558510894905:web:1e12f95244be7fc373c2e8',
  databaseURL: 'https://vuon-chung-rtdb.asia-southeast1.firebasedatabase.app',
};

export const EMULATORS = new URLSearchParams(location.search).get('emu') === '1';

export const app = initializeApp(
  EMULATORS ? { ...config, databaseURL: `http://127.0.0.1:9000?ns=${config.projectId}` } : config,
);

export const auth = getAuth(app);
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true }, 'vuon-chung');
export const rtdb = getDatabase(app);

if (EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
}
