# Amstrad CPC Debug — VS Code Extension

> 🇬🇧 [English version available](README.md)

Extension de débogage VS Code pour le développement Z80 sur **Amstrad CPC** (CPC 464 / 664 / 6128 / CPC+).

L'extension agit comme un pont Debug Adapter Protocol (DAP) entre VS Code et un émulateur CPC. Elle se connecte à l'émulateur via un protocole JSON/TCP documenté dans [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md), ce qui la rend compatible avec n'importe quel émulateur qui implémente ce protocole.

L'émulateur de référence est **[SugarboxV2](https://github.com/Tom1975/SugarboxV2)**.

---

## Table des matières

- [Prérequis](#prérequis)
- [Installation](#installation)
  - [Depuis le VSIX](#depuis-le-vsix)
  - [Installer les outils de compilation](#installer-les-outils-de-compilation)
  - [Compiler depuis les sources](#compiler-depuis-les-sources)
- [Démarrage rapide](#démarrage-rapide)
- [Configuration](#configuration)
  - [Mode Launch](#mode-launch-recommandé)
  - [Mode Attach](#mode-attach)
  - [Référence des propriétés](#référence-des-propriétés)
- [Utilisation](#utilisation)
  - [Contrôle de l'exécution](#contrôle-de-lexécution)
  - [Debug dans le source](#debug-dans-le-source)
  - [Vue désassemblage](#vue-désassemblage)
  - [Breakpoints](#breakpoints)
  - [Registres et pile](#registres-et-pile)
  - [Vue mémoire](#vue-mémoire)
  - [Panneaux hardware](#panneaux-hardware)
  - [Clavier virtuel](#clavier-virtuel)
  - [Panneau écran](#panneau-écran)
  - [Quick Launch](#quick-launch)
  - [Création de projet](#création-de-projet)
  - [Éditeur hexadécimal](#éditeur-hexadécimal)
- [Architecture](#architecture)
- [Compatibilité émulateurs](#compatibilité-émulateurs)
- [Tests de conformité](#tests-de-conformité)
- [Limitations connues](#limitations-connues)

---

## Prérequis

- [VS Code](https://code.visualstudio.com/) 1.108+
- Un émulateur CPC supportant le protocole TCP debug (voir [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md))
- [RASM](http://www.rasm.assemble.tf/) (assembleur Z80, recommandé)
- Node.js 18+ et npm (uniquement nécessaires pour compiler l'extension depuis les sources)
- Python 3 (uniquement nécessaire pour empaqueter le `.vsix` via `make_vsix.py` — bibliothèque standard uniquement, aucun paquet pip requis)

---

## Installation

### Depuis le VSIX

```bash
code --install-extension amstrad-cpc-debug-0.0.3.vsix
```

### Installer les outils de compilation

<details>
<summary><strong>Windows</strong></summary>

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Microsoft.VisualStudioCode
```

Sous Windows, le lanceur Python est généralement `python`, pas `python3` — utilisez `python make_vsix.py` dans l'étape de compilation ci-dessous.

`RASM` n'a pas de paquet Windows — téléchargez `rasm.exe` depuis [rasm.assemble.tf](http://www.rasm.assemble.tf/) puis ajoutez son dossier au `PATH`, ou renseignez le paramètre `z80debug.rasm` / la variable d'environnement `RASM` avec son chemin.

</details>

<details>
<summary><strong>Linux (Debian/Ubuntu)</strong></summary>

```bash
sudo apt update
sudo apt install nodejs npm python3
```

La version de Node.js fournie par `apt` peut être ancienne ; si `node --version` affiche moins que 18, installez une version récente via [nvm](https://github.com/nvm-sh/nvm) :

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install --lts
```

Installez VS Code depuis le [dépôt apt/`.deb` officiel](https://code.visualstudio.com/docs/setup/linux) ou via `snap install code --classic`.

`RASM` n'a pas de paquet apt — téléchargez le binaire Linux depuis [rasm.assemble.tf](http://www.rasm.assemble.tf/), rendez-le exécutable (`chmod +x`) et placez-le dans votre `PATH` (ou renseignez la variable d'environnement `RASM` / le paramètre `z80debug.rasm` avec son chemin).

</details>

<details>
<summary><strong>macOS</strong></summary>

```bash
brew install node python3
brew install --cask visual-studio-code
```

`RASM` n'a pas de formule Homebrew — téléchargez le binaire macOS depuis [rasm.assemble.tf](http://www.rasm.assemble.tf/), rendez-le exécutable (`chmod +x`) et placez-le dans votre `PATH` (ou renseignez la variable d'environnement `RASM` / le paramètre `z80debug.rasm` avec son chemin). Il peut être nécessaire de lever la quarantaine Gatekeeper : `xattr -d com.apple.quarantine rasm`.

</details>

### Compiler depuis les sources

```bash
npm install
npm run bundle          # compile TypeScript + webpack → dist/main.js
python3 make_vsix.py    # génère amstrad-cpc-debug-0.0.3.vsix — utilisez "python make_vsix.py" sous Windows
code --install-extension amstrad-cpc-debug-0.0.3.vsix
```

Les trois commandes sont multiplateformes et s'exécutent de la même façon sous Windows, Linux et macOS une fois les prérequis installés.

---

## Démarrage rapide

### 1. Configurer les chemins

Ouvrez la palette de commandes (`Ctrl+Shift+P`) → **Z80 Debug: Configure** et renseignez :
- le chemin vers l'émulateur (SugarboxV2 ou autre)
- le chemin vers RASM

### 2. Créer un projet

Palette → **Z80 Debug: New CPC Project...** — l'assistant crée un dossier avec `src/main.asm`, les fichiers `.vscode/` (tasks, launch, settings) et un template assembleur prêt à compiler.

### 3. Lancer le debug

Appuyez sur **F5** ou utilisez **Z80 Debug: Launch CPC...** pour le lancement rapide interactif.

![Vue générale d'une session de debug](docs/screenshots/overview_debug_session.png)

---

## Configuration

### Mode Launch (recommandé)

L'extension démarre l'émulateur, charge le média et attache le debugger.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "z80",
      "request": "launch",
      "name": "Amstrad CPC - Debug",
      "emulator": "/chemin/vers/Sugarbox",
      "snapshot": "${workspaceFolder}/build/mygame.sna",
      "symbolFile": "${workspaceFolder}/build/mygame.rasm",
      "sourceFile": "${workspaceFolder}/src/main.asm",
      "port": 1234,
      "preLaunchTask": "RASM: assemble"
    }
  ]
}
```

### Mode Attach

Attache le debugger à un émulateur déjà en cours d'exécution.

```bash
./Sugarbox --debug --debug_server 1234
```

```json
{
  "type": "z80",
  "request": "attach",
  "name": "Amstrad CPC - Attach",
  "port": 1234,
  "symbolFile": "${workspaceFolder}/build/mygame.rasm"
}
```

### Référence des propriétés

#### Mode `launch`

| Propriété | Type | Défaut | Description |
|---|---|---|---|
| `emulator` | string | *(requis)* | Chemin vers le binaire de l'émulateur |
| `port` | number | `1234` | Port TCP du serveur debug |
| `snapshot` | string | — | Fichier `.sna` à charger |
| `disk` | string | — | Disquette `.dsk` — lecteur A |
| `diskB` | string | — | Disquette `.dsk` — lecteur B |
| `tape` | string | — | Cassette `.cdt` / `.wav` / `.tzx` |
| `cartridge` | string | — | Cartouche `.cpr` (CPC+/GX4000) |
| `configuration` | string | — | Profil machine (ex : `CPC464`, `CPC+`) |
| `symbolFile` | string | — | Fichier symboles RASM (`.rasm`) — labels dans le désassemblage |
| `sourceFile` | string | — | Fichier source principal `.asm` — debug dans le source |
| `hideEmulator` | boolean | `false` | Cacher la fenêtre de l'émulateur |
| `preLaunchTask` | string | — | Tâche VS Code à exécuter avant le lancement |

#### Mode `attach`

| Propriété | Type | Défaut | Description |
|---|---|---|---|
| `port` | number | `1234` | Port TCP du serveur debug |
| `symbolFile` | string | — | Fichier symboles RASM (`.rasm`) |
| `sourceFile` | string | — | Fichier source principal `.asm` |

---

## Utilisation

### Contrôle de l'exécution

| Action | Raccourci |
|---|---|
| Continuer | F5 |
| Pause | F6 |
| Step Over | F10 |
| Step Into | F11 |
| Step Out | Shift+F11 |
| Restart | Ctrl+Shift+F5 |
| Stop | Shift+F5 |

**Step Over** gère intelligemment `CALL`, `RST`, `DJNZ` et les instructions de bloc (`LDIR`, `LDDR`, etc.) en posant un breakpoint temporaire après l'instruction plutôt que d'entrer dans la sous-routine.

**Step Out** lit l'adresse de retour sur la pile et pose un breakpoint temporaire dessus, puis reprend l'exécution jusqu'au retour de la sous-routine courante.

---

### Debug dans le source

Lorsque `symbolFile` et `sourceFile` sont tous deux renseignés dans `launch.json`, l'extension propose un debug enrichi par le source :

- La vue de désassemblage intercale les lignes du fichier `.asm` original avec les instructions désassemblées. Chaque ligne source apparaît au-dessus de l'instruction correspondante, ce qui permet de suivre la logique dans le code original tout en voyant les octets exacts exécutés.
- Les labels RASM du fichier `.rasm` sont affichés aux adresses correspondantes, rendant les sauts et appels lisibles.
- La position d'exécution courante est surlignée dans la vue désassemblage et, lorsque le PC correspond à une ligne source connue, également dans le fichier `.asm`.

```
; src/main.asm ligne 42
        LD A, (score)
0x5A00  LD A,(0x5C00)    ; 3A 00 5C
; src/main.asm ligne 43
        CP #FF
0x5A03  CP #FF           ; FE FF
; src/main.asm ligne 44
        JR Z, game_over
0x5A05  JR Z,0x5A07      ; 28 00

game_over:               ; label du fichier .rasm
0x5A07  HALT             ; 76
```

> Poser des breakpoints directement sur les lignes `.asm` dans l'éditeur n'est pas encore supporté — utilisez les breakpoints sur le désassemblage (F9) ou les label breakpoints.

![Désassemblage avec source intercalé](docs/screenshots/disassembly_with_source.png)

---

### Vue désassemblage

L'extension ouvre automatiquement une vue de désassemblage à l'adresse courante du PC à chaque arrêt.

- `Ctrl+Alt+D` — ouvrir le désassemblage à une adresse spécifique
- `Ctrl+Alt+M` — ouvrir la vue mémoire à une adresse spécifique

Si l'émulateur supporte `getMemBanks`, un sélecteur de banque mémoire est proposé en haut de la fenêtre pour naviguer entre ROM, RAM et pages de cartouche.

---

### Breakpoints

Trois types de breakpoints coexistent et sont fusionnés en une seule liste envoyée à l'émulateur :

- **Breakpoints sur le désassemblage** — clic dans la marge ou `F9` sur une ligne d'instruction dans la vue désassemblage. Ces breakpoints sont **persistants** : ils survivent aux redémarrages de session et sont ré-appliqués automatiquement à chaque `configurationDone`.
- **Label breakpoints** — panneau VS Code *Breakpoints* → *Add Function Breakpoint* : saisir un label RASM (ex : `game_loop`) ou une adresse hex (`0xBB5A`, `BB5A`, `47962`).
- **Instruction breakpoints** — depuis la vue Disassembly native de VS Code (clic droit → *Add Breakpoint*).

La commande **Z80 Debug: Toggle breakpoint at address / label** (`Ctrl+Shift+P`) permet d'ajouter ou supprimer un breakpoint en tapant une adresse ou un label sans ouvrir la vue désassemblage.

**Breakpoint ED FF** : écrire la séquence d'octets `ED FF` en RAM Z80 et l'exécuter déclenche un arrêt immédiat, utile pour les breakpoints logiciels injectés par le programme lui-même.

---

### Registres et pile

Le panneau **Variables** expose :

- **Registers** — tous les registres Z80 (AF, BC, DE, HL, SP, PC, IX, IY, AF′, BC′, DE′, HL′, I, R). Double-cliquer sur un registre pour éditer sa valeur.
- **Stack** — 16 premiers mots sur la pile avec leur adresse.

Le menu contextuel d'un registre 16 bits propose :
- *Open Memory View* — aller à cette adresse dans le panneau mémoire
- *Open Disassembly View* — désassembler depuis cette adresse

---

### Vue mémoire

Clic droit sur un registre → *Open Memory View*, ou `Ctrl+Alt+M` puis saisir une adresse.

La vue mémoire affiche une grille hex + ASCII. Les octets peuvent être édités en place en cliquant une cellule et en tapant.

Si l'émulateur supporte `getMemBanks`, un menu déroulant permet de basculer entre les vues mémoire (espace lecture, espace écriture, banques RAM brutes).

---

### Panneaux hardware

Une entrée **Z80 Debug** dans la barre d'activité de VS Code (barre latérale gauche) donne accès à tous les panneaux hardware. Les panneaux se rafraîchissent automatiquement à chaque arrêt du CPU.

#### CRTC / ASIC

Affiche l'état du contrôleur vidéo CRTC 6845 :

- **Registres R0–R17** avec leurs masques et valeurs courantes
- **Compteurs internes** : HCC (compteur horizontal), VLC (compteur lignes verticales), VCC (compteur caractères verticaux), MA (adresse mémoire)
- **Type CRTC** (0–4) et indicateur mode CPC+

![Panneau CRTC](docs/screenshots/panel_crtc.png)

En **mode CPC+ / ASIC**, des onglets supplémentaires sont disponibles :
- **Sprites** — 16 sprites hardware avec position (X, Y) et forme 16×16 pixels rendue sur un canvas
- **Palette** — 32 entrées de palette hardware avec valeurs RGB
- **DMA** — 3 canaux DMA (adresse, prescaler, compteur de boucle, pause)

![Panneau CRTC mode ASIC](docs/screenshots/panel_crtc_asic.png)

#### Gate Array

Affiche l'état du Gate Array (contrôleur couleur/mémoire) :

- **Mode vidéo** (0 = 16 couleurs, 1 = 4 couleurs, 2 = 2 couleurs)
- **17 encres** — border (encre 16) + 16 entrées palette, chacune avec une pastille couleur et sa valeur registre hardware
- **Fenêtres mémoire** — 4 slots (0x0000–0x3FFF, 0x4000–0x7FFF, etc.) montrant le mappage ROM/RAM et l'index de banque
- **Interruptions** — compteur d'interruption et flag en attente

![Panneau Gate Array](docs/screenshots/panel_gate_array.png)

#### PSG (AY-3-8912)

Affiche l'état du générateur de son programmable :

- **16 registres** (R0–R15)
- **Par canal** (A, B, C) : fréquence de tonalité, volume, activation ton/bruit
- **Fréquence du bruit**
- **Registre mixer** décodé bit par bit
- **Enveloppe** — fréquence et registre de forme

![Panneau PSG](docs/screenshots/panel_psg.png)

#### PPI (8255)

Affiche l'état du périphérique programmable :

- **Port A** — valeur du bus de données PSG
- **Port B** — VSYNC CRT, entrée cassette, imprimante occupée, port extension, ligne clavier (bit 6 = 50/60 Hz)
- **Port C** — ligne de scan clavier (bits 0–3), contrôle PSG (bits 6–7)
- **Mot de contrôle** — bits de mode et direction

![Panneau PPI](docs/screenshots/panel_ppi.png)

#### FDC (µPD765)

Affiche l'état du contrôleur de disquettes :

- **Registre d'état principal** — décodé bit par bit (FDD occupé, FDC occupé, direction, prêt)
- **Lecteur courant** et indicateur **moteur actif**
- **Lecteur 0 / Lecteur 1** — présent, piste courante, face courante, liste des secteurs (C/H/R/N/ST1/ST2 par secteur)
- **Visionneuse de piste brute** — dump hex MFM de la piste courante ; les secteurs sont surlignés en couleurs alternées avec une légende
- **État « Pas de disque »** affiché quand aucun fichier image n'est inséré
- **Bouton Insérer un disque** — ouvre un sélecteur de fichier pour charger une image `.dsk` dans le lecteur sélectionné

![Panneau FDC](docs/screenshots/panel_fdc.png)

#### Cassette

Affiche l'état de l'interface cassette :

- **Chemin du fichier** et indicateur **inséré**
- État **moteur**, **lecture**, **enregistrement**
- **Compteur** (position courante) et **durée** totale
- **Liste des blocs** — tous les blocs détectés avec type, taille et position
- **Visualisation du signal** — diagramme à signal carré de la position courante sur la bande

![Panneau Cassette](docs/screenshots/panel_tape.png)

---

### Clavier virtuel

Ouvrir via **Z80 Debug: Show Virtual Keyboard** (`Ctrl+Shift+P`).

Un clavier CPC rendu (73 touches) permet d'envoyer des appuis de touches directement à l'émulateur sans toucher à sa fenêtre.

- **Sélecteur de disposition** — EN (QWERTY), FR (AZERTY), DE (QWERTZ), ES
- **Mode normal** — maintenir le bouton de souris pour appuyer sur une touche ; relâcher la souris relâche la touche
- **Mode sticky** — cliquer pour basculer une touche maintenue (affichée en orange) ; utile pour Shift, Ctrl, etc.
- **Bouton « Relâcher tout »** — relâche toutes les touches maintenues en une fois

La disposition par défaut est contrôlée par le paramètre `z80debug.keyboardLayout`.

![Clavier virtuel](docs/screenshots/panel_keyboard.png)

---

### Panneau écran

Ouvrir via **Z80 Debug: Show Screen** (`Ctrl+Shift+P`).

Affiche l'écran CPC en temps réel dans un panneau VS Code

![Panneau écran](docs/screenshots/panel_screen.png)
, mis à jour à chaque arrêt du CPU (ou en continu quand l'émulateur tourne et que l'abonnement écran est actif). Utile quand `hideEmulator: true` est défini et que l'on veut voir l'affichage sans la fenêtre de l'émulateur.

---

### Quick Launch

**Z80 Debug: Launch CPC...** (`Ctrl+Shift+P`) — assistant interactif permettant de choisir :
- La configuration machine (CPC464, CPC6128, CPC+, etc.)
- Le média à charger (snapshot, disque A, disque B, cassette, cartouche)

Les derniers paramètres sont mémorisés et proposés en tête de liste pour relancer instantanément sans ressaisir le formulaire.

---

### Création de projet

**Z80 Debug: New CPC Project...** — génère un squelette de projet complet :

- `src/main.asm` — template Hello World ou squelette vide
- `.vscode/tasks.json` — tâche de compilation RASM (`Ctrl+Shift+B`)
- `.vscode/launch.json` — configurations launch + attach
- `.vscode/settings.json` — paramètres locaux au projet (chemin émulateur, chemin RASM)
- `.gitignore`

---

### Éditeur hexadécimal

L'extension enregistre un éditeur personnalisé pour les fichiers binaires CPC : **SNA**, **DSK**, **CPR**, **CDT**.

Double-cliquer sur l'un de ces fichiers dans l'Explorateur VS Code l'ouvre dans l'éditeur hex plutôt que dans l'éditeur texte par défaut.

**Régions colorées** — le fichier est analysé et chaque bloc logique est surligné d'une couleur distincte avec un label :
- `.sna` — en-tête (27 octets), 64 Ko RAM, en-tête étendu optionnel et banques supplémentaires
- `.dsk` — Disk Info Block, puis chaque piste (format standard) ou blocs par piste (format étendu)
- `.cpr` — en-tête RIFF, puis chaque chunk de cartouche (`cb00`, `cb01`, …)
- `.cdt` — en-tête TZX/CDT, puis chaque bloc par type (vitesse standard, tonalité pure, pause, …)

Une **légende des couleurs** sous la grille hex associe chaque couleur au nom de sa région.

**Édition** — cliquer une cellule hex et taper pour modifier les octets en place. Les octets modifiés sont mis en évidence. Les modifications peuvent être sauvegardées (`Ctrl+S`) ou annulées.

**Recherche** — une barre de recherche en haut supporte trois modes (cycle avec le bouton de mode) :
- **AUTO** — interprète la saisie comme des octets hex si elle ressemble à de l'hex (`CD 3E` → octets `0xCD 0x3E`), sinon comme du texte
- **HEX** — octets hex uniquement ; les caractères invalides sont signalés par un message d'erreur
- **TXT** — texte brut, chaque caractère est comparé par son code ASCII

Les résultats sont surlignés dans la grille ; utilisez les boutons fléchés ou `Entrée` / `Shift+Entrée` pour passer d'une occurrence à l'autre.

![Éditeur hex — fichier SNA avec régions colorées](docs/screenshots/hex_editor_sna.png)

![Éditeur hex — fichier DSK avec régions colorées](docs/screenshots/hex_editor_dsk.png)

---

## Architecture

```
VS Code (DAP client)
    ↕  DAP inline (stdio)
Z80DebugSession.ts  (debug adapter)
    ↕  JSON/TCP port 1234
Émulateur CPC (ex : SugarboxV2 DebugServer.cpp)
    ↕  appels directs
Machine Z80 / hardware
```

En mode `launch`, l'adapter :
1. Génère un script CSL temporaire si un média est fourni
2. Lance l'émulateur : `<emulator> --debug --debug_server <port> [--csl <file>] [--cfg <name>] [--hide]`
3. Attend l'ouverture du port TCP (retry 250 ms, timeout 10 s)
4. Se connecte, envoie `loadSnapshot` si un `.sna` est spécifié
5. Envoie `InitializedEvent` → VS Code envoie `configurationDone` → l'émulateur s'arrête sur l'entrée

---

## Compatibilité émulateurs

L'extension fonctionne avec tout émulateur qui implémente le protocole TCP JSON décrit dans [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md). Les commandes des panneaux hardware (CRTC, FDC, etc.) sont optionnelles : l'extension se dégrade gracieusement si elles ne sont pas supportées.

---

## Tests de conformité

Le fichier [`test_conformance.py`](test_conformance.py) est une suite de tests de protocole autonome qui valide tout émulateur implémentant le protocole Amstrad CPC Debug — pas uniquement SugarboxV2.

### Mode autonome — contre un émulateur en cours d'exécution

Aucun paquet pip requis (bibliothèque standard Python uniquement).

```bash
# Démarrez votre émulateur avec le serveur debug sur le port 1234, puis :
python3 test_conformance.py --host 127.0.0.1 --port 1234
```

Code de sortie `0` = tous les tests passent, `1` = un ou plusieurs échecs.

### Mode pytest — CI automatisée

Le fichier de tests utilise un fixture `client` qui dépend d'un fixture de session `emulator`. Vous devez fournir ce fixture dans un `conftest.py` à côté du répertoire où vous lancez pytest.

SugarboxV2 fournit un tel `conftest.py` dans `Sugarbox/debugers/` — il démarre le binaire de l'émulateur automatiquement :

```bash
pip install pytest
cd Sugarbox/debugers
pytest z80-debug-adapter/test_conformance.py -v --tb=short
```

Variables d'environnement pour le conftest SugarboxV2 :

| Variable | Défaut | Description |
|---|---|---|
| `SUGARBOX_BINARY` | `../../build/Sugarbox/Sugarbox` | Chemin vers le binaire de l'émulateur |
| `SUGARBOX_PORT` | `1234` | Port TCP du serveur debug |

#### Utilisation avec un autre émulateur

Créez un `conftest.py` qui expose un fixture de session `emulator` :

```python
import socket, pytest

@pytest.fixture(scope="session")
def emulator():
    # Démarrez votre émulateur ici, puis :
    sock = socket.create_connection(("127.0.0.1", 1234))
    reader = sock.makefile("r")
    yield sock, reader
    reader.close(); sock.close()
    # Arrêtez votre émulateur ici
```

Puis lancez :

```bash
pytest /chemin/vers/z80-debug-adapter/test_conformance.py -v
```

### Ce qui est testé

| Groupe | Commandes |
|---|---|
| Bases du protocole | commande inconnue → champ `error` |
| État émulateur | `halt`, `continue`, `reset`, `getState`, `subscribeScreen` |
| Registres | `readRegisters`, `setRegisters`, `setPC`, `evaluate` |
| Mémoire | `readMemory`, `writeMemory`, `getMemBanks` |
| Exécution | `step`, `stepIn`, `stepOut`, `setBreakpoints` + hit |
| Désassemblage | `disassemble` — count, structure, adresses ordonnées |
| État hardware | `getCrtcState`, `getGateArrayState`, `getPsgState`, `getPpiState`, `getFdcState`, `getTapeState` |
| Clavier | `sendKey` — press/release valides, line/bit invalides → `error` |

---

## Limitations connues

- Les breakpoints posés directement sur les lignes source `.asm` ne sont pas encore supportés — utilisez les breakpoints sur le désassemblage (F9) ou les label breakpoints.
- Un seul thread Z80 est exposé (pas de breakpoints DMA ASIC/CPC+ multi-canal).
- Timeout de réponse de l'émulateur : 10 s par commande.
