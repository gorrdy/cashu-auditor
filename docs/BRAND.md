# Cashu Audit — brand manual

Verze 1.0 · 30. 9. 2026 · platí pro audit.cashu.cz a vše, co z projektu vychází
(sociální karty, prezentace, nálepky, e-maily s reporty).

---

## 1. Koncept: puncovní úřad pro ecash

Puncovní úřad nezkoumá, jestli se prsten líbí. Zjistí, z čeho je, a vyrazí
na něj punc. Cashu Audit dělá totéž pro Cashu minty: nezávisle, pravidelně a
veřejně ověřuje, že mint odpovídá a že skutečně vyplácí přes Lightning.

Z toho plyne všechno ostatní:

- **Důkaz, ne názor.** Každé tvrzení na webu je podložené měřením s časem.
  Žádné hodnocení hvězdičkami, žádné „doporučujeme“.
- **Klidná autorita.** Vizuálně spíš úřední listina a laboratorní protokol
  než krypto dashboard. Žádné neony, gradienty ani rakety.
- **Punc jako symbol.** Značka je puncovní razítko: osmiúhelník (tvar
  razidla) a v něm mince s vyraženým háčkem.

**Tagline:** *Independent proof that Cashu mints pay.*
**Česky:** *Nezávislý důkaz, že minty platí.*

## 2. Jméno a zápis

| Použití | Zápis |
|---|---|
| Plný název | Cashu Audit |
| Wordmark | `cashu audit` — malými písmeny, „audit“ v řezu Semibold |
| Doména | audit.cashu.cz |
| V textu | vždy „Cashu Audit“, nikdy „CashuAudit“, „CASHU AUDIT“ ani „Auditor“ jako vlastní jméno |

Anglické UI je výchozí (minty i jejich uživatelé jsou mezinárodní). Česká
verze textů smí existovat, ale nemíchat jazyky v jedné obrazovce.

## 3. Logo

Soubory: `public/brand/mark.svg` (značka), `app/icon.svg` (favicon).

```
 ⬡  osmiúhelník = razidlo (tah 2.5 px na 32 px mřížce)
 ●  mince uvnitř, plná barva Copper
 ✓  háček vyražený do mince barvou povrchu
```

- **Ochranná zóna:** kolem značky vždy volné místo ≥ ¼ její šířky.
- **Minimální velikost:** 16 px (favicon), ve wordmarku 20 px.
- **Barvy:** Copper na Paper, nebo Paper na Ink. Nic jiného.
- **Nedělat:** neotáčet, nepřidávat stín, gradient ani obrys, nevkládat do
  kruhu, nepoužívat háček bez razidla (pak je to jen „check“, ne punc).

## 4. Barvy

Barvy jsou definované jako CSS tokeny v `app/globals.css`. V kódu se nikdy
nepíše hex, jen token.

### 4.1 Základ

| Token | Role | Světlý | Tmavý |
|---|---|---|---|
| `--paper` | pozadí stránky | `#f6f4ee` | `#12110e` |
| `--surface` | karty, tabulky, grafy | `#fffdf9` | `#1b1916` |
| `--surface-2` | hlavičky tabulek, vnořené plochy | `#f1eee6` | `#23211d` |
| `--ink` | hlavní text | `#1a1712` | `#f4f1ea` |
| `--ink-2` | sekundární text | `#595449` | `#c4bfb3` |
| `--ink-3` | popisky os, metadata (≥ 4.5:1) | `#76705f` | `#8f8a7f` |
| `--line` | vlasové linky, mřížka | `#e6e1d6` | `#2e2b26` |
| `--line-strong` | osy, okraje polí | `#cfc8b9` | `#3d3a33` |

### 4.2 Copper — barva značky

| Token | Role | Světlý | Tmavý |
|---|---|---|---|
| `--copper` | značka, datová řada 1, primární tlačítko | `#b4541f` | `#d46c30` |
| `--copper-ink` | odkazy a text v barvě značky (≥ 4.5:1) | `#8f3f12` | `#e98a52` |
| `--copper-wash` | zvýraznění řádku, plocha pod čarou | copper 10 % | copper 14 % |
| `--on-copper` | text na výplni Copper | `#fffdf9` | `#12110e` |

Copper je měď mincí a zároveň odkaz na oranžovou bitcoinu, jen dospělejší.
Na obrazovce jí má být málo: logo, primární akce a data. Nikdy velká plocha.

### 4.3 Stavové barvy (pevné, nikdy nemíchat s daty)

| Stav | Barva | Ikona | Popisek |
|---|---|---|---|
| OK | `#0ca30c` | ✓ v kruhu | OK |
| Warning | `#fab219` | ! v trojúhelníku | Warning |
| Serious | `#ec835a` | ! v kosočtverci | Degraded |
| Critical | `#d03b3b` | × v osmiúhelníku | Offline / Failed |
| Unknown | `--ink-3` | prázdný kruh | Not checked |

Pravidlo: **stavová barva nikdy nenese význam sama.** Vždy ikona + slovo.
Text popisku je v `--ink`, barevná je jen ikona.

### 4.4 Data

| Slot | Světlý | Tmavý | Použití |
|---|---|---|---|
| Řada 1 | `#b4541f` | `#d46c30` | latence, hlavní metrika |
| Řada 2 | `#2270c2` | `#3d8ae0` | srovnávací metrika (např. keysets) |

Paleta prošla validátorem (CVD ΔE ≥ 23, kontrast ≥ 3:1 v obou režimech).
Víc než dvě řady v jednom grafu nepoužíváme; místo toho víc grafů.
Úspěch/selhání swapů jsou *stavy*, ne řady, a kreslí se stavovými barvami.

## 5. Typografie

| Role | Písmo | Řez | Velikost / řádek |
|---|---|---|---|
| Hero číslo | IBM Plex Sans | 600 | 48 / 52 |
| H1 | IBM Plex Sans | 600 | 32 / 38, tracking −0.015em |
| H2 | IBM Plex Sans | 600 | 20 / 28 |
| Eyebrow (nad nadpisem) | IBM Plex Mono | 500 | 12 / 16, VERZÁLKY, tracking 0.08em |
| Text | IBM Plex Sans | 400 | 15 / 24 |
| Malý text, popisky | IBM Plex Sans | 400 | 13 / 18 |
| URL, hashe, verze, kód | IBM Plex Mono | 400 | 13 / 18 |

- Plex je technické písmo s „úředním“ charakterem a plnou češtinou.
- Čísla v tabulkách a na osách: `tabular-nums`. Velká samostatná čísla
  (hero, dlaždice) ne.
- Jednotky vždy s mezerou: `21 sat`, `412 ms`, `99.8 %`, `3.2 s`.

## 6. Tvar, mřížka, prostor

- Základní jednotka 4 px. Mezery 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Obsah max. 1200 px, boční okraj 16 px na mobilu, 32 px od 768 px.
- Rádius: 4 px ovládací prvky a buňky, 8 px karty. Nic kulatějšího.
- Oddělujeme **vlasovou linkou 1 px** (`--line`), ne stínem. Stín má jen
  plovoucí tooltip.
- Karty nemají barevné pozadí hlavičky; nadpis karty je text, ne pruh.

## 7. Komponenty

- **Stavový odznak:** ikona 14 px ve stavové barvě + slovo v `--ink`,
  obrys `--line`, rádius 999 px. Bez výplně.
- **Dlaždice metriky:** popisek (malý text, `--ink-2`) · hodnota (28 px,
  600) · volitelný kontext (13 px, `--ink-3`). Jedno hero číslo na stránku.
- **Tabulka:** hlavička `--surface-2`, řádky oddělené linkou, hover
  `--copper-wash`, čísla zarovnaná doprava a `tabular-nums`.
- **Pás dostupnosti:** buňky 2 px od sebe, rádius 2 px, barva podle stavu
  (≥ 99 % OK, ≥ 95 % Warning, ≥ 80 % Serious, jinak Critical, bez dat
  `--line`). Vždy s legendou.
- **Tlačítko primární:** výplň Copper, text `--on-copper`. Sekundární: obrys
  `--line-strong`, text `--ink`.
- **Pole formuláře:** povrch `--surface`, obrys `--line-strong`, focus
  prstenec 2 px Copper.

## 8. Grafy

Řídíme se interním dataviz standardem:

- čáry 2 px, sloupce ≤ 24 px s rádiusem 4 px nahoře, mezi segmenty 2 px mezera,
- mřížka jen vodorovná, vlasová, plná (nikdy čárkovaná),
- jedna osa Y. Dvě veličiny = dva grafy,
- každý graf má tooltip (hover i klávesnice) **a** tabulkovou verzi
  pod rozbalovacím „Show table“,
- u ≥ 2 řad vždy legenda,
- časy v zóně Europe/Prague a v tooltipu vždy s datem.

## 9. Hlas a tón

- Věcně, krátce, v přítomném čase. „Mint answered in 412 ms.“ ne „Wow, super
  fast!“
- Neobviňujeme. Selhání popisujeme faktem a fází: „Melt failed at source:
  HTTP 502“.
- Vyhýbáme se slovům *trusted, safe, guaranteed*. Audit neříká, že je mint
  bezpečný; říká, co se stalo.
- Čísla bez zaokrouhlování do marketingu: `99.2 %`, ne „skoro 100 %“.

## 10. Příklady

| Ano | Ne |
|---|---|
| `Offline · HTTP 502 · 3 checks` | `❌ DOWN!!!` |
| `Swap success 94.1 % (30 d)` | `Reliability score: A+` |
| Copper jen na logu, tlačítku a čáře grafu | Oranžové nadpisy, oranžové tabulky |
| Linka mezi řádky | Stín pod každou kartou |
