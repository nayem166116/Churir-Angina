/* =========================================================
 * ux-extras.js  (v3.1)
 *  - Barcode scanner support on the POS screen
 *  - Big "CHANGE TO RETURN" box
 *  - Quick cash buttons (no on-screen keypad)
 * ========================================================= */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function injectCss() {
    if (el('uxExtrasCss')) return;
    var css = [
      '.quick-cash{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
      '.quick-cash button{flex:1;min-width:64px;padding:11px 4px;font-size:13.5px;font-weight:700;',
      'border:1.5px solid var(--line);background:#fff;border-radius:11px;cursor:pointer;color:var(--pink);transition:.15s}',
      '.quick-cash button:hover{background:#fdeef5;border-color:var(--pink)}',
      '.quick-cash button:active{transform:scale(.95)}',
      '.change-box{margin-top:10px;padding:14px;border-radius:14px;text-align:center;',
      'background:#e8f9f0;border:1.5px solid #bfe9d3}',
      '.change-box.due{background:#fdecec;border-color:#f6d4d4}',
      '.change-box .lbl{font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.7px}',
      '.change-box .amt{font-size:27px;font-weight:800;color:var(--ok);line-height:1.25}',
      '.change-box.due .amt{color:var(--bad)}',
      '.scan-bar{display:flex;align-items:center;gap:8px;padding:9px 13px;margin-bottom:11px;',
      'background:#fff;border:1.5px dashed var(--line);border-radius:13px;font-size:12.5px;color:var(--muted)}',
      '.scan-bar.on{border-color:var(--ok);background:#f2fbf6;color:var(--ok);font-weight:700}',
      '@media(max-width:760px){.btn{padding:13px 17px}.btn-sm{padding:9px 13px}}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'uxExtrasCss';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function fireInput(node) {
    if (!node) return;
    try { node.dispatchEvent(new Event('input', { bubbles: true })); }
    catch (e) { if (typeof renderCart === 'function') renderCart(); }
  }

  window.quickCash = function (amount) {
    var input = el('paidInput');
    if (!input) return;
    input.value = Number(amount);
    fireInput(input);
  };

  window.exactCash = function () {
    var input = el('paidInput');
    if (!input) return;
    var sub = typeof cartSubtotal === 'function' ? cartSubtotal() : 0;
    var disc = Number(((el('discountInput') || {}).value) || 0);
    input.value = Math.max(0, sub - disc).toFixed(2);
    fireInput(input);
  };

  function injectCashTools() {
    if (el('cashTools')) return;
    var checkoutBtn = el('checkoutBtn');
    if (!checkoutBtn || !checkoutBtn.parentNode) return;

    var wrap = document.createElement('div');
    wrap.id = 'cashTools';
    wrap.innerHTML = [
      '<div id="changeBox" class="change-box" style="display:none;">',
      '<div class="lbl" id="changeLbl">CHANGE TO RETURN</div>',
      '<div class="amt" id="changeAmt">0.00</div></div>',
      '<div class="quick-cash">',
      '<button type="button" onclick="exactCash()">Exact</button>',
      '<button type="button" onclick="quickCash(500)">500</button>',
      '<button type="button" onclick="quickCash(1000)">1000</button>',
      '<button type="button" onclick="quickCash(2000)">2000</button>',
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
      el('changeLbl').textContent = 'CHANGE TO RETURN';
      el('changeAmt').textContent = (typeof money === 'function' ? money(change) : change.toFixed(2));
    } else {
      box.classList.add('due');
      el('changeLbl').textContent = 'REMAINING DUE';
      el('changeAmt').textContent = (typeof money === 'function' ? money(Math.abs(change)) : Math.abs(change).toFixed(2));
    }
  }

  var prevHook = window.onCartRendered;
  window.onCartRendered = function () {
    if (typeof prevHook === 'function') { try { prevHook(); } catch (e) {} }
    injectCashTools();
    updateChangeBox();
  };

  /* ---------- barcode scanner ---------- */
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
    if (!p) { if (typeof toast === 'function') toast('Barcode not found: ' + code, 'err'); return; }
    if (typeof stockOf === 'function' && stockOf(p) <= 0) {
      if (typeof toast === 'function') toast(p.name + ' is out of stock', 'err');
      return;
    }
    if (typeof addToCart === 'function') {
      addToCart(p.id);
      if (typeof toast === 'function') toast('Added: ' + p.name, 'ok');
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
    bar.innerHTML = '<span>SCAN</span><span>Barcode scanner ready \u2014 scan a product to add it to the cart</span>';
    grid.parentNode.insertBefore(bar, grid);
  }

  function tick() {
    injectCss();
    var pos = el('v-pos');
    if (pos && pos.classList.contains('active')) {
      injectScanBar();
      injectCashTools();
      updateChangeBox();
    }
  }

  injectCss();
  setInterval(tick, 700);
  console.log('[ux-extras.js] barcode + change box installed');
})();
