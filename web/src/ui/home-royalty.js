// Home, Own section: a royalty calculator. Pick the daily volume that remixes of your stack trade;
// see your royalty (the stack author's share of the trade fee) and how the whole fee splits.
import { FEES } from '../api/contract.js';

const share = (who) => FEES.split.find((s) => s.who === who)?.pct ?? 0;
const MIN_EXP = 1, MAX_EXP = 5; // 10 SOL … 100,000 SOL a day, on a log scale
const DEFAULT_T = 50;           // 1,000 SOL

/** Slider position (0–100) → a round volume in SOL. */
function volumeAt(t) {
  const v = 10 ** (MIN_EXP + ((MAX_EXP - MIN_EXP) * t) / 100);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / step) * step;
}

export function fmtSol(n) {
  const v = n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3);
  return `${v} SOL`;
}

export function mountRoyalty(calcEl, splitEl) {
  const fee = FEES.tradeFeePct;
  const author = share('Stack author'), creator = share('Creator'), platform = share('hookrz');
  const rate = (fee * author) / 100; // % of volume that reaches the stack author

  calcEl.innerHTML = `
    <div class="calc nr">
      <div class="calc-head"><span class="pixel">Royalty calculator</span><span class="pixel dim">${author}% of the ${fee}% fee</span></div>
      <label class="calc-k" for="calcVol">Daily volume on remixes of your stack</label>
      <div class="calc-row"><input id="calcVol" type="range" min="0" max="100" step="1" value="${DEFAULT_T}"><output class="num" for="calcVol" data-o="vol"></output></div>
      <div class="calc-scale mono dim" aria-hidden="true"><span>10</span><span>100</span><span>1K</span><span>10K</span><span>100K SOL</span></div>
      <div class="calc-out">
        <div><span class="pixel">Your royalty · per day</span><b class="num ice" data-o="day"></b></div>
        <div><span class="pixel">Per 30 days</span><b class="num" data-o="month"></b></div>
      </div>
      <p class="own-note">That is ${rate}% of every trade on a remix of your stack. Royalties go one level up: a remix of a remix pays the stack it forked.</p>
    </div>`;

  splitEl.innerHTML = `
    <span class="pixel fee-ex-k">Worked example · one day</span>
    <p>Remixes of your stack trade <b class="num" data-o="vol"></b>. The <b class="num" data-o="fee"></b> in trade fees splits three ways:</p>
    <ul>
      <li><span class="sw s0"></span><span>Creators of the remixes<small>${creator}% of the fee</small></span><b class="num" data-o="creator"></b></li>
      <li><span class="sw s1"></span><span>hookrz<small>engine, keeper, API · ${platform}%</small></span><b class="num" data-o="platform"></b></li>
      <li><span class="sw s2"></span><span>You<small>author of the stack they remixed · ${author}%</small></span><b class="num ice" data-o="author"></b></li>
    </ul>`;

  const input = calcEl.querySelector('input');
  const outs = (k) => [...calcEl.querySelectorAll(`[data-o="${k}"]`), ...splitEl.querySelectorAll(`[data-o="${k}"]`)];
  const set = (k, text) => outs(k).forEach((o) => { o.textContent = text; });
  const update = () => {
    const t = +input.value;
    const vol = volumeAt(t);
    const feeSol = (vol * fee) / 100;
    input.style.setProperty('--fill', `${t}%`);
    input.setAttribute('aria-valuetext', `${fmtSol(vol)} a day`);
    set('vol', fmtSol(vol));
    set('fee', fmtSol(feeSol));
    set('day', fmtSol((feeSol * author) / 100));
    set('month', fmtSol((feeSol * author * 30) / 100));
    set('creator', fmtSol((feeSol * creator) / 100));
    set('platform', fmtSol((feeSol * platform) / 100));
    set('author', fmtSol((feeSol * author) / 100));
  };
  input.addEventListener('input', update);
  update();
}
