# Churir Angina POS -- v3.1 (Full English)

Everything in the software is now in **English only**. No mixed language.

---

## What changed in v3.1

| Change | Detail |
|---|---|
| Product add error fixed | "Could not find the 'box_contains_dozen' column" no longer blocks saving |
| Full English | Every label, button, message and receipt is English |
| On-screen keypad removed | You type with the normal keyboard; quick cash buttons stay |
| Cleaner UI | New colours, softer cards, better tables, better spacing, better mobile view |
| Permanent key | Only a Login screen -- no Connect step |
| Barcode scanning | Still works on the POS screen |
| WhatsApp receipts | Still works, English text |

---

## Setup -- 4 steps

### Step 1 -- Fix the database (IMPORTANT, do this first)
Supabase -> **SQL Editor** -> New query -> paste the whole of **`schema_fix.sql`** -> **Run**.

This adds every column the app needs, including `box_contains_dozen`, `barcode`,
`cost_price_pcs`, `sale_price_pcs` and `low_stock_threshold_pcs`.
It deletes nothing and can be run again safely.

### Step 2 -- Add the automation tables
Same SQL Editor -> paste **`automation_migration.sql`** -> **Run**.

### Step 3 -- Make your key permanent
Open **`config.js`** in Notepad and edit only these two lines:

```js
var SUPABASE_URL = 'https://your-project-id.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOi....your anon public key....';
```

Both values are in Supabase -> **Settings -> API** (`Project URL` and the `anon public` key).
Save the file. The Connect screen is now gone forever -- only Login remains.

> The anon key is safe in the browser. Supabase calls it *public* by design; your
> data is protected by Row Level Security. Never put the `service_role` key here.

### Step 4 -- Upload
Upload all 8 files together to your hosting:

```
index.html
config.js
app.js
automation.js
ux-extras.js
schema_fix.sql
automation_migration.sql
manifest.json
```

Open the site, sign in, then go to **Automation** in the sidebar and set your
shop name and owner WhatsApp number.

---

## Daily use

**Selling**
1. Open **Sell (POS)**
2. Tap a product, or scan its barcode
3. Type the customer phone number (membership is created automatically)
4. Type the amount paid, or press **Exact / 500 / 1000 / 2000**
5. The green box shows the exact change to return
6. Press **Complete sale** -- the WhatsApp receipt opens automatically

**Automation buttons**

| Where | Button | What it does |
|---|---|---|
| POS, after a sale | Send receipt again | Reopens WhatsApp with the same receipt |
| Due ledger | Remind | Sends a polite payment reminder |
| Automation page | Send daily report | Today's totals to the owner |
| Automation page | Send low stock list | All products below their alert limit |
| Members page | Message | Welcome message to that member |

---

## Troubleshooting

**"Could not find the 'x' column" when saving**
Run `schema_fix.sql` again. The app will still save and tell you which columns were skipped.

**Connect screen still appears**
Your `config.js` still has the placeholder text. Check for typos and clear the browser cache.

**Barcode scanner does nothing**
The barcode must be saved on the product first (Products -> Edit -> Barcode).
Stay on the POS page while scanning.

**Something looks broken**
Press F12 -> Console. You should see these three lines:
```
[config.js] Supabase config loaded permanently
[automation.js] automation add-on installed
[ux-extras.js] barcode + change box installed
```

---

## Coming later

**Product variants** (size 2.4 / 2.6 / 2.8, colours) -- this needs a new database
table, so it will be a separate update.
