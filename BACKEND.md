# ML Tournament — Backend

Frontend ini di-host di GitHub Pages, sedangkan data online memakai Supabase sebagai backend.

## Komponen backend

- `public.teams` — data 32 tim, seed, warna, dan URL logo.
- `public.matches` — skor, peserta, pemenang, dan loser setiap pertandingan.
- Supabase Storage bucket `team-logos` — penyimpanan logo tim.
- Trigger `set_updated_at` — memperbarui timestamp secara otomatis.
- Row Level Security (RLS) — sudah diaktifkan.

## Setup

1. Buka project Supabase yang dipakai aplikasi.
2. Jalankan `supabase/schema.sql` di SQL Editor.
3. Pastikan URL dan anon key di `index.html` menunjuk ke project tersebut.
4. Deploy ulang GitHub Pages.

> Catatan keamanan: versi saat ini mempertahankan kompatibilitas dengan aplikasi lama sehingga policy write masih publik. Untuk produksi, langkah berikutnya adalah memindahkan admin login ke Supabase Auth dan membatasi policy write hanya untuk user/admin terautentikasi. Jangan menaruh service-role key di frontend.

## Export

Tombol **Export Excel** sekarang menghasilkan file `.xlsx` dengan 3 sheet:
- Hasil Pertandingan
- Tim
- Standings

File dibuat langsung di browser menggunakan SheetJS; tidak ada lagi export JSON.
