# Cashu Audit — brand manual

Verze 2.0 · 6. 10. 2026 · platí pro audit.cashu.cz a vše, co z projektu vychází
(sociální karty, prezentace, nálepky, e-maily s reporty).

---

## 1. Koncept: puncovní úřad pro ecash

Puncovní úřad nezkoumá, jestli se prsten líbí. Zjistí, z čeho je, a vyrazí
na něj punc. Cashu Audit dělá totéž pro Cashu minty: nezávisle, pravidelně a
veřejně ověřuje, že mint odpovídá a že skutečně vyplácí přes Lightning.

Z toho plyne všechno ostatní:

- **Důkaz, ne názor.** Každé tvrzení na webu je podložené měřením s časem.
  Žádné hodnocení hvězdičkami, žádné „doporučujeme“.
- **Moderní, ale věcný.** Vzdušná stránka, velká typografie, měkké
  plochy a jemná záře v pozadí. Moderní forma, data pořád na prvním místě:
  žádné neony, rakety ani animace kvůli efektu.
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
 ●  mince uvnitř, plná barva Accent
 ✓  háček vyražený do mince barvou povrchu
```

- **Ochranná zóna:** kolem značky vždy volné místo ≥ ¼ její šířky.
- **Minimální velikost:** 16 px (favicon), ve wordmarku 20 px.
- **Barvy:** Accent na Paper, nebo Paper na Ink. Nic jiného.
- **Nedělat:** neotáčet, nepřidávat stín, gradient ani obrys, nevkládat do
  kruhu, nepoužívat háček bez razidla (pak je to jen „check“, ne punc).

## 4. Barvy

Barvy jsou definované jako CSS tokeny v `app/globals.css`. V kódu se nikdy
nepíše hex, jen token. Výjimkou jsou soubory, které CSS nevidí: favicon,
logo v `public/brand`, OG obrázky a SVG badge.

### 4.1 Základ

| Token | Role | Světlý | Tmavý |
|---|---|---|---|
| `--paper` | pozadí stránky | `#f5f6fa` | `#0c0d13` |
| `--surface` | karty, tabulky, grafy | `#ffffff` | `#14151e` |
| `--surface-2` | vnořené plochy, pole formulářů, podklad přepínačů | `#eef0f6` | `#1c1e2a` |
| `--ink` | hlavní text | `#12131c` | `#f2f3f8` |
| `--ink-2` | sekundární text | `#4a4e63` | `#b3b7cb` |
| `--ink-3` | popisky os, metadata (≥ 4.5:1) | `#6f7490` | `#8a8ea6` |
| `--line` | vlasové linky, mřížka | `#e7e9f1` | `#242635` |
| `--line-strong` | osy, okraje | `#d5d8e4` | `#323549` |

### 4.2 Accent — barva značky

| Token | Role | Světlý | Tmavý |
|---|---|---|---|
| `--accent` | značka, datová řada 1, primární tlačítko, druhý řádek hero nadpisu | `#5b45e6` | `#8f80ff` |
| `--accent-ink` | odkazy a text v barvě značky (≥ 4.5:1) | `#4733cf` | `#aa9eff` |
| `--accent-wash` | sekundární tlačítko, zvýraznění řádku, vybraná volba | accent 9 % | accent 14 % |
| `--on-accent` | text na výplni Accent | `#ffffff` | `#0c0d13` |
| `--glow-1`, `--glow-2` | záře v pozadí stránky (accent a teplá oranžová) | 16 % / 10 % | 18 % / 7 % |

Indigo dává auditu technický, moderní charakter a od bitcoinové oranžové
se záměrně odlišuje. Teplá oranžová zůstává jen jako druhá datová řada a
slabá záře. Accent patří na logo, primární akce, zvýraznění a data, ne na
velké plochy.

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
| Řada 1 | `#5b45e6` | `#8f80ff` | latence, hlavní metrika |
| Řada 2 | `#ef8a3a` | `#f5a462` | srovnávací metrika (např. Frankfurt) |

Paleta prošla validátorem (CVD ΔE ≥ 23, kontrast ≥ 3:1 v obou režimech).
Víc než dvě řady v jednom grafu nepoužíváme; místo toho víc grafů.
Úspěch/selhání swapů jsou *stavy*, ne řady, a kreslí se stavovými barvami.

## 5. Typografie

| Role | Písmo | Řez | Velikost / řádek |
|---|---|---|---|
| Hero nadpis (úvodní stránka) | Plus Jakarta Sans | 800 | 40–76 px / 1.02, tracking −0.04em, druhý řádek v Accent |
| Hero číslo | Plus Jakarta Sans | 800 | 72 / 72 (mobil 56), tracking −0.05em |
| H1 | Plus Jakarta Sans | 800 | 30–44 px / 1.08, tracking −0.035em |
| H2 | Plus Jakarta Sans | 700 | 24 / 30, tracking −0.025em |
| Hodnota dlaždice | Plus Jakarta Sans | 800 | 34 / 40, tracking −0.04em |
| Eyebrow (nad nadpisem) | JetBrains Mono | 500 | 12 / 16, VERZÁLKY, tracking 0.14em, v Accent |
| Text | Plus Jakarta Sans | 400 | 15 / 24 |
| Malý text, popisky | Plus Jakarta Sans | 400–500 | 13 / 18 |
| Hlavička tabulky | Plus Jakarta Sans | 600 | 11, VERZÁLKY, tracking 0.03em, `--ink-3` |
| URL, hashe, verze, kód | JetBrains Mono | 400 | 13 / 18 |

- Velké nadpisy jsou těžké a těsné, text pod nimi lehký a vzdušný. Ten
  kontrast nese moderní charakter.
- Čísla v tabulkách a na osách: `tabular-nums`. Velká samostatná čísla
  (hero, dlaždice) ne.
- Jednotky vždy s mezerou: `21 sat`, `412 ms`, `99.8 %`, `3.2 s`.

## 6. Tvar, mřížka, prostor

- Základní jednotka 4 px. Mezery 4 / 8 / 12 / 16 / 24 / 32 / 48 / 56 / 64.
  Sekce od sebe 56 px.
- Obsah max. 1200 px, boční okraj 16 px na mobilu, 32 px od 768 px.
- Rádius: karty, dlaždice a tabulky 20 px, dialog 24 px, volby a QR
  16 px, pole formulářů 12 px, tlačítka a přepínače 999 px (pilulka).
- Karty oddělujeme od pozadí **měkkým stínem** (`--shadow`), ne rámečkem.
  V tmavém režimu místo stínu vlasová linka. Uvnitř karet a tabulek
  zůstávají vlasové linky.
- Pozadí stránky: `--paper` se dvěma jemnými radiálními zářemi
  (`--glow-1` vpravo nahoře, `--glow-2` vlevo). Žádné další gradienty
  kromě jemného nádechu Accent u pruhu s financováním.
- Hlavička je průhledná s rozostřením pozadí (`backdrop-filter`).

## 7. Komponenty

- **Stavový odznak:** ikona 14 px ve stavové barvě + slovo v `--ink`,
  podklad `--surface-2`, rádius 999 px.
- **Dlaždice metriky:** popisek (malý text, `--ink-2`) · hodnota (34 px,
  800) · volitelný kontext (13 px, `--ink-3`). Jedno hero číslo na stránku.
- **Tabulka:** bez podkladu hlavičky, řádky oddělené linkou, hover
  `--accent-wash`, čísla zarovnaná doprava a `tabular-nums`.
- **Pás dostupnosti:** buňky 2 px od sebe, rádius 2 px, barva podle stavu
  (≥ 99 % OK, ≥ 95 % Warning, ≥ 80 % Serious, jinak Critical, bez dat
  `--line`). Vždy s legendou.
- **Tlačítko primární:** pilulka, výplň Accent, text `--on-accent`, měkký
  stín v barvě Accent. Sekundární: pilulka, podklad `--accent-wash`, text
  `--accent-ink`, bez obrysu.
- **Přepínač (segmented, záložky):** pilulka s podkladem `--surface-2`,
  vybraná volba je bílá pilulka se stínem.
- **Pole formuláře:** podklad `--surface-2`, bez obrysu, rádius 12 px,
  při focusu `--surface` a prstenec 2 px Accent.
- **Pruh financování:** karta s nádechem `--accent-wash`, počet dní
  výdrže a ukazatel ve stavové barvě (≥ 30 dní OK, ≥ 10 Warning, jinak
  Critical).

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
| Accent na logu, tlačítkách, zvýraznění a čáře grafu | Fialové plochy, fialové tabulky |
| Měkký stín pod kartou, linka mezi řádky | Rámeček i stín zároveň, tvrdé černé stíny |
