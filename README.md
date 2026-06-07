# LFC Crafting Website

Statische Website für GitHub Pages.

## Wichtig vor dem Hochladen

In `assets/js/config.js` muss der öffentliche Supabase `anon key` eingetragen werden:

```js
window.LFC_SUPABASE_CONFIG = {
  url: "https://mwyaoijpvwjvutmctqxv.supabase.co",
  anonKey: "HIER_SUPABASE_ANON_KEY_EINTRAGEN"
};
```

Nur der `anon key` darf ins Frontend. Niemals den `service_role key` in GitHub speichern.

## Enthaltene Seiten

- `index.html`
- `katalog.html`
- `bestelluebersicht.html`
- `rohstoffpreise.html`
- `kontakt.html`
- `standort.html`
- `login.html`
- `admin.html`

## Datenquellen

- Katalog: Supabase View `public_vehicle_catalog`
- Bestellübersicht: Supabase View `public_order_overview`
- Rohstoffpreise: Supabase View `public_item_prices`
- Kontakt/Termine: Tabellen `contact_requests`, `appointment_requests`
- Admin: Tabellen `vehicle_catalog_entries`, `orders`, `contact_requests`

## Hinweise

- Supabase SQL, Migrations und Edge Functions sind absichtlich nicht enthalten.
- Bildpfade unter `bilder/...` sind vorbereitet. Vorhandene Bilder müssen separat in das Repo kopiert werden.
- Fahrzeugbilder aus dem Katalog kommen als externe URLs aus Supabase.
