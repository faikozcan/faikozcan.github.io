# SetPoint — padel & tenis skor uygulaması (web)

Canlı adres (main dalına birleştirildikten sonra): `https://faikozcan.github.io/skor/`

- İki telefon QR kodla eşleşir; skor WebRTC ile (PeerJS) doğrudan senkronlanır, sunucu gerekmez.
- Herkes **kendi** puanını verir: ekranın alt yarısına dokunarak ya da saatin/kulaklığın
  müzik tuşlarıyla (⏭ veya ⏯ = puanım, ⏮ = son puanımı geri al).
- Aynı ralli için 2 saniye içinde gelen ikinci basış reddedilir.
- Padel (altın sayı) ve tenis (avantaj) kuralları, tie-break, 1 veya 3 set, servis ve taraf değiştirme uyarısı.
- Skor sesli okunur (TR/EN), maç sonunda paylaşılabilir skor kartı üretilir.

Dosyalar: `scoring.js` (sayma motoru), `app.js` (arayüz, eşleşme, media session), `i18n.js` (metinler),
`vendor/` (PeerJS 1.5.5, qrcode-generator 1.4.4 — MIT).

Yerel test için kendi PeerJS sunucunuzu `?peer=host:port` parametresiyle kullanabilirsiniz.
