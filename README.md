# Cristina D'Alessandro — Portfolio

Sito: https://cristinadalessandro.github.io

## Gestire foto e testi

Area riservata: https://cristinadalessandro.github.io/admin/

Da lì si possono:
- creare, rinominare, riordinare ed eliminare le cartelle (es. Portrait, Travel) e, dentro ognuna, i progetti;
- caricare foto nei progetti (vengono ridotte e ottimizzate in automatico), riordinarle, eliminarle, scegliere le copertine;
- modificare biografia, contatti e foto profilo della homepage.

Le modifiche vanno online toccando **Salva e pubblica**; il sito si aggiorna entro 1-2 minuti.

## Struttura

- `content/site.json`: nome, testi, biografia, contatti
- `content/albums.json`: cartelle → progetti → foto
- `photos/<cartella>/<progetto>/`: le foto (versione grande + miniatura `_t`)
- `admin/`: area riservata
