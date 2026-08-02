/* =========================================================
 * ui-upgrade.js
 * 1) Numeric keypad (boro touch button) + auto "ferot" hishab
 * 2) Barcode scanner support
 * 3) Boro touch-friendly button (tablet/phone)
 * ========================================================= */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function injectCss() {
    if (el('uiUpgradeCss')) return;
    var css = [
      '.keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:8px}',
      '.keypad button{padding:15px 0;font-size:18px;font-weight:700;border:1.5px solid var(--line);',
      'background:#fff;color:var(--ink);border-radius:13px;cursor:pointer;transition:.12s}',
      '.keypad button:hover{background:#fdeef5;border-color:var(--pink);color:var(--pink)}',
      '.keypad button:active{transform:scale(.94)}',
      '.keypad button.wide{grid-column:span 2}',
      '.keypad button.act{background:#fdeef5;color:var(--pink);font-size:14px}',
      '.keypad button.clr{background:#fdecec;color:var(--bad);font-size:14px}',
      '.quick-cash{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
      '.quick-cash button{flex:1;min-width:66px;padding:11px 4px;font-size:13.5px;font-weight:700;',
      'border:1.5px solid var(--line);background:#fff;border-radius:11px;cursor:pointer;color:var(--pink)}',
      '.quick-cash button:hover{background:#fdeef5;border-color:var(--pink)}',
      '.change-box{margin-top:10px;padding:13px;border-radius:14px;text-align:center;',
      'background:#e5f7ee;border:1.5px solid #bfe9d3}',
      '.change-box.due{background:#fdecec;border-color:#f6d4d4}',
      '.change-box .lbl{font-size:11.5px;font-weight:700;color:var(--muted);letter-spacing:.4px}',
      '.change-box .amt{font-size:26px;font-weight:800;color:var(--ok);line-height:1.25}',
      '.change-box.due .amt{color:var(--bad)}',
      '.scan-bar{display:flex;align-items:center;gap:8px;padding:9px 12px;margin-bottom:10px;',
      'background:#fff;border:1.5px dashed var(--line);border-radius:13px;font-size:12.5px;color:var(--muted)}',
      '.scan-bar.on{border-color:var(--ok);background:#f2fbf6;color:var(--ok);font-weight:600}',
      '#checkoutBtn{padding:17px 20px !important;font-size:17px !important;border-radius:15px !important}',
      '@media(max-width:760px){.prod{padding:14px 11px}.prod .nm{font-size:13.5px}',
      '.qty-btn{width:34px;height:34px;font-size:18px}.cart-line input{width:62px;padding:8px}',
      '.btn{padding:13px 17px}.btn-sm{padding:9px 13px}}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'uiUpgradeCss';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function fireInput(node) {
    if (!node) return;
    try { node.dispatchEvent(new Event('input', { bubbles: true })); }
    catch (e) { if (typeof renderCart === 'function') renderCart(); }
  }

  /* ---------- keypad ---------- */
  var keypadTarget = 'paidInput';

  window.kpFocus = function (which) {
    keypadTarget = which;
    var wrap = el('kpWrap');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-kt]'), function (b) {
      b.classList.toggle('act', b.getAttribute('data-kt') === which);
    });
  };

  window.kpPress = function (ch) {
    var input = el(keypadTarget);
    if (!input) return;
    var cur = String(input.value || '');
    if (cur === '0') cur = '';
    if (ch === '.') { if (cur.indexOf('.') !== -1) return; if (!cur) cur = '0'; }
    input.value = cur + ch;
    fireInput(input);
  };

  window.kpBack = function () {
    var input = el(keypadTarget);
    if (!input) return;
    var cur = String(input.value || '');
    input.value = cur.length > 1 ? cur.slice(0, -1) : '0';
    fireInput(input);
  };

  window.kpClear = function () {
    var input = el(keypadTarget);
    if (!input) return;
    input.value = '0';
    fireInput(input);
  };

  window.kpQuick = function (amount) {
    var input = el('paidInput');
    if (!input) return;
    keypadTarget = 'paidInput';
    input.value = Number(amount);
    fireInput(input);
  };

  window.kpExact = function () {
    var input = el('paidInput');
    if (!input) return;
    var sub = typeof cartSubtotal === 'function' ? cartSubtotal() : 0;
    var disc = Number(((el('discountInput') || {}).value) || 0);
    input.value = Math.max(0, sub - disc).toFixed(2);
    fireInput(input);
  };

  function injectKeypad() {
    if (el('kpWrap')) return;
    var checkoutBtn = el('checkoutBtn');
    if (!checkoutBtn || !checkoutBtn.parentNode) return;

    var wrap = document.createElement('div');
    wrap.id = 'kpWrap';
    wrap.innerHTML = [
      '<div id="changeBox" class="change-box" style="display:none;">',
      '<div class="lbl" id="changeLbl">FEROT DIN</div>',
      '<div class="amt" id="changeAmt">Tk 0.00</div></div>',
      '<div class="quick-cash">',
      '<button type="button" onclick="kpExact()">Exact</button>',
      '<button type="button" onclick="kpQuick(500)">500</button>',
      '<button type="button" onclick="kpQuick(1000)">1000</button>',
      '<button type="button" onclick="kpQuick(2000)">2000</button>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:7px;margin-top:11px;font-size:11.5px;color:var(--muted);">',
      '<span>Keypad &gt;</span>',
      '<button type="button" class="btn btn-ghost btn-sm act" data-kt="paidInput" onclick="kpFocus(\'paidInput\')">Paid</button>',
      '<button type="button" class="btn btn-ghost btn-sm" data-kt="discountInput" onclick="kpFocus(\'discountInput\')">Discount</button>',
      '</div>',
      '<div class="keypad">',
      '<button type="button" onclick="kpPress(\'7\')">7</button>',
      '<button type="button" onclick="kpPress(\'8\')">8</button>',
      '<button type="button" onclick="kpPress(\'9\')">9</button>',
      '<button type="button" onclick="kpPress(\'4\')">4</button>',
      '<button type="button" onclick="kpPress(\'5\')">5</button>',
      '<button type="button" onclick="kpPress(\'6\')">6</button>',
      '<button type="button" onclick="kpPress(\'1\')">1</button>',
      '<button type="button" onclick="kpPress(\'2\')">2</button>',
      '<button type="button" onclick="kpPress(\'3\')">3</button>',
      '<button type="button" onclick="kpPress(\'0\')">0</button>',
      '<button type="button" onclick="kpPress(\'.\')">.</button>',
      '<button type="button" class="clr" onclick="kpBack()">Back</button>',
      '<button type="button" class="clr wide" onclick="kpClear()">Clear</button>',
      '<button type="button" class="act" onclick="kpExact()">Exact</button>',
      '</div>'
    ].join('');

    checkoutBtn.parentNode.insertBefore(wrap, checkoutBtn);
    updateChangeBox();
  }

  function updateChangeBox() {
    var box = el('changeBox');
    if (!box) return;
    var sub = typeof cartSubtotal === 'function' ? cartSubtotal() : 0;
    var disc = Number(((el('discountInput') || {}).value) || 0);
    var paid = Number(((el('paidInput') || {}).value) || 0);
    var total = Math.max(0, sub - disc);
    var change = paid - total;

    if (!sub) { box.style.display = 'none'; return; }
    box.style.display = 'block';

    if (change >= 0) {
      box.classList.remove('due');
      el('changeLbl').textContent = 'FEROT DIN';
      el('changeAmt').textContent = 'Tk ' + change.toFixed(2);
    } else {
      box.classList.add('due');
      el('changeLbl').textContent = 'BAKI THAKBE';
      el('changeAmt').textContent = 'Tk ' + Math.abs(change).toFixed(2);
    }
  }

  var prevHook = window.onCartRendered;
  window.onCartRendered = function () {
    if (typeof prevHook === 'function') { try { prevHook(); } catch (e) {} }
    injectKeypad();
    updateChangeBox();
  };

  /* ---------- barcode ---------- */
  var scanBuf = '';
  var scanLast = 0;

  function findByBarcode(code) {
    var list = window.productsCache || [];
    var hit = list.find(function (p) { return String(p.barcode || '') === code; });
    if (hit) return hit;
    return list.find(function (p) { return String(p.sku || '').toLowerCase() === code.toLowerCase(); });
  }

  function flashScanBar() {
    var bar = el('scanBar');
    if (!bar) return;
    bar.classList.add('on');
    setTimeout(function () { bar.classList.remove('on'); }, 700);
  }

  function handleScan(code) {
    if (!code || code.length < 3) return;
    var p = findByBarcode(code);
    if (!p) {
      if (typeof toast === 'function') toast('Barcode pawa jayni: ' + code, 'err');
      return;
    }
    if (typeof stockOf === 'function' && stockOf(p) <= 0) {
      if (typeof toast === 'function') toast(p.name + ' -- stock shesh', 'err');
      return;
    }
    if (typeof addToCart === 'function') {
      addToCart(p.id);
      if (typeof toast === 'function') toast('+ ' + p.name, 'ok');
      flashScanBar();
    }
  }

  document.addEventListener('keydown', function (e) {
    var posView = el('v-pos');
    if (!posView || !posView.classList.contains('active')) return;
    var mb = el('modalBack');
    if (mb && mb.classList.contains('show')) return;

    var tag = (document.activeElement && document.activeElement.tagName) || '';
    var activeId = (document.activeElement && document.activeElement.id) || '';
    if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && activeId !== 'posSearch') return;

    var now = Date.now();
    if (now - scanLast > 120) scanBuf = '';
    scanLast = now;

    if (e.key === 'Enter') {
      var code = scanBuf.trim();
      scanBuf = '';
      if (code.length >= 3) {
        e.preventDefault();
        handleScan(code);
        var s = el('posSearch');
        if (s) { s.value = ''; if (typeof renderPOSGrid === 'function') renderPOSGrid(); }
      }
      return;
    }
    if (e.key.length === 1) scanBuf += e.key;
  });

  function injectScanBar() {
    if (el('scanBar')) return;
    var grid = el('posGrid');
    if (!grid || !grid.parentNode) return;
    var bar = document.createElement('div');
    bar.id = 'scanBar';
    bar.className = 'scan-bar';
    bar.innerHTML = '<span>[SCAN]</span><span>Barcode scanner ready -- scan korlei cart e chole ashbe</span>';
    grid.parentNode.insertBefore(bar, grid);
  }

  function tick() {
    injectCss();
    var pos = el('v-pos');
    if (pos && pos.classList.contains('active')) {
      injectScanBar();
      injectKeypad();
      updateChangeBox();
    }
  }

  injectCss();
  setInterval(tick, 700);
  console.log('[ui-upgrade.js] keypad + barcode + touch UI installed');
})();
