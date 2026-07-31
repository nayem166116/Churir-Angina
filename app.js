/* ========================================================
   Churir Angina -- Supabase Retail POS (app.js)
   Base unit: PCS | Sale default: DOZEN | Box: variable
======================================================== */
const CFG_KEY = 'ca_supabase_cfg_v1';
let cfg = { url:'', anonKey:'' };
let sb = null;
let session = null;
let profile = null;
let cart = []; // {product, qty, unit, unit_price_input}
let productsCache = [];
let categoriesCache = [];
let customersCache = [];
let suppliersCache = [];
let activeTab = 'dashboard';

const $ = id => document.getElementById(id);
const tk = n => '৳ ' + Number(n||0).toLocaleString('en-IN', {maximumFractionDigits:2});
const pcsToDozen = pcs => (Number(pcs||0)/12);
const fmtDozenPcs = pcs => { const d = Math.floor(Number(pcs||0)/12); const r = Number(pcs||0) - d*12; return d + ' Dozen ' + r + ' Pcs (' + Number(pcs||0) + ' pcs)'; };
const todayStr = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

function toast(msg, type){
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  $('toastWrap').appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 3200);
}
function openModal(html){ $('modalBody').innerHTML = html; $('modalBg').classList.add('show'); }
function closeModal(){ $('modalBg').classList.remove('show'); }
$('modalBg') && $('modalBg').addEventListener('click', (e)=>{ if(e.target.id === 'modalBg') closeModal(); });

/* ---------------- Connection / Auth ---------------- */
function loadCfg(){
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch(e){}
}
function saveCfg(){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

function gateTab(tab){
  $('tabConnectBtn').classList.toggle('active', tab==='connect');
  $('tabLoginBtn').classList.toggle('active', tab==='login');
  $('tabConnect').classList.toggle('hidden', tab!=='connect');
  $('tabLogin').classList.toggle('hidden', tab!=='login');
}

function initClient(){
  if(!cfg.url || !cfg.anonKey) return false;
  try {
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    return true;
  } catch(e){ console.error(e); return false; }
}

function saveConnection(){
  cfg.url = ($('cfgUrl').value || '').trim().replace(/\/$/, '');
  cfg.anonKey = ($('cfgAnon').value || '').trim();
  if(!cfg.url || !cfg.anonKey){ $('gateMsg').textContent = 'URL এবং anon key দিন।'; return; }
  saveCfg();
  if(initClient()){ $('gateMsg').textContent = 'Connected. এখন Login করুন।'; gateTab('login'); }
  else { $('gateMsg').textContent = 'Connection ব্যর্থ, URL/key check করুন।'; }
}

async function doLogin(){
  if(!sb){ if(!initClient()){ $('gateMsg').textContent = 'আগে Connect step complete করুন।'; return; } }
  const email = ($('loginEmail').value||'').trim();
  const password = $('loginPass').value||'';
  if(!email || !password){ $('gateMsg').textContent = 'Email/Password দিন।'; return; }
  $('gateMsg').textContent = 'Login হচ্ছে...';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if(error) throw error;
    session = data.session;
    await afterLogin();
  } catch(e){
    $('gateMsg').textContent = 'Login failed: ' + e.message;
  }
}

async function afterLogin(){
  const { data: userData } = await sb.auth.getUser();
  const user = userData?.user;
  if(!user){ toast('Session not found', 'err'); return; }
  let { data: prof } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  profile = prof || { id:user.id, full_name: user.email, role:'owner' };
  $('gate').style.display = 'none';
  $('app').classList.add('show');
  $('userBadge').textContent = (profile.role||'owner') + ' • ' + (profile.full_name || user.email);
  buildNav();
  showTab('dashboard');
  setSyncStatus(true);
}

async function logout(){
  try { await sb.auth.signOut(); } catch(e){}
  session = null; profile = null;
  $('app').classList.remove('show');
  $('gate').style.display = 'flex';
  gateTab('login');
}

function setSyncStatus(ok){
  const el = $('syncStatus');
  el.textContent = ok ? '● Connected' : '● Offline';
  el.style.color = ok ? '#2fb36d' : '#c94848';
}

async function restoreSession(){
  loadCfg();
  if(!initClient()) return;
  const { data } = await sb.auth.getSession();
  if(data && data.session){ session = data.session; await afterLogin(); }
  else { $('cfgUrl').value = cfg.url; $('cfgAnon').value = cfg.anonKey; gateTab('login'); }
}

/* ---------------- Navigation ---------------- */
const NAV = [
  { group:'Overview', items:[ ['dashboard','📊 Dashboard'] ] },
  { group:'Operations', items:[ ['pos','🛍️ POS'], ['products','📦 Products'], ['purchases','📥 Purchases'], ['sales','🧾 Sales / Cancel'], ['returns','↩️ Returns'] ] },
  { group:'Money', items:[ ['ledger','💰 Due / Payments'], ['expenses','🧾 Expenses'], ['closing','🔒 Daily Closing'] ] },
  { group:'People', items:[ ['customers','👥 Customers'], ['suppliers','🏪 Suppliers'], ['partners','🤝 Partners'] ] },
  { group:'Insights', items:[ ['reports','📈 Reports'], ['stockmove','🔁 Stock Movement'], ['alerts','🔔 Alerts'] ] },
  { group:'System', items:[ ['audit','📜 Audit Log'], ['trash','🗑️ Trash'], ['backups','☁️ Backups'], ['settings','⚙️ Settings'] ] },
];
function buildNav(){
  let html = '';
  NAV.forEach(g => {
    html += `<div class="nav-group">${g.group}</div>`;
    g.items.forEach(([id,label]) => {
      html += `<button class="nav-btn" data-tab="${id}" onclick="showTab('${id}')">${label}</button>`;
    });
  });
  $('navHost').innerHTML = html;
}
function showTab(tab){
  activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = $('v-' + tab);
  if(view) view.classList.add('active');
  const titles = { dashboard:'Dashboard', pos:'POS বিক্রয়', products:'Products', purchases:'Purchases', sales:'Sales / Cancel',
    returns:'Sales Return', ledger:'Due / Payment Ledger', expenses:'Expenses', closing:'Daily Closing',
    customers:'Customers', suppliers:'Suppliers', partners:'Partners', reports:'Reports', stockmove:'Stock Movement',
    alerts:'Alert Center', audit:'Audit Log', trash:'Trash', backups:'Backups', settings:'Settings' };
  $('pageTitle').textContent = titles[tab] || tab;
  renderTab(tab);
}
function renderTab(tab){
  const map = { dashboard:renderDashboard, pos:renderPOS, products:renderProducts, purchases:renderPurchases,
    sales:renderSales, returns:renderReturns, ledger:renderLedger, expenses:renderExpenses, closing:renderClosing,
    customers:renderCustomers, suppliers:renderSuppliers, partners:renderPartners, reports:renderReports,
    stockmove:renderStockMove, alerts:renderAlerts, audit:renderAudit, trash:renderTrash, backups:renderBackups, settings:renderSettings };
  if(map[tab]) map[tab]();
}

/* ---------------- Data helpers ---------------- */
async function fetchProducts(){
  const { data, error } = await sb.from('products').select('*, inventory(quantity_pcs), categories(name)').eq('is_active', true).order('name');
  if(error){ toast('Product load failed: '+error.message,'err'); return []; }
  productsCache = data || [];
  return productsCache;
}
async function fetchCategories(){
  const { data } = await sb.from('categories').select('*').order('name');
  categoriesCache = data || [];
  return categoriesCache;
}
async function fetchCustomers(){
  const { data } = await sb.from('customers').select('*').order('name');
  customersCache = data || [];
  return customersCache;
}
async function fetchSuppliers(){
  const { data } = await sb.from('suppliers').select('*').order('name');
  suppliersCache = data || [];
  return suppliersCache;
}
async function logAudit(action, module, details){
  try { await sb.from('audit_log').insert({ actor_id: profile?.id, actor_email: session?.user?.email, action, module, details }); } catch(e){}
}

/* ==================================================================
   DASHBOARD
================================================================== */
async function renderDashboard(){
  const host = $('v-dashboard');
  host.innerHTML = `<div class="grid cols-4" id="dashMetrics">
    <div class="card metric"><div class="k">আজকের বিক্রয়</div><div class="v" id="mToday">৳ 0</div><div class="d" id="mTodayCount">0 invoice</div></div>
    <div class="card metric"><div class="k">এই মাসের বিক্রয়</div><div class="v" id="mMonth">৳ 0</div><div class="d" id="mMonthCount">0 invoice</div></div>
    <div class="card metric"><div class="k">Customer Due</div><div class="v" id="mCustDue">৳ 0</div><div class="d">Total pending</div></div>
    <div class="card metric"><div class="k">Supplier Due</div><div class="v" id="mSupDue">৳ 0</div><div class="d">Total payable</div></div>
  </div>
  <div class="grid cols-2" style="margin-top:14px">
    <div class="card"><h3>স্টক মূল্য (অনুমান)</h3><div class="v" id="mStockValue" style="font-size:20px;font-weight:800;color:var(--pink-d)">৳ 0</div><p class="muted" style="font-size:12px">cost_per_pcs × quantity_pcs এর যোগয়োগ</p></div>
    <div class="card"><h3>Low Stock Alert</h3><div id="lowStockMini" class="muted">Loading...</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>সাম্প্রতিক Invoice</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="right">Total</th><th class="right">Due</th><th>Status</th></tr></thead><tbody id="recentSalesRows"></tbody></table></div></div>`;

  try {
    const startToday = todayStr();
    const startMonth = startToday.slice(0,7) + '-01';
    const { data: todaySales } = await sb.from('sales').select('total_amount, due_amount').gte('created_at', startToday).neq('status','canceled');
    const { data: monthSales } = await sb.from('sales').select('total_amount, due_amount').gte('created_at', startMonth).neq('status','canceled');
    const tSum = (todaySales||[]).reduce((a,s)=>a+Number(s.total_amount||0),0);
    const mSum = (monthSales||[]).reduce((a,s)=>a+Number(s.total_amount||0),0);
    $('mToday').textContent = tk(tSum); $('mTodayCount').textContent = (todaySales||[]).length + ' invoice';
    $('mMonth').textContent = tk(mSum); $('mMonthCount').textContent = (monthSales||[]).length + ' invoice';

    const { data: dueSales } = await sb.from('sales').select('due_amount').gt('due_amount',0).neq('status','canceled');
    $('mCustDue').textContent = tk((dueSales||[]).reduce((a,s)=>a+Number(s.due_amount||0),0));

    const { data: duePurchases } = await sb.from('purchases').select('due_amount').gt('due_amount',0);
    $('mSupDue').textContent = tk((duePurchases||[]).reduce((a,s)=>a+Number(s.due_amount||0),0));

    const prods = await fetchProducts();
    const stockValue = prods.reduce((a,p)=> a + Number(p.cost_per_pcs||0) * Number(p.inventory?.quantity_pcs||0), 0);
    $('mStockValue').textContent = tk(stockValue);
    const low = prods.filter(p => Number(p.inventory?.quantity_pcs||0) <= Number(p.low_stock_threshold_pcs||24));
    $('lowStockMini').innerHTML = low.length ? low.slice(0,6).map(p=>`<div style="padding:4px 0">⚠️ ${p.name} (${p.sku}) — ${fmtDozenPcs(p.inventory?.quantity_pcs)}</div>`).join('') : '<span class="pill ok">Stock ঠিক আছে</span>';

    const { data: recent } = await sb.from('sales').select('invoice_number, created_at, total_amount, due_amount, status, customers(name)').order('created_at',{ascending:false}).limit(8);
    $('recentSalesRows').innerHTML = (recent||[]).map(s=>`<tr><td>${s.invoice_number}</td><td>${new Date(s.created_at).toLocaleString()}</td><td>${s.customers?.name||'Walk-in'}</td><td class="right">${tk(s.total_amount)}</td><td class="right">${tk(s.due_amount)}</td><td><span class="pill ${s.status==='active'?'ok':s.status==='canceled'?'bad':'warn'}">${s.status}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No sales yet</td></tr>';
    setSyncStatus(true);
  } catch(e){ toast('Dashboard load failed: '+e.message, 'err'); setSyncStatus(false); }
}

/* ==================================================================
   POS
================================================================== */
async function renderPOS(){
  const host = $('v-pos');
  host.innerHTML = `<div class="pos-wrap">
    <div>
      <div class="pos-search"><input id="posSearch" placeholder="🔍 Product name / SKU / Barcode…" oninput="renderProductGrid()"></div>
      <div class="product-grid" id="productGrid"></div>
    </div>
    <div class="cart-panel">
      <h3 style="margin:0 0 8px">🛍️ Cart</h3>
      <div id="cartItems"><p class="muted">Cart empty</p></div>
      <div class="field"><label>Customer (optional)</label>
        <select id="posCustomer"><option value="">Walk-in Customer</option></select>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="field"><label>Discount</label><input id="posDiscount" type="number" value="0"></div>
        <div class="field"><label>Paid Amount</label><input id="posPaid" type="number" value="0"></div>
      </div>
      <div class="field"><label>Payment Method</label>
        <select id="posPayMethod"><option value="cash">Cash</option><option value="mfs">bKash/Nagad</option><option value="bank">Bank</option><option value="due">Due</option></select>
      </div>
      <div class="cart-summary" id="cartSummary"></div>
      <button class="btn primary block" style="margin-top:10px" onclick="checkout()">✅ Complete Sale</button>
      <button class="btn small block" style="margin-top:6px" onclick="clearCart()">Clear Cart</button>
    </div>
  </div>`;
  await fetchProducts();
  await fetchCustomers();
  $('posCustomer').innerHTML += customersCache.map(c=>`<option value="${c.id}">${c.name}${c.phone?(' - '+c.phone):''}</option>`).join('');
  renderProductGrid();
  renderCart();
}
function renderProductGrid(){
  const q = ($('posSearch')?.value || '').toLowerCase();
  const list = productsCache.filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.barcode||'').toLowerCase().includes(q));
  $('productGrid').innerHTML = list.map(p => {
    const stock = Number(p.inventory?.quantity_pcs||0);
    const low = stock <= Number(p.low_stock_threshold_pcs||24);
    return `<div class="product-card" onclick='addToCart(${JSON.stringify(p.id)})'>
      <img src="${p.image_url||''}" onerror="this.style.display='none'">
      <b>${p.name}</b>
      <span class="stk">${p.color||''} ${p.size||''}</span><br>
      <span class="stk ${low?'low':''}">${fmtDozenPcs(stock)}</span><br>
      <b style="color:var(--pink-d)">${tk(p.default_sale_price_per_dozen)}/dz</b>
    </div>`;
  }).join('') || '<p class="muted">No products found. Products tab থেকে যোগ করুন।</p>';
}
function addToCart(productId){
  const p = productsCache.find(x => x.id === productId);
  if(!p) return;
  const existing = cart.find(c => c.product.id === productId && c.unit === 'dozen');
  if(existing){ existing.qty += 1; }
  else { cart.push({ product: p, qty: 1, unit: 'dozen', unit_price_input: Number(p.default_sale_price_per_dozen||0) }); }
  renderCart();
}
function updateCartLine(idx, field, value){
  const line = cart[idx]; if(!line) return;
  if(field === 'unit'){
    line.unit = value;
    line.unit_price_input = value === 'dozen' ? Number(line.product.default_sale_price_per_dozen||0) : Number(line.product.default_sale_price_per_pcs||0);
  } else if(field === 'qty'){ line.qty = Math.max(0.01, Number(value)||1); }
  else if(field === 'price'){ line.unit_price_input = Number(value)||0; }
  renderCart();
}
function removeCartLine(idx){ cart.splice(idx,1); renderCart(); }
function clearCart(){ cart = []; renderCart(); }
function renderCart(){
  if(!cart.length){ $('cartItems').innerHTML = '<p class="muted">Cart empty</p>'; $('cartSummary').innerHTML=''; return; }
  $('cartItems').innerHTML = cart.map((line, idx) => `
    <div class="cart-item">
      <div><b style="font-size:12.5px">${line.product.name}</b><div class="muted" style="font-size:11px">${line.product.sku}</div></div>
      <input type="number" min="0.01" step="0.01" value="${line.qty}" onchange="updateCartLine(${idx},'qty',this.value)">
      <select onchange="updateCartLine(${idx},'unit',this.value)">
        <option value="dozen" ${line.unit==='dozen'?'selected':''}>Dozen</option>
        <option value="pcs" ${line.unit==='pcs'?'selected':''}>Pcs</option>
      </select>
      <input type="number" value="${line.unit_price_input}" style="width:64px" onchange="updateCartLine(${idx},'price',this.value)">
      <button class="btn small danger" style="grid-column:1/-1;margin-top:4px" onclick="removeCartLine(${idx})">Remove</button>
    </div>`).join('');
  const subtotal = cart.reduce((a,l)=> a + l.qty * l.unit_price_input, 0);
  const discount = Number($('posDiscount')?.value || 0);
  const total = Math.max(subtotal - discount, 0);
  const paid = Number($('posPaid')?.value || 0);
  const due = Math.max(total - paid, 0);
  $('cartSummary').innerHTML = `<div class="row"><span>Subtotal</span><span>${tk(subtotal)}</span></div>
    <div class="row"><span>Discount</span><span>-${tk(discount)}</span></div>
    <div class="row total"><span>Total</span><span>${tk(total)}</span></div>
    <div class="row"><span>Paid</span><span>${tk(paid)}</span></div>
    <div class="row"><span>Due</span><span style="color:var(--bad)">${tk(due)}</span></div>`;
}
$('content') && $('content').addEventListener('input', (e)=>{ if(e.target && (e.target.id==='posDiscount' || e.target.id==='posPaid')) renderCart(); });

async function checkout(){
  if(!cart.length) return toast('Cart খালি', 'err');
  const items = cart.map(l => ({ product_id: l.product.id, qty: l.qty, unit: l.unit, unit_price_input: l.unit_price_input }));
  const discount = Number($('posDiscount').value||0);
  const paid = Number($('posPaid').value||0);
  const payment_method = $('posPayMethod').value;
  const customer_id = $('posCustomer').value || null;
  try {
    const { data, error } = await sb.rpc('complete_sale', {
      p_customer_id: customer_id, p_payment_method: payment_method, p_discount: discount, p_paid: paid, p_items: items, p_note: null
    });
    if(error) throw error;
    const res = Array.isArray(data) ? data[0] : data;
    toast('Sale complete: ' + res.invoice_number, 'ok');
    clearCart();
    await fetchProducts(); renderProductGrid();
    showReceipt(res);
  } catch(e){ toast('Checkout failed: ' + e.message, 'err'); }
}
function showReceipt(res){
  openModal(`<h3>✅ Invoice: ${res.invoice_number}</h3>
    <p>Total: <b>${tk(res.total_amount)}</b></p>
    <p>Due: <b style="color:var(--bad)">${tk(res.due_amount)}</b></p>
    <button class="btn primary block" onclick="closeModal()">OK</button>`);
}

/* ==================================================================
   PRODUCTS
================================================================== */
async function renderProducts(){
  const host = $('v-products');
  host.innerHTML = `<div class="section-head"><h2>Products</h2><button class="btn primary" onclick="openProductForm()">+ Add Product</button></div>
  <div class="filters"><input id="prodFilter" placeholder="Search..." oninput="renderProductTable()"></div>
  <div class="table-wrap"><table><thead><tr><th>SKU</th><th>Name</th><th>Color/Size</th><th class="right">Cost/Pcs</th><th class="right">Sale/Dozen</th><th class="right">Stock</th><th></th></tr></thead><tbody id="productRows"></tbody></table></div>`;
  await fetchProducts(); await fetchCategories();
  renderProductTable();
}
function renderProductTable(){
  const q = ($('prodFilter')?.value||'').toLowerCase();
  const list = productsCache.filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q));
  $('productRows').innerHTML = list.map(p => `<tr>
    <td>${p.sku}</td><td>${p.name}</td><td>${p.color||''} ${p.size||''}</td>
    <td class="right">${tk(p.cost_per_pcs)}</td><td class="right">${tk(p.default_sale_price_per_dozen)}</td>
    <td class="right">${fmtDozenPcs(p.inventory?.quantity_pcs)}</td>
    <td><button class="btn small" onclick='openProductForm(${JSON.stringify(p.id)})'>Edit</button>
        <button class="btn small danger" onclick="deleteProduct('${p.id}')">Trash</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No products</td></tr>';
}
function openProductForm(id){
  const p = id ? productsCache.find(x=>x.id===id) : null;
  openModal(`<h3>${p?'Edit':'Add'} Product</h3>
    <div class="form-grid">
      <div class="field"><label>SKU</label><input id="fSku" value="${p?.sku||''}"></div>
      <div class="field"><label>Name</label><input id="fName" value="${p?.name||''}"></div>
      <div class="field"><label>Category</label>
        <select id="fCategory">${categoriesCache.map(c=>`<option value="${c.id}" ${p?.category_id===c.id?'selected':''}>${c.name}</option>`).join('')}</select></div>
      <div class="field"><label>Collection</label><input id="fCollection" value="${p?.collection||''}"></div>
      <div class="field"><label>Color</label><input id="fColor" value="${p?.color||''}"></div>
      <div class="field"><label>Size</label><input id="fSize" value="${p?.size||''}"></div>
      <div class="field"><label>Barcode</label><input id="fBarcode" value="${p?.barcode||''}"></div>
      <div class="field"><label>Image URL</label><input id="fImage" value="${p?.image_url||''}"></div>
      <div class="field"><label>Sale Price / Dozen</label><input id="fPriceDozen" type="number" value="${p?.default_sale_price_per_dozen||0}"></div>
      <div class="field"><label>Sale Price / Pcs</label><input id="fPricePcs" type="number" value="${p?.default_sale_price_per_pcs||0}"></div>
      <div class="field"><label>Low Stock Threshold (pcs)</label><input id="fLowStock" type="number" value="${p?.low_stock_threshold_pcs||24}"></div>
    </div>
    <p class="help">Cost/Pcs স্বয়ংক্রিয়ভাবে update হয় Purchase entry থেকে। Opening stock দিতে Purchases tab ব্যবহার করুন।</p>
    <button class="btn primary block" onclick="saveProduct(${p?`'${p.id}'`:'null'})">Save</button>`);
}
async function saveProduct(id){
  const payload = {
    sku: $('fSku').value.trim(), name: $('fName').value.trim(), category_id: $('fCategory').value || null,
    collection: $('fCollection').value.trim(), color: $('fColor').value.trim(), size: $('fSize').value.trim(),
    barcode: $('fBarcode').value.trim() || null, image_url: $('fImage').value.trim() || null,
    default_sale_price_per_dozen: Number($('fPriceDozen').value||0), default_sale_price_per_pcs: Number($('fPricePcs').value||0),
    low_stock_threshold_pcs: Number($('fLowStock').value||24)
  };
  if(!payload.sku || !payload.name) return toast('SKU/Name আবশ্যক', 'err');
  try {
    if(id){ const { error } = await sb.from('products').update(payload).eq('id', id); if(error) throw error; }
    else { const { error } = await sb.from('products').insert(payload); if(error) throw error; }
    await logAudit(id?'update_product':'create_product','products',payload);
    closeModal(); toast('Product saved', 'ok'); await fetchProducts(); renderProductTable();
  } catch(e){ toast('Save failed: '+e.message, 'err'); }
}
async function deleteProduct(id){
  if(!confirm('Product Trash-এ পাঠাতে চান?')) return;
  const p = productsCache.find(x=>x.id===id);
  try {
    await sb.from('trash').insert({ table_name:'products', record_json: p, details:'Deleted from Products tab', deleted_by: profile?.id });
    const { error } = await sb.from('products').update({ is_active:false }).eq('id', id);
    if(error) throw error;
    await logAudit('trash_product','products',{id});
    toast('Product Trash-এ পাঠানো হয়েছে', 'ok'); await fetchProducts(); renderProductTable();
  } catch(e){ toast('Failed: '+e.message, 'err'); }
}

/* ==================================================================
   PURCHASES (variable box handled)
================================================================== */
let purchaseLines = [];
async function renderPurchases(){
  const host = $('v-purchases');
  await fetchProducts(); await fetchSuppliers();
  purchaseLines = [];
  host.innerHTML = `<div class="section-head"><h2>New Purchase</h2></div>
  <div class="card">
    <div class="form-grid">
      <div class="field"><label>Supplier</label><select id="pSupplier"><option value="">-- Select --</option>${suppliersCache.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
      <div class="field"><label>Bill No</label><input id="pBillNo"></div>
      <div class="field"><label>Paid Amount</label><input id="pPaid" type="number" value="0"></div>
    </div>
    <div id="purchaseLinesHost"></div>
    <button class="btn small" onclick="addPurchaseLine()">+ Add Item</button>
    <div class="cart-summary" id="purchaseSummary" style="margin-top:10px"></div>
    <button class="btn primary block" style="margin-top:10px" onclick="savePurchase()">Save Purchase</button>
  </div>
  <div class="card" style="margin-top:14px"><h3>Recent Purchases</h3><div class="table-wrap"><table><thead><tr><th>Bill</th><th>Supplier</th><th>Date</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Due</th></tr></thead><tbody id="purchaseRows"></tbody></table></div></div>`;
  addPurchaseLine();
  loadPurchaseHistory();
}
function addPurchaseLine(){
  purchaseLines.push({ product_id:'', purchase_unit:'box', qty_unit:1, box_contains_dozen:6, unit_cost:0 });
  renderPurchaseLines();
}
function removePurchaseLine(idx){ purchaseLines.splice(idx,1); renderPurchaseLines(); }
function updatePurchaseLine(idx, field, value){
  purchaseLines[idx][field] = (field==='product_id'||field==='purchase_unit') ? value : Number(value);
  renderPurchaseLines();
}
function renderPurchaseLines(){
  $('purchaseLinesHost').innerHTML = purchaseLines.map((l, idx) => {
    const pcsPerUnit = l.purchase_unit==='box' ? (Number(l.box_contains_dozen||0)*12) : (l.purchase_unit==='dozen'?12:1);
    const stockIn = Number(l.qty_unit||0) * pcsPerUnit;
    const costPerPcs = pcsPerUnit ? (Number(l.unit_cost||0)/pcsPerUnit) : 0;
    return `<div class="card" style="margin-top:8px">
      <div class="form-grid">
        <div class="field"><label>Product</label><select onchange="updatePurchaseLine(${idx},'product_id',this.value)"><option value="">-- Select --</option>${productsCache.map(p=>`<option value="${p.id}" ${l.product_id===p.id?'selected':''}>${p.name} (${p.sku})</option>`).join('')}</select></div>
        <div class="field"><label>Purchase Unit</label><select onchange="updatePurchaseLine(${idx},'purchase_unit',this.value)">
          <option value="box" ${l.purchase_unit==='box'?'selected':''}>Box</option>
          <option value="dozen" ${l.purchase_unit==='dozen'?'selected':''}>Dozen</option>
          <option value="pcs" ${l.purchase_unit==='pcs'?'selected':''}>Pcs</option></select></div>
        <div class="field"><label>Qty (${l.purchase_unit})</label><input type="number" value="${l.qty_unit}" onchange="updatePurchaseLine(${idx},'qty_unit',this.value)"></div>
        ${l.purchase_unit==='box' ? `<div class="field"><label>Box contains কত Dozen</label><input type="number" value="${l.box_contains_dozen}" onchange="updatePurchaseLine(${idx},'box_contains_dozen',this.value)"></div>` : ''}
        <div class="field"><label>Cost per ${l.purchase_unit}</label><input type="number" value="${l.unit_cost}" onchange="updatePurchaseLine(${idx},'unit_cost',this.value)"></div>
      </div>
      <p class="help">Pcs/unit: <b>${pcsPerUnit}</b> &nbsp;|&nbsp; Stock in: <b>${stockIn} pcs</b> (${fmtDozenPcs(stockIn)}) &nbsp;|&nbsp; Cost/Pcs: <b>${tk(costPerPcs)}</b></p>
      <button class="btn small danger" onclick="removePurchaseLine(${idx})">Remove</button>
    </div>`;
  }).join('');
  const total = purchaseLines.reduce((a,l)=> a + Number(l.qty_unit||0)*Number(l.unit_cost||0), 0);
  $('purchaseSummary').innerHTML = `<div class="row total"><span>Total Bill</span><span>${tk(total)}</span></div>`;
}
async function savePurchase(){
  const items = purchaseLines.filter(l => l.product_id && l.qty_unit>0).map(l => ({
    product_id: l.product_id, purchase_unit: l.purchase_unit, qty_unit: l.qty_unit,
    box_contains_dozen: l.purchase_unit==='box' ? l.box_contains_dozen : null, unit_cost: l.unit_cost
  }));
  if(!items.length) return toast('অন্তত ১টি item দিন', 'err');
  try {
    const { data, error } = await sb.rpc('record_purchase', {
      p_supplier_id: $('pSupplier').value || null, p_bill_no: $('pBillNo').value || null,
      p_paid_amount: Number($('pPaid').value||0), p_items: items, p_note: null
    });
    if(error) throw error;
    toast('Purchase saved', 'ok');
    purchaseLines = []; addPurchaseLine();
    await fetchProducts(); loadPurchaseHistory();
  } catch(e){ toast('Purchase failed: '+e.message, 'err'); }
}
async function loadPurchaseHistory(){
  const { data } = await sb.from('purchases').select('bill_no, created_at, total_bill, paid_amount, due_amount, suppliers(name)').order('created_at',{ascending:false}).limit(15);
  $('purchaseRows').innerHTML = (data||[]).map(p=>`<tr><td>${p.bill_no||'-'}</td><td>${p.suppliers?.name||'-'}</td><td>${new Date(p.created_at).toLocaleDateString()}</td><td class="right">${tk(p.total_bill)}</td><td class="right">${tk(p.paid_amount)}</td><td class="right">${tk(p.due_amount)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No purchases</td></tr>';
}

/* ==================================================================
   SALES LIST / CANCEL
================================================================== */
async function renderSales(){
  const host = $('v-sales');
  host.innerHTML = `<div class="filters"><input id="saleSearch" placeholder="Invoice number..."><button class="btn" onclick="searchSale()">Search</button></div>
  <div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="right">Total</th><th class="right">Due</th><th>Status</th><th></th></tr></thead><tbody id="salesRows"></tbody></table></div>`;
  loadSalesList();
}
async function loadSalesList(){
  const { data } = await sb.from('sales').select('*, customers(name)').order('created_at',{ascending:false}).limit(30);
  $('salesRows').innerHTML = (data||[]).map(s=>`<tr><td>${s.invoice_number}</td><td>${new Date(s.created_at).toLocaleString()}</td><td>${s.customers?.name||'Walk-in'}</td><td class="right">${tk(s.total_amount)}</td><td class="right">${tk(s.due_amount)}</td><td><span class="pill ${s.status==='active'?'ok':s.status==='canceled'?'bad':'warn'}">${s.status}</span></td><td>${s.status==='active'?`<button class="btn small danger" onclick="cancelInvoice('${s.invoice_number}')">Cancel</button>`:''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No sales</td></tr>';
}
async function searchSale(){
  const q = $('saleSearch').value.trim();
  if(!q) return loadSalesList();
  const { data } = await sb.from('sales').select('*, customers(name)').ilike('invoice_number', `%${q}%`).order('created_at',{ascending:false});
  $('salesRows').innerHTML = (data||[]).map(s=>`<tr><td>${s.invoice_number}</td><td>${new Date(s.created_at).toLocaleString()}</td><td>${s.customers?.name||'Walk-in'}</td><td class="right">${tk(s.total_amount)}</td><td class="right">${tk(s.due_amount)}</td><td><span class="pill ${s.status==='active'?'ok':'bad'}">${s.status}</span></td><td>${s.status==='active'?`<button class="btn small danger" onclick="cancelInvoice('${s.invoice_number}')">Cancel</button>`:''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Not found</td></tr>';
}
async function cancelInvoice(inv){
  const reason = prompt('Cancel করার কারণ লিখুন:');
  if(reason === null) return;
  try {
    const { error } = await sb.rpc('cancel_sale', { p_invoice_number: inv, p_reason: reason });
    if(error) throw error;
    toast('Invoice canceled', 'ok'); loadSalesList();
  } catch(e){ toast('Cancel failed: '+e.message, 'err'); }
}

/* ==================================================================
   RETURNS
================================================================== */
let returnLines = [];
async function renderReturns(){
  const host = $('v-returns');
  host.innerHTML = `<div class="card">
    <div class="form-grid">
      <div class="field"><label>Invoice Number</label><input id="rInvoice" placeholder="INV-..."></div>
      <div class="field"><label>Mode</label><select id="rMode"><option value="refund">Refund (Cash back)</option><option value="exchange">Exchange</option><option value="due_adjust">Due Adjust</option></select></div>
    </div>
    <button class="btn small" onclick="loadInvoiceForReturn()">Load Invoice</button>
    <div id="returnLinesHost" style="margin-top:10px"></div>
    <button class="btn small" onclick="addReturnLine()">+ Add Item</button>
    <button class="btn primary block" style="margin-top:10px" onclick="submitReturn()">Process Return</button>
  </div>`;
  returnLines = [];
}
async function loadInvoiceForReturn(){
  const inv = $('rInvoice').value.trim();
  if(!inv) return;
  const { data: sale } = await sb.from('sales').select('id').eq('invoice_number', inv).maybeSingle();
  if(!sale) return toast('Invoice পাওয়া যায়নি', 'err');
  const { data: items } = await sb.from('sale_items').select('*, products(name, sku)').eq('sale_id', sale.id);
  returnLines = (items||[]).map(it => ({ product_id: it.product_id, name: it.products?.name, unit: it.unit, qty: 0, refund_amount: 0 }));
  renderReturnLines();
}
function addReturnLine(){ returnLines.push({ product_id:'', name:'Manual', unit:'pcs', qty:0, refund_amount:0 }); renderReturnLines(); }
function updateReturnLine(idx, field, value){ returnLines[idx][field] = (field==='name'||field==='unit'||field==='product_id') ? value : Number(value); }
function renderReturnLines(){
  $('returnLinesHost').innerHTML = returnLines.map((l, idx) => `<div class="cart-item">
    <div>${l.name} <select onchange="updateReturnLine(${idx},'unit',this.value)"><option value="pcs" ${l.unit==='pcs'?'selected':''}>Pcs</option><option value="dozen" ${l.unit==='dozen'?'selected':''}>Dozen</option></select></div>
    <input type="number" placeholder="Qty" value="${l.qty}" onchange="updateReturnLine(${idx},'qty',this.value)">
    <input type="number" placeholder="Refund ৳" value="${l.refund_amount}" onchange="updateReturnLine(${idx},'refund_amount',this.value)">
    <span></span></div>`).join('');
}
async function submitReturn(){
  const inv = $('rInvoice').value.trim();
  const items = returnLines.filter(l=>l.product_id && l.qty>0).map(l=>({ product_id:l.product_id, qty:l.qty, unit:l.unit, refund_amount:l.refund_amount }));
  if(!inv || !items.length) return toast('Invoice ও item দিন', 'err');
  try {
    const { error } = await sb.rpc('process_return', { p_invoice_number: inv, p_items: items, p_mode: $('rMode').value });
    if(error) throw error;
    toast('Return processed', 'ok'); returnLines=[]; renderReturnLines();
  } catch(e){ toast('Return failed: '+e.message, 'err'); }
}

/* ==================================================================
   LEDGER (Customer due + Supplier due payments)
================================================================== */
async function renderLedger(){
  const host = $('v-ledger');
  host.innerHTML = `<div class="grid cols-2">
    <div class="card"><h3>Customer Due</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th class="right">Due</th><th></th></tr></thead><tbody id="custDueRows"></tbody></table></div></div>
    <div class="card"><h3>Supplier Due</h3><div class="table-wrap"><table><thead><tr><th>Bill</th><th>Supplier</th><th class="right">Due</th><th></th></tr></thead><tbody id="supDueRows"></tbody></table></div></div>
  </div>`;
  const { data: cd } = await sb.from('sales').select('invoice_number, due_amount, customers(name)').gt('due_amount',0).neq('status','canceled');
  $('custDueRows').innerHTML = (cd||[]).map(s=>`<tr><td>${s.invoice_number}</td><td>${s.customers?.name||'Walk-in'}</td><td class="right">${tk(s.due_amount)}</td><td><button class="btn small" onclick="recordCustomerPayment('${s.invoice_number}', ${s.due_amount})">Receive</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No due</td></tr>';
  const { data: sd } = await sb.from('purchases').select('id, bill_no, due_amount, suppliers(name)').gt('due_amount',0);
  $('supDueRows').innerHTML = (sd||[]).map(p=>`<tr><td>${p.bill_no||'-'}</td><td>${p.suppliers?.name||'-'}</td><td class="right">${tk(p.due_amount)}</td><td><button class="btn small" onclick="recordSupplierPayment('${p.id}', ${p.due_amount})">Pay</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No due</td></tr>';
}
async function recordCustomerPayment(invoice, maxDue){
  const amt = Number(prompt(`কত টাকা receive করলেন? (Due: ${maxDue})`, maxDue));
  if(!amt || amt<=0) return;
  try {
    const { data: sale } = await sb.from('sales').select('id, due_amount, paid_amount, customer_id').eq('invoice_number', invoice).maybeSingle();
    const newDue = Math.max(Number(sale.due_amount) - amt, 0);
    await sb.from('sales').update({ due_amount:newDue, paid_amount:Number(sale.paid_amount)+amt }).eq('id', sale.id);
    await sb.from('customer_payments').insert({ customer_id: sale.customer_id, sale_id: sale.id, amount: amt });
    await sb.from('cashbook').insert({ entry_date: todayStr(), description:'Due received '+invoice, money_in: amt, money_out:0, ref_type:'customer_payment', ref_id: sale.id });
    toast('Payment recorded', 'ok'); renderLedger();
  } catch(e){ toast('Failed: '+e.message, 'err'); }
}
async function recordSupplierPayment(purchaseId, maxDue){
  const amt = Number(prompt(`কত টাকা pay করলেন? (Due: ${maxDue})`, maxDue));
  if(!amt || amt<=0) return;
  try {
    const { data: pur } = await sb.from('purchases').select('id, due_amount, paid_amount, supplier_id').eq('id', purchaseId).maybeSingle();
    const newDue = Math.max(Number(pur.due_amount) - amt, 0);
    await sb.from('purchases').update({ due_amount:newDue, paid_amount:Number(pur.paid_amount)+amt }).eq('id', pur.id);
    await sb.from('supplier_payments').insert({ supplier_id: pur.supplier_id, purchase_id: pur.id, amount: amt });
    await sb.from('cashbook').insert({ entry_date: todayStr(), description:'Supplier paid', money_in:0, money_out: amt, ref_type:'supplier_payment', ref_id: pur.id });
    toast('Payment recorded', 'ok'); renderLedger();
  } catch(e){ toast('Failed: '+e.message, 'err'); }
}

/* ==================================================================
   EXPENSES
================================================================== */
async function renderExpenses(){
  const host = $('v-expenses');
  host.innerHTML = `<div class="card">
    <div class="form-grid">
      <div class="field"><label>Category</label><input id="eCategory" placeholder="Rent/Electricity/Staff..."></div>
      <div class="field"><label>Amount</label><input id="eAmount" type="number"></div>
      <div class="field"><label>Note</label><input id="eNote"></div>
    </div>
    <button class="btn primary" onclick="saveExpense()">Add Expense</button>
  </div>
  <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="right">Amount</th></tr></thead><tbody id="expenseRows"></tbody></table></div>`;
  loadExpenses();
}
async function saveExpense(){
  const category = $('eCategory').value.trim(); const amount = Number($('eAmount').value||0);
  if(!category || !amount) return toast('Category/Amount দিন', 'err');
  try {
    await sb.from('expenses').insert({ category, amount, note: $('eNote').value.trim(), created_by: profile?.id });
    await sb.from('cashbook').insert({ entry_date: todayStr(), description:'Expense: '+category, money_in:0, money_out: amount, ref_type:'expense' });
    toast('Expense added', 'ok'); loadExpenses();
  } catch(e){ toast('Failed: '+e.message, 'err'); }
}
async function loadExpenses(){
  const { data } = await sb.from('expenses').select('*').order('created_at',{ascending:false}).limit(30);
  $('expenseRows').innerHTML = (data||[]).map(e=>`<tr><td>${new Date(e.created_at).toLocaleDateString()}</td><td>${e.category}</td><td>${e.note||''}</td><td class="right">${tk(e.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No expenses</td></tr>';
}

/* ==================================================================
   CUSTOMERS / SUPPLIERS
================================================================== */
async function renderCustomers(){
  const host = $('v-customers');
  host.innerHTML = `<div class="card"><div class="form-grid"><div class="field"><label>Name</label><input id="cName"></div><div class="field"><label>Phone</label><input id="cPhone"></div><div class="field"><label>Opening Due</label><input id="cOpeningDue" type="number" value="0"></div></div><button class="btn primary" onclick="saveCustomer()">Add Customer</button></div>
  <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Name</th><th>Phone</th><th class="right">Opening Due</th></tr></thead><tbody id="customerRows"></tbody></table></div>`;
  loadCustomerTable();
}
async function saveCustomer(){
  const name = $('cName').value.trim(); if(!name) return toast('Name দিন','err');
  try { await sb.from('customers').insert({ name, phone: $('cPhone').value.trim(), opening_due: Number($('cOpeningDue').value||0) }); toast('Customer added','ok'); loadCustomerTable(); } catch(e){ toast('Failed: '+e.message,'err'); }
}
async function loadCustomerTable(){
  const list = await fetchCustomers();
  $('customerRows').innerHTML = list.map(c=>`<tr><td>${c.name}</td><td>${c.phone||''}</td><td class="right">${tk(c.opening_due)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No customers</td></tr>';
}
async function renderSuppliers(){
  const host = $('v-suppliers');
  host.innerHTML = `<div class="card"><div class="form-grid"><div class="field"><label>Name</label><input id="sName"></div><div class="field"><label>Phone</label><input id="sPhone"></div><div class="field"><label>Opening Due</label><input id="sOpeningDue" type="number" value="0"></div></div><button class="btn primary" onclick="saveSupplier()">Add Supplier</button></div>
  <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Name</th><th>Phone</th><th class="right">Opening Due</th></tr></thead><tbody id="supplierRows"></tbody></table></div>`;
  loadSupplierTable();
}
async function saveSupplier(){
  const name = $('sName').value.trim(); if(!name) return toast('Name দিন','err');
  try { await sb.from('suppliers').insert({ name, phone: $('sPhone').value.trim(), opening_due: Number($('sOpeningDue').value||0) }); toast('Supplier added','ok'); loadSupplierTable(); } catch(e){ toast('Failed: '+e.message,'err'); }
}
async function loadSupplierTable(){
  const list = await fetchSuppliers();
  $('supplierRows').innerHTML = list.map(s=>`<tr><td>${s.name}</td><td>${s.phone||''}</td><td class="right">${tk(s.opening_due)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No suppliers</td></tr>';
}

/* ==================================================================
   PARTNERS
================================================================== */
async function renderPartners(){
  const host = $('v-partners');
  host.innerHTML = `<div class="card"><div class="form-grid"><div class="field"><label>Name</label><input id="ptName"></div><div class="field"><label>Share %</label><input id="ptShare" type="number"></div><div class="field"><label>Opening Capital</label><input id="ptCapital" type="number" value="0"></div></div><button class="btn primary" onclick="savePartner()">Add Partner</button></div>
  <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Name</th><th class="right">Share %</th><th class="right">Capital</th><th></th></tr></thead><tbody id="partnerRows"></tbody></table></div>`;
  loadPartnerTable();
}
async function savePartner(){
  const name = $('ptName').value.trim(); if(!name) return toast('Name দিন','err');
  try { await sb.from('partners').insert({ name, share_percent:Number($('ptShare').value||0), capital_balance:Number($('ptCapital').value||0) }); toast('Partner added','ok'); loadPartnerTable(); } catch(e){ toast('Failed: '+e.message,'err'); }
}
async function loadPartnerTable(){
  const { data } = await sb.from('partners').select('*').order('created_at');
  $('partnerRows').innerHTML = (data||[]).map(p=>`<tr><td>${p.name}</td><td class="right">${p.share_percent}%</td><td class="right">${tk(p.capital_balance)}</td><td><button class="btn small" onclick="partnerTx('${p.id}')">+ Tx</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No partners</td></tr>';
}
async function partnerTx(partnerId){
  const type = prompt('Type: capital_in / withdraw / profit_share / loan_in / loan_repay'); if(!type) return;
  const amount = Number(prompt('Amount:')); if(!amount) return;
  try {
    await sb.from('partner_tx').insert({ partner_id: partnerId, tx_type: type, amount });
    const delta = (type==='withdraw'||type==='loan_repay') ? -amount : amount;
    const { data: p } = await sb.from('partners').select('capital_balance').eq('id', partnerId).maybeSingle();
    await sb.from('partners').update({ capital_balance: Number(p.capital_balance)+delta }).eq('id', partnerId);
    toast('Transaction saved', 'ok'); loadPartnerTable();
  } catch(e){ toast('Failed: '+e.message, 'err'); }
}

/* ==================================================================
   REPORTS
================================================================== */
async function renderReports(){
  const host = $('v-reports');
  host.innerHTML = `<div class="filters">
    <input id="repStart" type="date" value="${todayStr().slice(0,8)}01">
    <input id="repEnd" type="date" value="${todayStr()}">
    <button class="btn primary" onclick="runReport()">Run Report</button>
    <button class="btn" onclick="exportCsv()">Export CSV</button>
  </div>
  <div class="grid cols-3" id="repMetrics"></div>
  <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Invoice</th><th>Date</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Due</th></tr></thead><tbody id="repRows"></tbody></table></div>`;
  runReport();
}
let lastReportRows = [];
async function runReport(){
  const start = $('repStart').value; const end = $('repEnd').value;
  const { data } = await sb.from('sales').select('*').gte('created_at', start).lte('created_at', end+'T23:59:59').neq('status','canceled').order('created_at');
  lastReportRows = data || [];
  const total = lastReportRows.reduce((a,s)=>a+Number(s.total_amount||0),0);
  const paid = lastReportRows.reduce((a,s)=>a+Number(s.paid_amount||0),0);
  const due = lastReportRows.reduce((a,s)=>a+Number(s.due_amount||0),0);
  $('repMetrics').innerHTML = `<div class="card metric"><div class="k">Total Sales</div><div class="v">${tk(total)}</div></div>
    <div class="card metric"><div class="k">Total Paid</div><div class="v">${tk(paid)}</div></div>
    <div class="card metric"><div class="k">Total Due</div><div class="v">${tk(due)}</div></div>`;
  $('repRows').innerHTML = lastReportRows.map(s=>`<tr><td>${s.invoice_number}</td><td>${new Date(s.created_at).toLocaleDateString()}</td><td class="right">${tk(s.total_amount)}</td><td class="right">${tk(s.paid_amount)}</td><td class="right">${tk(s.due_amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No data</td></tr>';
}
function exportCsv(){
  if(!lastReportRows.length) return toast('No data to export','err');
  const header = 'Invoice,Date,Total,Paid,Due\n';
  const rows = lastReportRows.map(s=>[s.invoice_number, s.created_at, s.total_amount, s.paid_amount, s.due_amount].join(',')).join('\n');
  const blob = new Blob([header+rows], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sales_report.csv'; a.click();
}

/* ==================================================================
   STOCK MOVEMENT
================================================================== */
async function renderStockMove(){
  const host = $('v-stockmove');
  await fetchProducts();
  host.innerHTML = `<div class="filters"><select id="smProduct">${productsCache.map(p=>`<option value="${p.id}">${p.name} (${p.sku})</option>`).join('')}</select><button class="btn primary" onclick="loadStockMove()">Load</button></div>
  <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Detail</th><th class="right">Pcs Change</th></tr></thead><tbody id="smRows"></tbody></table></div>`;
  if(productsCache.length) loadStockMove();
}
async function loadStockMove(){
  const pid = $('smProduct').value;
  const [{data: pi}, {data: si}, {data: ri}, {data: adj}] = await Promise.all([
    sb.from('purchase_items').select('created_at:purchases(created_at), stock_in_pcs, purchase_unit').eq('product_id', pid),
    sb.from('sale_items').select('sales(created_at, invoice_number), qty_pcs').eq('product_id', pid),
    sb.from('return_items').select('returns(created_at), qty_pcs').eq('product_id', pid),
    sb.from('stock_adjustments').select('*').eq('product_id', pid)
  ]);
  let rows = [];
  (pi||[]).forEach(x=> rows.push({ date: x.created_at?.created_at, type:'Purchase In', detail: x.purchase_unit, change: x.stock_in_pcs }));
  (si||[]).forEach(x=> rows.push({ date: x.sales?.created_at, type:'Sale Out', detail: x.sales?.invoice_number, change: -x.qty_pcs }));
  (ri||[]).forEach(x=> rows.push({ date: x.returns?.created_at, type:'Return In', detail:'Return', change: x.qty_pcs }));
  (adj||[]).forEach(x=> rows.push({ date: x.created_at, type:'Adjustment', detail: x.reason, change: x.change_pcs }));
  rows.sort((a,b)=> new Date(b.date||0) - new Date(a.date||0));
  $('smRows').innerHTML = rows.map(r=>`<tr><td>${r.date?new Date(r.date).toLocaleString():'-'}</td><td>${r.type}</td><td>${r.detail||''}</td><td class="right" style="color:${r.change<0?'var(--bad)':'var(--ok)'}">${r.change>0?'+':''}${r.change}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No movement</td></tr>';
}

/* ==================================================================
   DAILY CLOSING
================================================================== */
async function renderClosing(){
  const host = $('v-closing');
  const today = todayStr();
  const { data: cb } = await sb.from('cashbook').select('money_in, money_out').eq('entry_date', today);
  const expected = (cb||[]).reduce((a,c)=> a + Number(c.money_in||0) - Number(c.money_out||0), 0);
  host.innerHTML = `<div class="card">
    <h3>Today's Closing (${today})</h3>
    <p>Expected Cash (Cashbook থেকে): <b>${tk(expected)}</b></p>
    <div class="field"><label>Opening Cash</label><input id="clOpening" type="number" value="0"></div>
    <div class="field"><label>Actual Cash Counted</label><input id="clActual" type="number" value="0"></div>
    <div class="field"><label>Note</label><input id="clNote"></div>
    <button class="btn primary block" onclick="saveClosing(${expected})">Save Closing</button>
  </div>
  <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Date</th><th class="right">Expected</th><th class="right">Actual</th><th class="right">Diff</th></tr></thead><tbody id="closingRows"></tbody></table></div>`;
  loadClosingHistory();
}
async function saveClosing(expected){
  const opening = Number($('clOpening').value||0);
  const actual = Number($('clActual').value||0);
  const diff = actual - (expected + opening);
  try {
    await sb.from('daily_closing').upsert({ closing_date: todayStr(), opening_cash: opening, expected_cash: expected+opening, actual_cash: actual, difference: diff, note: $('clNote').value, closed_by: profile?.id }, { onConflict:'closing_date' });
    toast('Closing saved', 'ok'); loadClosingHistory();
  } catch(e){ toast('Failed: '+e.message, 'err'); }
}
async function loadClosingHistory(){
  const { data } = await sb.from('daily_closing').select('*').order('closing_date',{ascending:false}).limit(15);
  $('closingRows').innerHTML = (data||[]).map(c=>`<tr><td>${c.closing_date}</td><td class="right">${tk(c.expected_cash)}</td><td class="right">${tk(c.actual_cash)}</td><td class="right" style="color:${c.difference<0?'var(--bad)':'var(--ok)'}">${tk(c.difference)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No records</td></tr>';
}

/* ==================================================================
   ALERTS
================================================================== */
async function renderAlerts(){
  const host = $('v-alerts');
  await fetchProducts();
  const low = productsCache.filter(p => Number(p.inventory?.quantity_pcs||0) <= Number(p.low_stock_threshold_pcs||24));
  host.innerHTML = `<div class="card"><h3>Low Stock (${low.length})</h3><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Name</th><th class="right">Stock</th><th class="right">Threshold</th></tr></thead><tbody>${low.map(p=>`<tr><td>${p.sku}</td><td>${p.name}</td><td class="right">${fmtDozenPcs(p.inventory?.quantity_pcs)}</td><td class="right">${p.low_stock_threshold_pcs} pcs</td></tr>`).join('') || '<tr><td colspan="4" class="muted">সব ঠিক আছে</td></tr>'}</tbody></table></div></div>`;
}

/* ==================================================================
   AUDIT LOG
================================================================== */
async function renderAudit(){
  const host = $('v-audit');
  host.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Module</th><th>Details</th></tr></thead><tbody id="auditRows"></tbody></table></div>`;
  const { data } = await sb.from('audit_log').select('*').order('created_at',{ascending:false}).limit(50);
  $('auditRows').innerHTML = (data||[]).map(a=>`<tr><td>${new Date(a.created_at).toLocaleString()}</td><td>${a.actor_email||''}</td><td>${a.action}</td><td>${a.module}</td><td><code style="font-size:11px">${JSON.stringify(a.details||{})}</code></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No logs</td></tr>';
}

/* ==================================================================
   TRASH
================================================================== */
async function renderTrash(){
  const host = $('v-trash');
  host.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Deleted At</th><th>Table</th><th>Details</th><th></th></tr></thead><tbody id="trashRows"></tbody></table></div>`;
  loadTrash();
}
async function loadTrash(){
  const { data } = await sb.from('trash').select('*').order('deleted_at',{ascending:false}).limit(50);
  $('trashRows').innerHTML = (data||[]).map(t=>`<tr><td>${new Date(t.deleted_at).toLocaleString()}</td><td>${t.table_name}</td><td>${t.details||''}</td><td><button class="btn small" onclick='restoreTrash(${JSON.stringify(t.id)}, ${JSON.stringify(t.table_name)}, ${JSON.stringify(t.record_json)})'>Restore</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Trash খালি</td></tr>';
}
async function restoreTrash(trashId, tableName, record){
  try {
    if(tableName === 'products'){ await sb.from('products').update({ is_active:true }).eq('id', record.id); }
    else { await sb.from(tableName).insert(record); }
    await sb.from('trash').delete().eq('id', trashId);
    toast('Restored', 'ok'); loadTrash();
  } catch(e){ toast('Restore failed: '+e.message, 'err'); }
}

/* ==================================================================
   BACKUPS
================================================================== */
async function renderBackups(){
  const host = $('v-backups');
  host.innerHTML = `<div class="card"><h3>Cloud Backup</h3><p class="muted">সব table-এর snapshot Supabase-এ save হবে।</p>
    <button class="btn gold" onclick="createBackup()">Create Backup Now</button>
    <button class="btn" onclick="downloadBackupJson()">Download JSON</button>
  </div>
  <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Created</th><th>Version</th><th class="right">Size</th></tr></thead><tbody id="backupRows"></tbody></table></div>`;
  loadBackups();
}
async function exportAllData(){
  const tables = ['products','inventory','categories','customers','suppliers','sales','sale_items','purchases','purchase_items','expenses','cashbook','partners','partner_tx','returns','return_items','daily_closing','stock_adjustments'];
  const out = {};
  for(const t of tables){ const { data } = await sb.from(t).select('*'); out[t] = data || []; }
  out.meta = { exportedAt: new Date().toISOString(), version:'1.0-supabase' };
  return out;
}
async function createBackup(){
  try {
    const data = await exportAllData();
    const json = JSON.stringify(data);
    await sb.from('backup_snapshots').insert({ version:'1.0-supabase', data_json: data, created_by_email: session?.user?.email, size: json.length });
    toast('Backup created', 'ok'); loadBackups();
  } catch(e){ toast('Backup failed: '+e.message, 'err'); }
}
async function downloadBackupJson(){
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'churir_angina_backup.json'; a.click();
}
async function loadBackups(){
  const { data } = await sb.from('backup_snapshots').select('id, created_at, version, size').order('created_at',{ascending:false}).limit(20);
  $('backupRows').innerHTML = (data||[]).map(b=>`<tr><td>${new Date(b.created_at).toLocaleString()}</td><td>${b.version}</td><td class="right">${Math.round(b.size/1024)} KB</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No backups</td></tr>';
}

/* ==================================================================
   SETTINGS
================================================================== */
function renderSettings(){
  const host = $('v-settings');
  host.innerHTML = `<div class="card"><h3>Supabase Connection</h3>
    <div class="field"><label>Project URL</label><input id="stUrl" value="${cfg.url}"></div>
    <div class="field"><label>Anon Public Key</label><input id="stAnon" value="${cfg.anonKey}" type="password"></div>
    <button class="btn primary" onclick="updateConnection()">Update</button>
    <div class="note-box">Service_role key কখনো এখানে দেবেন না।</div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Shop Info</h3>
    <div class="field"><label>Logo URL</label><input id="stLogo" placeholder="https://..."></div>
    <button class="btn" onclick="applyLogo()">Apply Logo</button>
  </div>`;
}
function updateConnection(){
  cfg.url = $('stUrl').value.trim(); cfg.anonKey = $('stAnon').value.trim(); saveCfg();
  toast('Connection updated. Page reload করুন।', 'ok');
}
function applyLogo(){ $('brandLogo').src = $('stLogo').value.trim(); }

/* ---------------- Init ---------------- */
restoreSession();
