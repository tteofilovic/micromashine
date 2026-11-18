# Micromašine

Top-down trkačka igra u stilu Micro Machines, za browser i LAN (do 4 igrača).

## Pokretanje (host)

```
npm install
npm start
```

Server ispiše adrese, npr. `http://192.168.1.23:3000`. Pošalji tu adresu ostalima.
Svi (i host) otvore adresu u browseru, upišu ime i uđu. Prvi igrač je host i on pokreće trku.

Drugi port: `PORT=3001 npm start`.

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
