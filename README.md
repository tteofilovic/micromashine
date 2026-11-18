# Micromašine

Top-down trkačka igra u stilu Micro Machines, za browser i LAN (do 4 igrača).

## Pokretanje (host)

Potrebno: [Node.js](https://nodejs.org) 22 ili noviji.

```
npm install
npm start
```

Server ispiše adrese:

- `http://localhost:3000` za tebe,
- `http://192.168.x.x:3000` za igrače na istoj lokalnoj mreži (LAN),
- `https://....trycloudflare.com` za igrače preko interneta (Cloudflare tunel, vidi dole).

Svi (i host) otvore svoju adresu u browseru, upišu ime i uđu. Prvi igrač je host i on pokreće trku.
U gornjem desnom uglu igre prikazuje se ping do servera (zeleno ispod 60 ms, žuto do 120 ms, crveno preko).
Do oko 80 ms je igrivo, preko toga komande primetno kasne.

## Igranje preko interneta na Windows-u (korak po korak)

`npm start` uz server automatski pokreće Cloudflare tunel (besplatan "quick tunnel", bez naloga).
Tunel dobija javnu adresu koju pošalješ prijateljima. Nije potrebno podešavanje rutera.

### 1. Instalacija (jednom)

Otvori **PowerShell** (Start, pa ukucaj "PowerShell").

1. **Node.js:** skini LTS verziju sa https://nodejs.org ili pokreni
   ```
   winget install OpenJS.NodeJS.LTS
   ```
2. **cloudflared** (Cloudflare tunel):
   ```
   winget install --id Cloudflare.cloudflared
   ```
   Ako `winget` ne postoji ili ne nađe paket, skini instalaciju za Windows sa
   https://github.com/cloudflare/cloudflared/releases (fajl `cloudflared-windows-amd64.msi`) i instaliraj je.
3. **Zatvori PowerShell i otvori ga ponovo**, da bi se nove komande videle. Proveri:
   ```
   node -v
   cloudflared --version
   ```
   Obe komande moraju da ispišu verziju.
4. **Preuzmi igru** i instaliraj zavisnosti:
   ```
   git clone git@github.com:tteofilovic/micromashine.git
   cd micromashine
   npm install
   ```
   Ako na tom računaru nemaš podešen SSH ključ za GitHub, kloniraj preko HTTPS-a:
   `git clone https://github.com/tteofilovic/micromashine.git`.
   Ako igra još nije spojena u `main`, dodaj `git checkout web` posle `cd micromashine`.

### 2. Pokretanje (svaki put)

```
cd micromashine
npm start
```

Posle nekoliko sekundi terminal ispiše nešto ovako:

```
Ti (host):                http://localhost:3000
Ostali igrači (LAN):      http://192.168.1.23:3000
Ostali igrači (internet): https://neke-nasumicne-reci.trycloudflare.com
```

- **Ostavi prozor otvoren.** Kad ga zatvoriš ili pritisneš Ctrl+C, igra i tunel staju.
- **Ti igraš** na `http://localhost:3000` (to je i najmanji ping), ne preko javnog linka.
- Windows Defender Firewall može pri prvom pokretanju da pita za Node.js. Za igru preko interneta to
  nije potrebno (tunel je odlazna veza), a za igru na LAN-u klikni "Allow".

### 3. Šta da pošalješ prijateljima

Samo **link koji počinje sa `https://` i završava se na `.trycloudflare.com`** (red "Ostali igrači (internet)").
Ne šalji `localhost` ni `192.168...` adresu, one rade samo kod tebe.

Prijatelji ne instaliraju ništa. Dovoljan je browser (Chrome, Edge, Firefox; računar ili telefon):

> Otvori ovaj link: https://neke-nasumicne-reci.trycloudflare.com
> Upiši ime i klikni "Uđi u trku". Sačekaj da ja pokrenem trku. Kontrole: strelice ili WASD.

Kad se svi pojave u listi, ti (prvi igrač je host) klikneš "Pokreni trku".

### Važno
- **Link se menja svaki put** kad pokreneš `npm start`. Pošalji novi pre svake partije.
- Svako ko ima link može da uđe dok je lobi otvoren (najviše 4 igrača). Ne objavljuj ga javno.
- Ako tunel padne usred igre, igrači gube vezu: ponovo pokreni `npm start`, pošalji novi link, a oni
  ponovo uđu. Server ispiše "Tunel je prekinut".
- Ako piše "cloudflared nije instaliran", terminal nije video instalaciju: zatvori ga, otvori ponovo i probaj opet.
  Ako se link nikako ne pojavi, proveri internet vezu (VPN ili školska/firmina mreža ponekad blokira tunel).

### Opcije pokretanja

| Cilj | PowerShell | macOS / Linux |
|---|---|---|
| Samo LAN, bez tunela | `npm run start:lan` | `npm run start:lan` |
| Drugi port (ako je 3000 zauzet) | `$env:PORT=3001; npm start` | `PORT=3001 npm start` |

U običnom `cmd` prozoru drugi port se postavlja sa `set PORT=3001 && npm start`.
Na macOS-u se `cloudflared` instalira sa `brew install cloudflared`.

## Pravila

- Strelice ili WASD.
- Kamera prati lidera. Ko ostane van ekrana ispada iz runde. Ispali igrač gleda trku, ali ne vozi.
- Runda traje dok ne ostane jedan auto.
- Poeni: prvi ispali 0, sledeći 1, sledeći 2 itd. Poslednji koji ostane dobija broj igrača u rundi
  (poslednje mesto + 1 bonus). Za 4 igrača: 0, 1, 2, 4.
- Posle runde svi (i ispali) kreću ponovo sa pozicije pobednika runde.
- Igra se završava kad neko dođe do 10 poena. Pri izjednačenju pobeđuje bolji u poslednjoj rundi.
- Posle igre se na početnoj strani prikazuje konačni poredak.
- Sam igrač je u "praksi": runda se nikad ne završava.
- Staza se bira nasumično kad host pokrene igru (nikad ista dvaput zaredom) i važi do kraja igre.

## Staze

| Staza | Karakter |
|---|---|
| Klasik | Široka i brza, dva blaga suženja. |
| Autoput | Dugačka: tri duge prave, dve ukosnice (uski levkovi) i uski tunel u sredini. |
| Šikana | Uska i tehnička: pravougaoni ćoškovi sa zarezom i dva uska grla. |
| Trougao | Duge brze strane, oštar vrh, uski ćoškovi na dnu i uzak prolaz odmah posle starta. |

Staze su tačke u `shared/track-defs.js`: `[x, y]` ili `[x, y, širina]`. Širina puta se glatko menja između tačaka,
pa se tako prave uska grla. Izlazak na travu računa se prema lokalnoj širini. Nova staza = nova stavka u nizu.
Prva tačka je start i mora biti na pravom, širokom delu.

`npm test` za svaku stazu proverava da krivine nisu preoštre za put i ivičnjake, da se delovi staze ne dodiruju,
da je start prav i širok i da bot može da prođe pun krug (uz kočenje u krivinama).

## Ako se ostali ne mogu povezati

- Firewall na hostu mora da dozvoli Node (macOS pita pri prvom pokretanju).
- Svi moraju biti na istoj mreži. Guest Wi-Fi često ima "client isolation".

## Testovi

```
npm test
```
