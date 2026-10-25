# Fanta Alpine Ski 2026/27

Il fantasci della Coppa del Mondo di sci alpino: asta, formazioni, bonus, malus e classifica.

## Come si gioca sul sito

1. Ci si registra con email e password, poi si sceglie lo username (unico, lo vedono gli altri).
2. Due strade: **crea una lega** (per ora solo l'amministratore del sito; si sblocca da Gestione → Leghe) o **entra con un codice**.
3. Con il codice si entra nella lega e si sceglie la propria squadra. Chi organizza la lega può cambiarla da Gestione → Squadre.
4. Poi si mettono le formazioni prima della chiusura di ogni gara. Asta e atleti li gestisce chi organizza la lega.

L'amministratore del sito (il primo account che preme «Diventa amministratore») gestisce tutte le leghe, il calendario,
gli atleti e i risultati.

## Cartelle

- `docs/` — il sito pubblicato (GitHub Pages). `docs/data/` contiene listone, calendario e risultati: li aggiornano le attività automatiche.
- `src/core.js` — motore dei punti, comune al sito e alla pagina su Claude. `src/app.js` e `src/style.css` — la pagina su Claude.
- `site/src/` — il sito: `app.js` (interfaccia), `db.js` (Firebase), `mockdb.js` (database finto per le prove), `site.css`.
- `site/src/pdftext.js` — il lettore di PDF del sito, in JavaScript semplice (ES5) perché funzioni su qualunque telefono:
  legge il testo e la sua posizione dal PDF dei risultati FIS caricato in Gestione → Risultati (oggetti, flussi
  compressi, font e mappe ToUnicode). Il sito ricostruisce le righe dalla posizione del testo, sceglie la gara
  dall'intestazione del PDF (es. «Women's Giant Slalom … SAT 24 OCT 2026») e usa lo stesso lettore della classifica
  incollata. `tests/pdftext_test.mjs` lo confronta riga per riga con PDF.js e con i risultati ufficiali.
- `site/vendor/pdfjs/` — PDF.js (Mozilla, licenza Apache 2.0), usato solo se il lettore del sito non trova la
  classifica in un PDF; chiede un browser recente (ES2022: su iPhone iOS 16.4 o successivo). Se nessuno dei due legge
  il file, il pannello mostra una riga con il motivo e il browser usato.
- `site/firestore.rules` — regole di sicurezza del database, da incollare in Firebase → Firestore → Regole.
  Il sito controlla che quelle pubblicate siano le attuali (le nuove permettono di leggere `config/rulesAAAAMMGG`):
  se sono vecchie, chi organizza vede un avviso con il pulsante per copiarle. Quando cambiano, cambia anche quel nome
  (in `site/firestore.rules`, `site/src/db.js` e `tests/fakefire.js`).
- `build.py` — costruisce la pagina su Claude e `build/state.json` (da `data/*.tsv` e dal calendario nel file).
- `site/build_site.py` — costruisce il sito: `python3 build.py && python3 site/build_site.py --out docs`
  (tiene i `docs/data/*.json` già presenti; `--from-page pagina.html` li prende dalla pagina su Claude).
  La configurazione Firebase sta in `site/firebase.json`.
- `export_leagues.py` — esporta le leghe della pagina su Claude in un file da importare nel sito (Gestione → Leghe).
- `tests/` — prove con Node e Playwright (`pw_site.js`, `pw_import.js` sul database finto; `pw_fire.js` sul vero `db.js` con `fakefire.js`;
  il file di lega che leggono le prove di importazione lo scrive `tests/make_leghe_test.py`).

## Formazioni e permessi

- Ogni giocatore mette solo la formazione della squadra collegata al suo account, e solo prima della chiusura della gara.
- Chi organizza la lega (e l'amministratore del sito) mette e corregge la formazione di ogni squadra, anche a gara chiusa
  (Gare → gara → «Correggi», o Squadre → «Gare chiuse»): punti e classifica si aggiornano subito.
- Chi non ha la squadra collegata vede un avviso in ogni pagina; chi organizza vede chi è senza squadra e quali squadre
  non sono collegate (Gestione → Squadre), e può decidere che le squadre libere le colleghi solo lui («Le collego solo io»).

## Dati su Firebase

- `users/{uid}` (username, leghe), `usernames/{nome}` (uno per account), `config/admins` (amministratori), `config/site` (`openLeagues`).
- `leagues/{lega}` (impostazioni, mercato, chiusure delle gare, formazioni delle gare chiuse), con `teams`, `members`,
  `pending` (formazioni in arrivo, visibili solo alla squadra) e `races/{gara}/lineups/{squadra}` (la formazione che conta).
- `results`, `races`, `athletes`: correzioni dell'amministratore sopra i file di `docs/data/`.
