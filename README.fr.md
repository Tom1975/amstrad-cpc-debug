# Amstrad CPC Debug — VS Code Extension

> 🇬🇧 [English version available](README.md)

Extension de débogage VS Code pour le développement Z80 sur **Amstrad CPC** (CPC 464 / 664 / 6128 / CPC+).

L'extension agit comme un Debug Adapter Protocol (DAP) entre VS Code et un émulateur CPC. Elle se connecte à l'émulateur via un protocole JSON/TCP documenté dans [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md), ce qui permet de l'utiliser avec n'importe quel émulateur qui implémente ce protocole.

L'émulateur de référence est **[SugarboxV2](https://github.com/Tom1975/SugarboxV2)**.

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

Sous Windows, le lanceur Python est généralement `python`, pas `python3` — utilisez `python make_vsix.py` dans l'étape de compilation ci-dessous (voir [Compiler depuis les sources](#compiler-depuis-les-sources)).

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

Les trois commandes (`npm install`, `npm run bundle`, `make_vsix.py`) sont multiplateformes et s'exécutent de la même façon sous Windows, Linux et macOS une fois les prérequis ci-dessus installés.

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

---

## Configuration launch.json

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
      "port": 1234,
      "preLaunchTask": "RASM: assemble"
    }
  ]
}
```

### Mode Attach

Attache le debugger à un émulateur déjà en cours.

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

### Propriétés de configuration

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
| `configuration` | string | — | Profil machine (ex: `CPC464`, `CPC+`) |
| `symbolFile` | string | — | Fichier symboles RASM (`.rasm`) |
| `sourceFile` | string | — | Fichier source principal `.asm` (enrichit le désassemblage) |
| `hideEmulator` | boolean | `false` | Cacher la fenêtre de l'émulateur |
| `preLaunchTask` | string | — | Tâche VS Code à exécuter avant le lancement |

#### Mode `attach`

| Propriété | Type | Défaut | Description |
|---|---|---|---|
| `port` | number | `1234` | Port TCP du serveur debug |
| `symbolFile` | string | — | Fichier symboles RASM (`.rasm`) |
| `sourceFile` | string | — | Fichier source principal `.asm` |

---

## Fonctionnalités

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

**Step Over** gère intelligemment `CALL`, `RST`, `DJNZ` et les instructions de bloc (`LDIR`, `LDDR`, etc.).

**Step Out** lit l'adresse de retour sur la pile et pose un breakpoint temporaire dessus.

### Désassemblage virtuel

L'extension ouvre automatiquement une vue de désassemblage à l'adresse courante du PC. Si un fichier symboles RASM est fourni, les labels sont intercalés dans le texte :

```
GAME_LOOP:
0x5A00  LD A,(0x5C00)    ; A6 00 5C  ...
0x5A03  CP #FF           ; FE FF     ..
0x5A05  JR Z,GAME_OVER  ; 28 00     (.

GAME_OVER:
0x5A07  HALT             ; 76        v
```

Raccourcis :
- `Ctrl+Alt+D` — ouvrir le désassemblage à une adresse
- `Ctrl+Alt+M` — ouvrir la vue mémoire à une adresse

### Breakpoints

Trois types de breakpoints coexistent et sont fusionnés en un seul `setBreakpoints` envoyé à l'émulateur :

- **Breakpoints sur le désassemblage** — clic dans la marge ou `F9` sur une ligne d'instruction
- **Label breakpoints** — panneau VS Code *Breakpoints > Function Breakpoints* : saisir un label RASM ou une adresse (`0xBB5A`, `BB5A`, `47962`)
- **Instruction breakpoints** — depuis la vue Disassembly native de VS Code

Les breakpoints directs (F9) sont **persistants** : ils survivent aux redémarrages de session et sont ré-appliqués automatiquement à chaque `configurationDone`.

### Registres et pile

Le panneau **Variables** expose :
- **Registers** : tous les registres Z80 (AF, BC, DE, HL, SP, PC, IX, IY, AF', BC', DE', HL', I, R) — éditables par double-clic
- **Stack** : 16 premiers mots sur la pile avec leur adresse

Les registres 16 bits proposent *Open Memory View* et *Open Disassembly View* dans leur menu contextuel.

### Mémoire

Clic droit sur un registre → *Open Memory View* — permet d'inspecter et d'éditer la mémoire.

Si l'émulateur supporte `getMemBanks`, un sélecteur de banque mémoire est proposé à l'ouverture du désassemblage.

### Panneaux hardware

Une barre d'activité **Z80 Debug** donne accès aux panneaux hardware :

| Panneau | Contenu |
|---|---|
| CRTC / ASIC | Registres CRTC 6845, sprites ASIC (CPC+), palette, DMA |
| Gate Array | Mode vidéo, palette 17 couleurs, état des interruptions |
| PSG (AY-3-8912) | Registres des 3 canaux sonores |
| PPI (8255) | Ports A/B/C, mode, clavier |
| FDC | État des lecteurs, secteurs, vue hex de la piste MFM, insertion de disque |
| Cassette | Compteur, état, signal carré |

Les panneaux se rafraîchissent automatiquement à chaque arrêt du CPU.

### Quick Launch

**Z80 Debug: Launch CPC...** (`Ctrl+Shift+P`) — assistant interactif pour choisir le média et la configuration machine. Les derniers paramètres sont mémorisés et proposés en tête de liste pour relancer en un clic.

### Création de projet

**Z80 Debug: New CPC Project...** — génère un projet complet avec :
- `src/main.asm` (template Hello World ou squelette vide)
- `.vscode/tasks.json` (tâche RASM)
- `.vscode/launch.json` (configurations launch + attach)
- `.vscode/settings.json` (settings du projet)
- `.gitignore`

---

## Architecture

```
VS Code (DAP client)
    ↕  DAP inline (stdio)
Z80DebugSession.ts  (debug adapter)
    ↕  JSON/TCP port 1234
Émulateur CPC (ex: SugarboxV2 DebugServer.cpp)
    ↕  appels directs
Machine Z80 / hardware
```

En mode `launch`, l'adapter :
1. Génère un script CSL temporaire si un média est fourni
2. Lance l'émulateur : `<emulator> --debug --debug_server <port> [--csl <file>] [--cfg <name>] [--hide]`
3. Attend l'ouverture du port TCP (retry 250 ms, timeout 10 s)
4. Se connecte, envoie la commande `loadSnapshot` si un `.sna` est spécifié
5. Envoie `InitializedEvent` → VS Code envoie `configurationDone` → émulateur s'arrête sur `entry`

---

## Compatibilité émulateurs

L'extension fonctionne avec tout émulateur qui implémente le protocole TCP JSON décrit dans [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md). Les commandes hardware (panneaux CRTC, FDC, etc.) sont optionnelles : l'extension répond gracieusement si elles ne sont pas supportées.

---

## Limitations

- Les breakpoints sur fichiers source `.asm` réels ne sont pas supportés (uniquement sur le désassemblage virtuel et via labels).
- Un seul thread Z80 est exposé.
- Timeout de réponse de l'émulateur : 10 s par commande.
