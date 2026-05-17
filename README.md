# NewApp (React) – outil admin PrestaShop

NewApp est une mini application React qui parle directement au Webservice PrestaShop (`/api`) et échange **uniquement en XML**.

Fonctionnalités:

- Réinitialisation (suppression via Webservice)
- Import CSV → conversion en XML → création via Webservice

## Pré-requis

- Une instance PrestaShop fonctionnelle (ce repo)
- Webservice activé + une clé dédiée (BO → Paramètres avancés → Webservice)
- Node.js + npm (sur Windows, utilisez `npm.cmd` si `npm.ps1` est bloqué)

## Démarrage (dev)

```powershell
cd newapp
npm.cmd install
npm.cmd run dev
```

En dev, Vite proxifie `/api` vers la boutique (configurable via `VITE_PS_SHOP_BASE_URL`).

### Optionnel: démarrer sans l'écran “Configuration”

Créer un fichier `newapp/.env.local` (voir `.env.example`):

```env
VITE_PS_SHOP_BASE_URL=http://localhost/eval
VITE_PS_WS_KEY=TA_CLE_WEBSERVICE
```

## Build + déploiement (même domaine que PrestaShop)

```powershell
cd newapp
npm.cmd run build
```

Copier le contenu de `newapp/dist/` vers `admin123/newapp/`.

URL:

- `http://localhost/eval/admin123/newapp/` (routes via `#/reset` et `#/import`)
