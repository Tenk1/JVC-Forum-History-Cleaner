# JVC Forum History Cleaner

Extension Firefox permettant de prévisualiser, filtrer et supprimer en masse ses propres messages de forums Jeuxvideo.com.

## Fonctionnalités

- ouverture du nettoyeur depuis n’importe quel onglet Firefox ;
- simulation (**Dry Run**) avant toute suppression ;
- filtres par dates ;
- inclusion ou exclusion d’IDs de forums ;
- protection de messages et de topics par ID ou URL ;
- filtre par longueur de message ;
- suppression par lots ;
- pause, reprise et arrêt ;
- aperçu et journal exportable ;
- tutoriel intégré pour retrouver les IDs de forum, topic et message.

## Utilisation

1. Connectez-vous à votre compte sur Jeuxvideo.com dans Firefox.
2. Cliquez sur l’icône de l’extension depuis n’importe quel onglet.
3. Commencez par une simulation.
4. Vérifiez l’aperçu et les filtres.
5. Désactivez la simulation pour lancer la suppression réelle.

Si aucune session n’est détectée, le popup propose d’ouvrir Jeuxvideo.com pour se connecter puis de réessayer.

> **Attention :** la suppression de messages est définitive. Utilisez le Dry Run et vérifiez vos filtres avant de lancer une suppression réelle.

## Trouver les IDs JVC

Pour une URL de topic de la forme :

```text
https://www.jeuxvideo.com/forums/42-12345-98765432-1-0-1-0-exemple.htm
```

- `12345` est l’ID du forum ;
- `98765432` est l’ID du topic.

Pour un message :

```text
https://www.jeuxvideo.com/forums/message/1234567890
```

`1234567890` est l’ID du message. L’extension accepte également les URLs complètes dans les champs de conservation de messages/topics.

## Confidentialité

Aucune donnée n’est envoyée au développeur. Les réglages sont stockés localement via `browser.storage.local`. Les requêtes réseau nécessaires au fonctionnement sont limitées à `www.jeuxvideo.com`.

Voir [PRIVACY.md](PRIVACY.md) pour la politique de confidentialité complète.

## Installation pour le développement

1. Téléchargez ou clonez ce dépôt.
2. Ouvrez `about:debugging#/runtime/this-firefox` dans Firefox.
3. Cliquez sur **Load Temporary Add-on…**.
4. Sélectionnez `manifest.json`.

Aucun build n’est nécessaire : le code distribué est le code source lisible tel quel.

## Licence

Distribué sous licence [MIT](LICENSE).
