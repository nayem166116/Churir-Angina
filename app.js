/* =========================================================
 * CHURIR ANGINA POS -- app.js (v3.1, English UI)
 * ========================================================= */
'use strict';

var CFG_KEY = 'ca_supabase_cfg_v2';
var sb = null;
var myProfile = null;
var cart = [];
var productsCache = [];
var customersCache = [];
var suppliersCache = [];
var currentView = 'dashboard';
var RENDERERS = {};

/* ---------- helpers ---------- */
function $(id) { return document.getElementById(id); }

function money(n) {
  var v = Number(n || 0);
  return '\u09F3' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '-';
  var dt = new Date(d);
  if (isNaN(dt)) return '-';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '-';
  var dt = new Date(d);
  if (isNaN(dt)) return '-';
  return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function toast(msg, kind) {
  var host = $('toastHost');
  if (!host) { console.log(msg); return; }
  var d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.textContent = msg;
  host.appendChild(d);
  setTimeout(function () { d.remove(); }, 3600);
}

function openModal(html) {
  $('modalBody').innerHTML = html;
  $('modalBack').classList.add('show');
}

function closeModal() {
  $('modalBack').classList.remove('show');
  $('modalBody').innerHTML = '';
}

function toggleSidebar() {
  var s = $('sidebar');
  if (s) s.classList.toggle('open');
}

function revealAll() {
  var els = document.querySelectorAll('.reveal:not(.in)');
  Array.prototype.forEach.call(els, function (e, i) {
    setTimeout(function () { e.classList.add('in'); }, i * 40);
  });
}

function pageHead(title, desc, actionsHtml) {
  return '<div class="page-head"><div><h2>' + escapeHtml(title) + '</h2>' +
    (desc ? '<div class="desc">' + escapeHtml(desc) + '</div>' : '') + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (actionsHtml || '') + '</div></div>';
}

function emptyRow(cols, text) {
  return '<tr><td colspan="' + cols + '"><div class="empty"><div class="big">\u2014</div>' + escapeHtml(text) + '</div></td></tr>';
}

function stockOf(p) { return Number(p.stock_pcs || 0); }
function priceOf(p) { return Number(p.sale_price_pcs != null ? p.sale_price_pcs : (p.price_pcs || 0)); }
function pcsPerBox(p) { return Number((p && p.box_contains_dozen) || 0) * 12; }

/* ---------- schema-safe writes ----------
 * If the database is missing a column the app tries to write,
 * Supabase returns: Could not find the 'x' column of 'y' in the schema cache.
 * We drop that key and retry instead of failing the whole save.
 */
function missingColumnFrom(err) {
  var m = String((err && err.message) || err || '').match(/Could not find the '([^']+)' column/);
  return m ? m[1] : null;
}

async function safeWrite(table, payload, id) {
  var body = {};
  Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
  var dropped = [];

  for (var attempt = 0; attempt < 12; attempt++) {
    var r = id
      ? await sb.from(table).update(body).eq('id', id)
      : await sb.from(table).insert(body);

    if (!r.error) return { ok: true, dropped: dropped };

    var col = missingColumnFrom(r.error);
    if (col && Object.prototype.hasOwnProperty.call(body, col)) {
      delete body[col];
      dropped.push(col);
      continue;
    }
    throw r.error;
  }
  throw new Error('Could not save after several attempts');
}

/* ---------- gate / config ---------- */
function switchGateTab(which) {
  var isC = which === 'connect';
  $('tabConnectBtn').classList.toggle('active', isC);
  $('tabLoginBtn').classList.toggle('active', !isC);
  $('tabConnect').classList.toggle('hidden', !isC);
  $('tabLogin').classList.toggle('hidden', isC);
}

function loadCfg() {
  try {
    var raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (o && o.url && o.anonKey) return o;
  } catch (e) {}
  return null;
}

function saveConfig() {
  var url = ($('inUrl').value || '').trim().replace(/\/+$/, '');
  var key = ($('inKey').value || '').trim();
  if (!url || !key) { toast('Both URL and key are required', 'err'); return; }
  localStorage.setItem(CFG_KEY, JSON.stringify({ url: url, anonKey: key }));
  if (!initSupabase()) return;
  toast('Connected', 'ok');
  switchGateTab('login');
}

function initSupabase() {
  var cfg = loadCfg();
  if (!cfg) return false;
  if (!window.supabase || !window.supabase.createClient) {
    toast('Supabase library failed to load. Check your internet.', 'err');
    return false;
  }
  try {
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    window.sb = sb;
    return true;
  } catch (e) {
    toast('Connection failed: ' + e.message, 'err');
    return false;
  }
}

/* ---------- auth ---------- */
async function doLogin() {
  var msg = $('loginMsg');
  var btn = $('loginBtn');
  msg.textContent = '';

  if (!sb && !initSupabase()) {
    msg.textContent = 'Supabase is not connected. Add your keys in config.js.';
    return;
  }

  var email = ($('inEmail').value || '').trim();
  var pass = $('inPass').value || '';
  if (!email || !pass) { msg.textContent = 'Enter your email and password.'; return; }

  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    var res = await sb.auth.signInWithPassword({ email: email, password: pass });
    if (res.error) throw res.error;
    await afterLogin(res.data.user);
  } catch (e) {
    msg.textContent = e.message || 'Sign in failed';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function afterLogin(user) {
  var r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  var prof = r.data;

  if (!prof) {
    var ins = await sb.from('profiles').insert({
      id: user.id,
      full_name: (user.email || '').split('@')[0],
      role: 'owner',
      active: true
    }).select().maybeSingle();
    if (ins.error) {
      $('loginMsg').textContent = 'Could not create your profile: ' + ins.error.message;
      await sb.auth.signOut();
      return;
    }
    prof = ins.data;
  }

  if (prof.active === false) {
    $('loginMsg').textContent = 'This account is disabled. Contact the owner.';
    await sb.auth.signOut();
    return;
  }

  myProfile = prof;
  window.myProfile = prof;

  $('waName').textContent = prof.full_name || 'User';
  $('waRole').textContent = (prof.role || 'staff').toUpperCase();
  $('gate').classList.add('hidden');
  $('app').classList.add('show');

  buildNav();
  await preloadMasterData();

  var start = (prof.role === 'cashier') ? 'pos' : 'dashboard';
  if (!canAccess(start)) start = 'pos';
  navigate(start);

  if (typeof window.onAfterLogin === 'function') {
    try { await window.onAfterLogin(prof); } catch (e) { console.warn(e); }
  }
}

async function doLogout() {
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  location.reload();
}

/* ---------- navigation ---------- */
var NAV = [
  { label: 'MAIN', items: [
    { id: 'dashboard', name: 'Dashboard' },
    { id: 'pos', name: 'Sell (POS)' }
  ]},
  { label: 'INVENTORY', items: [
    { id: 'products', name: 'Products' },
    { id: 'stock', name: 'Stock' },
    { id: 'purchases', name: 'Purchases' },
    { id: 'alerts', name: 'Low Stock' }
  ]},
  { label: 'SALES', items: [
    { id: 'sales', name: 'Sales History' },
    { id: 'returns', name: 'Returns' },
    { id: 'ledger', name: 'Due Ledger' }
  ]},
  { label: 'PEOPLE', items: [
    { id: 'customers', name: 'Customers' },
    { id: 'suppliers', name: 'Suppliers' },
    { id: 'staff', name: 'Staff' }
  ]},
  { label: 'MONEY', items: [
    { id: 'expenses', name: 'Expenses' },
    { id: 'reports', name: 'Reports' }
  ]},
  { label: 'SYSTEM', items: [
    { id: 'settings', name: 'Settings' }
  ]}
];

var ROLE_ACCESS = {
  owner: '*',
  manager: ['dashboard','pos','products','stock','purchases','alerts','sales','returns','ledger','customers','suppliers','expenses','reports','settings'],
  cashier: ['pos','sales','customers','ledger','alerts'],
  staff: ['pos','products','stock','alerts']
};

function canAccess(viewId) {
  var role = (myProfile && myProfile.role) || 'staff';
  var allow = ROLE_ACCESS[role] || ROLE_ACCESS.staff;
  if (allow === '*') return true;
  return allow.indexOf(viewId) !== -1;
}

function buildNav() {
  var host = $('navHost');
  if (!host) return;
  var html = '';
  NAV.forEach(function (g) {
    var items = g.items.filter(function (it) { return canAccess(it.id); });
    if (!items.length) return;
    html += '<div class="nav-group"><div class="nav-group-label">' + g.label + '</div>';
    items.forEach(function (it) {
      html += '<div class="nav-item" id="nav-' + it.id + '" onclick="navigate(\'' + it.id + '\')">' + escapeHtml(it.name) + '</div>';
    });
    html += '</div>';
  });
  host.innerHTML = html;
}

async function navigate(viewId) {
  if (!canAccess(viewId)) { toast('You do not have access to this page', 'err'); return; }

  currentView = viewId;
  window.currentView = viewId;

  Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.remove('active'); });
  var sec = $('v-' + viewId);
  if (sec) sec.classList.add('active');

  Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (n) { n.classList.remove('active'); });
  var nv = $('nav-' + viewId);
  if (nv) nv.classList.add('active');

  var titleMap = {};
  NAV.forEach(function (g) { g.items.forEach(function (it) { titleMap[it.id] = it.name; }); });
  titleMap.members = 'Members';
  titleMap.automation = 'Automation';
  $('pageTitle').textContent = titleMap[viewId] || viewId;

  var sbar = $('sidebar');
  if (sbar) sbar.classList.remove('open');

  var fn = RENDERERS[viewId];
  if (typeof fn === 'function') {
    try { await fn(); } catch (e) {
      console.error('[render ' + viewId + ']', e);
      if (sec) sec.innerHTML = '<div class="card"><h3>Could not load this page</h3><p style="color:var(--bad)">' + escapeHtml(e.message || e) + '</p></div>';
    }
  }
  revealAll();
}

async function preloadMasterData() {
  try {
    var res = await Promise.all([
      sb.from('products').select('*').order('name'),
      sb.from('customers').select('*').order('name'),
      sb.from('suppliers').select('*').order('name')
    ]);
    productsCache = res[0].data || [];
    customersCache = res[1].data || [];
    suppliersCache = res[2].data || [];
    window.productsCache = productsCache;
    window.customersCache = customersCache;
    window.suppliersCache = suppliersCache;
  } catch (e) {
    console.warn('preload failed', e);
  }
}

function filterTable(tbodyId, inputId) {
  var q = (($(inputId) || {}).value || '').toLowerCase();
  var tb = $(tbodyId);
  if (!tb) return;
  Array.prototype.forEach.call(tb.rows, function (r) {
    r.style.display = r.textContent.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
  });
}

/* ---------- DASHBOARD ---------- */
RENDERERS.dashboard = async function () {
  var host = $('v-dashboard');
  try {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var iso = today.toISOString();

    var res = await Promise.all([
      sb.from('sales').select('*').gte('created_at', iso),
      sb.from('expenses').select('*').gte('created_at', iso),
      sb.from('products').select('*'),
      sb.from('sales').select('*').order('created_at', { ascending: false }).limit(8)
    ]);

    var todaySales = (res[0].data || []).filter(function (s) { return s.status !== 'cancelled'; });
    var todayExp = res[1].data || [];
    var prods = res[2].data || [];
    var recent = res[3].data || [];

    var revenue = todaySales.reduce(function (a, s) { return a + Number(s.total || 0); }, 0);
    var cash = todaySales.reduce(function (a, s) { return a + Number(s.paid || 0); }, 0);
    var due = todaySales.reduce(function (a, s) { return a + Number(s.due_amount || 0); }, 0);
    var exp = todayExp.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
    var low = prods.filter(function (p) { return stockOf(p) <= Number(p.low_stock_threshold_pcs || 12); });
    var stockValue = prods.reduce(function (a, p) { return a + stockOf(p) * Number(p.cost_price_pcs || 0); }, 0);

    var h = pageHead('Dashboard', 'Today at a glance',
      '<button class="btn btn-primary" onclick="navigate(\'pos\')">Start selling</button>');

    h += '<div class="grid grid-4" style="margin-bottom:14px">';
    h += '<div class="stat reveal"><div class="lbl">Today\'s sales</div><div class="val">' + money(revenue) + '</div><div class="sub">' + todaySales.length + ' transactions</div></div>';
    h += '<div class="stat ok reveal"><div class="lbl">Cash received</div><div class="val">' + money(cash) + '</div><div class="sub">Due: ' + money(due) + '</div></div>';
    h += '<div class="stat warn reveal"><div class="lbl">Today\'s expenses</div><div class="val">' + money(exp) + '</div><div class="sub">' + todayExp.length + ' entries</div></div>';
    h += '<div class="stat reveal"><div class="lbl">Stock value</div><div class="val">' + money(stockValue) + '</div><div class="sub">' + prods.length + ' products</div></div>';
    h += '</div>';

    if (low.length) {
      h += '<div class="card pad0 reveal" style="border-color:#f6d4d4"><h3 style="color:var(--bad)">Low stock (' + low.length + ')</h3>';
      h += '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Product</th><th class="num">In stock (pcs)</th><th class="num">Limit</th></tr></thead><tbody>';
      low.slice(0, 8).forEach(function (p) {
        h += '<tr><td>' + escapeHtml(p.name) + '</td><td class="num"><span class="tag tag-bad">' + stockOf(p) + '</span></td><td class="num">' + Number(p.low_stock_threshold_pcs || 12) + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    h += '<div class="card pad0 reveal"><h3>Recent sales</h3><div class="table-wrap" style="margin-top:12px"><table>';
    h += '<thead><tr><th>Invoice</th><th>Time</th><th class="num">Total</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>';
    if (!recent.length) h += emptyRow(5, 'No sales yet');
    recent.forEach(function (s) {
      h += '<tr><td>' + escapeHtml(s.invoice_no || String(s.id).slice(0, 8)) + '</td><td>' + fmtDateTime(s.created_at) + '</td>';
      h += '<td class="num">' + money(s.total) + '</td><td class="num">' + money(s.paid) + '</td>';
      h += '<td>' + (s.status === 'cancelled' ? '<span class="tag tag-bad">Cancelled</span>' : '<span class="tag tag-ok">Completed</span>') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';

    host.innerHTML = h;
  } catch (e) {
    host.innerHTML = '<div class="card"><h3>Dashboard could not load</h3><p style="color:var(--bad)">' + escapeHtml(e.message || e) + '</p></div>';
  }
};

/* ---------- POS ---------- */
RENDERERS.pos = async function () {
  var host = $('v-pos');
  if (!host.dataset.built) {
    host.innerHTML = [
      pageHead('Sell (POS)', 'Tap a product or scan a barcode to add it to the cart'),
      '<div class="pos-wrap">',
      '<div>',
      '<div class="toolbar">',
      '<input id="posSearch" placeholder="Search product, SKU or barcode" oninput="renderPOSGrid()" style="flex:1">',
      '</div>',
      '<div class="prod-grid" id="posGrid"></div>',
      '</div>',
      '<div class="cart-panel">',
      '<h3 style="margin:0 0 10px;font-size:14px;font-weight:700;">Cart</h3>',
      '<div id="cartLines"></div>',
      '<div class="field" style="margin-top:12px"><label>Customer (optional)</label>',
      '<select id="posCustomer"><option value="">Walk-in customer</option></select></div>',
      '<div class="field"><label>Discount</label><input id="discountInput" type="number" value="0" oninput="renderCart()"></div>',
      '<div class="field"><label>Amount paid</label><input id="paidInput" type="number" value="0" oninput="renderCart()"></div>',
      '<div class="field"><label>Payment method</label><select id="posMethod">',
      '<option value="cash">Cash</option><option value="bkash">bKash</option>',
      '<option value="nagad">Nagad</option><option value="card">Card</option></select></div>',
      '<div id="cartTotals"></div>',
      '<button id="checkoutBtn" class="btn btn-primary btn-block btn-lg" style="margin-top:12px" onclick="checkout()">Complete sale</button>',
      '<button class="btn btn-ghost btn-block btn-sm" style="margin-top:7px" onclick="clearCart()">Clear cart</button>',
      '</div></div>'
    ].join('');
    host.dataset.built = '1';
  }

  var sel = $('posCustomer');
  if (sel) {
    var opts = '<option value="">Walk-in customer</option>';
    customersCache.forEach(function (c) {
      opts += '<option value="' + c.id + '">' + escapeHtml(c.name || c.phone) + '</option>';
    });
    sel.innerHTML = opts;
  }

  renderPOSGrid();
  renderCart();
};

function renderPOSGrid() {
  var grid = $('posGrid');
  if (!grid) return;
  var q = (($('posSearch') || {}).value || '').toLowerCase().trim();

  var list = productsCache.filter(function (p) {
    if (p.active === false) return false;
    if (!q) return true;
    return String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
           String(p.sku || '').toLowerCase().indexOf(q) !== -1 ||
           String(p.barcode || '').toLowerCase().indexOf(q) !== -1 ||
           String(p.category || '').toLowerCase().indexOf(q) !== -1;
  });

  if (!list.length) {
    grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty">No products found</div></div>';
    return;
  }

  grid.innerHTML = list.slice(0, 150).map(function (p) {
    var st = stockOf(p);
    return '<div class="prod' + (st <= 0 ? ' out' : '') + '" onclick="addToCart(\'' + p.id + '\')">' +
      '<div class="nm">' + escapeHtml(p.name) + '</div>' +
      '<div class="pr">' + money(priceOf(p)) + '</div>' +
      '<div class="st">' + st + ' pcs in stock</div></div>';
  }).join('');
}

function addToCart(productId) {
  var p = productsCache.find(function (x) { return String(x.id) === String(productId); });
  if (!p) return;
  if (stockOf(p) <= 0) { toast('Out of stock', 'err'); return; }

  var line = cart.find(function (l) { return String(l.product_id) === String(productId); });
  if (line) {
    if (line.qty_pcs + 1 > stockOf(p)) { toast('No more stock available', 'err'); return; }
    line.qty_pcs += 1;
  } else {
    cart.push({ product_id: p.id, name: p.name, unit_price: priceOf(p), qty_pcs: 1, max: stockOf(p) });
  }
  window.cart = cart;
  renderCart();
}

function changeQty(productId, delta) {
  var l = cart.find(function (x) { return String(x.product_id) === String(productId); });
  if (!l) return;
  var next = l.qty_pcs + delta;
  if (next <= 0) { removeLine(productId); return; }
  if (next > l.max) { toast('Only ' + l.max + ' pcs in stock', 'err'); return; }
  l.qty_pcs = next;
  renderCart();
}

function setQty(productId, val) {
  var l = cart.find(function (x) { return String(x.product_id) === String(productId); });
  if (!l) return;
  var n = Number(val || 0);
  if (n <= 0) { removeLine(productId); return; }
  if (n > l.max) { n = l.max; toast('Stock limit: ' + l.max, 'err'); }
  l.qty_pcs = n;
  renderCart();
}

function removeLine(productId) {
  cart = cart.filter(function (x) { return String(x.product_id) !== String(productId); });
  window.cart = cart;
  renderCart();
}

function clearCart() {
  cart = [];
  window.cart = cart;
  var d = $('discountInput'); if (d) d.value = 0;
  var pd = $('paidInput'); if (pd) pd.value = 0;
  renderCart();
}

function cartSubtotal() {
  return cart.reduce(function (a, l) { return a + l.qty_pcs * Number(l.unit_price || 0); }, 0);
}

function renderCart() {
  var lines = $('cartLines');
  var tot = $('cartTotals');
  if (!lines || !tot) return;

  if (!cart.length) {
    lines.innerHTML = '<div class="empty" style="padding:22px 8px">Cart is empty</div>';
  } else {
    lines.innerHTML = cart.map(function (l) {
      return '<div class="cart-line">' +
        '<div class="nm">' + escapeHtml(l.name) + '<br><span style="color:var(--muted);font-size:11px">' + money(l.unit_price) + ' x ' + l.qty_pcs + '</span></div>' +
        '<button class="qty-btn" onclick="changeQty(\'' + l.product_id + '\',-1)">-</button>' +
        '<input type="number" value="' + l.qty_pcs + '" onchange="setQty(\'' + l.product_id + '\',this.value)">' +
        '<button class="qty-btn" onclick="changeQty(\'' + l.product_id + '\',1)">+</button>' +
        '<button class="qty-btn" style="color:var(--bad)" onclick="removeLine(\'' + l.product_id + '\')">x</button>' +
        '</div>';
    }).join('');
  }

  var sub = cartSubtotal();
  var disc = Number(($('discountInput') || {}).value || 0);
  var paid = Number(($('paidInput') || {}).value || 0);
  var total = Math.max(0, sub - disc);
  var change = paid - total;

  var h = '<div class="totrow"><span>Subtotal</span><span>' + money(sub) + '</span></div>';
  if (disc > 0) h += '<div class="totrow"><span>Discount</span><span>-' + money(disc) + '</span></div>';
  h += '<div class="totrow big"><span>Total</span><span>' + money(total) + '</span></div>';
  if (paid > 0) {
    if (change >= 0) h += '<div class="totrow"><span>Change</span><span style="color:var(--ok)">' + money(change) + '</span></div>';
    else h += '<div class="totrow"><span>Due</span><span style="color:var(--bad)">' + money(Math.abs(change)) + '</span></div>';
  }
  tot.innerHTML = h;

  if (typeof window.onCartRendered === 'function') {
    try { window.onCartRendered(); } catch (e) {}
  }
}

async function checkout() {
  if (typeof window.automatedCheckout === 'function') return window.automatedCheckout();

  if (!cart.length) { toast('Cart is empty', 'err'); return; }
  var discount = Number(($('discountInput') || {}).value || 0);
  var paid = Number(($('paidInput') || {}).value || 0);
  var method = ($('posMethod') || {}).value || 'cash';
  var customerId = ($('posCustomer') || {}).value || null;

  var items = cart.map(function (l) {
    return { product_id: l.product_id, qty_pcs: l.qty_pcs, unit_price: l.unit_price };
  });

  var btn = $('checkoutBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    var r = await sb.rpc('complete_sale', {
      p_customer_id: customerId || null,
      p_items: items,
      p_discount: discount,
      p_paid: paid,
      p_method: method
    });
    if (r.error) throw r.error;
    toast('Sale completed', 'ok');
    clearCart();
    await preloadMasterData();
    renderPOSGrid();
  } catch (e) {
    toast('Sale failed: ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Complete sale';
  }
}

/* ---------- PRODUCTS ---------- */
RENDERERS.products = async function () {
  var host = $('v-products');
  await preloadMasterData();
  var h = pageHead('Products', productsCache.length + ' products in your catalogue',
    '<button class="btn btn-primary" onclick="editProduct()">+ New product</button>');
  h += '<div class="toolbar"><input id="prSearch" placeholder="Search by name, SKU or category" oninput="filterTable(\'prTbody\',\'prSearch\')"></div>';
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr>';
  h += '<th>Name</th><th>SKU</th><th>Barcode</th><th>Category</th><th class="num">Price / pc</th><th class="num">Stock</th><th></th></tr></thead><tbody id="prTbody">';
  if (!productsCache.length) h += emptyRow(7, 'No products yet. Click "New product" to add one.');
  productsCache.forEach(function (p) {
    var st = stockOf(p);
    var low = st <= Number(p.low_stock_threshold_pcs || 12);
    h += '<tr><td><b>' + escapeHtml(p.name) + '</b></td><td>' + escapeHtml(p.sku || '-') + '</td><td>' + escapeHtml(p.barcode || '-') + '</td>';
    h += '<td>' + escapeHtml(p.category || '-') + '</td><td class="num">' + money(priceOf(p)) + '</td>';
    h += '<td class="num"><span class="tag ' + (low ? 'tag-bad' : 'tag-ok') + '">' + st + '</span></td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="editProduct(\'' + p.id + '\')">Edit</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function editProduct(id) {
  var p = id ? productsCache.find(function (x) { return String(x.id) === String(id); }) : {};
  if (!p) p = {};
  var h = '<h3>' + (id ? 'Edit product' : 'New product') + '</h3>';
  h += '<div class="field"><label>Product name *</label><input id="pfName" value="' + escapeHtml(p.name || '') + '"></div>';
  h += '<div class="grid grid-2">';
  h += '<div class="field"><label>SKU</label><input id="pfSku" value="' + escapeHtml(p.sku || '') + '"></div>';
  h += '<div class="field"><label>Barcode</label><input id="pfBarcode" value="' + escapeHtml(p.barcode || '') + '" placeholder="Scan or type"></div>';
  h += '<div class="field"><label>Category</label><input id="pfCat" value="' + escapeHtml(p.category || '') + '"></div>';
  h += '<div class="field"><label>Dozens per box</label><input id="pfBox" type="number" value="' + Number(p.box_contains_dozen || 0) + '"><div class="hint">1 dozen = 12 pcs</div></div>';
  h += '<div class="field"><label>Cost price (per pc)</label><input id="pfCost" type="number" value="' + Number(p.cost_price_pcs || 0) + '"></div>';
  h += '<div class="field"><label>Selling price (per pc) *</label><input id="pfPrice" type="number" value="' + priceOf(p) + '"></div>';
  h += '<div class="field"><label>Low stock alert (pcs)</label><input id="pfLow" type="number" value="' + Number(p.low_stock_threshold_pcs || 12) + '"></div>';
  if (!id) h += '<div class="field"><label>Opening stock (pcs)</label><input id="pfStock" type="number" value="0"></div>';
  h += '</div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveProduct(' + (id ? "'" + id + "'" : 'null') + ')">Save product</button></div>';
  openModal(h);
}

async function saveProduct(id) {
  var payload = {
    name: ($('pfName').value || '').trim(),
    sku: ($('pfSku').value || '').trim() || null,
    barcode: ($('pfBarcode').value || '').trim() || null,
    category: ($('pfCat').value || '').trim() || null,
    box_contains_dozen: Number($('pfBox').value || 0),
    cost_price_pcs: Number($('pfCost').value || 0),
    sale_price_pcs: Number($('pfPrice').value || 0),
    low_stock_threshold_pcs: Number($('pfLow').value || 12)
  };
  if ($('pfStock')) payload.stock_pcs = Number($('pfStock').value || 0);
  if (!payload.name) { toast('Product name is required', 'err'); return; }

  try {
    var res = await safeWrite('products', payload, id);
    closeModal();
    if (res.dropped.length) {
      toast('Saved. Skipped missing columns: ' + res.dropped.join(', ') + ' (run schema_fix.sql)', 'ok');
    } else {
      toast('Product saved', 'ok');
    }
    await preloadMasterData();
    navigate('products');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- STOCK ---------- */
RENDERERS.stock = async function () {
  var host = $('v-stock');
  await preloadMasterData();
  var h = pageHead('Stock', 'Current quantity and value of every product');
  h += '<div class="toolbar"><input id="stSearch" placeholder="Search product" oninput="filterTable(\'stTbody\',\'stSearch\')"></div>';
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">Pcs</th><th class="num">Dozens</th><th class="num">Stock value</th><th></th></tr></thead><tbody id="stTbody">';
  if (!productsCache.length) h += emptyRow(5, 'No products yet');
  productsCache.forEach(function (p) {
    var st = stockOf(p);
    h += '<tr><td>' + escapeHtml(p.name) + '</td><td class="num"><b>' + st + '</b></td><td class="num">' + (st / 12).toFixed(1) + '</td>';
    h += '<td class="num">' + money(st * Number(p.cost_price_pcs || 0)) + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="adjustStock(\'' + p.id + '\')">Adjust</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function adjustStock(id) {
  var p = productsCache.find(function (x) { return String(x.id) === String(id); });
  if (!p) return;
  var h = '<h3>Adjust stock &mdash; ' + escapeHtml(p.name) + '</h3>';
  h += '<p style="color:var(--muted);font-size:12.5px;margin-top:0">Currently <b>' + stockOf(p) + '</b> pcs in stock</p>';
  h += '<div class="field"><label>New quantity (pcs)</label><input id="saQty" type="number" value="' + stockOf(p) + '"></div>';
  h += '<div class="field"><label>Reason</label><input id="saNote" placeholder="Damage, recount, etc."></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveStockAdjust(\'' + id + '\')">Save</button></div>';
  openModal(h);
}

async function saveStockAdjust(id) {
  try {
    var qty = Number($('saQty').value || 0);
    await safeWrite('products', { stock_pcs: qty }, id);
    closeModal();
    toast('Stock updated', 'ok');
    await preloadMasterData();
    navigate('stock');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- PURCHASES ---------- */
RENDERERS.purchases = async function () {
  var host = $('v-purchases');
  host.innerHTML = '<div class="card">Loading...</div>';
  var r = await sb.from('purchases').select('*').order('created_at', { ascending: false }).limit(100);
  var rows = r.data || [];
  var h = pageHead('Purchases', 'Stock bought from suppliers',
    '<button class="btn btn-primary" onclick="newPurchase()">+ New purchase</button>');
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Supplier</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th></tr></thead><tbody>';
  if (!rows.length) h += emptyRow(5, 'No purchases recorded yet');
  rows.forEach(function (x) {
    var sup = suppliersCache.find(function (s) { return String(s.id) === String(x.supplier_id); });
    h += '<tr><td>' + fmtDate(x.created_at) + '</td><td>' + escapeHtml(sup ? sup.name : '-') + '</td>';
    h += '<td class="num">' + money(x.total) + '</td><td class="num">' + money(x.paid) + '</td><td class="num">' + money(Number(x.total || 0) - Number(x.paid || 0)) + '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function newPurchase() {
  var h = '<h3>New purchase</h3>';
  h += '<div class="field"><label>Supplier</label><select id="puSup"><option value="">None</option>';
  suppliersCache.forEach(function (s) { h += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; });
  h += '</select></div>';
  h += '<div class="field"><label>Product</label><select id="puProd">';
  productsCache.forEach(function (p) { h += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>'; });
  h += '</select></div>';
  h += '<div class="grid grid-2">';
  h += '<div class="field"><label>Number of boxes</label><input id="puBox" type="number" value="1"></div>';
  h += '<div class="field"><label>Cost per box</label><input id="puCost" type="number" value="0"></div>';
  h += '<div class="field"><label>Amount paid</label><input id="puPaid" type="number" value="0"></div>';
  h += '</div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="savePurchase()">Save purchase</button></div>';
  openModal(h);
}

async function savePurchase() {
  try {
    var pid = $('puProd').value;
    var p = productsCache.find(function (x) { return String(x.id) === String(pid); });
    var perBox = pcsPerBox(p) || 12;
    var boxes = Number($('puBox').value || 0);
    var costBox = Number($('puCost').value || 0);
    var paid = Number($('puPaid').value || 0);
    var items = [{ product_id: pid, qty_pcs: boxes * perBox, unit_cost: perBox ? (costBox / perBox) : costBox }];
    var r = await sb.rpc('record_purchase', {
      p_supplier_id: $('puSup').value || null,
      p_items: items,
      p_paid: paid
    });
    if (r.error) throw r.error;
    closeModal();
    toast('Purchase saved', 'ok');
    await preloadMasterData();
    navigate('purchases');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- SALES ---------- */
RENDERERS.sales = async function () {
  var host = $('v-sales');
  host.innerHTML = '<div class="card">Loading...</div>';
  var r = await sb.from('sales').select('*').order('created_at', { ascending: false }).limit(200);
  var rows = r.data || [];
  var h = pageHead('Sales history', 'Last 200 transactions');
  h += '<div class="toolbar"><input id="slSearch" placeholder="Search invoice" oninput="filterTable(\'slTbody\',\'slSearch\')"></div>';
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Time</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th><th>Status</th><th></th></tr></thead><tbody id="slTbody">';
  if (!rows.length) h += emptyRow(7, 'No sales yet');
  rows.forEach(function (s) {
    h += '<tr><td>' + escapeHtml(s.invoice_no || String(s.id).slice(0, 8)) + '</td><td>' + fmtDateTime(s.created_at) + '</td>';
    h += '<td class="num">' + money(s.total) + '</td><td class="num">' + money(s.paid) + '</td><td class="num">' + money(s.due_amount) + '</td>';
    h += '<td>' + (s.status === 'cancelled' ? '<span class="tag tag-bad">Cancelled</span>' : '<span class="tag tag-ok">Completed</span>') + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="viewSale(\'' + s.id + '\')">Details</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

async function viewSale(id) {
  try {
    var res = await Promise.all([
      sb.from('sales').select('*').eq('id', id).maybeSingle(),
      sb.from('sale_items').select('*').eq('sale_id', id)
    ]);
    var s = res[0].data || {};
    var items = res[1].data || [];
    var h = '<h3>Invoice ' + escapeHtml(s.invoice_no || String(id).slice(0, 8)) + '</h3>';
    h += '<div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>';
    items.forEach(function (it) {
      var p = productsCache.find(function (x) { return String(x.id) === String(it.product_id); });
      h += '<tr><td>' + escapeHtml(p ? p.name : '-') + '</td><td class="num">' + it.qty_pcs + '</td><td class="num">' + money(it.unit_price) + '</td><td class="num">' + money(Number(it.qty_pcs) * Number(it.unit_price)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="totrow big"><span>Total</span><span>' + money(s.total) + '</span></div>';
    h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button>';
    if (s.status !== 'cancelled') h += '<button class="btn btn-danger" onclick="cancelSale(\'' + id + '\')">Cancel this sale</button>';
    h += '</div>';
    openModal(h);
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

async function cancelSale(id) {
  if (!confirm('Cancel this sale? Stock will be returned.')) return;
  try {
    var r = await sb.rpc('cancel_sale', { p_sale_id: id });
    if (r.error) throw r.error;
    closeModal();
    toast('Sale cancelled', 'ok');
    await preloadMasterData();
    navigate('sales');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- RETURNS ---------- */
RENDERERS.returns = async function () {
  var host = $('v-returns');
  host.innerHTML = '<div class="card">Loading...</div>';
  var rows = [];
  try {
    var r = await sb.from('returns').select('*').order('created_at', { ascending: false }).limit(100);
    rows = r.data || [];
  } catch (e) {}
  var h = pageHead('Returns', 'Products returned by customers');
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Sale</th><th class="num">Amount</th><th>Reason</th></tr></thead><tbody>';
  if (!rows.length) h += emptyRow(4, 'No returns recorded. Open a sale from Sales history to process a return.');
  rows.forEach(function (x) {
    h += '<tr><td>' + fmtDateTime(x.created_at) + '</td><td>' + escapeHtml(String(x.sale_id || '-').slice(0, 8)) + '</td><td class="num">' + money(x.total) + '</td><td>' + escapeHtml(x.reason || '-') + '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

/* ---------- CUSTOMERS ---------- */
RENDERERS.customers = async function () {
  var host = $('v-customers');
  await preloadMasterData();
  var h = pageHead('Customers', customersCache.length + ' customers',
    '<button class="btn btn-primary" onclick="editCustomer()">+ New customer</button>');
  h += '<div class="toolbar"><input id="cuSearch" placeholder="Search name or phone" oninput="filterTable(\'cuTbody\',\'cuSearch\')"></div>';
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th class="num">Points</th><th class="num">Total spent</th><th></th></tr></thead><tbody id="cuTbody">';
  if (!customersCache.length) h += emptyRow(5, 'No customers yet');
  customersCache.forEach(function (c) {
    h += '<tr><td>' + escapeHtml(c.name || '-') + '</td><td>' + escapeHtml(c.phone || '-') + '</td>';
    h += '<td class="num">' + Number(c.loyalty_points || 0) + '</td><td class="num">' + money(c.total_spent) + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="editCustomer(\'' + c.id + '\')">Edit</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function editCustomer(id) {
  var c = id ? customersCache.find(function (x) { return String(x.id) === String(id); }) : {};
  if (!c) c = {};
  var h = '<h3>' + (id ? 'Edit customer' : 'New customer') + '</h3>';
  h += '<div class="field"><label>Name *</label><input id="cfName" value="' + escapeHtml(c.name || '') + '"></div>';
  h += '<div class="field"><label>Phone</label><input id="cfPhone" value="' + escapeHtml(c.phone || '') + '" placeholder="01XXXXXXXXX"></div>';
  h += '<div class="field"><label>Address</label><input id="cfAddr" value="' + escapeHtml(c.address || '') + '"></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveCustomer(' + (id ? "'" + id + "'" : 'null') + ')">Save</button></div>';
  openModal(h);
}

async function saveCustomer(id) {
  var payload = {
    name: ($('cfName').value || '').trim(),
    phone: ($('cfPhone').value || '').trim() || null,
    address: ($('cfAddr').value || '').trim() || null
  };
  if (!payload.name) { toast('Name is required', 'err'); return; }
  try {
    await safeWrite('customers', payload, id);
    closeModal();
    toast('Customer saved', 'ok');
    await preloadMasterData();
    navigate('customers');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- SUPPLIERS ---------- */
RENDERERS.suppliers = async function () {
  var host = $('v-suppliers');
  await preloadMasterData();
  var h = pageHead('Suppliers', suppliersCache.length + ' suppliers',
    '<button class="btn btn-primary" onclick="editSupplier()">+ New supplier</button>');
  h += '<div class="toolbar"><input id="suSearch" placeholder="Search supplier" oninput="filterTable(\'suTbody\',\'suSearch\')"></div>';
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Address</th><th></th></tr></thead><tbody id="suTbody">';
  if (!suppliersCache.length) h += emptyRow(4, 'No suppliers yet');
  suppliersCache.forEach(function (s) {
    h += '<tr><td>' + escapeHtml(s.name || '-') + '</td><td>' + escapeHtml(s.phone || '-') + '</td><td>' + escapeHtml(s.address || '-') + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="editSupplier(\'' + s.id + '\')">Edit</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function editSupplier(id) {
  var s = id ? suppliersCache.find(function (x) { return String(x.id) === String(id); }) : {};
  if (!s) s = {};
  var h = '<h3>' + (id ? 'Edit supplier' : 'New supplier') + '</h3>';
  h += '<div class="field"><label>Name *</label><input id="sfName" value="' + escapeHtml(s.name || '') + '"></div>';
  h += '<div class="field"><label>Phone</label><input id="sfPhone" value="' + escapeHtml(s.phone || '') + '"></div>';
  h += '<div class="field"><label>Address</label><input id="sfAddr" value="' + escapeHtml(s.address || '') + '"></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveSupplier(' + (id ? "'" + id + "'" : 'null') + ')">Save</button></div>';
  openModal(h);
}

async function saveSupplier(id) {
  var payload = {
    name: ($('sfName').value || '').trim(),
    phone: ($('sfPhone').value || '').trim() || null,
    address: ($('sfAddr').value || '').trim() || null
  };
  if (!payload.name) { toast('Name is required', 'err'); return; }
  try {
    await safeWrite('suppliers', payload, id);
    closeModal();
    toast('Supplier saved', 'ok');
    await preloadMasterData();
    navigate('suppliers');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- DUE LEDGER ---------- */
RENDERERS.ledger = async function () {
  var host = $('v-ledger');
  host.innerHTML = '<div class="card">Loading...</div>';
  var r = await sb.from('sales').select('*').gt('due_amount', 0).neq('status', 'cancelled').order('created_at', { ascending: false });
  var rows = r.data || [];
  var totalDue = rows.reduce(function (a, s) { return a + Number(s.due_amount || 0); }, 0);

  var h = pageHead('Due ledger', 'Money customers still owe you');
  h += '<div class="grid grid-3" style="margin-bottom:14px">';
  h += '<div class="stat bad reveal"><div class="lbl">Total outstanding</div><div class="val">' + money(totalDue) + '</div><div class="sub">' + rows.length + ' invoices</div></div>';
  h += '</div>';
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="num">Due</th><th></th></tr></thead><tbody>';
  if (!rows.length) h += emptyRow(5, 'Nothing is outstanding. Well done!');
  rows.forEach(function (s) {
    var c = customersCache.find(function (x) { return String(x.id) === String(s.customer_id); });
    var nm = c ? (c.name || c.phone) : 'Walk-in';
    h += '<tr><td>' + escapeHtml(s.invoice_no || String(s.id).slice(0, 8)) + '</td><td>' + fmtDate(s.created_at) + '</td>';
    h += '<td>' + escapeHtml(nm) + '</td><td class="num"><b style="color:var(--bad)">' + money(s.due_amount) + '</b></td><td>';
    h += '<button class="btn btn-ghost btn-sm" onclick="collectDue(\'' + s.id + '\',' + Number(s.due_amount) + ')">Collect</button>';
    if (c && c.phone) {
      h += ' <button class="btn btn-ghost btn-sm" onclick="sendDueReminder(\'' + c.id + '\',\'' + escapeHtml(c.phone) + '\',' + Number(s.due_amount) + ',\'' + escapeHtml(nm) + '\')">Remind</button>';
    }
    h += '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function collectDue(saleId, due) {
  var h = '<h3>Collect payment</h3>';
  h += '<p style="color:var(--muted);font-size:12.5px;margin-top:0">Outstanding: <b>' + money(due) + '</b></p>';
  h += '<div class="field"><label>Amount received</label><input id="duAmt" type="number" value="' + due + '"></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveDuePayment(\'' + saleId + '\',' + due + ')">Save</button></div>';
  openModal(h);
}

async function saveDuePayment(saleId, due) {
  try {
    var amt = Number($('duAmt').value || 0);
    if (amt <= 0) { toast('Enter an amount', 'err'); return; }
    var s = await sb.from('sales').select('paid,due_amount').eq('id', saleId).maybeSingle();
    var cur = s.data || {};
    var r = await sb.from('sales').update({
      paid: Number(cur.paid || 0) + amt,
      due_amount: Math.max(0, Number(cur.due_amount || due) - amt)
    }).eq('id', saleId);
    if (r.error) throw r.error;
    closeModal();
    toast('Payment recorded', 'ok');
    navigate('ledger');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- EXPENSES ---------- */
RENDERERS.expenses = async function () {
  var host = $('v-expenses');
  host.innerHTML = '<div class="card">Loading...</div>';
  var r = await sb.from('expenses').select('*').order('created_at', { ascending: false }).limit(200);
  var rows = r.data || [];
  var h = pageHead('Expenses', 'Shop running costs',
    '<button class="btn btn-primary" onclick="newExpense()">+ New expense</button>');
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="num">Amount</th></tr></thead><tbody>';
  if (!rows.length) h += emptyRow(4, 'No expenses recorded yet');
  rows.forEach(function (x) {
    h += '<tr><td>' + fmtDate(x.created_at) + '</td><td>' + escapeHtml(x.category || '-') + '</td><td>' + escapeHtml(x.note || '-') + '</td><td class="num">' + money(x.amount) + '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function newExpense() {
  var h = '<h3>New expense</h3>';
  h += '<div class="field"><label>Category</label><input id="exCat" placeholder="Rent, electricity, transport..."></div>';
  h += '<div class="field"><label>Note</label><input id="exNote"></div>';
  h += '<div class="field"><label>Amount *</label><input id="exAmt" type="number" value="0"></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveExpense()">Save</button></div>';
  openModal(h);
}

async function saveExpense() {
  try {
    var amt = Number($('exAmt').value || 0);
    if (amt <= 0) { toast('Enter an amount', 'err'); return; }
    await safeWrite('expenses', {
      category: ($('exCat').value || '').trim() || null,
      note: ($('exNote').value || '').trim() || null,
      amount: amt
    }, null);
    closeModal();
    toast('Expense saved', 'ok');
    navigate('expenses');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- REPORTS ---------- */
RENDERERS.reports = async function () {
  var host = $('v-reports');
  host.innerHTML = '<div class="card">Calculating...</div>';
  try {
    var now = new Date();
    var m0 = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    var res = await Promise.all([
      sb.from('sales').select('*').gte('created_at', m0),
      sb.from('expenses').select('*').gte('created_at', m0)
    ]);
    var sales = (res[0].data || []).filter(function (s) { return s.status !== 'cancelled'; });
    var exps = res[1].data || [];

    var rev = sales.reduce(function (a, s) { return a + Number(s.total || 0); }, 0);
    var cash = sales.reduce(function (a, s) { return a + Number(s.paid || 0); }, 0);
    var due = sales.reduce(function (a, s) { return a + Number(s.due_amount || 0); }, 0);
    var ex = exps.reduce(function (a, s) { return a + Number(s.amount || 0); }, 0);

    var byDay = {};
    sales.forEach(function (s) {
      var k = fmtDate(s.created_at);
      if (!byDay[k]) byDay[k] = { total: 0, count: 0 };
      byDay[k].total += Number(s.total || 0);
      byDay[k].count += 1;
    });

    var h = pageHead('Reports', 'This month so far');
    h += '<div class="grid grid-4" style="margin-bottom:14px">';
    h += '<div class="stat reveal"><div class="lbl">Revenue</div><div class="val">' + money(rev) + '</div><div class="sub">' + sales.length + ' sales</div></div>';
    h += '<div class="stat ok reveal"><div class="lbl">Cash received</div><div class="val">' + money(cash) + '</div></div>';
    h += '<div class="stat bad reveal"><div class="lbl">Outstanding due</div><div class="val">' + money(due) + '</div></div>';
    h += '<div class="stat warn reveal"><div class="lbl">Expenses</div><div class="val">' + money(ex) + '</div><div class="sub">Net: ' + money(cash - ex) + '</div></div>';
    h += '</div>';

    h += '<div class="card pad0 reveal"><h3>Day by day</h3><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Date</th><th class="num">Sales</th><th class="num">Revenue</th></tr></thead><tbody>';
    var keys = Object.keys(byDay);
    if (!keys.length) h += emptyRow(3, 'No sales this month');
    keys.forEach(function (k) {
      h += '<tr><td>' + k + '</td><td class="num">' + byDay[k].count + '</td><td class="num">' + money(byDay[k].total) + '</td></tr>';
    });
    h += '</tbody></table></div></div>';

    host.innerHTML = h;
  } catch (e) {
    host.innerHTML = '<div class="card"><p style="color:var(--bad)">' + escapeHtml(e.message || e) + '</p></div>';
  }
};

/* ---------- LOW STOCK ---------- */
RENDERERS.alerts = async function () {
  var host = $('v-alerts');
  await preloadMasterData();
  var low = productsCache.filter(function (p) { return stockOf(p) <= Number(p.low_stock_threshold_pcs || 12); });
  var h = pageHead('Low stock', low.length + ' products need restocking');
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Alert limit</th><th></th></tr></thead><tbody>';
  if (!low.length) h += emptyRow(4, 'All products are above their alert limit');
  low.forEach(function (p) {
    h += '<tr><td>' + escapeHtml(p.name) + '</td><td class="num"><span class="tag tag-bad">' + stockOf(p) + '</span></td>';
    h += '<td class="num">' + Number(p.low_stock_threshold_pcs || 12) + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="adjustStock(\'' + p.id + '\')">Adjust</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

/* ---------- STAFF ---------- */
RENDERERS.staff = async function () {
  var host = $('v-staff');
  host.innerHTML = '<div class="card">Loading...</div>';
  var r = await sb.from('profiles').select('*');
  var rows = r.data || [];
  var h = pageHead('Staff', 'People who can use this system');
  h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>';
  if (!rows.length) h += emptyRow(5, 'No staff profiles found');
  rows.forEach(function (p) {
    h += '<tr><td>' + escapeHtml(p.full_name || '-') + '</td><td><span class="tag">' + escapeHtml((p.role || '').toUpperCase()) + '</span></td>';
    h += '<td>' + escapeHtml(p.phone || '-') + '</td>';
    h += '<td>' + (p.active === false ? '<span class="tag tag-bad">Disabled</span>' : '<span class="tag tag-ok">Active</span>') + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="editStaff(\'' + p.id + '\')">Edit</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  h += '<div class="card"><h3>Adding a new staff member</h3><p style="font-size:12.5px;color:var(--muted);margin:0">Create the user in Supabase &rsaquo; Authentication &rsaquo; Users, then come back here and set the correct role.</p></div>';
  host.innerHTML = h;
};

function editStaff(id) {
  var h = '<h3>Edit staff member</h3>';
  h += '<div class="field"><label>Full name</label><input id="stfName"></div>';
  h += '<div class="field"><label>Role</label><select id="stfRole">';
  ['owner','manager','cashier','staff'].forEach(function (r) { h += '<option value="' + r + '">' + r + '</option>'; });
  h += '</select></div>';
  h += '<div class="field"><label>Phone</label><input id="stfPhone"></div>';
  h += '<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="stfActive" checked> Account is active</label>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveStaff(\'' + id + '\')">Save</button></div>';
  openModal(h);

  sb.from('profiles').select('*').eq('id', id).maybeSingle().then(function (r) {
    var p = r.data || {};
    if ($('stfName')) $('stfName').value = p.full_name || '';
    if ($('stfRole')) $('stfRole').value = p.role || 'staff';
    if ($('stfPhone')) $('stfPhone').value = p.phone || '';
    if ($('stfActive')) $('stfActive').checked = p.active !== false;
  });
}

async function saveStaff(id) {
  try {
    await safeWrite('profiles', {
      full_name: ($('stfName').value || '').trim(),
      role: $('stfRole').value,
      phone: ($('stfPhone').value || '').trim() || null,
      active: $('stfActive').checked
    }, id);
    closeModal();
    toast('Staff member saved', 'ok');
    navigate('staff');
  } catch (e) { toast('Failed: ' + (e.message || e), 'err'); }
}

/* ---------- SETTINGS ---------- */
RENDERERS.settings = async function () {
  var host = $('v-settings');
  var cfg = loadCfg() || {};
  var h = pageHead('Settings', 'System and account information');
  h += '<div class="grid grid-2">';
  h += '<div class="card"><h3>Database connection</h3>';
  h += '<p style="font-size:12.5px;color:var(--muted);margin:0 0 6px">Project URL</p>';
  h += '<p style="font-size:13px;word-break:break-all;margin:0 0 12px"><b>' + escapeHtml(cfg.url || '-') + '</b></p>';
  h += '<p style="font-size:12.5px;color:var(--muted);margin:0">Your key is stored permanently inside <b>config.js</b>. Edit that file to change it.</p></div>';
  h += '<div class="card"><h3>Your account</h3>';
  h += '<p style="font-size:13px;margin:0 0 6px">Name: <b>' + escapeHtml((myProfile && myProfile.full_name) || '-') + '</b></p>';
  h += '<p style="font-size:13px;margin:0 0 14px">Role: <b>' + escapeHtml((myProfile && myProfile.role) || '-') + '</b></p>';
  h += '<button class="btn btn-danger" onclick="doLogout()">Sign out</button></div>';
  h += '</div>';
  h += '<div class="card"><h3>Automation</h3><p style="font-size:12.5px;color:var(--muted);margin:0">WhatsApp receipts, membership and loyalty settings live on the <b>Automation</b> page in the sidebar.</p></div>';
  host.innerHTML = h;
};

/* ---------- BOOT ---------- */
async function boot() {
  var cfg = loadCfg();
  if (cfg && initSupabase()) {
    switchGateTab('login');
    try {
      var s = await sb.auth.getSession();
      if (s && s.data && s.data.session && s.data.session.user) {
        await afterLogin(s.data.session.user);
      }
    } catch (e) { console.warn(e); }
  } else {
    switchGateTab('connect');
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
}

/* ---------- exports ---------- */
window.$ = $;
window.money = money;
window.escapeHtml = escapeHtml;
window.fmtDate = fmtDate;
window.fmtDateTime = fmtDateTime;
window.toast = toast;
window.openModal = openModal;
window.closeModal = closeModal;
window.toggleSidebar = toggleSidebar;
window.revealAll = revealAll;
window.pageHead = pageHead;
window.emptyRow = emptyRow;
window.stockOf = stockOf;
window.priceOf = priceOf;
window.pcsPerBox = pcsPerBox;
window.safeWrite = safeWrite;
window.switchGateTab = switchGateTab;
window.saveConfig = saveConfig;
window.loadCfg = loadCfg;
window.initSupabase = initSupabase;
window.doLogin = doLogin;
window.doLogout = doLogout;
window.afterLogin = afterLogin;
window.canAccess = canAccess;
window.buildNav = buildNav;
window.navigate = navigate;
window.preloadMasterData = preloadMasterData;
window.filterTable = filterTable;
window.RENDERERS = RENDERERS;
window.NAV = NAV;
window.renderPOSGrid = renderPOSGrid;
window.addToCart = addToCart;
window.changeQty = changeQty;
window.setQty = setQty;
window.removeLine = removeLine;
window.clearCart = clearCart;
window.cartSubtotal = cartSubtotal;
window.renderCart = renderCart;
window.checkout = checkout;
window.editProduct = editProduct;
window.saveProduct = saveProduct;
window.adjustStock = adjustStock;
window.saveStockAdjust = saveStockAdjust;
window.newPurchase = newPurchase;
window.savePurchase = savePurchase;
window.viewSale = viewSale;
window.cancelSale = cancelSale;
window.editCustomer = editCustomer;
window.saveCustomer = saveCustomer;
window.editSupplier = editSupplier;
window.saveSupplier = saveSupplier;
window.collectDue = collectDue;
window.saveDuePayment = saveDuePayment;
window.newExpense = newExpense;
window.saveExpense = saveExpense;
window.editStaff = editStaff;
window.saveStaff = saveStaff;
window.cart = cart;
window.productsCache = productsCache;
window.customersCache = customersCache;
window.suppliersCache = suppliersCache;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
