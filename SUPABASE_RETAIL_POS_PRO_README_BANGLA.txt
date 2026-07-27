চুড়ির আঙিনা Supabase Retail POS Pro

এই version-এ Google Sheet ছাড়াও Supabase free database support add করা হয়েছে। App এখন Local Backup + Google Sheet Sync + Supabase Cloud — তিনভাবেই data handle করতে পারে।

নতুন Supabase UI/UX:
- Supabase Cloud নামে আলাদা section
- Project URL + anon public key input
- Email/password login
- Test connection
- Cloud Pull
- Cloud Push
- Cloud Backup
- Backup list/restore
- Auto Push every 1 minute
- Supabase connection status card

কীভাবে setup করবেন:
1. Supabase.com এ account খুলুন।
2. New Project create করুন।
3. Project ready হলে SQL Editor খুলুন।
4. ZIP-এর supabase_setup.sql file-এর code paste করে Run করুন।
5. Authentication → Users → Add user থেকে owner/manager/staff user add করুন।
6. Project Settings → API থেকে Project URL এবং anon public key copy করুন।
7. HTML app deploy করুন।
8. App → Supabase Cloud section খুলুন।
9. Project URL, anon public key, email, password দিন।
10. Save → Login → Test করুন।
11. পুরোনো data থাকলে আগে app-এ Import/Cloud Pull করে নিন, তারপর Supabase Cloud Push দিন।

Important security:
- HTML app-এ কখনো service_role key দেবেন না।
- শুধু anon public key ব্যবহার করবেন।
- supabase_setup.sql RLS enable করে authenticated user access দেয়।

Data migration:
- Current Google Sheet/Local app থেকে Backup JSON নিন।
- Supabase version app-এ Import JSON করুন।
- Data check করুন।
- Supabase Cloud → Cloud Push দিন।
- অন্য device থেকে login করে Cloud Pull দিলে data চলে আসবে।

Update safety:
- New app empty হলে আগে Cloud Pull দিন।
- Empty app থেকে আগে Cloud Push দেবেন না।
- Push করার আগে app automatic Supabase backup তৈরি করে।

Deploy:
- churir_angina_SUPABASE_RETAIL_POS_PRO.html rename করে index.html করুন।
- manifest.json একই folder-এ রাখুন।
- GitHub/Vercel-এ upload করুন।

Included files:
- churir_angina_SUPABASE_RETAIL_POS_PRO.html
- supabase_setup.sql
- manifest.json
- SUPABASE_RETAIL_POS_PRO_README_BANGLA.txt
