/* =========================================================
 * automation.js -- WhatsApp receipt + auto membership + loyalty
 * ========================================================= */
(function () {
  'use strict';

  window.shopSettings = null;
  window.lastSaleInfo = null;
  window.pendingRedeemPoints = 0;
  window.currentMember = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }

  async function loadShopSettings() {
    if (!window.sb) return null;
    try {
      var r = await window.sb.from('shop_settings').select('*').eq('id', 1).maybeSingle();
      window.shopSettings = r.data || null;
    } catch (e) { console.warn('[automation] settings load fail', e); }
    return window.shopSettings;
  }

  function normalizePhone(raw) {
    var d = String(raw || '').replace(/[^0-9]/g, '');
    if (d.length === 13 && d.slice(0, 3) === '880') return '0' + d.slice(3);
    if (d.length === 10 && d[0] === '1') return '0' + d;
    return d;
  }

  function toWhatsAppNumber(raw) {
    var cc = (window.shopSettings && window.shopSettings.whatsapp_country_code) || '880';
    var d = String(raw || '').replace(/[^0-9]/g, '');
    if (d.slice(0, cc.length) === cc && d.length > 10) return d;
    if (d[0] === '0') return cc + d.slice(1);
    if (d.length === 10 && d[0] === '1') return cc + d;
    return d;
  }

  async function sendWhatsApp(phone, message, meta) {
    var waNumber = toWhatsAppNumber(phone);
    if (!waNumber || waNumber.length < 10) {
      if (typeof toast === 'function') toast('WhatsApp number thik nei', 'err');
      return false;
    }
    var url = 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(message);
    window.open(url, '_blank');

    try {
      if (window.sb) {
        await window.sb.from('message_log').insert({
          channel: 'whatsapp',
          purpose: (meta && meta.purpose) || 'receipt',
          to_phone: waNumber,
          customer_id: (meta && meta.customerId) || null,
          sale_id: (meta && meta.saleId) || null,
          body: message,
          status: 'opened',
          created_by: (window.myProfile && window.myProfile.id) || null
        });
      }
    } catch (e) { console.warn('[automation] log fail', e); }
    return true;
  }

  function buildReceiptText(info) {
    var s = window.shopSettings || {};
    var L = [];
    L.push('*' + (s.shop_name || 'Churir Angina') + '*');
    if (s.shop_phone) L.push('Ph: ' + s.shop_phone);
    L.push('------------------------------');
    L.push('Invoice: ' + (info.invoice || '-'));
    L.push('Date: ' + new Date(info.date || Date.now()).toLocaleString('en-GB'));
    if (info.customerName) L.push('Customer: ' + info.customerName);
    L.push('------------------------------');

    (info.items || []).forEach(function (it) {
      L.push(it.name);
      L.push('   ' + it.qty + ' x ' + Number(it.price).toFixed(2) + ' = ' + Number(it.qty * it.price).toFixed(2));
    });

    L.push('------------------------------');
    L.push('Subtotal : ' + Number(info.subtotal || 0).toFixed(2));
    if (Number(info.discount) > 0) L.push('Discount : -' + Number(info.discount).toFixed(2));
    L.push('*TOTAL   : ' + Number(info.total || 0).toFixed(2) + ' Tk*');
    L.push('Paid     : ' + Number(info.paid || 0).toFixed(2));
    if (Number(info.due) > 0) L.push('DUE      : ' + Number(info.due).toFixed(2));
    if (Number(info.change) > 0) L.push('Ferot    : ' + Number(info.change).toFixed(2));

    if (info.pointsEarned > 0 || info.pointsBalance != null) {
      L.push('------------------------------');
      if (info.pointsEarned > 0) L.push('Ei kena-katay point: +' + info.pointsEarned);
      if (info.pointsBalance != null) L.push('Mot point: ' + info.pointsBalance);
    }

    L.push('------------------------------');
    L.push(s.receipt_footer || 'Dhonnobad! Abar ashben.');
    return L.join('\n');
  }

  /* ---------- POS automation UI ---------- */
  function injectPosAutomationUI() {
    if (el('autoPhoneBox')) return;
    var anchor = el('posCustomer');
    if (!anchor || !anchor.parentNode) return;

    var box = document.createElement('div');
    box.id = 'autoPhoneBox';
    box.style.cssText = 'margin-top:10px;padding:11px;background:#fdeef5;border-radius:13px;border:1px solid var(--line)';
    box.innerHTML = [
      '<div style="font-size:11.5px;font-weight:700;color:var(--pink);margin-bottom:7px;">CUSTOMER PHONE (auto membership)</div>',
      '<input id="autoPhone" placeholder="01XXXXXXXXX" inputmode="numeric" ',
      'style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:11px;outline:none;" ',
      'oninput="lookupMemberDebounced()">',
      '<input id="autoName" placeholder="Naam (optional)" ',
      'style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:11px;outline:none;margin-top:6px;">',
      '<div id="memberInfo" style="margin-top:7px;font-size:12px;color:var(--muted);"></div>',
      '<div id="redeemBox" style="margin-top:7px;"></div>',
      '<label style="display:flex;align-items:center;gap:7px;margin-top:9px;font-size:12.5px;cursor:pointer;">',
      '<input type="checkbox" id="autoSendWa" checked style="width:17px;height:17px;">',
      '<span>Sell er por WhatsApp e receipt pathao</span></label>'
    ].join('');

    anchor.parentNode.insertBefore(box, anchor.nextSibling);
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
    window.currentMember = null;
    window.pendingRedeemPoints = 0;
    if (redeem) redeem.innerHTML = '';

    if (phone.length < 10) { info.innerHTML = ''; return; }

    info.innerHTML = 'Khuja hocche...';
    try {
      var r = await window.sb.from('customers').select('*').eq('phone', phone).maybeSingle();
      if (!r.data) {
        info.innerHTML = '<span style="color:var(--ok);font-weight:600;">Notun customer -- sell korle automatic member hoye jabe</span>';
        return;
      }
      var c = r.data;
      window.currentMember = c;
      var nameEl = el('autoName');
      if (nameEl && !nameEl.value && c.name && c.name !== c.phone) nameEl.value = c.name;

      info.innerHTML =
        '<b style="color:var(--pink);">' + esc(c.name || phone) + '</b> ' +
        '<span class="tag tag-ok">' + esc((c.tier || 'silver').toUpperCase()) + '</span><br>' +
        'Point: <b>' + Number(c.loyalty_points || 0) + '</b> | Mot kena: ' +
        (typeof money === 'function' ? money(c.total_spent) : c.total_spent);

      var s = window.shopSettings || {};
      var minPts = Number(s.min_points_to_redeem || 50);
      var pts = Number(c.loyalty_points || 0);
      if (s.loyalty_enabled !== false && pts >= minPts && redeem) {
        var taka = pts * Number(s.point_value_taka || 1);
        redeem.innerHTML =
          '<button type="button" class="btn btn-ghost btn-sm" onclick="applyPointsDiscount(' + pts + ')">' +
          'Point bhangan: ' + pts + ' pt = ' + taka.toFixed(0) + ' Tk discount</button>';
      }
    } catch (e) {
      info.innerHTML = '<span style="color:var(--bad);">Lookup fail</span>';
    }
  }

  window.applyPointsDiscount = function (points) {
    var s = window.shopSettings || {};
    var taka = Number(points) * Number(s.point_value_taka || 1);
    var d = el('discountInput');
    if (!d) return;
    d.value = (Number(d.value || 0) + taka).toFixed(2);
    window.pendingRedeemPoints = Number(points);
    if (typeof renderCart === 'function') renderCart();
    if (typeof toast === 'function') toast(points + ' point = ' + taka.toFixed(0) + ' Tk discount', 'ok');
    var rb = el('redeemBox');
    if (rb) rb.innerHTML = '<span style="font-size:12px;color:var(--ok);font-weight:600;">Point apply kora hoyeche</span>';
  };

  window.__loadShopSettings = loadShopSettings;
  window.__normalizePhone = normalizePhone;
  window.__toWhatsAppNumber = toWhatsAppNumber;
  window.__sendWhatsApp = sendWhatsApp;
  window.__buildReceiptText = buildReceiptText;
  window.__injectPosAutomationUI = injectPosAutomationUI;
  window.__lookupMember = lookupMember;
})();

/* ---------- automation part 2: checkout wrap ---------- */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function esc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }

  window.automatedCheckout = async function () {
    if (!window.cart || !window.cart.length) { if (typeof toast === 'function') toast('Cart faka', 'err'); return; }

    var phoneEl = el('autoPhone');
    var nameEl = el('autoName');
    var phone = phoneEl ? String(phoneEl.value || '').replace(/[^0-9]/g, '') : '';
    var custName = nameEl ? String(nameEl.value || '').trim() : '';
    var customerId = null;

    var s = window.shopSettings || {};
    if (phone.length >= 10 && s.auto_membership_enabled !== false) {
      try {
        var m = await window.sb.rpc('upsert_member', { p_phone: phone, p_name: custName || null });
        if (m.error) throw m.error;
        if (m.data) {
          customerId = m.data.id;
          window.currentMember = m.data;
        }
      } catch (e) {
        console.warn('[automation] member fail', e);
        if (typeof toast === 'function') toast('Member toiri fail: ' + (e.message || e), 'err');
      }
    }

    if (!customerId) {
      var sel = el('posCustomer');
      if (sel && sel.value) customerId = sel.value;
    }

    if (window.pendingRedeemPoints > 0 && customerId) {
      try {
        await window.sb.rpc('redeem_points', { p_customer_id: customerId, p_points: window.pendingRedeemPoints });
      } catch (e) {
        console.warn('[automation] redeem fail', e);
      }
    }

    var subtotal = typeof cartSubtotal === 'function' ? cartSubtotal() : 0;
    var discount = Number((el('discountInput') || {}).value || 0);
    var paid = Number((el('paidInput') || {}).value || 0);
    var method = (el('posMethod') || {}).value || 'cash';
    var total = Math.max(0, subtotal - discount);

    var items = window.cart.map(function (l) {
      return { product_id: l.product_id, qty_pcs: l.qty_pcs, unit_price: l.unit_price };
    });

    var snapshot = window.cart.map(function (l) {
      return { name: l.name, qty: l.qty_pcs, price: l.unit_price };
    });

    var btn = el('checkoutBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Save hocche...'; }

    try {
      var r = await window.sb.rpc('complete_sale', {
        p_customer_id: customerId,
        p_items: items,
        p_discount: discount,
        p_paid: paid,
        p_method: method
      });
      if (r.error) throw r.error;

      var saleId = r.data && (r.data.sale_id || r.data.id || r.data);
      var invoice = (r.data && r.data.invoice_no) || String(saleId || '').slice(0, 8);

      var pointsEarned = 0;
      var pointsBalance = null;
      if (customerId) {
        try {
          var lp = await window.sb.rpc('apply_loyalty', {
            p_customer_id: customerId,
            p_sale_id: (typeof saleId === 'string' ? saleId : null),
            p_amount: total
          });
          pointsEarned = Number(lp.data || 0);
          var cc = await window.sb.from('customers').select('loyalty_points,name,phone,tier,visit_count').eq('id', customerId).maybeSingle();
          if (cc.data) {
            pointsBalance = Number(cc.data.loyalty_points || 0);
            window.currentMember = Object.assign({}, window.currentMember || {}, cc.data, { id: customerId });
          }
        } catch (e) { console.warn('[automation] loyalty fail', e); }
      }

      window.lastSaleInfo = {
        invoice: invoice,
        saleId: saleId,
        date: new Date().toISOString(),
        customerId: customerId,
        customerName: (window.currentMember && window.currentMember.name) || custName || null,
        phone: phone,
        items: snapshot,
        subtotal: subtotal,
        discount: discount,
        total: total,
        paid: paid,
        due: Math.max(0, total - paid),
        change: Math.max(0, paid - total),
        pointsEarned: pointsEarned,
        pointsBalance: pointsBalance,
        isNewMember: !!(window.currentMember && window.currentMember.visit_count <= 1)
      };

      if (typeof clearCart === 'function') clearCart();
      if (phoneEl) phoneEl.value = '';
      if (nameEl) nameEl.value = '';
      if (el('memberInfo')) el('memberInfo').innerHTML = '';
      if (el('redeemBox')) el('redeemBox').innerHTML = '';
      window.pendingRedeemPoints = 0;

      await preloadMasterData();
      if (typeof renderPOSGrid === 'function') renderPOSGrid();

      if (typeof toast === 'function') toast('Sell hoyeche! Invoice ' + invoice, 'ok');
      showAfterSaleActions();

      var wantWa = el('autoSendWa') ? el('autoSendWa').checked : false;
      if (wantWa && phone.length >= 10 && (window.shopSettings || {}).whatsapp_enabled !== false) {
        await sendWhatsAppReceipt();
      }
    } catch (e) {
      if (typeof toast === 'function') toast('Sell fail: ' + (e.message || e), 'err');
      console.error(e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Checkout'; }
    }
  };

  async function sendWhatsAppReceipt() {
    var info = window.lastSaleInfo;
    if (!info || !info.phone) return;
    var text = window.__buildReceiptText(info);
    if (info.isNewMember) {
      text += '\n\n*Apni ekhon amader member!* Protiti kena-katay point jomben.';
    }
    await window.__sendWhatsApp(info.phone, text, { purpose: 'receipt', customerId: info.customerId, saleId: (typeof info.saleId === 'string' ? info.saleId : null) });
  }
  window.__sendWhatsAppReceipt = sendWhatsAppReceipt;

  window.resendLastReceipt = function () {
    if (!window.lastSaleInfo) { if (typeof toast === 'function') toast('Kono recent sell nei', 'err'); return; }
    sendWhatsAppReceipt();
  };

  function showAfterSaleActions() {
    var info = window.lastSaleInfo;
    if (!info) return;
    var host = el('cartTotals');
    if (!host) return;
    var old = el('afterSaleBox');
    if (old) old.remove();

    var box = document.createElement('div');
    box.id = 'afterSaleBox';
    box.style.cssText = 'margin-top:11px;padding:12px;background:#e5f7ee;border:1.5px solid #bfe9d3;border-radius:14px';
    var h = '<div style="font-weight:700;color:var(--ok);font-size:13px;margin-bottom:8px;">Sell complete -- ' + esc(info.invoice) + '</div>';
    if (info.change > 0) h += '<div style="font-size:15px;font-weight:700;margin-bottom:8px;">Ferot din: ' + info.change.toFixed(2) + ' Tk</div>';
    if (info.pointsEarned > 0) h += '<div style="font-size:12px;margin-bottom:8px;">Point jomeche: +' + info.pointsEarned + ' (mot ' + info.pointsBalance + ')</div>';
    h += '<div style="display:flex;gap:7px;flex-wrap:wrap;">';
    if (info.phone) h += '<button class="btn btn-ghost btn-sm" onclick="resendLastReceipt()">WhatsApp e receipt</button>';
    h += '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'afterSaleBox\').remove()">Bondho</button>';
    h += '</div>';
    box.innerHTML = h;
    host.appendChild(box);
  }
  window.showAfterSaleActions = showAfterSaleActions;
})();

/* ---------- automation part 3: views, settings, install ---------- */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function esc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }

  window.sendLowStockToOwner = async function () {
    var s = window.shopSettings || {};
    if (!s.owner_whatsapp) { if (typeof toast === 'function') toast('Age Owner WhatsApp number save korun', 'err'); return; }
    var list = (window.productsCache || []).filter(function (p) {
      return Number(p.stock_pcs || 0) <= Number(p.low_stock_threshold_pcs || 12);
    });
    var L = ['*Stock Alert -- ' + (s.shop_name || 'Churir Angina') + '*', new Date().toLocaleDateString('en-GB'), '------------------------------'];
    if (!list.length) L.push('Sob product er stock thik ache.');
    list.slice(0, 40).forEach(function (p) {
      L.push('- ' + p.name + ' : ' + Number(p.stock_pcs || 0) + ' pcs');
    });
    await window.__sendWhatsApp(s.owner_whatsapp, L.join('\n'), { purpose: 'low_stock' });
  };

  window.sendDailyReportToOwner = async function () {
    var s = window.shopSettings || {};
    if (!s.owner_whatsapp) { if (typeof toast === 'function') toast('Age Owner WhatsApp number save korun', 'err'); return; }
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var iso = d.toISOString();
    try {
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

      var L = [
        '*Ajker Report -- ' + (s.shop_name || 'Churir Angina') + '*',
        new Date().toLocaleDateString('en-GB'),
        '------------------------------',
        'Mot bikroy : ' + rev.toFixed(2) + ' Tk',
        'Sell shongkha : ' + sales.length,
        'Cash joma : ' + cash.toFixed(2) + ' Tk',
        'Baki : ' + due.toFixed(2) + ' Tk',
        'Khoroch : ' + ex.toFixed(2) + ' Tk',
        '------------------------------',
        'Hate thaka (cash - khoroch) : ' + (cash - ex).toFixed(2) + ' Tk'
      ];
      await window.__sendWhatsApp(s.owner_whatsapp, L.join('\n'), { purpose: 'daily_report' });
    } catch (e) {
      if (typeof toast === 'function') toast('Report fail: ' + (e.message || e), 'err');
    }
  };

  window.sendDueReminder = async function (customerId, phone, amount, name) {
    var s = window.shopSettings || {};
    var L = [
      'Assalamu Alaikum ' + (name || '') + ',',
      '',
      (s.shop_name || 'Churir Angina') + ' theke apnar bakeya ache: *' + Number(amount).toFixed(2) + ' Tk*',
      '',
      'Shuvidha moto poriShodh korle khushi hobo. Dhonnobad.'
    ];
    if (s.shop_phone) L.push('Ph: ' + s.shop_phone);
    await window.__sendWhatsApp(phone, L.join('\n'), { purpose: 'due_reminder', customerId: customerId });
  };

  /* ---- extra views ---- */
  function ensureViewSection(id) {
    if (el('v-' + id)) return el('v-' + id);
    var main = el('content');
    if (!main) return null;
    var sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'v-' + id;
    main.appendChild(sec);
    return sec;
  }

  window.RENDERERS = window.RENDERERS || {};

  window.RENDERERS.members = async function () {
    var host = ensureViewSection('members');
    if (!host) return;
    host.innerHTML = '<div class="card">Load hocche...</div>';
    try {
      var r = await window.sb.from('customers').select('*').eq('is_member', true).order('total_spent', { ascending: false }).limit(300);
      var rows = r.data || [];
      var h = '<div class="toolbar"><input id="memSearch" placeholder="Naam / phone khujun" oninput="filterTable(\'memTbody\',\'memSearch\')"></div>';
      h += '<div class="card"><div class="table-wrap"><table><thead><tr>';
      h += '<th>Code</th><th>Naam</th><th>Phone</th><th>Tier</th><th>Point</th><th>Mot Kena</th><th>Visit</th><th></th>';
      h += '</tr></thead><tbody id="memTbody">';
      if (!rows.length) h += '<tr><td colspan="8" style="text-align:center;color:var(--muted)">Kono member nei</td></tr>';
      rows.forEach(function (c) {
        h += '<tr><td>' + esc(c.member_code || '-') + '</td><td>' + esc(c.name || '-') + '</td><td>' + esc(c.phone || '-') + '</td>' +
          '<td><span class="tag tag-ok">' + esc((c.tier || 'silver').toUpperCase()) + '</span></td>' +
          '<td><b>' + Number(c.loyalty_points || 0) + '</b></td><td>' + money(c.total_spent) + '</td><td>' + Number(c.visit_count || 0) + '</td>' +
          '<td>' + (c.phone ? '<button class="btn btn-ghost btn-sm" onclick="sendWelcomeMessage(\'' + c.id + '\',\'' + esc(c.phone) + '\',\'' + esc(c.name || '') + '\')">WhatsApp</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
      host.innerHTML = h;
    } catch (e) {
      host.innerHTML = '<div class="card"><p style="color:var(--bad)">' + esc(e.message || e) + '</p></div>';
    }
  };

  window.sendWelcomeMessage = async function (id, phone, name) {
    var s = window.shopSettings || {};
    var L = [
      'Assalamu Alaikum ' + (name || '') + ',',
      '',
      'Apni ' + (s.shop_name || 'Churir Angina') + ' er member!',
      'Protiti kena-katay point jombe, ar point diye discount paben.',
      '',
      s.receipt_footer || 'Dhonnobad!'
    ];
    await window.__sendWhatsApp(phone, L.join('\n'), { purpose: 'welcome', customerId: id });
  };

  window.RENDERERS.automation = async function () {
    var host = ensureViewSection('automation');
    if (!host) return;
    var s = (await window.__loadShopSettings()) || {};
    var h = '';
    h += '<div class="grid grid-2">';
    h += '<div class="card"><h3>Dokan er tottho</h3>';
    h += '<div class="field"><label>Dokaner naam</label><input id="seShopName" value="' + esc(s.shop_name || '') + '"></div>';
    h += '<div class="field"><label>Dokaner phone</label><input id="seShopPhone" value="' + esc(s.shop_phone || '') + '"></div>';
    h += '<div class="field"><label>Owner WhatsApp (report ei number e jabe)</label><input id="seOwnerWa" value="' + esc(s.owner_whatsapp || '') + '" placeholder="01XXXXXXXXX"></div>';
    h += '<div class="field"><label>Receipt footer</label><input id="seFooter" value="' + esc(s.receipt_footer || '') + '"></div>';
    h += '<div class="field"><label>WhatsApp country code</label><input id="seCC" value="' + esc(s.whatsapp_country_code || '880') + '"></div>';
    h += '</div>';

    h += '<div class="card"><h3>Loyalty & Membership</h3>';
    h += '<div class="field"><label>Prati 100 Tk te koto point</label><input id="sePoints" type="number" value="' + Number(s.points_per_100_taka || 1) + '"></div>';
    h += '<div class="field"><label>1 point = koto Tk</label><input id="sePointVal" type="number" value="' + Number(s.point_value_taka || 1) + '"></div>';
    h += '<div class="field"><label>Kompokkhe koto point bhangano jabe</label><input id="seMinRedeem" type="number" value="' + Number(s.min_points_to_redeem || 50) + '"></div>';
    h += '<div class="field"><label>Gold tier (mot kena Tk)</label><input id="seGold" type="number" value="' + Number(s.tier_gold_at || 20000) + '"></div>';
    h += '<div class="field"><label>Platinum tier (mot kena Tk)</label><input id="sePlat" type="number" value="' + Number(s.tier_platinum_at || 50000) + '"></div>';
    h += '<label style="display:flex;gap:8px;align-items:center;margin-bottom:7px;font-size:13px"><input type="checkbox" id="seLoyalty" ' + (s.loyalty_enabled !== false ? 'checked' : '') + '> Loyalty chalu</label>';
    h += '<label style="display:flex;gap:8px;align-items:center;margin-bottom:7px;font-size:13px"><input type="checkbox" id="seAutoMem" ' + (s.auto_membership_enabled !== false ? 'checked' : '') + '> Auto membership chalu</label>';
    h += '<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="seWa" ' + (s.whatsapp_enabled !== false ? 'checked' : '') + '> WhatsApp chalu</label>';
    h += '</div></div>';

    h += '<button class="btn btn-primary" onclick="saveAutomationSettings()">Settings Save Korun</button>';

    h += '<div class="card" style="margin-top:14px"><h3>Ek clicke pathan</h3>';
    h += '<div style="display:flex;gap:9px;flex-wrap:wrap">';
    h += '<button class="btn btn-ghost" onclick="sendDailyReportToOwner()">Ajker report pathao</button>';
    h += '<button class="btn btn-ghost" onclick="sendLowStockToOwner()">Stock kom report pathao</button>';
    h += '<button class="btn btn-ghost" onclick="resendLastReceipt()">Sesh receipt abar pathao</button>';
    h += '</div></div>';

    host.innerHTML = h;
  };

  window.saveAutomationSettings = async function () {
    try {
      var payload = {
        shop_name: (el('seShopName') || {}).value || null,
        shop_phone: (el('seShopPhone') || {}).value || null,
        owner_whatsapp: (el('seOwnerWa') || {}).value || null,
        receipt_footer: (el('seFooter') || {}).value || null,
        whatsapp_country_code: (el('seCC') || {}).value || '880',
        points_per_100_taka: Number((el('sePoints') || {}).value || 1),
        point_value_taka: Number((el('sePointVal') || {}).value || 1),
        min_points_to_redeem: Number((el('seMinRedeem') || {}).value || 50),
        tier_gold_at: Number((el('seGold') || {}).value || 20000),
        tier_platinum_at: Number((el('sePlat') || {}).value || 50000),
        loyalty_enabled: !!(el('seLoyalty') || {}).checked,
        auto_membership_enabled: !!(el('seAutoMem') || {}).checked,
        whatsapp_enabled: !!(el('seWa') || {}).checked,
        updated_at: new Date().toISOString()
      };
      var r = await window.sb.from('shop_settings').update(payload).eq('id', 1);
      if (r.error) throw r.error;
      await window.__loadShopSettings();
      if (typeof toast === 'function') toast('Settings save hoyeche', 'ok');
    } catch (e) {
      if (typeof toast === 'function') toast('Save fail: ' + (e.message || e), 'err');
    }
  };

  function addNavItems() {
    var host = el('navHost');
    if (!host || el('nav-automation-group')) return;
    var role = (window.myProfile && window.myProfile.role) || 'staff';
    var g = document.createElement('div');
    g.className = 'nav-group';
    g.id = 'nav-automation-group';
    var h = '<div class="nav-group-label">AUTOMATION</div>';
    h += '<div class="nav-item" id="nav-members" onclick="navigate(\'members\')">Members</div>';
    if (role === 'owner' || role === 'manager') {
      h += '<div class="nav-item" id="nav-automation" onclick="navigate(\'automation\')">Automation</div>';
    }
    g.innerHTML = h;
    host.appendChild(g);
  }

  function install() {
    if (window.__autoNavWrapped) return;
    window.__autoNavWrapped = true;

    var origCanAccess = window.canAccess;
    window.canAccess = function (id) {
      if (id === 'members') return true;
      if (id === 'automation') {
        var role = (window.myProfile && window.myProfile.role) || 'staff';
        return role === 'owner' || role === 'manager';
      }
      return typeof origCanAccess === 'function' ? origCanAccess(id) : true;
    };

    ensureViewSection('members');
    ensureViewSection('automation');

    var origAfter = window.onAfterLogin;
    window.onAfterLogin = async function (prof) {
      if (typeof origAfter === 'function') { try { await origAfter(prof); } catch (e) {} }
      await window.__loadShopSettings();
      addNavItems();
    };

    setInterval(function () {
      var pos = el('v-pos');
      if (pos && pos.classList.contains('active')) window.__injectPosAutomationUI();
      if (document.getElementById('app') && document.getElementById('app').classList.contains('show')) addNavItems();
    }, 800);

    console.log('[automation.js] POS Automation add-on installed');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
