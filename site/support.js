/*
 * Hi8ctane prototype player (support.js)
 *
 * Runs the canvas screen files (*.dc.html) in any browser, without the design tool:
 *   - <helmet> content (fonts, styles) goes into <head>
 *   - the template inside <x-dc> renders with the screen's `Component` (a class extending DCLogic)
 *   - {{name}} / {{item.field}} fill text and attributes, <sc-if value> shows or hides, <sc-for list as> repeats
 *   - onClick / onChange / on… attributes call the screen's handlers; setState re-renders in place
 *
 *   - a screen whose content grows past its designed height (six sports picked, the captain form open)
 *     grows with it instead of being cut off; when the content fits, nothing changes
 *   - window.DC_EXTEND (see live.js) can extend a screen's Component without touching the screen file;
 *     componentDidUpdate() runs after every re-render
 *
 * Plain JavaScript, no dependencies, no network calls. Written for Hi8ctane; free to change.
 */
(function () {
  'use strict';

  var head = document.head || document.documentElement;
  // keep the raw template out of sight while the page loads; outside the screen's own frame,
  // centre it on a dark backdrop (the frame itself is untouched)
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}' +
    'html{background:#1C1B19}#dc-root>.sc-host{width:fit-content;margin:0 auto}';
  head.appendChild(hide);
  // phones: lay the page out at the device's real width
  if (!document.querySelector('meta[name="viewport"]')) {
    var vm = document.createElement('meta');
    vm.name = 'viewport';
    vm.content = 'width=device-width, initial-scale=1';
    head.appendChild(vm);
  }

  var comp = null, host = null, tpl = [], mounted = false;
  var queue = [], callbacks = [], scheduled = false, rendering = false;

  // ---- the base class the screens extend (React-like class component) ----
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (update, cb) {
    queue.push(update);
    if (typeof cb === 'function') callbacks.push(cb.bind(this));
    schedule();
  };
  DCLogic.prototype.forceUpdate = function (cb) {
    if (typeof cb === 'function') callbacks.push(cb.bind(this));
    schedule();
  };
  window.DCLogic = DCLogic;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(flush);
  }
  function flush() {
    scheduled = false;
    if (!comp) return;
    var s = comp.state, q = queue;
    queue = [];
    for (var i = 0; i < q.length; i++) {
      var p = typeof q[i] === 'function' ? q[i].call(comp, s, comp.props) : q[i];
      if (p != null) s = Object.assign({}, s, p);
    }
    comp.state = s;
    render();
    var cbs = callbacks;
    callbacks = [];
    for (var j = 0; j < cbs.length; j++) cbs[j]();
  }

  // ---- values ----
  var RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
  function single(str) {
    var m = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/.exec(str || '');
    return m ? m[1] : null;
  }
  function lookup(expr, scopes) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr === 'undefined' || expr === '') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    var q = /^(['"])([\s\S]*)\1$/.exec(expr);
    if (q) return q[2];
    var parts = expr.split('.'), head = parts[0], v, found = false;
    for (var i = scopes.length - 1; i >= 0; i--) {
      var sc = scopes[i];
      if (sc != null && head in Object(sc)) { v = sc[head]; found = true; break; }
    }
    if (!found) return undefined;
    for (var j = 1; j < parts.length; j++) {
      if (v == null) return undefined;
      v = v[parts[j]];
    }
    return v;
  }
  function text(v) { return v == null || v === true || v === false ? '' : String(v); }
  function interp(str, scopes) {
    return str.replace(RE, function (_, e) { return text(lookup(e, scopes)); });
  }
  function truthy(v) { return Array.isArray(v) ? v.length > 0 : !!v; }
  function eventType(attr, el) {
    var t = attr.slice(2).toLowerCase();
    if (t === 'change' && /^(input|textarea)$/i.test(el.localName)) {
      var ty = (el.getAttribute('type') || '').toLowerCase();
      return ty === 'checkbox' || ty === 'radio' || ty === 'file' ? 'change' : 'input';
    }
    if (t === 'doubleclick') return 'dblclick';
    return t;
  }

  // ---- build a fresh tree from the template ----
  function buildChildren(nodes, scopes, parent) {
    for (var i = 0; i < nodes.length; i++) buildNode(nodes[i], scopes, parent);
  }
  function buildNode(n, scopes, parent) {
    if (n.nodeType === 3) {
      var t = n.nodeValue;
      if (/^\s*$/.test(t) && t.indexOf('\n') >= 0) return; // layout whitespace between tags, as in JSX
      if (t.indexOf('{{') < 0) { parent.appendChild(document.createTextNode(t)); return; }
      // each filled-in value gets its own <span class="sc-interp">, exactly as the design tool renders it
      var last = 0, m;
      RE.lastIndex = 0;
      while ((m = RE.exec(t))) {
        if (m.index > last) parent.appendChild(document.createTextNode(t.slice(last, m.index)));
        var sp = document.createElement('span');
        sp.className = 'sc-interp';
        sp.textContent = text(lookup(m[1], scopes));
        parent.appendChild(sp);
        last = RE.lastIndex;
      }
      if (last < t.length) parent.appendChild(document.createTextNode(t.slice(last)));
      return;
    }
    if (n.nodeType !== 1) return;
    var name = n.localName;
    if (name === 'sc-if') {
      var ce = single(n.getAttribute('value'));
      if (truthy(ce != null ? lookup(ce, scopes) : n.getAttribute('value'))) buildChildren(n.childNodes, scopes, parent);
      return;
    }
    if (name === 'sc-for') {
      var le = single(n.getAttribute('list'));
      var list = le != null ? lookup(le, scopes) : null;
      var as = n.getAttribute('as') || 'item';
      if (list && typeof list.length === 'number') {
        for (var k = 0; k < list.length; k++) {
          var o = {};
          o[as] = list[k];
          o[as + 'Index'] = k;
          buildChildren(n.childNodes, scopes.concat([o]), parent);
        }
      }
      return;
    }
    var el = n.cloneNode(false), handlers = null, value;
    var attrs = Array.prototype.slice.call(n.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var an = attrs[a].name, av = attrs[a].value;
      if (av.indexOf('{{') < 0) continue;
      if (/^on/i.test(an)) {
        el.removeAttribute(an);
        var fe = single(av), fn = fe != null ? lookup(fe, scopes) : null;
        if (typeof fn === 'function') (handlers || (handlers = {}))[eventType(an, n)] = fn;
        continue;
      }
      var se = single(av), val;
      if (se != null) {
        val = lookup(se, scopes);
        if (val == null || (val === false && !/^(aria-|data-)/.test(an))) {
          el.removeAttributeNS(attrs[a].namespaceURI, attrs[a].localName);
          if (an === 'value') value = '';
          continue;
        }
        val = String(val);
      } else {
        val = interp(av, scopes);
      }
      el.setAttributeNS(attrs[a].namespaceURI, an, val);
      if (an === 'value') value = val;
    }
    if (handlers) el.__h = handlers;
    if (value !== undefined) el.__v = value;
    buildChildren(n.childNodes, scopes, el);
    parent.appendChild(el);
  }

  // ---- patch the page to match the fresh tree (keeps focus, scroll and iframes) ----
  function dispatch(ev) {
    var f = this.__h && this.__h[ev.type];
    if (f) f(ev);
  }
  function listen(el) {
    if (el.nodeType !== 1) return;
    if (el.__h) {
      var l = el.__l || (el.__l = {});
      for (var t in el.__h) if (!l[t]) { l[t] = true; el.addEventListener(t, dispatch); }
    }
    if (el.__v !== undefined && el.value !== el.__v) el.value = el.__v;
    for (var c = el.firstChild; c; c = c.nextSibling) listen(c);
  }
  function same(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    return a.localName === b.localName && a.namespaceURI === b.namespaceURI &&
      (a.localName !== 'input' || a.getAttribute('type') === b.getAttribute('type'));
  }
  function morph(o, n) {
    if (o.nodeType === 3 || o.nodeType === 8) {
      if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
      return;
    }
    var i, at, na = n.attributes, oa = o.attributes;
    for (i = 0; i < na.length; i++) {
      at = na[i];
      if (o.getAttributeNS(at.namespaceURI, at.localName) !== at.value) o.setAttributeNS(at.namespaceURI, at.name, at.value);
    }
    for (i = oa.length - 1; i >= 0; i--) {
      at = oa[i];
      if (!n.hasAttributeNS(at.namespaceURI, at.localName)) o.removeAttributeNS(at.namespaceURI, at.localName);
    }
    o.__h = n.__h;
    o.__v = n.__v;
    if (o.__h) {
      var l = o.__l || (o.__l = {});
      for (var t in o.__h) if (!l[t]) { l[t] = true; o.addEventListener(t, dispatch); }
    }
    if (o.__v !== undefined && o.value !== o.__v) o.value = o.__v;
    morphChildren(o, n);
  }
  function morphChildren(op, np) {
    var o = op.firstChild, n = np.firstChild;
    while (n) {
      var next = n.nextSibling;
      if (!o) {
        op.appendChild(n);
        listen(n);
      } else if (same(o, n)) {
        morph(o, n);
        o = o.nextSibling;
      } else {
        var after = o.nextSibling;
        op.replaceChild(n, o);
        listen(n);
        o = after;
      }
      n = next;
    }
    while (o) {
      var gone = o;
      o = o.nextSibling;
      op.removeChild(gone);
    }
  }

  function render() {
    if (rendering) { schedule(); return; }
    rendering = true;
    try {
      var vals = comp && typeof comp.renderVals === 'function' ? comp.renderVals() || {} : {};
      var fresh = document.createElement('div');
      buildChildren(tpl, [vals], fresh);
      morphChildren(host, fresh);
      grow();
    } catch (e) {
      if (window.console) console.error('[hi8 player]', e);
      if (window.DC_ERROR) try { window.DC_ERROR(e); } catch (x) { /* never let reporting break the page */ }
    } finally {
      rendering = false;
    }
    if (mounted && comp && typeof comp.componentDidUpdate === 'function') {
      try { comp.componentDidUpdate(); } catch (e2) { if (window.console) console.error('[hi8 player]', e2); if (window.DC_ERROR) try { window.DC_ERROR(e2); } catch (x) { /* ignore */ } }
    }
  }

  // the frame keeps its designed height; only when the content needs more does it grow to fit
  function grow() {
    var f = host && host.firstElementChild;
    if (!f || !f.style.height || f.style.height === 'auto') return;
    if (f.scrollHeight > f.clientHeight + 1) {
      f.style.minHeight = f.style.height;
      f.style.height = 'auto';
    }
  }

  // a screen wider than the window (a 390 px phone screen on a 360 px phone, the 1280 px web page on a
  // small laptop) is scaled down to fit, never cropped
  function fit() {
    var f = host && host.firstElementChild;
    if (!f) return;
    var w = parseFloat(f.style.width) || f.offsetWidth;
    var z = w ? Math.min(1, document.documentElement.clientWidth / w) : 1;
    host.style.zoom = z < 1 ? String(z) : '';
  }

  // ---- start ----
  function boot() {
    var x = document.querySelector('x-dc');
    if (!x) return;
    var kids = Array.prototype.slice.call(x.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.nodeType === 1 && c.localName === 'helmet') {
        while (c.firstChild) {
          var h = c.firstChild;
          if (h.nodeType === 1) document.head.appendChild(h); else c.removeChild(h);
        }
      } else {
        tpl.push(c);
      }
    }
    x.parentNode.removeChild(x);

    var root = document.createElement('div');
    root.id = 'dc-root';
    host = document.createElement('div');
    host.className = 'sc-host';
    host.setAttribute('data-sc-name', (location.pathname.split('/').pop() || '').replace(/\.dc\.html$/, ''));
    root.appendChild(host);
    document.body.insertBefore(root, document.body.firstChild);

    // the screen logic sits in <script type="text/x-dc" data-dc-script data-props='…'>; the browser doesn't run that type, we do
    var C = null, props = {};
    var s = document.querySelector('script[data-dc-script]');
    if (s) {
      try { props = JSON.parse(s.getAttribute('data-props') || '{}'); } catch (e) { props = {}; }
      try {
        C = new Function('DCLogic', s.textContent + '\n;return typeof Component !== "undefined" ? Component : null;')(DCLogic);
      } catch (e) {
        if (window.console) console.error('[hi8 player]', e);
      if (window.DC_ERROR) try { window.DC_ERROR(e); } catch (x) { /* never let reporting break the page */ }
      }
    }
    // extensions (live.js) get the screen's Component and its name, and may return a subclass
    var ext = window.DC_EXTEND || [], nm = host.getAttribute('data-sc-name');
    for (var e = 0; e < ext.length; e++) {
      try { C = ext[e](C || DCLogic, nm) || C; } catch (er) { if (window.console) console.error('[hi8 player]', er); }
    }
    comp = C ? new C(props) : new DCLogic(props);
    render();
    fit();
    window.addEventListener('resize', fit);
    mounted = true;
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
    window.addEventListener('pagehide', function () {
      if (comp && typeof comp.componentWillUnmount === 'function') comp.componentWillUnmount();
    });
  }

  // window.DC_READY (hi8.js): wait for live data such as the forecast before the first draw, at most 7 s
  function start() {
    var r = window.DC_READY;
    if (!r || typeof r.then !== 'function') { boot(); return; }
    var done = false, wait = document.createElement('div');
    wait.id = 'dc-wait';
    wait.textContent = 'LOADING THE FORECAST…';
    wait.setAttribute('style', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#C8FF3D;font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em');
    document.body.appendChild(wait);
    var go = function () { if (done) return; done = true; if (wait.parentNode) wait.parentNode.removeChild(wait); boot(); };
    r.then(go, go);
    setTimeout(go, 7000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
