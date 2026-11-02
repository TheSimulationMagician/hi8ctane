// Hi8ctane day zero: the few interactive bits. No framework, no tracking.
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const NAME = { kite: 'KITE', wing: 'WING', surf: 'SURF', sup: 'SUP', mtb: 'MTB', mx: 'MX' };
  const LEVELS = {
    kite: [['rookie', 'Course done, short runs, not upwind yet'], ['regular', 'Upwind both ways, up to 25 knots'], ['ripper', 'Jumps, gusty days, helps others launch']],
    wing: [['rookie', 'Pumps the wing, rides the board, first flights'], ['regular', 'Foils on both tacks'], ['ripper', 'Foiling gybes and tacks, waves']],
    surf: [['rookie', 'Whitewater, stands up in the foam'], ['regular', 'Green waves, turns, up to chest high'], ['ripper', 'Head high and up, reads the peak']],
    sup: [['rookie', 'Kneels, then stands on flat water'], ['regular', 'An hour on flat water, light chop'], ['ripper', 'Downwinders, waves, distance']],
    mtb: [['rookie', 'Blue routes, no drops'], ['regular', 'Red routes, roots, small drops'], ['ripper', 'Black routes, jumps, fast descents']],
    mx: [['rookie', "The beginners' loop, no jumps"], ['regular', 'The full track, small tables'], ['ripper', 'Doubles, whoops, race pace']],
  };
  const HUBS = {
    amsterdam: [['west', 'Sloterdijk P+R (west)'], ['cs', 'Centraal'], ['zuid', "A'dam Zuid"], ['hlm', 'Haarlem station'], ['other', 'Somewhere else / my own way']],
    barcelona: [['sants', 'Sants'], ['gracia', 'Gràcia'], ['sagrera', 'La Sagrera'], ['other', 'Somewhere else / my own way']],
    lisbon: [['other', 'Lisbon (hubs come when the city opens)']], tarifa: [['other', 'Tarifa (hubs come when the city opens)']], berlin: [['other', 'Berlin (hubs come when the city opens)']],
  };
  const SOON = {
    lisbon: { n: 'LISBON', season: 'Surf all year · kite April to October', hubs: 'Cais do Sodré, Oriente and Sete Rios', spots: [
      [['surf'], 'Carcavelos', '25 MIN', 'Beach break, all levels, a train from Cais do Sodré'], [['kite', 'surf'], 'Guincho', '35 MIN', 'Strong summer northerly: experts on the kite'],
      [['surf'], 'Costa da Caparica', '30 MIN', 'A long beach with lots of peaks'], [['wing', 'sup'], 'Lagoa de Albufeira', '45 MIN', 'A flat lagoon: rookie heaven'], [['mtb'], 'Sintra', '35 MIN', 'Forest trails, blue to black']] },
    tarifa: { n: 'TARIFA', season: 'Kite + wing all year', hubs: 'Tarifa town and Algeciras', spots: [
      [['kite'], 'Los Lances', '5 MIN', 'The town beach, levante and poniente'], [['kite', 'wing'], 'Valdevaqueros', '15 MIN', 'A big beach, schools at the east end'],
      [['surf'], 'El Palmar', '45 MIN', 'Winter swell, beach peaks'], [['mtb'], 'Alcornocales', '30 MIN', 'Cork-oak trails in the hills']] },
    berlin: { n: 'BERLIN', season: 'SUP + wing May to September · MTB all year', hubs: 'Hauptbahnhof, Ostkreuz and Südkreuz', spots: [
      [['wing', 'sup'], 'Müggelsee', '35 MIN', 'A big lake, westerlies across it'], [['sup'], 'Wannsee', '30 MIN', 'Sheltered bays, calm mornings'],
      [['mtb'], 'Grunewald', '25 MIN', 'Sandy singletrack, blue to red'], [['mtb'], 'Teufelsberg', '25 MIN', 'Short, steep descents']] },
  };
  const pad3 = (n) => String(n).padStart(3, '0');
  const source = () => { try { const u = new URL(location.href); return (u.searchParams.get('utm_source') || u.searchParams.get('src') || document.referrer.replace(/^https?:\/\/([^/]+).*/, '$1') || '').slice(0, 80); } catch { return ''; } };
  const ref = () => { try { return (new URL(location.href).searchParams.get('ref') || '').slice(0, 40); } catch { return ''; } };

  async function post(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      let data = {}; try { data = await r.json(); } catch {}
      return { status: r.status, data };
    } catch { return { status: 0, data: { ok: false, error: 'offline' } }; }
  }
  let countsP = null;
  const counts = () => (countsP ||= fetch('/api/counts').then((r) => r.json()).catch(() => ({ ok: false })));

  function showErrors(form, res) {
    $$('[data-err]', form).forEach((e) => { e.textContent = ''; });
    const f = (res.data && res.data.fields) || {};
    for (const [k, msg] of Object.entries(f)) { const e = $(`[data-err="${k}"]`, form); if (e) e.textContent = msg; }
    const err = res.data && res.data.error;
    const top = $('[data-err="form"]', form);
    if (err === 'invalid') top.textContent = 'Check the fields marked in pink.';
    else if (err === 'not_configured') top.textContent = 'Sign-ups open in a moment: we are switching the list on. Try again in a few minutes.';
    else if (err) top.textContent = 'That didn\'t go through. Check your connection and try again.';
    const first = Object.keys(f)[0]; if (first) { const i = form.elements[first]; if (i && i.focus) i.focus(); }
  }
  function busy(form, on, label) { const b = $('[data-submit]', form); if (!b) return; if (on) { b.dataset.label = b.textContent; b.textContent = label || 'ONE SEC…'; b.disabled = true; } else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; } }
  function shareBox(url) {
    const inp = h('input', { class: 'inp', value: url, readonly: true, 'aria-label': 'Your share link' });
    const btn = h('button', { type: 'button', class: 'btn lm sm', text: 'COPY LINK' });
    btn.addEventListener('click', async () => {
      try { if (navigator.share) await navigator.share({ title: 'Hi8ctane', url }); else { await navigator.clipboard.writeText(url); btn.textContent = 'COPIED ✓'; } }
      catch { inp.select(); }
    });
    return h('div', { class: 'share' }, inp, btn);
  }

  // ---- counts on every page ---------------------------------------------------------------------------------------------
  counts().then((c) => {
    if (!c.ok) return;
    $$('[data-night-going]').forEach((e) => { e.textContent = `${c.night.going} OF 150 GOING`; });
    const by = Object.fromEntries(c.cities.map((x) => [x.slug, x]));
    $$('[data-cities] .cty').forEach((a) => {
      const slug = a.getAttribute('href').split('/').pop(), x = by[slug]; if (!x) return;
      $('i', a).style.width = Math.min(100, x.riders / x.riders_goal * 100) + '%';
      $('small', a).textContent = `${x.riders}/${x.riders_goal} · ${x.captains}/${x.captains_goal}`;
    });
    const ams = by.amsterdam, el = $('[data-plates-left]');
    if (ams && el) el.textContent = `${ams.plates_left} OF 100 LEFT IN AMSTERDAM · ${by.barcelona ? by.barcelona.plates_left : 100} IN BARCELONA`;
  });

  // ---- the week board + today's call -----------------------------------------------------------------------------------------------
  async function loadWeek(city) {
    const box = $('[data-week]'); if (!box) return;
    $('[data-week-tag]').textContent = 'THE GOOD-DAY METER · ' + (city === 'bcn' ? 'BARCELONA' : 'AMSTERDAM');
    $('[data-call-city]').textContent = city === 'bcn' ? 'BARCELONA' : 'AMSTERDAM';
    let w = { ok: false };
    try { w = await (await fetch('/api/week?city=' + city)).json(); } catch {}
    box.replaceChildren();
    if (!w.ok) {
      box.append(h('div', { class: 'week-off' }, h('b', { text: 'The meter wakes up at launch. ' }), 'Every morning it rates each sport at its best spot near you, hour by hour.'));
      $('[data-week-note]').textContent = '';
      $('[data-call-line]').textContent = 'The meter wakes up at launch.';
      return;
    }
    const grid = h('div', { class: 'week', role: 'table', 'aria-label': 'The week ahead' });
    grid.append(h('span', { role: 'columnheader' }), ...w.days.map((d) => h('span', { class: 'dh', role: 'columnheader', text: d.label })));
    const calls = [null, null];
    for (const r of w.rows) {
      const top = Math.max(...r.cells.map((c) => c.score ?? -1));
      grid.append(h('span', { class: 'sp', role: 'rowheader' }, h('img', { src: `/img/sports/${r.sport}-flat.svg`, alt: '', width: 38, height: 38 }), NAME[r.sport]));
      r.cells.forEach((c, i) => {
        const cls = c.score == null ? 'NO' : c.label === 'NO GO' ? 'NO' : c.label;
        const best = c.score != null && c.score === top && c.score >= 6;
        grid.append(h('div', { class: `cell ${cls}${best ? ' best' : ''}`, role: 'cell', 'aria-label': `${NAME[r.sport]} ${w.days[i].label}: ${c.label}${c.score != null ? ' ' + c.score + ' out of 10' : ''}${c.spot ? ' at ' + c.spot : ''}` },
          h('b', { text: c.score == null || c.label === 'NO GO' ? c.label : `${c.label} ${c.score}` }), h('span', { text: c.key || '' }), c.spot ? h('span', { class: 'w', text: c.spot + (c.window ? ' · ' + c.window : '') }) : null));
        if (c.score != null && (i === 0 || i === 1)) { const pick = calls[i]; if (!pick || c.score > pick.score) calls[i] = { ...c, sport: r.sport }; }
      });
    }
    box.append(grid);
    $('[data-week-note]').textContent = `Updated ${new Date(w.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Forecast: ${w.source}. A model, not a beach sensor: every session is your own call. MX joins when the track calendars are in.`;
    const call = calls[0] || calls[1];
    if (call) {
      if (!calls[0]) $('[data-call-city]').textContent += ' · TOMORROW';
      $('[data-call-label]').textContent = call.label === 'NO GO' ? 'NO' : call.label;
      $('[data-call-score]').textContent = `${call.score}/10`;
      $('[data-call-line]').replaceChildren(`${NAME[call.sport]} · ${call.spot} · ${call.key}`, call.window ? h('span', { class: 'nw', text: ' · ' + call.window }) : '');
      $$('[data-call-meter] i').forEach((i, n) => { i.className = n < call.score ? (n >= 8 ? 'pk' : 'on') : ''; });
      $('[data-call-why]').textContent = call.score >= 6 ? 'When the app is live, this is where the crews for it show up, with a seat from your hub.' : 'Not today. The week board shows the next good day.';
    } else { $('[data-call-line]').textContent = 'Done for today. The board shows the next days.'; }
  }

  // ---- levels picker (home + city) ---------------------------------------------------------------------------------------------
  function levelsUI(box, sports, levels) {
    box.replaceChildren();
    if (!sports.size) { box.append(h('p', { class: 'note', style: 'margin:0', text: 'Pick your sports below and say what you can do in each.' })); return; }
    for (const sp of sports) {
      const opts = h('div', { class: 'opts' });
      for (const [k, d] of LEVELS[sp]) {
        const b = h('button', { type: 'button', 'aria-pressed': String(levels[sp] === k) }, h('b', { text: k.toUpperCase() }), h('span', { text: d }));
        b.addEventListener('click', () => { levels[sp] = k; $$('button', opts).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
        opts.append(b);
      }
      box.append(h('div', { class: 'lvl' }, h('div', { class: 'lh' }, h('img', { src: `/img/sports/${sp}.svg`, alt: '', width: 22, height: 22 }), NAME[sp], h('span', { style: 'margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--quiet)', text: 'WHAT CAN YOU DO?' })), opts));
    }
  }

  // ---- home ---------------------------------------------------------------------------------------------------------------------
  function home() {
    const state = { hub: 'west', sports: new Set(), levels: {} };
    const form = $('[data-signup]'), citySel = form.elements.city, hubSel = form.elements.hub, lvBox = $('[data-levels]'), formSports = $('[data-form-sports]');
    const cityOfHub = (hub) => (['bcn', 'sants', 'gracia', 'sagrera'].includes(hub) ? 'barcelona' : 'amsterdam');
    const fillHubs = () => { const list = HUBS[citySel.value] || HUBS.lisbon; hubSel.replaceChildren(...list.map(([v, t]) => h('option', { value: v, text: t }))); const want = state.hub === 'bcn' ? 'sants' : state.hub; if (list.some(([v]) => v === want)) hubSel.value = want; };
    const syncSports = () => {
      $$('.sport').forEach((b) => b.setAttribute('aria-pressed', String(state.sports.has(b.dataset.sport))));
      $('.sports').classList.toggle('dim', state.sports.size > 0);
      $$('button', formSports).forEach((b) => b.setAttribute('aria-pressed', String(state.sports.has(b.dataset.sport))));
      levelsUI(lvBox, state.sports, state.levels);
    };
    const toggle = (sp) => { if (state.sports.has(sp)) state.sports.delete(sp); else { state.sports.add(sp); if (!state.levels[sp]) state.levels[sp] = 'rookie'; } syncSports(); };
    for (const sp of Object.keys(NAME)) { const b = h('button', { type: 'button', class: 'chip', 'data-sport': sp, 'aria-pressed': 'false', text: NAME[sp] }); b.addEventListener('click', () => toggle(sp)); formSports.append(b); }
    $$('.sport').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.sport)));
    $$('[data-hub]').forEach((b) => b.addEventListener('click', () => {
      state.hub = b.dataset.hub; $$('[data-hub]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      citySel.value = cityOfHub(state.hub); fillHubs(); loadWeek(state.hub === 'bcn' ? 'bcn' : 'ams');
    }));
    citySel.addEventListener('change', fillHubs);
    fillHubs(); syncSports(); loadWeek('ams');

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const E = form.elements, sports = [...state.sports], levels = Object.fromEntries(sports.map((s) => [s, state.levels[s] || 'rookie']));
      const body = { city: E.city.value, first_name: E.first_name.value, email: E.email.value, hub: E.hub.value, sports, levels, captain: E.captain.checked,
        captain_sport: E.captain.checked ? sports[0] || null : null, captain_days: [], consent: E.consent.checked, source: source(), ref: ref(), website: E.website.value };
      busy(form, true); const res = await post('/api/signup', body); busy(form, false);
      if (!res.data.ok) return showErrors(form, res);
      showErrors(form, { data: {} });
      const r = res.data, box = $('[data-result]', form), share = `${location.origin}/?ref=${r.plate ? pad3(r.plate) : 'friend'}&utm_source=friend`;
      box.replaceChildren(h('div', { class: 'row' }, h('span', { class: 'stamp', text: r.plate ? pad3(r.plate) : '✓' }),
        h('div', {}, h('div', { class: 'k', text: r.existing ? 'YOU WERE ALREADY IN' : 'YOU\'RE IN' }),
          h('h3', { text: r.plate ? `Founding plate #${pad3(r.plate)} in ${r.city_name} is yours.` : `You're on the list for ${r.city_name}.` }),
          h('div', { style: 'font-size:13px', text: r.status === 'open' ? 'We email you the night before the first good day.' : `${r.city_name} opens at ${r.riders_goal} riders and ${r.captains_goal} captains: ${r.riders} in so far.` }))),
        h('p', { style: 'margin:12px 0 0;font-size:13px', text: 'Bring your crew: every mate who joins from your link rides with you on day one.' }), shareBox(share));
      box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // ---- Founding Night ----------------------------------------------------------------------------------------------------------
  function night() {
    const form = $('[data-rsvp]'); let session = 'kite-wing';
    $$('[data-session]').forEach((b) => b.addEventListener('click', () => { session = b.dataset.session; $$('[data-session]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const E = form.elements;
      const body = { first_name: E.first_name.value, email: E.email.value, session, hub: E.hub.value, waiver: E.waiver.checked, photo: E.photo.checked, website: E.website.value };
      busy(form, true); const res = await post('/api/rsvp', body); busy(form, false);
      if (!res.data.ok) return showErrors(form, res);
      showErrors(form, { data: {} });
      const box = $('[data-result]', form);
      box.replaceChildren(h('div', { class: 'k', text: res.data.existing ? 'UPDATED · YOU\'RE STILL GOING' : 'YOU\'RE GOING' }), h('h3', { text: 'See you on the 23rd.' }),
        h('div', { style: 'font-size:13px', text: 'The venue and your crew\'s pickup come by email a week before, the call 3 hours before the first session.' }), shareBox(location.origin + '/night?utm_source=friend'));
      box.hidden = false;
      if (res.data.going) $$('[data-night-going]').forEach((e) => { e.textContent = `${res.data.going} OF 150 GOING`; });
    });
  }

  // ---- a new city ----------------------------------------------------------------------------------------------------------------
  function city() {
    const parts = location.pathname.split('/').filter(Boolean);
    let slug = (parts[0] === 'city' ? parts[1] : parts[0]) || new URL(location.href).searchParams.get('c') || 'lisbon';
    if (!SOON[slug]) slug = 'lisbon';
    const form = $('[data-city-form]'), sports = new Set(), days = new Set(['sat']);
    const tabs = $('[data-city-tabs]');
    for (const k of Object.keys(SOON)) tabs.append(h('a', { class: 'chip', href: '/city/' + k, 'aria-current': k === slug ? 'page' : null, 'aria-pressed': String(k === slug), text: SOON[k].n }));
    const c = SOON[slug];
    document.title = `Start Hi8ctane in ${c.n.charAt(0) + c.n.slice(1).toLowerCase()}`;
    $('[data-city-name]').textContent = c.n; $('[data-season]').textContent = c.season; $('[data-hubs]').textContent = c.hubs;
    const all = []; c.spots.forEach((s) => s[0].forEach((x) => { if (!all.includes(x)) all.push(x); }));
    $('[data-spot-tag]').textContent = `${c.spots.length} SPOTS · ${all.length} SPORTS`;
    $('[data-spots]').replaceChildren(...c.spots.map(([sps, n, m, d]) => h('div', { class: 'spot-row' }, h('span', { class: 'ic' }, ...sps.map((s) => h('img', { src: `/img/sports/${s}.svg`, alt: NAME[s], width: 32, height: 32 }))), h('span', {}, h('b', { text: n }), h('span', { text: d })), h('em', { text: m }))));
    const sbox = $('[data-city-sports]');
    for (const s of all) { const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: NAME[s] }); b.addEventListener('click', () => { if (sports.has(s)) sports.delete(s); else sports.add(s); b.setAttribute('aria-pressed', String(sports.has(s))); }); sbox.append(b); }
    $$('[data-day]').forEach((b) => b.addEventListener('click', () => { const d = b.dataset.day; if (days.has(d)) days.delete(d); else days.add(d); b.setAttribute('aria-pressed', String(days.has(d))); }));
    $('[data-captain]').addEventListener('change', (e) => { $('[data-captain-more]').hidden = !e.target.checked; $('[data-submit]', form).textContent = e.target.checked ? "I'LL CAPTAIN" : 'COUNT ME IN'; });
    const meters = (r, k, rg = 25, kg = 3) => { $('[data-riders]').textContent = `${r} / ${rg}`; $('[data-captains]').textContent = `${k} / ${kg}`; $('[data-riders-bar]').style.width = Math.min(100, r / rg * 100) + '%'; $('[data-captains-bar]').style.width = Math.min(100, k / kg * 100) + '%'; };
    counts().then((x) => { if (!x.ok) return; const y = x.cities.find((q) => q.slug === slug); if (y) meters(y.riders, y.captains, y.riders_goal, y.captains_goal); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const E = form.elements, sp = [...sports];
      const body = { city: slug, first_name: E.first_name.value, email: E.email.value, hub: 'other', sports: sp, levels: {}, captain: E.captain.checked,
        captain_sport: E.captain.checked ? sp[0] || null : null, captain_days: E.captain.checked ? [...days] : [], consent: E.consent.checked, source: source(), ref: ref(), website: E.website.value };
      busy(form, true); const res = await post('/api/signup', body); busy(form, false);
      if (!res.data.ok) return showErrors(form, res);
      showErrors(form, { data: {} });
      const r = res.data; meters(r.riders, r.captains, r.riders_goal, r.captains_goal);
      const need = Math.max(0, r.riders_goal - r.riders), needC = Math.max(0, r.captains_goal - r.captains), nm = r.city_name;
      const box = $('[data-result]', form);
      box.replaceChildren(h('div', { class: 'k', text: r.existing ? 'YOU WERE ALREADY IN' : body.captain ? 'FOUNDING CAPTAIN · ' + nm.toUpperCase() : 'YOU\'RE IN' }),
        h('h3', { text: need || needC ? `${need} more riders and ${needC} captain${needC === 1 ? '' : 's'} to open ${nm}.` : `${nm} has what it needs. We're on it.` }),
        h('div', { style: 'font-size:13px', text: 'Everyone who joins from your link counts. We email you once, the day it opens.' }), shareBox(`${location.origin}/city/${slug}?utm_source=friend`));
      box.hidden = false;
    });
  }

  const page = document.body.dataset.page;
  if (page === 'home') home(); else if (page === 'night') night(); else if (page === 'city') city();
})();
