# Changelog

## 1.1.1

- Remplacement des rendus dynamiques utilisant `innerHTML` par des API DOM sûres (`textContent`, `createElement`, `replaceChildren`).
- Nettoyage du contenu HTML des messages via `DOMParser` au lieu d’une affectation à `innerHTML`.
- Aucun changement fonctionnel du moteur de scan ou de suppression.

## 1.1.0

- Le nettoyeur est désormais accessible depuis n’importe quel onglet Firefox.
- Ajout d’une page JVC inactive dédiée à la session et au moteur de nettoyage.
- Le traitement peut continuer lorsque le popup est fermé.
- Ajout d’un tutoriel intégré pour retrouver les IDs de forum, topic et message.
- Ajout de boutons d’aide contextuels près des champs utilisant des IDs.
- Conservation du moteur de suppression JVC par lots et des filtres existants.

## 1.0.0

- Première version publique.
- Simulation, filtres et suppression en masse de ses propres messages de forums JVC.
