# Data visualisation GTD

## Données Kaggle avec D3

Ce projet charge les données Kaggle localement avant de les visualiser avec D3.
La clé Kaggle n'est jamais envoyée au navigateur.

### 1. Installer et authentifier Kaggle

Installer le CLI dans l'environnement Python utilisé par le projet :

```bash
python -m pip install kaggle
```

Puis choisir l'une des méthodes d'authentification :

- placer `kaggle.json` dans `~/.kaggle/` ;
- définir `KAGGLE_USERNAME` et `KAGGLE_KEY` dans `.env` ;
- utiliser un token Kaggle récent avec `KAGGLE_API_TOKEN`.

### 2. Configurer et télécharger un dataset

```bash
cp .env.example .env
# renseigner KAGGLE_DATASET=proprietaire/nom-du-dataset
npm run data:download
```

Pour ne télécharger qu'un fichier :

```dotenv
KAGGLE_FILE=nom-du-fichier.csv
```

Les fichiers sont décompressés dans `public/data/`, qui est volontairement
ignoré par Git. Il faut donc relancer le téléchargement après un clone.

### 3. Charger les données dans une visualisation D3

```ts
import { loadData } from "./data/loadData";

type Record = {
  category: string;
  value: string;
};

const rows = await loadData<Record>("data/nom-du-fichier.csv");
const values = rows.map((row) => ({
  category: row.category,
  value: Number(row.value),
}));
```

`loadData` accepte les fichiers `.csv`, `.tsv` et `.json`. Pour un JSON, le
format racine peut être un tableau ou `{ "data": [...] }`. Les erreurs de
réseau, de format et de fichier sont propagées avec le chemin concerné afin
que l'interface puisse les afficher.

### Commandes utiles

```bash
npm run dev
npm run typecheck
npm run build
```