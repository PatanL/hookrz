// Worker: drafts, fuzzes and honeypot-checks Hookscript off the page's main thread.
import * as hs from '../vendor/hookscript.js';
import { runJob } from './jobs.js';

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try { self.postMessage({ id, result: await runJob(hs, type, payload) }); } catch (err) { self.postMessage({ id, error: err?.message ?? String(err) }); }
};
