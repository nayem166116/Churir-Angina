/* =========================================================
 * CHURIR ANGINA POS -- app.js (v3)
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
  return 'Tk ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  setTimeout(function () { d.remove(); }, 3200);
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
    setTimeout(function () { e.classList.add('in'); }, i * 45);
  });
}

function stockOf(p) { return Number(p.stock_pcs || 0); }
function priceOf(p) { return Number(p.sale_price_pcs != null ? p.sale_price_pcs : (p.price_pcs || 0)); }
function pcsPerBox(p) { return Number(p.box_contains_dozen || 0) * 12; }

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
  if (!url || !key) { toast('URL and Key duita e lagbe', 'err'); return; }
  localStorage.setItem(CFG_KEY, JSON.stringify({ url: url, anonKey: key }));
  if (!initSupabase()) return;
  toast('Connected!', 'ok');
  switchGateTab('login');
}

function initSupabase() {
  var cfg = loadCfg();
  if (!cfg) return false;
  if (!window.supabase || !window.supabase.createClient) {
    toast('Supabase library load hoyni. Internet check korun.', 'err');
    return false;
  }
  try {
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    window.sb = sb;
    return true;
  } catch (e) {
    toast('Connect fail: ' + e.message, 'err');
    return false;
  }
}

/* ---------- auth ---------- */
async function doLogin() {
  var msg = $('loginMsg');
  var btn = $('loginBtn');
  msg.textContent = '';

  if (!sb && !initSupabase()) {
    msg.textContent = 'Age Supabase connect korun (config.js e key bosan).';
    return;
  }

  var email = ($('inEmail').value || '').trim();
  var pass = $('inPass').value || '';
  if (!email || !pass) { msg.textContent = 'Email o password din.'; return; }

  btn.disabled = true;
  btn.textContent = 'Login hocche...';

  try {
    var res = await sb.auth.signInWithPassword({ email: email, password: pass });
    if (res.error) throw res.error;
    await afterLogin(res.data.user);
  } catch (e) {
    msg.textContent = e.message || 'Login fail hoyeche';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
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
      $('loginMsg').textContent = 'Profile toiri kora jayni: ' + ins.error.message;
      await sb.auth.signOut();
      return;
    }
    prof = ins.data;
  }

  if (prof.active === false) {
    $('loginMsg').textContent = 'Apnar account bondho kora hoyeche. Owner ke bolun.';
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
    { id: 'dashboard', name: 'Dashboard', icon: 'DB' },
    { id: 'pos', name: 'Bikroy (POS)', icon: 'POS' }
  ]},
  { label: 'INVENTORY', items: [
    { id: 'products', name: 'Products', icon: 'PR' },
    { id: 'stock', name: 'Stock', icon: 'ST' },
    { id: 'purchases', name: 'Purchase', icon: 'PU' },
    { id: 'alerts', name: 'Stock Alert', icon: 'AL' }
  ]},
  { label: 'SALES', items: [
    { id: 'sales', name: 'Sales History', icon: 'SA' },
    { id: 'returns', name: 'Return', icon: 'RE' },
    { id: 'ledger', name: 'Baki Khata', icon: 'LG' }
  ]},
  { label: 'PEOPLE', items: [
    { id: 'customers', name: 'Customers', icon: 'CU' },
    { id: 'suppliers', name: 'Suppliers', icon: 'SU' },
    { id: 'staff', name: 'Staff', icon: 'SF' }
  ]},
  { label: 'MONEY', items: [
    { id: 'expenses', name: 'Khoroch', icon: 'EX' },
    { id: 'reports', name: 'Reports', icon: 'RP' }
  ]},
  { label: 'SYSTEM', items: [
    { id: 'settings', name: 'Settings', icon: 'SE' }
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
  if (!canAccess(viewId)) { toast('Ei page e apnar access nei', 'err'); return; }

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
  $('pageTitle').textContent = titleMap[viewId] || viewId;

  var sb2 = $('sidebar');
  if (sb2) sb2.classList.remove('open');

  var fn = RENDERERS[viewId];
  if (typeof fn === 'function') {
    try { await fn(); } catch (e) {
      console.error('[render ' + viewId + ']', e);
      if (sec) sec.innerHTML = '<div class="card"><h3>Load kora jayni</h3><p style="color:var(--bad)">' + escapeHtml(e.message || e) + '</p></div>';
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
    console.warn('preload fail', e);
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

    var h = '<div class="grid grid-4" style="margin-bottom:14px">';
    h += '<div class="stat reveal"><div class="lbl">AJKER BIKROY</div><div class="val">' + money(revenue) + '</div><div class="sub">' + todaySales.length + ' ti sell</div></div>';
    h += '<div class="stat reveal"><div class="lbl">CASH JOMA</div><div class="val">' + money(cash) + '</div><div class="sub">Baki: ' + money(due) + '</div></div>';
    h += '<div class="stat reveal"><div class="lbl">AJKER KHOROCH</div><div class="val">' + money(exp) + '</div><div class="sub">' + todayExp.length + ' ti entry</div></div>';
    h += '<div class="stat reveal"><div class="lbl">STOCK VALUE</div><div class="val">' + money(stockValue) + '</div><div class="sub">' + prods.length + ' ti product</div></div>';
    h += '</div>';

    if (low.length) {
      h += '<div class="card reveal" style="border-color:#f6d4d4;background:#fffafa"><h3>Stock kome geche (' + low.length + ')</h3>';
      h += '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Stock (pcs)</th><th>Limit</th></tr></thead><tbody>';
      low.slice(0, 8).forEach(function (p) {
        h += '<tr><td>' + escapeHtml(p.name) + '</td><td><span class="tag tag-bad">' + stockOf(p) + '</span></td><td>' + Number(p.low_stock_threshold_pcs || 12) + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    h += '<div class="card reveal"><h3>Sam-protik bikroy</h3><div class="table-wrap"><table>';
    h += '<thead><tr><th>Invoice</th><th>Somoy</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead><tbody>';
    if (!recent.length) h += '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Kono sell nei</td></tr>';
    recent.forEach(function (s) {
      h += '<tr><td>' + escapeHtml(s.invoice_no || String(s.id).slice(0, 8)) + '</td><td>' + fmtDateTime(s.created_at) + '</td><td>' + money(s.total) + '</td><td>' + money(s.paid) + '</td><td>' + (s.status === 'cancelled' ? '<span class="tag tag-bad">Cancelled</span>' : '<span class="tag tag-ok">OK</span>') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';

    host.innerHTML = h;
  } catch (e) {
    host.innerHTML = '<div class="card"><h3>Dashboard load fail</h3><p style="color:var(--bad)">' + escapeHtml(e.message || e) + '</p></div>';
  }
};

/* ---------- POS ---------- */
RENDERERS.pos = async function () {
  var host = $('v-pos');
  if (!host.dataset.built) {
    host.innerHTML = [
      '<div class="pos-wrap">',
      '<div>',
      '<div class="toolbar">',
      '<input id="posSearch" placeholder="Product khujun / barcode scan korun" oninput="renderPOSGrid()" style="flex:1">',
      '</div>',
      '<div class="prod-grid" id="posGrid"></div>',
      '</div>',
      '<div class="cart-panel">',
      '<h3 style="margin:0 0 10px;color:var(--pink-d);font-size:14.5px;">Cart</h3>',
      '<div id="cartLines"></div>',
      '<div class="field" style="margin-top:11px"><label>Customer (optional)</label>',
      '<select id="posCustomer"><option value="">-- Walk-in --</option></select></div>',
      '<div class="field"><label>Discount (Tk)</label><input id="discountInput" type="number" value="0" oninput="renderCart()"></div>',
      '<div class="field"><label>Paid (Tk)</label><input id="paidInput" type="number" value="0" oninput="renderCart()"></div>',
      '<div class="field"><label>Payment Method</label><select id="posMethod">',
      '<option value="cash">Cash</option><option value="bkash">bKash</option>',
      '<option value="nagad">Nagad</option><option value="card">Card</option></select></div>',
      '<div id="cartTotals"></div>',
      '<button id="checkoutBtn" class="btn btn-primary btn-block btn-lg" style="margin-top:11px" onclick="checkout()">Checkout</button>',
      '<button class="btn btn-ghost btn-block btn-sm" style="margin-top:7px" onclick="clearCart()">Cart Khali Korun</button>',
      '</div></div>'
    ].join('');
    host.dataset.built = '1';
  }

  var sel = $('posCustomer');
  if (sel) {
    var opts = '<option value="">-- Walk-in --</option>';
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
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:26px">Kono product pawa jayni</div>';
    return;
  }

  grid.innerHTML = list.slice(0, 120).map(function (p) {
    var st = stockOf(p);
    return '<div class="prod' + (st <= 0 ? ' out' : '') + '" onclick="addToCart(\'' + p.id + '\')">' +
      '<div class="nm">' + escapeHtml(p.name) + '</div>' +
      '<div class="pr">' + money(priceOf(p)) + '</div>' +
      '<div class="st">Stock: ' + st + ' pcs</div></div>';
  }).join('');
}

function addToCart(productId) {
  var p = productsCache.find(function (x) { return String(x.id) === String(productId); });
  if (!p) return;
  if (stockOf(p) <= 0) { toast('Stock shesh', 'err'); return; }

  var line = cart.find(function (l) { return String(l.product_id) === String(productId); });
  if (line) {
    if (line.qty_pcs + 1 > stockOf(p)) { toast('Stock e ar nei', 'err'); return; }
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
  if (next > l.max) { toast('Stock e ache sudhu ' + l.max + ' pcs', 'err'); return; }
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
    lines.innerHTML = '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12.5px">Cart faka</div>';
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
    if (change >= 0) h += '<div class="totrow" style="color:var(--ok);font-weight:700"><span>Ferot Din</span><span>' + money(change) + '</span></div>';
    else h += '<div class="totrow" style="color:var(--bad);font-weight:700"><span>Baki</span><span>' + money(Math.abs(change)) + '</span></div>';
  }
  tot.innerHTML = h;

  if (typeof window.onCartRendered === 'function') {
    try { window.onCartRendered(); } catch (e) {}
  }
}

async function checkout() {
  if (typeof window.automatedCheckout === 'function') return window.automatedCheckout();

  if (!cart.length) { toast('Cart faka', 'err'); return; }
  var discount = Number(($('discountInput') || {}).value || 0);
  var paid = Number(($('paidInput') || {}).value || 0);
  var method = ($('posMethod') || {}).value || 'cash';
  var customerId = ($('posCustomer') || {}).value || null;

  var items = cart.map(function (l) {
    return { product_id: l.product_id, qty_pcs: l.qty_pcs, unit_price: l.unit_price };
  });

  var btn = $('checkoutBtn');
  btn.disabled = true; btn.textContent = 'Save hocche...';
  try {
    var r = await sb.rpc('complete_sale', {
      p_customer_id: customerId || null,
      p_items: items,
      p_discount: discount,
      p_paid: paid,
      p_method: method
    });
    if (r.error) throw r.error;
    toast('Sell hoyeche!', 'ok');
    clearCart();
    await preloadMasterData();
    renderPOSGrid();
  } catch (e) {
    toast('Sell fail: ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Checkout';
  }
}

/* ---------- PRODUCTS ---------- */
RENDERERS.products = async function () {
  var host = $('v-products');
  await preloadMasterData();
  var h = '<div class="toolbar"><input id="prSearch" placeholder="Product khujun" oninput="filterTable(\'prTbody\',\'prSearch\')">';
  h += '<button class="btn btn-primary" onclick="editProduct()">+ Notun Product</button></div>';
  h += '<div class="card"><div class="table-wrap"><table><thead><tr>';
  h += '<th>Naam</th><th>SKU</th><th>Barcode</th><th>Category</th><th>Dam (pcs)</th><th>Stock</th><th></th></tr></thead><tbody id="prTbody">';
  if (!productsCache.length) h += '<tr><td colspan="7" style="text-align:center;color:var(--muted)">Kono product nei</td></tr>';
  productsCache.forEach(function (p) {
    var st = stockOf(p);
    var low = st <= Number(p.low_stock_threshold_pcs || 12);
    h += '<tr><td><b>' + escapeHtml(p.name) + '</b></td><td>' + escapeHtml(p.sku || '-') + '</td><td>' + escapeHtml(p.barcode || '-') + '</td>';
    h += '<td>' + escapeHtml(p.category || '-') + '</td><td>' + money(priceOf(p)) + '</td>';
    h += '<td><span class="tag ' + (low ? 'tag-bad' : 'tag-ok') + '">' + st + '</span></td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="editProduct(\'' + p.id + '\')">Edit</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function editProduct(id) {
  var p = id ? productsCache.find(function (x) { return String(x.id) === String(id); }) : {};
  if (!p) p = {};
  var h = '<h3>' + (id ? 'Product Edit' : 'Notun Product') + '</h3>';
  h += '<div class="field"><label>Naam *</label><input id="pfName" value="' + escapeHtml(p.name || '') + '"></div>';
  h += '<div class="grid grid-2">';
  h += '<div class="field"><label>SKU</label><input id="pfSku" value="' + escapeHtml(p.sku || '') + '"></div>';
  h += '<div class="field"><label>Barcode (scan korun)</label><input id="pfBarcode" value="' + escapeHtml(p.barcode || '') + '"></div>';
  h += '<div class="field"><label>Category</label><input id="pfCat" value="' + escapeHtml(p.category || '') + '"></div>';
  h += '<div class="field"><label>Box e koto dozen</label><input id="pfBox" type="number" value="' + Number(p.box_contains_dozen || 0) + '"></div>';
  h += '<div class="field"><label>Kroy dam (per pcs)</label><input id="pfCost" type="number" value="' + Number(p.cost_price_pcs || 0) + '"></div>';
  h += '<div class="field"><label>Bikroy dam (per pcs) *</label><input id="pfPrice" type="number" value="' + priceOf(p) + '"></div>';
  h += '<div class="field"><label>Low stock limit (pcs)</label><input id="pfLow" type="number" value="' + Number(p.low_stock_threshold_pcs || 12) + '"></div>';
  h += '</div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveProduct(' + (id ? "'" + id + "'" : 'null') + ')">Save</button></div>';
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
  if (!payload.name) { toast('Naam din', 'err'); return; }
  try {
    var r = id ? await sb.from('products').update(payload).eq('id', id)
               : await sb.from('products').insert(payload);
    if (r.error) throw r.error;
    closeModal();
    toast('Save hoyeche', 'ok');
    await preloadMasterData();
    navigate('products');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- STOCK ---------- */
RENDERERS.stock = async function () {
  var host = $('v-stock');
  await preloadMasterData();
  var h = '<div class="toolbar"><input id="stSearch" placeholder="Khujun" oninput="filterTable(\'stTbody\',\'stSearch\')"></div>';
  h += '<div class="card"><div class="table-wrap"><table><thead><tr><th>Product</th><th>Stock (pcs)</th><th>Dozen</th><th>Value</th><th></th></tr></thead><tbody id="stTbody">';
  productsCache.forEach(function (p) {
    var st = stockOf(p);
    h += '<tr><td>' + escapeHtml(p.name) + '</td><td><b>' + st + '</b></td><td>' + (st / 12).toFixed(1) + '</td>';
    h += '<td>' + money(st * Number(p.cost_price_pcs || 0)) + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="adjustStock(\'' + p.id + '\')">Adjust</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function adjustStock(id) {
  var p = productsCache.find(function (x) { return String(x.id) === String(id); });
  if (!p) return;
  var h = '<h3>Stock Adjust -- ' + escapeHtml(p.name) + '</h3>';
  h += '<p style="color:var(--muted);font-size:12.5px">Ekhon ache: <b>' + stockOf(p) + '</b> pcs</p>';
  h += '<div class="field"><label>Notun stock (pcs)</label><input id="saQty" type="number" value="' + stockOf(p) + '"></div>';
  h += '<div class="field"><label>Karon</label><input id="saNote" placeholder="Damage / Ganona / etc"></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveStockAdjust(\'' + id + '\')">Save</button></div>';
  openModal(h);
}

async function saveStockAdjust(id) {
  try {
    var qty = Number($('saQty').value || 0);
    var r = await sb.from('products').update({ stock_pcs: qty }).eq('id', id);
    if (r.error) throw r.error;
    closeModal();
    toast('Stock update hoyeche', 'ok');
    await preloadMasterData();
    navigate('stock');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- PURCHASES ---------- */
RENDERERS.purchases = async function () {
  var host = $('v-purchases');
  host.innerHTML = '<div class="card">Load hocche...</div>';
  var r = await sb.from('purchases').select('*').order('created_at', { ascending: false }).limit(100);
  var rows = r.data || [];
  var h = '<div class="toolbar"><button class="btn btn-primary" onclick="newPurchase()">+ Notun Purchase</button></div>';
  h += '<div class="card"><div class="table-wrap"><table><thead><tr><th>Tarikh</th><th>Supplier</th><th>Total</th><th>Paid</th><th>Baki</th></tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Kichu nei</td></tr>';
  rows.forEach(function (x) {
    var sup = suppliersCache.find(function (s) { return String(s.id) === String(x.supplier_id); });
    h += '<tr><td>' + fmtDate(x.created_at) + '</td><td>' + escapeHtml(sup ? sup.name : '-') + '</td>';
    h += '<td>' + money(x.total) + '</td><td>' + money(x.paid) + '</td><td>' + money(Number(x.total || 0) - Number(x.paid || 0)) + '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function newPurchase() {
  var h = '<h3>Notun Purchase</h3>';
  h += '<div class="field"><label>Supplier</label><select id="puSup"><option value="">-- Nei --</option>';
  suppliersCache.forEach(function (s) { h += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; });
  h += '</select></div>';
  h += '<div class="field"><label>Product</label><select id="puProd">';
  productsCache.forEach(function (p) { h += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>'; });
  h += '</select></div>';
  h += '<div class="grid grid-2">';
  h += '<div class="field"><label>Koto box</label><input id="puBox" type="number" value="1"></div>';
  h += '<div class="field"><label>Prati box er dam</label><input id="puCost" type="number" value="0"></div>';
  h += '<div class="field"><label>Koto taka dilen</label><input id="puPaid" type="number" value="0"></div>';
  h += '</div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="savePurchase()">Save</button></div>';
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
    var items = [{
      product_id: pid,
      qty_pcs: boxes * perBox,
      unit_cost: perBox ? (costBox / perBox) : costBox
    }];
    var r = await sb.rpc('record_purchase', {
      p_supplier_id: $('puSup').value || null,
      p_items: items,
      p_paid: paid
    });
    if (r.error) throw r.error;
    closeModal();
    toast('Purchase save hoyeche', 'ok');
    await preloadMasterData();
    navigate('purchases');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- SALES ---------- */
RENDERERS.sales = async function () {
  var host = $('v-sales');
  host.innerHTML = '<div class="card">Load hocche...</div>';
  var r = await sb.from('sales').select('*').order('created_at', { ascending: false }).limit(200);
  var rows = r.data || [];
  var h = '<div class="toolbar"><input id="slSearch" placeholder="Invoice khujun" oninput="filterTable(\'slTbody\',\'slSearch\')"></div>';
  h += '<div class="card"><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Somoy</th><th>Total</th><th>Paid</th><th>Baki</th><th>Status</th><th></th></tr></thead><tbody id="slTbody">';
  if (!rows.length) h += '<tr><td colspan="7" style="text-align:center;color:var(--muted)">Kichu nei</td></tr>';
  rows.forEach(function (s) {
    h += '<tr><td>' + escapeHtml(s.invoice_no || String(s.id).slice(0, 8)) + '</td><td>' + fmtDateTime(s.created_at) + '</td>';
    h += '<td>' + money(s.total) + '</td><td>' + money(s.paid) + '</td><td>' + money(s.due_amount) + '</td>';
    h += '<td>' + (s.status === 'cancelled' ? '<span class="tag tag-bad">Cancelled</span>' : '<span class="tag tag-ok">OK</span>') + '</td>';
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
    h += '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Dam</th><th>Total</th></tr></thead><tbody>';
    items.forEach(function (it) {
      var p = productsCache.find(function (x) { return String(x.id) === String(it.product_id); });
      h += '<tr><td>' + escapeHtml(p ? p.name : '-') + '</td><td>' + it.qty_pcs + '</td><td>' + money(it.unit_price) + '</td><td>' + money(Number(it.qty_pcs) * Number(it.unit_price)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="totrow big"><span>Total</span><span>' + money(s.total) + '</span></div>';
    h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Bondho</button>';
    if (s.status !== 'cancelled') h += '<button class="btn btn-danger" onclick="cancelSale(\'' + id + '\')">Sell Cancel</button>';
    h += '</div>';
    openModal(h);
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

async function cancelSale(id) {
  if (!confirm('Ei sell cancel korben? Stock ferot jabe.')) return;
  try {
    var r = await sb.rpc('cancel_sale', { p_sale_id: id });
    if (r.error) throw r.error;
    closeModal();
    toast('Cancel hoyeche', 'ok');
    await preloadMasterData();
    navigate('sales');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- RETURNS ---------- */
RENDERERS.returns = async function () {
  var host = $('v-returns');
  host.innerHTML = '<div class="card">Load hocche...</div>';
  var r = await sb.from('returns').select('*').order('created_at', { ascending: false }).limit(100);
  var rows = r.data || [];
  var h = '<div class="card"><h3>Return List</h3><div class="table-wrap"><table><thead><tr><th>Tarikh</th><th>Sale</th><th>Amount</th><th>Karon</th></tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Kono return nei</td></tr>';
  rows.forEach(function (x) {
    h += '<tr><td>' + fmtDateTime(x.created_at) + '</td><td>' + escapeHtml(String(x.sale_id || '-').slice(0, 8)) + '</td><td>' + money(x.total) + '</td><td>' + escapeHtml(x.reason || '-') + '</td></tr>';
  });
  h += '</tbody></table></div><p style="font-size:12.5px;color:var(--muted);margin-top:10px">Return korte Sales History theke sell ta khule nin.</p></div>';
  host.innerHTML = h;
};

/* ---------- CUSTOMERS ---------- */
RENDERERS.customers = async function () {
  var host = $('v-customers');
  await preloadMasterData();
  var h = '<div class="toolbar"><input id="cuSearch" placeholder="Khujun" oninput="filterTable(\'cuTbody\',\'cuSearch\')">';
  h += '<button class="btn btn-primary" onclick="editCustomer()">+ Notun Customer</button></div>';
  h += '<div class="card"><div class="table-wrap"><table><thead><tr><th>Naam</th><th>Phone</th><th>Point</th><th>Mot Kena</th><th></th></tr></thead><tbody id="cuTbody">';
  if (!customersCache.length) h += '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Kichu nei</td></tr>';
  customersCache.forEach(function (c) {
    h += '<tr><td>' + escapeHtml(c.name || '-') + '</td><td>' + escapeHtml(c.phone || '-') + '</td>';
    h += '<td>' + Number(c.loyalty_points || 0) + '</td><td>' + money(c.total_spent) + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="editCustomer(\'' + c.id + '\')">Edit</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function editCustomer(id) {
  var c = id ? customersCache.find(function (x) { return String(x.id) === String(id); }) : {};
  if (!c) c = {};
  var h = '<h3>' + (id ? 'Customer Edit' : 'Notun Customer') + '</h3>';
  h += '<div class="field"><label>Naam *</label><input id="cfName" value="' + escapeHtml(c.name || '') + '"></div>';
  h += '<div class="field"><label>Phone</label><input id="cfPhone" value="' + escapeHtml(c.phone || '') + '"></div>';
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
  if (!payload.name) { toast('Naam din', 'err'); return; }
  try {
    var r = id ? await sb.from('customers').update(payload).eq('id', id)
               : await sb.from('customers').insert(payload);
    if (r.error) throw r.error;
    closeModal();
    toast('Save hoyeche', 'ok');
    await preloadMasterData();
    navigate('customers');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- SUPPLIERS ---------- */
RENDERERS.suppliers = async function () {
  var host = $('v-suppliers');
  await preloadMasterData();
  var h = '<div class="toolbar"><input id="suSearch" placeholder="Khujun" oninput="filterTable(\'suTbody\',\'suSearch\')">';
  h += '<button class="btn btn-primary" onclick="editSupplier()">+ Notun Supplier</button></div>';
  h += '<div class="card"><div class="table-wrap"><table><thead><tr><th>Naam</th><th>Phone</th><th>Address</th><th></th></tr></thead><tbody id="suTbody">';
  if (!suppliersCache.length) h += '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Kichu nei</td></tr>';
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
  var h = '<h3>' + (id ? 'Supplier Edit' : 'Notun Supplier') + '</h3>';
  h += '<div class="field"><label>Naam *</label><input id="sfName" value="' + escapeHtml(s.name || '') + '"></div>';
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
  if (!payload.name) { toast('Naam din', 'err'); return; }
  try {
    var r = id ? await sb.from('suppliers').update(payload).eq('id', id)
               : await sb.from('suppliers').insert(payload);
    if (r.error) throw r.error;
    closeModal();
    toast('Save hoyeche', 'ok');
    await preloadMasterData();
    navigate('suppliers');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- LEDGER (Baki khata) ---------- */
RENDERERS.ledger = async function () {
  var host = $('v-ledger');
  host.innerHTML = '<div class="card">Load hocche...</div>';
  var r = await sb.from('sales').select('*').gt('due_amount', 0).neq('status', 'cancelled').order('created_at', { ascending: false });
  var rows = r.data || [];
  var totalDue = rows.reduce(function (a, s) { return a + Number(s.due_amount || 0); }, 0);

  var h = '<div class="stat reveal" style="margin-bottom:14px"><div class="lbl">MOT BAKI</div><div class="val">' + money(totalDue) + '</div><div class="sub">' + rows.length + ' ti invoice</div></div>';
  h += '<div class="card"><h3>Baki talika</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Tarikh</th><th>Customer</th><th>Baki</th><th></th></tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Kono baki nei</td></tr>';
  rows.forEach(function (s) {
    var c = customersCache.find(function (x) { return String(x.id) === String(s.customer_id); });
    var nm = c ? (c.name || c.phone) : 'Walk-in';
    h += '<tr><td>' + escapeHtml(s.invoice_no || String(s.id).slice(0, 8)) + '</td><td>' + fmtDate(s.created_at) + '</td>';
    h += '<td>' + escapeHtml(nm) + '</td><td><b style="color:var(--bad)">' + money(s.due_amount) + '</b></td><td>';
    h += '<button class="btn btn-ghost btn-sm" onclick="collectDue(\'' + s.id + '\',' + Number(s.due_amount) + ')">Taka nin</button>';
    if (c && c.phone) {
      h += ' <button class="btn btn-ghost btn-sm" onclick="sendDueReminder(\'' + c.id + '\',\'' + escapeHtml(c.phone) + '\',' + Number(s.due_amount) + ',\'' + escapeHtml(nm) + '\')">Remind</button>';
    }
    h += '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function collectDue(saleId, due) {
  var h = '<h3>Baki adaay</h3>';
  h += '<p style="color:var(--muted);font-size:12.5px">Baki ache: <b>' + money(due) + '</b></p>';
  h += '<div class="field"><label>Koto taka pelen</label><input id="duAmt" type="number" value="' + due + '"></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveDuePayment(\'' + saleId + '\',' + due + ')">Save</button></div>';
  openModal(h);
}

async function saveDuePayment(saleId, due) {
  try {
    var amt = Number($('duAmt').value || 0);
    if (amt <= 0) { toast('Taka din', 'err'); return; }
    var s = await sb.from('sales').select('paid,due_amount').eq('id', saleId).maybeSingle();
    var cur = s.data || {};
    var r = await sb.from('sales').update({
      paid: Number(cur.paid || 0) + amt,
      due_amount: Math.max(0, Number(cur.due_amount || due) - amt)
    }).eq('id', saleId);
    if (r.error) throw r.error;
    closeModal();
    toast('Joma hoyeche', 'ok');
    navigate('ledger');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- EXPENSES ---------- */
RENDERERS.expenses = async function () {
  var host = $('v-expenses');
  host.innerHTML = '<div class="card">Load hocche...</div>';
  var r = await sb.from('expenses').select('*').order('created_at', { ascending: false }).limit(200);
  var rows = r.data || [];
  var h = '<div class="toolbar"><button class="btn btn-primary" onclick="newExpense()">+ Notun Khoroch</button></div>';
  h += '<div class="card"><div class="table-wrap"><table><thead><tr><th>Tarikh</th><th>Khat</th><th>Bibaron</th><th>Taka</th></tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Kichu nei</td></tr>';
  rows.forEach(function (x) {
    h += '<tr><td>' + fmtDate(x.created_at) + '</td><td>' + escapeHtml(x.category || '-') + '</td><td>' + escapeHtml(x.note || '-') + '</td><td>' + money(x.amount) + '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

function newExpense() {
  var h = '<h3>Notun Khoroch</h3>';
  h += '<div class="field"><label>Khat</label><input id="exCat" placeholder="Bhara / Bidyut / Transport"></div>';
  h += '<div class="field"><label>Bibaron</label><input id="exNote"></div>';
  h += '<div class="field"><label>Taka *</label><input id="exAmt" type="number" value="0"></div>';
  h += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  h += '<button class="btn btn-primary" onclick="saveExpense()">Save</button></div>';
  openModal(h);
}

async function saveExpense() {
  try {
    var amt = Number($('exAmt').value || 0);
    if (amt <= 0) { toast('Taka din', 'err'); return; }
    var r = await sb.from('expenses').insert({
      category: ($('exCat').value || '').trim() || null,
      note: ($('exNote').value || '').trim() || null,
      amount: amt
    });
    if (r.error) throw r.error;
    closeModal();
    toast('Save hoyeche', 'ok');
    navigate('expenses');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- REPORTS ---------- */
RENDERERS.reports = async function () {
  var host = $('v-reports');
  host.innerHTML = '<div class="card">Hishab kora hocche...</div>';
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
      byDay[k] = (byDay[k] || 0) + Number(s.total || 0);
    });

    var h = '<div class="grid grid-4" style="margin-bottom:14px">';
    h += '<div class="stat reveal"><div class="lbl">EI MASHER BIKROY</div><div class="val">' + money(rev) + '</div></div>';
    h += '<div class="stat reveal"><div class="lbl">CASH JOMA</div><div class="val">' + money(cash) + '</div></div>';
    h += '<div class="stat reveal"><div class="lbl">BAKI</div><div class="val">' + money(due) + '</div></div>';
    h += '<div class="stat reveal"><div class="lbl">KHOROCH</div><div class="val">' + money(ex) + '</div></div>';
    h += '</div>';

    h += '<div class="card reveal"><h3>Diner hishab</h3><div class="table-wrap"><table><thead><tr><th>Tarikh</th><th>Bikroy</th></tr></thead><tbody>';
    Object.keys(byDay).forEach(function (k) {
      h += '<tr><td>' + k + '</td><td>' + money(byDay[k]) + '</td></tr>';
    });
    h += '</tbody></table></div></div>';

    host.innerHTML = h;
  } catch (e) {
    host.innerHTML = '<div class="card"><p style="color:var(--bad)">' + escapeHtml(e.message || e) + '</p></div>';
  }
};

/* ---------- ALERTS ---------- */
RENDERERS.alerts = async function () {
  var host = $('v-alerts');
  await preloadMasterData();
  var low = productsCache.filter(function (p) { return stockOf(p) <= Number(p.low_stock_threshold_pcs || 12); });
  var h = '<div class="card"><h3>Stock kome geche (' + low.length + ')</h3>';
  h += '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Stock</th><th>Limit</th><th></th></tr></thead><tbody>';
  if (!low.length) h += '<tr><td colspan="4" style="text-align:center;color:var(--ok)">Sob thik ache</td></tr>';
  low.forEach(function (p) {
    h += '<tr><td>' + escapeHtml(p.name) + '</td><td><span class="tag tag-bad">' + stockOf(p) + '</span></td>';
    h += '<td>' + Number(p.low_stock_threshold_pcs || 12) + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="adjustStock(\'' + p.id + '\')">Adjust</button></td></tr>';
  });
  h += '</tbody></table></div></div>';
  host.innerHTML = h;
};

/* ---------- STAFF ---------- */
RENDERERS.staff = async function () {
  var host = $('v-staff');
  host.innerHTML = '<div class="card">Load hocche...</div>';
  var r = await sb.from('profiles').select('*').order('created_at');
  var rows = r.data || [];
  var h = '<div class="card"><h3>Staff talika</h3><div class="table-wrap"><table><thead><tr><th>Naam</th><th>Role</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>';
  rows.forEach(function (p) {
    h += '<tr><td>' + escapeHtml(p.full_name || '-') + '</td><td><span class="tag">' + escapeHtml((p.role || '').toUpperCase()) + '</span></td>';
    h += '<td>' + escapeHtml(p.phone || '-') + '</td>';
    h += '<td>' + (p.active === false ? '<span class="tag tag-bad">Bondho</span>' : '<span class="tag tag-ok">Chalu</span>') + '</td>';
    h += '<td><button class="btn btn-ghost btn-sm" onclick="editStaff(\'' + p.id + '\')">Edit</button></td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<p style="font-size:12.5px;color:var(--muted);margin-top:10px">Notun staff add korte Supabase &gt; Authentication &gt; Users theke user toiri korun, tarpor ekhane role thik kore din.</p></div>';
  host.innerHTML = h;
};

function editStaff(id) {
  var h = '<h3>Staff Edit</h3>';
  h += '<div class="field"><label>Naam</label><input id="stfName"></div>';
  h += '<div class="field"><label>Role</label><select id="stfRole">';
  ['owner','manager','cashier','staff'].forEach(function (r) { h += '<option value="' + r + '">' + r + '</option>'; });
  h += '</select></div>';
  h += '<div class="field"><label>Phone</label><input id="stfPhone"></div>';
  h += '<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="stfActive" checked> Account chalu</label>';
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
    var r = await sb.from('profiles').update({
      full_name: ($('stfName').value || '').trim(),
      role: $('stfRole').value,
      phone: ($('stfPhone').value || '').trim() || null,
      active: $('stfActive').checked
    }).eq('id', id);
    if (r.error) throw r.error;
    closeModal();
    toast('Save hoyeche', 'ok');
    navigate('staff');
  } catch (e) { toast('Fail: ' + (e.message || e), 'err'); }
}

/* ---------- SETTINGS ---------- */
RENDERERS.settings = async function () {
  var host = $('v-settings');
  var cfg = loadCfg() || {};
  var h = '<div class="card"><h3>Connection</h3>';
  h += '<p style="font-size:12.5px;color:var(--muted)">Supabase URL: <b>' + escapeHtml(cfg.url || '-') + '</b></p>';
  h += '<p style="font-size:12.5px;color:var(--muted)">Key ta <b>config.js</b> file e permanent bosano ache. Bodlate hole oi file e edit korun.</p>';
  h += '</div>';
  h += '<div class="card"><h3>Apnar account</h3>';
  h += '<p style="font-size:13px">Naam: <b>' + escapeHtml((myProfile && myProfile.full_name) || '-') + '</b></p>';
  h += '<p style="font-size:13px">Role: <b>' + escapeHtml((myProfile && myProfile.role) || '-') + '</b></p>';
  h += '<button class="btn btn-danger" onclick="doLogout()">Logout</button></div>';
  h += '<div class="card"><h3>Automation</h3>';
  h += '<p style="font-size:12.5px;color:var(--muted)">WhatsApp, membership o loyalty settings er jonno sidebar e <b>Automation</b> page dekhun.</p></div>';
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

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });
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
window.stockOf = stockOf;
window.priceOf = priceOf;
window.pcsPerBox = pcsPerBox;
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
