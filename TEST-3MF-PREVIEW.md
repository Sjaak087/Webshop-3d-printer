# 3MF-preview regressietest

Getest met het aangeleverde bestand `Kerstboom voor oma.3mf`.

- Bambu Studio build-item: uniforme schaal 3.2 en translatie (90, 90, 80) mm.
- Mesh: 97.651 vertices en 195.302 triangles.
- De oude positionering liet na schalen ongeveer 89 eenheden offset over, buiten het camerabeeld.
- De nieuwe positionering schaalt de berekende bounding-box-center mee en centreert het model op (0, 0, 0).
- De camera-afstand wordt afgeleid van de bounding-sphere, zodat de preview zich aan de modelafmetingen aanpast.

Dit is een code-/geometrie-regressietest. De live GitHub Pages-pagina en WebGL-rendering in de browser zijn niet vanuit het Firebase-project getest.
