/* =====================================================
 * CONFIG.JS  --  EKHANE EKBAR KEY BOSAN, AR KOKHONO LAGBE NA
 * =====================================================
 *  ****  SHUDHU EI 2 TA LINE POROBORTON KORUN  ****
 *  Supabase Dashboard > Settings > API
 *    - "Project URL"     -> SUPABASE_URL
 *    - "anon public" key -> SUPABASE_ANON_KEY
 *  Ekbar bosiye save korle Connect screen ar ashbe na.
 * ===================================================== */

var SUPABASE_URL = 'https://simsudwlbeotxaccppta.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpbXN1ZHdsYmVvdHhhY2NwcHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzUxMTcsImV4cCI6MjEwMDcxMTExN30.vLV73jLpFaBFPIIkYSr_kAV6MlnVURGIdcxHZEQcB_8';

/* ---- NICHER KICHU CHANGE KORBEN NA ---- */
(function () {
  'use strict';
  var CFG_KEY = 'ca_supabase_cfg_v2';

  var isPlaceholder =
    !SUPABASE_URL || !SUPABASE_ANON_KEY ||
    SUPABASE_URL.indexOf('YOUR-PROJECT-ID') !== -1 ||
    SUPABASE_ANON_KEY.indexOf('YOUR-ANON') !== -1;

  window.POS_CONFIG = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    isConfigured: !isPlaceholder
  };

  if (isPlaceholder) {
    console.warn('[config.js] Supabase key bosano hoyni. Connect screen dekhabe.');
    return;
  }

  try {
    localStorage.setItem(CFG_KEY, JSON.stringify({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }));
  } catch (e) {
    console.error('[config.js] localStorage e config lekha jayni', e);
  }

  function hideConnectTab() {
    var connectBtn = document.getElementById('tabConnectBtn');
    var loginBtn = document.getElementById('tabLoginBtn');
    var tabConnect = document.getElementById('tabConnect');
    var tabLogin = document.getElementById('tabLogin');
    var tabsWrap = document.querySelector('.gate-tabs');
    if (!connectBtn || !tabLogin) return false;

    if (tabsWrap) tabsWrap.style.display = 'none';
    connectBtn.style.display = 'none';
    if (loginBtn) loginBtn.classList.add('active');
    if (tabConnect) tabConnect.classList.add('hidden');
    tabLogin.classList.remove('hidden');

    var emailEl = document.getElementById('inEmail');
    if (emailEl && document.activeElement !== emailEl) {
      try { emailEl.focus(); } catch (e) {}
    }
    return true;
  }

  var tries = 0;
  var t = setInterval(function () {
    tries++;
    if (hideConnectTab() || tries > 40) clearInterval(t);
  }, 100);

  document.addEventListener('DOMContentLoaded', hideConnectTab);
  console.log('[config.js] Supabase config permanent set kora hoyeche');
})();
