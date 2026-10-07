# ML Tournament — Backend

Frontend ini di-host di GitHub Pages, sedangkan data online memakai Supabase sebagai backend.

## Komponen backend

- `public.teams` — data 32 tim, seed, warna, dan URL logo.
- `public.matches` — skor, peserta, pemenang, dan loser setiap pertandingan.
- `public.admin_users` — daftar user Supabase Auth yang boleh mengedit turnamen.
- Supabase Storage bucket `team-logos` — penyimpanan logo tim.
- Trigger `set_updated_at` — memperbarui timestamp secara otomatis.
- Row Level Security (RLS) — publik hanya bisa membaca; admin bisa menulis.

## Setup production

### 1. Jalankan schema

Di Supabase **SQL Editor**, jalankan:

`supabase/schema.sql`

Schema ini sudah menggunakan policy production: public bisa melihat data, tetapi INSERT/UPDATE/DELETE hanya untuk admin.

### 2. Buat akun admin

Di Supabase buka **Authentication → Users**, lalu buat user dengan email + password.

Setelah user dibuat, salin **User UID**-nya.

### 3. Daftarkan user sebagai admin

Jalankan di SQL Editor:

```sql
insert into public.admin_users (user_id)
values ('PASTE-USER-UID-DI-SINI')
on conflict (user_id) do nothing;
```

Tidak perlu memasukkan password ke tabel mana pun. Password dikelola Supabase Auth.

### 4. Deploy

Setelah itu deploy GitHub Pages seperti biasa. Pengunjung tetap bisa melihat bracket/standings dan export Excel. Hanya akun yang ada di `admin_users` yang bisa login dan mengubah tim, skor, reset, atau upload logo.

## Migrasi dari versi lama

Kalau `schema.sql` sudah pernah dijalankan sebelumnya, **jangan perlu menghapus tabel atau data**. Jalankan:

`supabase/production-auth.sql`

Migration tersebut mengubah policy lama menjadi admin-only tanpa menghapus data tournament.

## Keamanan

- PIN frontend lama sudah dihapus.
- Password tidak disimpan di database aplikasi.
- RLS menjadi pengaman sebenarnya; hiding tombol di frontend bukan satu-satunya security layer.
- Jangan pernah memasukkan **Supabase service-role key** ke `index.html` atau GitHub.
- Anon/publishable key boleh berada di frontend karena aksesnya dibatasi oleh RLS.

## Export

Tombol **Export Excel** menghasilkan file `.xlsx` dengan 3 sheet:
- Hasil Pertandingan
- Tim
- Standings

File dibuat langsung di browser menggunakan SheetJS.
