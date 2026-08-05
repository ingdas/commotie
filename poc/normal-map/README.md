# POC · Normal-map / distortion-animatie (gras & boom)

Een zelfstandige WebGL2-proof-of-concept voor bewegend gras, grassprieten en een
boom, geïnspireerd door Factorio [FFF-324](https://factorio.com/blog/post/fff-324).
Geen build-stap, geen dependencies.

## Draaien

Open `index.html` via een lokale server (nodig omdat de browser texturen laadt):

```bash
cd poc/normal-map
python3 -m http.server 8000
# -> http://localhost:8000/
```

Of gewoon online, want de site is statisch: `https://commotie.art/poc/normal-map/`.

## De techniek (drie lagen)

1. **Distortion-animatie (het hoofdeffect uit FFF-324).**
   De UV-coördinaten waarmee de sprite wordt uitgelezen, worden per pixel een
   klein beetje verschoven. De verschuivingsrichting komt uit een *distortion
   map* — in de blog is dat de normal map van de bladeren, hier leiden we die
   in de shader af uit de helderheid van de sprite zelf. De verschuiving
   wappert in de tijd → de bladeren lijken te bewegen. Sterker naar de top.

2. **Normal-map-belichting.**
   Uit dezelfde afgeleide normal map (Sobel op de helderheid) berekenen we een
   oppervlakte-normaal, en belichten die met een lichtbron. Zo krijgen platte
   sprites diepte en glinstering.

3. **Bewegend licht.**
   De lichtbron veegt automatisch rond (of stuur hem met de muis), waardoor het
   normal-map-effect "leeft".

De grassprieten zijn geïnstantieerde, gebogen mesh-bladeren die fysiek buigen in
de wind; hun normaal draait mee zodat het licht er net zo overheen glijdt.

## Bediening

- **Sliders** rechts: windsnelheid, distortie, kroon-uitslag, bump, ambient,
  specular, licht-veegsnelheid, aantal grassprieten.
- **Klik/sleep** op het canvas: licht handmatig richten. **Dubbelklik**: weer
  automatisch.
- **Weergave-knoppen**: `Normaal`, `Normals` (de afgeleide normalen als RGB) en
  `Displacement` (blog-stijl debug: R = horizontale, G = verticale UV-
  verschuiving).
- **Eigen sprites**: sleep een PNG op het canvas, of gebruik de knoppen
  "Boom/Grond laden…". Werkt met transparante PNG's.

## Eigen assets

De demo probeert automatisch `assets/tree.png` en `assets/ground.png` te laden.
Bestaan ze niet, dan wordt een procedurele boom/grond gebruikt (de 404 in de
console is dus onschuldig). Zet je eigen boom als `assets/tree.png` neer om hem
vast in de POC te tonen — of laad hem live via drag-&-drop.

## Integreren in je app

`normalmap.js` zet één globale klasse neer, `NormalMapScene`:

```html
<canvas id="scene"></canvas>
<script src="normalmap.js"></script>
<script>
  const scene = new NormalMapScene(document.getElementById('scene'));
  scene.start();

  // Live bijsturen:
  scene.params.windSpeed = 2.0;
  scene.params.distort   = 0.04;
  scene.params.debug     = 2;      // 0 normaal · 1 normals · 2 displacement

  // Eigen afbeelding uit een <input type=file> of drop:
  scene.loadImageFromFile(file, 'tree');   // of 'ground'
</script>
```

Alle knoppen in `params` zijn realtime aanpasbaar. `scene.stop()` pauzeert de
render-loop, `scene.setGrassCount(n)` herbouwt het grasveld.

### Losse bouwstenen hergebruiken

De interessante code zit in de shaders in `normalmap.js`:

- `SPRITE_FS` — distortie + normal-map-belichting voor een enkele sprite.
- `GRASS_VS` / `GRASS_FS` — geïnstantieerde, buigende grassprieten.

Wil je alleen het distortie-effect op een bestaand sprite in jouw eigen
render-pipeline? Kopieer de `distDir()`-functie en de UV-offset-stap uit
`SPRITE_FS`; die heeft alleen de sprite-textuur, de tijd en een sterkte nodig.
