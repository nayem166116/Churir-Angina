# চুড়ির আঙিনা — Supabase POS Software (সেটআপ গাইড)

এই সফটওয়্যারটি **Churir_Angina_Supabase_POS_Final_Plan.md** এ থাকা চূড়ান্ত সিদ্ধান্ত অনুযায়ী তৈরি — base unit **Pcs**, sale default **Dozen**, box variable, RPC-ভিত্তিক atomic checkout/purchase/return/cancel logic সহ।

## ফাইল সমূহ
- `supabase_schema.sql` — সব Table + Trigger + RPC Function + RLS (Supabase SQL Editor-এ run করতে হবে)
- `index.html` — App-এর HTML + CSS (UI shell)
- `app.js` — App-এর সব লজিক (POS, Products, Purchases, Sales, Returns, Ledger, Expenses, Customers, Suppliers, Partners, Reports, Stock Movement, Closing, Alerts, Audit, Trash, Backups, Settings)
- `manifest.json` — PWA manifest (mobile-এ "Add to Home Screen" সাপোর্ট)

## সেটআপ স্টেপ বাই স্টেপ

### 1) Supabase Project তৈরি
1. https://supabase.com এ কাড় → **New Project** তৈরি করুন।
2. Project রেডি হলে বাম পাশের **SQL Editor**-এ যান।
3. `supabase_schema.sql` ফাইলের মধ্যেকার সব কোড কপি করে SQL Editorএ **Paste করে Run করুন।** (একবারই পুরো schema, table, trigger, function, RLS সব তৈরি হয়ে যাবে)।

### 2) Owner Login তৈরি
1. Supabase Dashboard → **Authentication → Users → Add User**।
2. Email + Password দিয়ে একটি User তৈরি করুন (এটিই Owner Login)।
3. Schema-র Trigger অটোমেটিকভাবে `profiles` table-এ role='owner' সহ একটি Profile তৈরি করে দেবে।

### 3) URL + Anon Key সংগ্রহ
1. Dashboard → **Project Settings → API**।
2. **Project URL** এবং **anon public** key কপি করুন।
3. **service_role** key কখনও এই App-এ ব্যবহার করবেন না।

### 4) App Connect
1. `index.html` ওয়েব ব্রাউজারে ওপেন করুন (বা Vercel-এ deploy করে লিংকে ওপেন করুন)।
2. "1. Connect" ট্যাবে Project URL + Anon Key দিয়ে **Save & Continue**।
3. "2. Login" ট্যাবে Owner Email/Password দিয়ে **Login** করুন।

### 5) প্রথম ব্যবহার
1. **Products** ট্যাব থেকে প্রথমে সব পণ্য যোগ করুন (SKU, Name, Color, Size, Price/Dozen, Price/Pcs)।
2. **Purchases** ট্যাব থেকে Opening Stock এবং পরবর্তী সব ক্রয় এন্ট্রি করুন — Purchase Unit = Box হলে প্রতি Box-এ কত Dozen আছে তা অবশ্যই লিখুন (যেহেতু Box-এর পরিমাণ পরিবর্তনশীল)।
3. **POS** ট্যাব থেকে পণ্যে ক্লিক করে Cart-এ যোগ করুন, Unit (Dozen/Pcs) বেছে নিন, তারপর **Complete Sale**।
4. প্রতিটি বিক্রয় স্বয়ংক্রিয়ভাবে Stock কমায়, Cashbook আপডেট করে, Audit Log তৈরি হয়—এই সব Supabase RPC Function দিয়ে অাটোমেটিকভাবে হয়।

### 6) Deploy (সবাই থেকে ব্যবহারের জন্য)
1. GitHub-এ একটি Repository তৈরি করে `index.html`, `app.js`, `manifest.json` আপলোড করুন।
2. https://vercel.com এ Import করে **Deploy** করুন।
3. লিংক ওপেন করে উপরের "App Connect" পদ্ধতি অনুসরণ করুন।

## গুরুত্বপূর্ণ নিয়ম
- **service_role key** কখনও HTML/GitHub/Vercel-এ দেবেন না, শুধু **anon public key** ব্যবহার করুন।
- Box-এর Dozen সংখ্যা পরিবর্তনশীল হওয়ায়, প্রতি Purchase Entry-তে এটি অবশ্যই এক্যুরেট দিতে হবে (Box না হলে সারাসরি সমস্যা হবে)।
- **Trash** ট্যাব থেকে বাতিল হয়ে যাওয়া Product Restore করা যায়।
- **Backups** ট্যাব থেকে নিয়মিত Cloud Backup এবং JSON Download নিতে পারবেন।
- ভবিষ্যতে স্টাফ বাড়লে `profiles.role` ব্যবহার করে Manager/Cashier RLS আলাদাবাবে সীমিত করা যায়।

## সমস্যা হলে
- Login হচ্ছে না → URL/Anon Key/Email/Password এ ভুল আছে কিনা দেখুন।
- ডাটা Save হচ্ছে না → Supabase RLS Policy ঠিকমতো আছে কিনা এবং User Login অবস্থায় আছে কিনা যাচাই করুন।
