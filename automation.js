/* =========================================================
 * automation.js (v3.1) -- WhatsApp receipts, auto membership,
 * loyalty points, owner reports. English UI.
 * ========================================================= */
(function () {
  'use strict';

  window.shopSettings = null;
  window.lastSaleInfo = null;
  window.pendingRedeemPoints = 0;
  window.currentMember = null;

  function el(id) { return document.getElementById(id); }

  async function loadShopSettings() {
    try {
      var r = await window.sb.from('shop_settings').select('*').eq('id', 1).maybeSingle();
      window.shopSettings = r.data || {};
    } catch (e) { window.shopSettings = {}; }
    return window.shopSettings;
  }

  function normalizePhone(raw) {
    var d = String(raw || '').replace(/[^0-9]/g, '');
    if (d.length === 13 && d.slice(0, 3) === '880') return '0' + d.slice(3);
    if (d.length === 10 && d[0] === '1') return '0' + d;
    return d;
  }

  function toWhatsAppNumber(raw) {
    var p = normalizePhone(raw);
    var cc = (window.shopSettings && window.shopSettings.whatsapp_country_code) || '880';
    if (p.length === 11 && p[0] === '0') return cc + p.slice(1);
    return p;
  }

  function sendWhatsApp(phone, message, meta) {
    var num = toWhatsAppNumber(phone);
    if (!num || num.length < 10) { window.toast('Phone number is not valid', 'err'); return false; }
    var url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(message);
    window.open(url, '_blank');
    try {
      window.sb.from('message_log').insert({
        channel: 'whatsapp',
        purpose: (meta && meta.purpose) || 'receipt',
        to_phone: num,
        customer_id: (meta && meta.customerId) || null,
        sale_id: (meta && meta.saleId) || null,
        body: message,
        status: 'opened'
      }).then(function () {}, function () {});
    } catch (e) {}
    return true;
  }

  function buildReceiptText(info) {
    var s = window.shopSettings || {};
    var L = [];
    L.push('*' + (s.shop_name || 'Churir Angina') + '*');
    if (s.shop_phone) L.push('Phone: ' + s.shop_phone);
    L.push('------------------------------');
    L.push('Invoice: ' + (info.invoice || '-'));
    L.push('Date: ' + new Date().toLocaleString('en-GB'));
    if (info.customerName) L.push('Customer: ' + info.customerName);
    L.push('------------------------------');
    (info.items || []).forEach(function (it) {
      L.push(it.name + '  x' + it.qty + '  = ' + Number(it.total).toFixed(2));
    });
    L.push('------------------------------');
    L.push('Subtotal: ' + Number(info.subtotal || 0).toFixed(2));
    if (info.discount > 0) L.push('Discount: -' + Number(info.discount).toFixed(2));
    L.push('*Total: ' + Number(info.total || 0).toFixed(2) + '*');
    L.push('Paid: ' + Number(info.paid || 0).toFixed(2));
    if (info.due > 0) L.push('Due: ' + Number(info.due).toFixed(2));
    if (info.change > 0) L.push('Change: ' + Number(info.change).toFixed(2));
    if (info.pointsEarned > 0) {
      L.push('------------------------------');
      L.push('Points earned: ' + info.pointsEarned);
      if (info.pointsBalance != null) L.push('Points balance: ' + info.pointsBalance);
    }
    L.push('------------------------------');
    L.push(s.receipt_footer || 'Thank you! Please visit again.');
    return L.join('\n');
  }

  function injectPosAutomationUI() {
    if (el('autoPhoneBox')) return;
    var sel = el('posCustomer');
    if (!sel || !sel.parentNode) return;

    var box = document.createElement('div');
    box.id = 'autoPhoneBox';
    box.innerHTML = [
      '<div class="field" style="margin-top:4px">',
      '<label>Customer phone (auto membership)</label>',
      '<input id="autoPhone" placeholder="01XXXXXXXXX" oninput="lookupMemberDebounced()">',
      '<div class="hint">Enter a number and the customer is registered automatically</div></div>',
      '<div class="field"><label>Customer name (optional)</label><input id="autoName" placeholder="Name"></div>',
      '<div id="memberInfo"></div>',
      '<div id="redeemBox"></div>',
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:8px 0">',
      '<input type="checkbox" id="autoSendWa" checked> Send WhatsApp receipt after the sale</label>'
    ].join('');

    sel.parentNode.parentNode.insertBefore(box, sel.parentNode.nextSibling);
  }

  var lookupTimer = null;
  window.lookupMemberDebounced = function () {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(lookupMember, 500);
  };

  async function lookupMember() {
    var input = el('autoPhone');
    var info = el('memberInfo');
    var redeem = el('redeemBox');
    if (!input || !info) return;

    var phone = normalizePhone(input.value);
    window.pendingRedeemPoints = 0;
    if (phone.length < 10) { info.innerHTML = ''; if (redeem) redeem.innerHTML = ''; window.currentMember = null; return; }

    try {
      var r = await window.sb.from('customers').select('*').eq('phone', phone).maybeSingle();
      var c = r.data;
      if (!c) {
        window.currentMember = null;
        info.innerHTML = '<div class="tag tag-warn" style="display:block;padding:8px;text-align:center">New customer &mdash; membership will be created automatically</div>';
        if (redeem) redeem.innerHTML = '';
        return;
      }
      window.currentMember = c;
      var nameEl = el('autoName');
      if (nameEl && !nameEl.value) nameEl.value = c.name || '';

      info.innerHTML = '<div class="card" style="padding:10px;margin:0 0 8px">' +
        '<b>' + window.escapeHtml(c.name || phone) + '</b> <span class="tag tag-ok">' + String(c.tier || 'silver').toUpperCase() + '</span>' +
        '<div style="font-size:12px;color:var(--muted);margin-top:4px">Points: <b>' + Number(c.loyalty_points || 0) + '</b> &nbsp;|&nbsp; Spent: ' + window.money(c.total_spent) + '</div></div>';

      var s = window.shopSettings || {};
      var min = Number(s.min_points_to_redeem || 50);
      var pts = Number(c.loyalty_points || 0);
      if (redeem) {
        if (s.loyalty_enabled !== false && pts >= min) {
          redeem.innerHTML = '<button class="btn btn-ghost btn-block btn-sm" style="margin-bottom:8px" onclick="applyPointsDiscount()">Use ' + pts + ' points as discount</button>';
        } else { redeem.innerHTML = ''; }
      }
    } catch (e) { console.warn(e); }
  }

  window.applyPointsDiscount = function () {
    var c = window.currentMember;
    if (!c) return;
    var s = window.shopSettings || {};
    var pts = Number(c.loyalty_points || 0);
    var value = pts * Number(s.point_value_taka || 1);
    var sub = window.cartSubtotal ? window.cartSubtotal() : 0;
    if (value > sub) { value = sub; pts = Math.floor(value / Number(s.point_value_taka || 1)); }
    var d = el('discountInput');
    if (d) { d.value = value.toFixed(2); window.renderCart(); }
    window.pendingRedeemPoints = pts;
    window.toast(pts + ' points applied as ' + window.money(value) + ' discount', 'ok');
  };

  /* ---------- automated checkout ---------- */
  window.automatedCheckout = async function () {
    var cart = window.cart || [];
    if (!cart.length) { window.toast('Cart is empty', 'err'); return; }

    var btn = el('checkoutBtn');
    var discount = Number((el('discountInput') || {}).value || 0);
    var paid = Number((el('paidInput') || {}).value || 0);
    var method = (el('posMethod') || {}).value || 'cash';
    var customerId = (el('posCustomer') || {}).value || null;
    var phone = normalizePhone((el('autoPhone') || {}).value || '');
    var custName = ((el('autoName') || {}).value || '').trim();
    var wantWa = !!(el('autoSendWa') && el('autoSendWa').checked);
    var s = window.shopSettings || {};

    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      /* 1. auto membership from the phone number */
      var memberName = custName;
      if (phone.length >= 10 && s.auto_membership_enabled !== false) {
        var m = await window.sb.rpc('upsert_member', { p_phone: phone, p_name: custName || null });
        if (!m.error && m.data) {
          customerId = m.data.id;
          memberName = m.data.name || custName;
          window.currentMember = m.data;
        }
      }

      /* 2. redeem points if requested */
      if (window.pendingRedeemPoints > 0 && customerId) {
        try { await window.sb.rpc('redeem_points', { p_customer_id: customerId, p_points: window.pendingRedeemPoints }); }
        catch (e) { console.warn('redeem failed', e); }
      }

      /* 3. record the sale */
      var items = cart.map(function (l) {
        return { product_id: l.product_id, qty_pcs: l.qty_pcs, unit_price: l.unit_price };
      });
      var r = await window.sb.rpc('complete_sale', {
        p_customer_id: customerId || null,
        p_items: items,
        p_discount: discount,
        p_paid: paid,
        p_method: method
      });
      if (r.error) throw r.error;

      var saleId = null;
      var invoice = '';
      if (r.data) {
        if (typeof r.data === 'string') saleId = r.data;
        else if (r.data.id) { saleId = r.data.id; invoice = r.data.invoice_no || ''; }
        else if (r.data.sale_id) { saleId = r.data.sale_id; invoice = r.data.invoice_no || ''; }
      }

      var sub = window.cartSubtotal();
      var total = Math.max(0, sub - discount);
      var change = Math.max(0, paid - total);
      var due = Math.max(0, total - paid);

      /* 4. loyalty points */
      var earned = 0;
      if (customerId) {
        try {
          var lr = await window.sb.rpc('apply_loyalty', { p_customer_id: customerId, p_sale_id: saleId, p_amount: total });
          if (!lr.error) earned = Number(lr.data || 0);
        } catch (e) { console.warn('loyalty failed', e); }
      }

      var balance = null;
      if (customerId) {
        try {
          var cr = await window.sb.from('customers').select('loyalty_points').eq('id', customerId).maybeSingle();
          if (cr.data) balance = Number(cr.data.loyalty_points || 0);
        } catch (e) {}
      }

      if (!invoice && saleId) {
        try {
          var sr = await window.sb.from('sales').select('invoice_no').eq('id', saleId).maybeSingle();
          if (sr.data) invoice = sr.data.invoice_no || String(saleId).slice(0, 8);
        } catch (e) {}
      }

      window.lastSaleInfo = {
        saleId: saleId,
        invoice: invoice || String(saleId || '').slice(0, 8),
        customerId: customerId,
        customerName: memberName,
        phone: phone,
        items: cart.map(function (l) { return { name: l.name, qty: l.qty_pcs, total: l.qty_pcs * l.unit_price }; }),
        subtotal: sub, discount: discount, total: total, paid: paid, due: due, change: change,
        pointsEarned: earned, pointsBalance: balance
      };

      window.toast('Sale completed' + (earned ? ' (+' + earned + ' points)' : ''), 'ok');

      /* 5. WhatsApp receipt */
      if (wantWa && phone.length >= 10 && s.whatsapp_enabled !== false) {
        sendWhatsAppReceipt();
      }

      showAfterSaleActions();
      window.clearCart();
      var ap = el('autoPhone'); if (ap) ap.value = '';
      var an = el('autoName'); if (an) an.value = '';
      var mi = el('memberInfo'); if (mi) mi.innerHTML = '';
      var rb = el('redeemBox'); if (rb) rb.innerHTML = '';
      window.pendingRedeemPoints = 0;
      window.currentMember = null;

      await window.preloadMasterData();
      window.renderPOSGrid();
    } catch (e) {
      window.toast('Sale failed: ' + (e.message || e), 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Complete sale';
    }
  };

  function sendWhatsAppReceipt() {
    var info = window.lastSaleInfo;
    if (!info) { window.toast('No recent sale found', 'err'); return; }
    if (!info.phone) { window.toast('No phone number for this sale', 'err'); return; }
    sendWhatsApp(info.phone, buildReceiptText(info), {
      purpose: 'receipt', customerId: info.customerId, saleId: info.saleId
    });
  }
  window.__sendWhatsAppReceipt = sendWhatsAppReceipt;
  window.resendLastReceipt = sendWhatsAppReceipt;

  function showAfterSaleActions() {
    var info = window.lastSaleInfo;
    if (!info) return;
    var host = el('cartTotals');
    if (!host) return;
    var box = el('afterSaleBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'afterSaleBox';
      box.style.marginTop = '10px';
      host.parentNode.insertBefore(box, host.nextSibling);
    }
    box.innerHTML = '<div class="card" style="padding:12px;margin:0">' +
      '<div style="font-size:12px;color:var(--muted)">Last sale</div>' +
      '<b>' + window.escapeHtml(info.invoice) + '</b> &mdash; ' + window.money(info.total) +
      (info.change > 0 ? '<div style="color:var(--ok);font-weight:700;margin-top:4px">Change: ' + window.money(info.change) + '</div>' : '') +
      '<button class="btn btn-ghost btn-block btn-sm" style="margin-top:8px" onclick="resendLastReceipt()">Send receipt on WhatsApp again</button>' +
      '</div>';
  }
  window.showAfterSaleActions = showAfterSaleActions;

  /* ---------- owner alerts & reports ---------- */
  window.sendLowStockToOwner = async function () {
    var s = window.shopSettings || {};
    if (!s.owner_whatsapp) { window.toast('Set the owner WhatsApp number on the Automation page', 'err'); return; }
    var list = (window.productsCache || []).filter(function (p) {
      return Number(p.stock_pcs || 0) <= Number(p.low_stock_threshold_pcs || 12);
    });
    if (!list.length) { window.toast('No products are low on stock', 'ok'); return; }
    var L = ['*Low stock report*', new Date().toLocaleDateString('en-GB'), '------------------------------'];
    list.slice(0, 40).forEach(function (p) { L.push(p.name + ' : ' + Number(p.stock_pcs || 0) + ' pcs'); });
    L.push('------------------------------');
    L.push('Total ' + list.length + ' products need restocking');
    sendWhatsApp(s.owner_whatsapp, L.join('\n'), { purpose: 'low_stock' });
  };

  window.sendDailyReportToOwner = async function () {
    var s = window.shopSettings || {};
    if (!s.owner_whatsapp) { window.toast('Set the owner WhatsApp number on the Automation page', 'err'); return; }
    try {
      var t = new Date(); t.setHours(0, 0, 0, 0);
      var iso = t.toISOString();
      var res = await Promise.all([
        window.sb.from('sales').select('*').gte('created_at', iso),
        window.sb.from('expenses').select('*').gte('created_at', iso)
      ]);
      var sales = (res[0].data || []).filter(function (x) { return x.status !== 'cancelled'; });
      var exps = res[1].data || [];
      var rev = sales.reduce(function (a, x) { return a + Number(x.total || 0); }, 0);
      var cash = sales.reduce(function (a, x) { return a + Number(x.paid || 0); }, 0);
      var due = sales.reduce(function (a, x) { return a + Number(x.due_amount || 0); }, 0);
      var ex = exps.reduce(function (a, x) { return a + Number(x.amount || 0); }, 0);

      var L = ['*Daily sales report*', new Date().toLocaleDateString('en-GB'), '------------------------------'];
      L.push('Transactions: ' + sales.length);
      L.push('Total sales: ' + rev.toFixed(2));
      L.push('Cash received: ' + cash.toFixed(2));
      L.push('Due added: ' + due.toFixed(2));
      L.push('Expenses: ' + ex.toFixed(2));
      L.push('------------------------------');
      L.push('*In hand: ' + (cash - ex).toFixed(2) + '*');
      sendWhatsApp(s.owner_whatsapp, L.join('\n'), { purpose: 'daily_report' });
    } catch (e) { window.toast('Report failed: ' + (e.message || e), 'err'); }
  };

  window.sendDueReminder = function (customerId, phone, amount, name) {
    var s = window.shopSettings || {};
    var L = ['Dear ' + (name || 'customer') + ',', '',
      'This is a friendly reminder from *' + (s.shop_name || 'Churir Angina') + '*.',
      'Outstanding amount: *' + Number(amount || 0).toFixed(2) + '*', '',
      'Please pay at your convenience. Thank you!'];
    if (s.shop_phone) L.push('Contact: ' + s.shop_phone);
    sendWhatsApp(phone, L.join('\n'), { purpose: 'due_reminder', customerId: customerId });
  };

  window.sendWelcomeMessage = function (phone, name) {
    var s = window.shopSettings || {};
    var L = ['Dear ' + (name || 'customer') + ',', '',
      'Welcome to *' + (s.shop_name || 'Churir Angina') + '*!',
      'You are now a member and will earn points on every purchase.', '',
      'Thank you for shopping with us.'];
    sendWhatsApp(phone, L.join('\n'), { purpose: 'welcome' });
  };

  /* ---------- extra views ---------- */
  function ensureViewSection(id) {
    var sec = el('v-' + id);
    if (sec) return sec;
    var main = el('content');
    if (!main) return null;
    sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'v-' + id;
    main.appendChild(sec);
    return sec;
  }

  window.RENDERERS.members = async function () {
    var host = ensureViewSection('members');
    host.innerHTML = '<div class="card">Loading...</div>';
    var r = await window.sb.from('customers').select('*').eq('is_member', true).order('total_spent', { ascending: false }).limit(300);
    var rows = r.data || [];
    var h = window.pageHead('Members', rows.length + ' members',
      '<button class="btn btn-ghost" onclick="sendDailyReportToOwner()">Daily report to owner</button>');
    h += '<div class="toolbar"><input id="memSearch" placeholder="Search name or phone" oninput="filterTable(\'memTbody\',\'memSearch\')"></div>';
    h += '<div class="card pad0"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Tier</th><th class="num">Points</th><th class="num">Spent</th><th class="num">Visits</th><th></th></tr></thead><tbody id="memTbody">';
    if (!rows.length) h += window.emptyRow(7, 'No members yet. Enter a phone number during a sale and membership is created automatically.');
    rows.forEach(function (c) {
      h += '<tr><td><b>' + window.escapeHtml(c.name || '-') + '</b></td><td>' + window.escapeHtml(c.phone || '-') + '</td>';
      h += '<td><span class="tag tag-ok">' + window.escapeHtml(String(c.tier || 'silver').toUpperCase()) + '</span></td>';
      h += '<td class="num">' + Number(c.loyalty_points || 0) + '</td><td class="num">' + window.money(c.total_spent) + '</td>';
      h += '<td class="num">' + Number(c.visit_count || 0) + '</td>';
      h += '<td><button class="btn btn-ghost btn-sm" onclick="sendWelcomeMessage(\'' + window.escapeHtml(c.phone || '') + '\',\'' + window.escapeHtml(c.name || '') + '\')">Message</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    host.innerHTML = h;
  };

  window.RENDERERS.automation = async function () {
    var host = ensureViewSection('automation');
    await loadShopSettings();
    var s = window.shopSettings || {};
    function v(x, d) { return x == null ? (d == null ? '' : d) : x; }

    var h = window.pageHead('Automation', 'WhatsApp, membership and loyalty settings');
    h += '<div class="grid grid-2">';

    h += '<div class="card"><h3>Shop details</h3>';
    h += '<div class="field"><label>Shop name</label><input id="seShopName" value="' + window.escapeHtml(v(s.shop_name, 'Churir Angina')) + '"></div>';
    h += '<div class="field"><label>Shop phone</label><input id="seShopPhone" value="' + window.escapeHtml(v(s.shop_phone)) + '"></div>';
    h += '<div class="field"><label>Owner WhatsApp number</label><input id="seOwnerWa" value="' + window.escapeHtml(v(s.owner_whatsapp)) + '" placeholder="01XXXXXXXXX"><div class="hint">Reports and alerts are sent here</div></div>';
    h += '<div class="field"><label>Receipt footer</label><input id="seFooter" value="' + window.escapeHtml(v(s.receipt_footer, 'Thank you! Please visit again.')) + '"></div>';
    h += '<div class="field"><label>WhatsApp country code</label><input id="seCC" value="' + window.escapeHtml(v(s.whatsapp_country_code, '880')) + '"></div>';
    h += '</div>';

    h += '<div class="card"><h3>Loyalty programme</h3>';
    h += '<div class="field"><label>Points per 100 taka</label><input id="sePoints" type="number" value="' + Number(v(s.points_per_100_taka, 1)) + '"></div>';
    h += '<div class="field"><label>Value of 1 point (taka)</label><input id="sePointVal" type="number" value="' + Number(v(s.point_value_taka, 1)) + '"></div>';
    h += '<div class="field"><label>Minimum points to redeem</label><input id="seMinRedeem" type="number" value="' + Number(v(s.min_points_to_redeem, 50)) + '"></div>';
    h += '<div class="field"><label>Gold tier from (taka spent)</label><input id="seGold" type="number" value="' + Number(v(s.tier_gold_at, 20000)) + '"></div>';
    h += '<div class="field"><label>Platinum tier from (taka spent)</label><input id="sePlat" type="number" value="' + Number(v(s.tier_platinum_at, 50000)) + '"></div>';
    h += '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:6px"><input type="checkbox" id="seLoyalty"' + (s.loyalty_enabled !== false ? ' checked' : '') + '> Loyalty points enabled</label>';
    h += '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:6px"><input type="checkbox" id="seAutoMem"' + (s.auto_membership_enabled !== false ? ' checked' : '') + '> Create membership automatically from phone number</label>';
    h += '<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="seWa"' + (s.whatsapp_enabled !== false ? ' checked' : '') + '> WhatsApp messages enabled</label>';
    h += '</div></div>';

    h += '<div class="card"><h3>Quick actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap">';
    h += '<button class="btn btn-primary" onclick="saveAutomationSettings()">Save settings</button>';
    h += '<button class="btn btn-ghost" onclick="sendDailyReportToOwner()">Send daily report</button>';
    h += '<button class="btn btn-ghost" onclick="sendLowStockToOwner()">Send low stock list</button>';
    h += '</div></div>';

    host.innerHTML = h;
  };

  window.saveAutomationSettings = async function () {
    try {
      var payload = {
        shop_name: (el('seShopName').value || '').trim(),
        shop_phone: (el('seShopPhone').value || '').trim() || null,
        owner_whatsapp: (el('seOwnerWa').value || '').trim() || null,
        receipt_footer: (el('seFooter').value || '').trim(),
        whatsapp_country_code: (el('seCC').value || '880').trim(),
        points_per_100_taka: Number(el('sePoints').value || 1),
        point_value_taka: Number(el('sePointVal').value || 1),
        min_points_to_redeem: Number(el('seMinRedeem').value || 50),
        tier_gold_at: Number(el('seGold').value || 20000),
        tier_platinum_at: Number(el('sePlat').value || 50000),
        loyalty_enabled: el('seLoyalty').checked,
        auto_membership_enabled: el('seAutoMem').checked,
        whatsapp_enabled: el('seWa').checked,
        updated_at: new Date().toISOString()
      };
      var r = await window.sb.from('shop_settings').update(payload).eq('id', 1);
      if (r.error) throw r.error;
      await loadShopSettings();
      window.toast('Settings saved', 'ok');
    } catch (e) { window.toast('Failed: ' + (e.message || e), 'err'); }
  };

  /* ---------- navigation entries ---------- */
  function addNavItems() {
    var host = el('navHost');
    if (!host || el('nav-automation-group')) return;
    var role = (window.myProfile && window.myProfile.role) || 'staff';
    var g = document.createElement('div');
    g.className = 'nav-group';
    g.id = 'nav-automation-group';
    var html = '<div class="nav-group-label">AUTOMATION</div>';
    html += '<div class="nav-item" id="nav-members" onclick="navigate(\'members\')">Members</div>';
    if (role === 'owner' || role === 'manager') {
      html += '<div class="nav-item" id="nav-automation" onclick="navigate(\'automation\')">Automation</div>';
    }
    g.innerHTML = html;
    host.appendChild(g);
  }

  var prevAfterLogin = window.onAfterLogin;
  window.onAfterLogin = async function (prof) {
    if (typeof prevAfterLogin === 'function') { try { await prevAfterLogin(prof); } catch (e) {} }
    await loadShopSettings();
    addNavItems();
  };

  if (!window.__autoNavWrapped) {
    window.__autoNavWrapped = true;
    var origCanAccess = window.canAccess;
    window.canAccess = function (viewId) {
      if (viewId === 'members') return true;
      if (viewId === 'automation') {
        var role = (window.myProfile && window.myProfile.role) || 'staff';
        return role === 'owner' || role === 'manager';
      }
      return typeof origCanAccess === 'function' ? origCanAccess(viewId) : true;
    };
  }

  function install() {
    ensureViewSection('members');
    ensureViewSection('automation');
    if (el('v-pos') && el('v-pos').dataset.built) injectPosAutomationUI();
    if (el('navHost') && el('navHost').children.length && !el('nav-automation-group')) addNavItems();
  }

  setInterval(install, 800);
  console.log('[automation.js] automation add-on installed');

  window.__loadShopSettings = loadShopSettings;
  window.__normalizePhone = normalizePhone;
  window.__toWhatsAppNumber = toWhatsAppNumber;
  window.__sendWhatsApp = sendWhatsApp;
  window.__buildReceiptText = buildReceiptText;
  window.__injectPosAutomationUI = injectPosAutomationUI;
})();
