/** Icônes au trait, 16 × 16, dessinées pour Poulpe. */
export const ICON_PATHS = {
  select: 'M4 2.5l8.5 6-3.8.7 2.1 4.1-1.6.8-2.1-4.1L4 12.6z',
  direct: 'M5 2.5l7.5 5.5-3.4.6 1.9 3.7-1.4.7-1.9-3.7L5 11.7z M1.5 12.5h3v3h-3z',
  pen: 'M8 1.8l4.2 5.6-2.2 6.1H6l-2.2-6.1z M8 1.8v6.4 M8 9.6a1.2 1.2 0 1 0 0-.1 M5.5 15h5',
  pencil: 'M2.5 13.5l.7-3L11 2.7l2.3 2.3-7.8 7.8z M9.5 4.2l2.3 2.3 M2.5 13.5l3-.7',
  // Modes de la plume (Intelligent, Polygone, Ligne).
  penSmart:
    'M2.5 12C4 5.5 12 5.5 13.5 12 M2.5 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z M8 5.7a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z M13.5 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z',
  penPolygon: 'M3 12.5L6 4l5 6.5L13 4 M2 11.5h2v2H2z M5 3h2v2H5z M10 9.5h2v2h-2z M12 3h2v2h-2z',
  penLine: 'M4.5 11.5l7-7 M2 11h3v3H2z M11 2h3v3h-3z',
  unite: 'M2.5 2.5h7v3.5h3.5v7.5h-7.5v-3.5H2.5z',
  subtract: 'M2.5 2.5h7v3.5H6v4H2.5z M7.5 7.5h6v6h-6z',
  intersect: 'M2.5 2.5h7v7h-7z M6.5 6.5h7v7h-7z M6.5 6.5h3v3h-3z',
  exclude: 'M2.5 2.5h7v4h-3v3h-4z M9.5 6.5h4v7h-7v-4h3z',
  divide: 'M2.5 2.5h7v7h-7z M6.5 6.5h7v7h-7z',
  effects: 'M3 4.5h8v8H3z M5 2.5h8v8 M13 2.5',
  artboard: 'M4 1.5v13 M12 1.5v13 M1.5 4h13 M1.5 12h13',
  rect: 'M2.5 3.5h11v9h-11z',
  ellipse: 'M8 3c3.3 0 5.5 2.2 5.5 5S11.3 13 8 13 2.5 10.8 2.5 8 4.7 3 8 3z',
  polygon: 'M8 2l5.2 3v6L8 14l-5.2-3V5z',
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
  line: 'M3 13L13 3',
  text: 'M3 3.5h10 M8 3.5v9.5 M6 13h4',
  image: 'M2.5 3h11v10h-11z M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5 M10.5 6.2a.7.7 0 1 0 0-.1',
  hand: 'M5 8V3.8a1 1 0 0 1 2 0V7.5 M7 7V2.8a1 1 0 0 1 2 0V7 M9 7V3.5a1 1 0 0 1 2 0V8 M11 8V5.5a1 1 0 0 1 2 0V9.5c0 2.8-2 4.5-4.5 4.5S4.6 13 3.6 11.4L2.4 9.3a1 1 0 0 1 1.7-1L5 9.5',
  zoom: 'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M10.3 10.3l3.2 3.2 M5 7h4 M7 5v4',
  eyedropper: 'M10.5 2.5l3 3-1.5 1.5-3-3z M9 4l3 3-6.5 6.5H2.5v-3z',
  undo: 'M5.5 3.5L2.5 6.5l3 3 M2.5 6.5h7a4 4 0 0 1 0 8h-2',
  redo: 'M10.5 3.5l3 3-3 3 M13.5 6.5h-7a4 4 0 0 0 0 8h2',
  alignLeft: 'M2.5 2v12 M4.5 4.5h8v2.5h-8z M4.5 9h5v2.5h-5z',
  alignHCenter: 'M8 2v12 M3.5 4.5h9v2.5h-9z M5 9h6v2.5H5z',
  alignRight: 'M13.5 2v12 M3.5 4.5h8v2.5h-8z M6.5 9h5v2.5h-5z',
  alignTop: 'M2 2.5h12 M4.5 4.5v8h2.5v-8z M9 4.5v5h2.5v-5z',
  alignVCenter: 'M2 8h12 M4.5 3.5v9h2.5v-9z M9 5v6h2.5V5z',
  alignBottom: 'M2 13.5h12 M4.5 3.5v8h2.5v-8z M9 6.5v5h2.5v-5z',
  distributeH: 'M2.5 2v12 M13.5 2v12 M6.5 5h3v6h-3z',
  distributeV: 'M2 2.5h12 M2 13.5h12 M5 6.5h6v3H5z',
  front: 'M5.5 5.5h8v8h-8z M2.5 10.5v-8h8',
  back: 'M2.5 2.5h8v8h-8z M5.5 13.5h8v-8',
  forward: 'M8 13V3 M4.5 6.5L8 3l3.5 3.5',
  backward: 'M8 3v10 M4.5 9.5L8 13l3.5-3.5',
  group: 'M2.5 2.5h4v4h-4z M9.5 9.5h4v4h-4z M1.5 1.5h13v13h-13z',
  ungroup: 'M2.5 2.5h5v5h-5z M8.5 8.5h5v5h-5z',
  flipH: 'M8 2v12 M6 4L2.5 12H6z M10 4l3.5 8H10z',
  flipV: 'M2 8h12 M4 6l8-3.5V6z M4 10l8 3.5V10z',
  rotateLeft: 'M3 3v3.5h3.5 M3.3 6.3A5.5 5.5 0 1 1 3 9.5',
  rotateRight: 'M13 3v3.5H9.5 M12.7 6.3A5.5 5.5 0 1 0 13 9.5',
  snap: 'M4 2.5v5.5a4 4 0 0 0 8 0V2.5 M4 5h3 M9 5h3',
  grid: 'M2.5 2.5h11v11h-11z M2.5 6.2h11 M2.5 9.8h11 M6.2 2.5v11 M9.8 2.5v11',
  ruler: 'M2 11l9-9 3 3-9 9z M5 8l1.5 1.5 M7 6l1 1 M9 4l1.5 1.5',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
  sun: 'M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M8 1v1.5 M8 13.5V15 M1 8h1.5 M13.5 8H15 M3 3l1 1 M12 12l1 1 M3 13l1-1 M12 4l1-1',
  sideLeft: 'M1.5 2.5h13v11h-13z M5.5 2.5v11',
  sideRight: 'M1.5 2.5h13v11h-13z M10.5 2.5v11',
  export: 'M8 10V2 M5 5l3-3 3 3 M2.5 9.5v4h11v-4',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  eyeOff:
    'M2 2l12 12 M6.6 6.6a2 2 0 0 0 2.8 2.8 M4.2 4.3C2.5 5.5 1.5 8 1.5 8S4 12.5 8 12.5c1.4 0 2.6-.5 3.6-1.2 M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.5 1-1.5 2',
  lock: 'M4 7.5h8v6H4z M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  unlock: 'M4 7.5h8v6H4z M5.5 7.5V5a2.5 2.5 0 0 1 4.9-.7',
  chevron: 'M6 4l4 4-4 4',
  chevronDown: 'M4 6l4 4 4-4',
  check: 'M3.5 8.5l3 3 6-6.5',
  plus: 'M8 3v10 M3 8h10',
  minus: 'M3 8h10',
  close: 'M4 4l8 8 M12 4l-8 8',
  trash: 'M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.7 9h5.6l.7-9',
  swap: 'M4 3v8 M2 9l2 2 2-2 M12 13V5 M10 7l2-2 2 2',
  draw: 'M3 13l2-.5 7.5-7.5-1.5-1.5L3.5 11z M10 4.5l1.5 1.5',
  photo: 'M2.5 4.5h3l1-1.5h3l1 1.5h3v8h-11z M8 6.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z',
  layout: 'M2.5 2.5h11v11h-11z M2.5 6h11 M7 6v7.5',
  // Onglets du haut : Vectoriel (courbe de Bézier), Pixel (pinceau sur pixels), Mise en page, Export.
  tabDraw:
    'M3 13C3 7.5 7.5 3 13 3 M2 12h2v2H2z M12 2h2v2h-2z M3 12V8 M12 3H8 M3 7.3a.7.7 0 1 1 0 .1 M7.3 3a.7.7 0 1 1 .1 0',
  tabPhoto: 'M2 9.5h3v3H2z M5 6.5h3v3H5z M5 9.5h3v3H5z M8 9.5h3v3H8z M11.2 2.2l2.6 2.6-4.3 4.3H6.9V6.5z',
  tabLayout: 'M2.5 2.5h11v11h-11z M2.5 5.5h11 M7 5.5v8 M9 8h3 M9 10.5h3',
  tabExport: 'M8 9.5V2 M5 5l3-3 3 3 M3 8.5v5h10v-5',
  bold: 'M4.5 3h4a2.5 2.5 0 0 1 0 5h-4z M4.5 8h4.5a2.5 2.5 0 0 1 0 5H4.5z',
  italic: 'M7 3h5 M4 13h5 M9.5 3l-3 10',
  underline: 'M4.5 3v4.5a3.5 3.5 0 0 0 7 0V3 M3.5 14h9',
  strike:
    'M3 8h10 M11 5c-.5-1.3-1.7-2-3-2-1.7 0-3 .9-3 2.3 0 2.7 6 1.7 6 4.7 0 1.4-1.3 2.5-3 2.5-1.5 0-2.8-.8-3.2-2',
  caps: 'M2 13l3-9 3 9 M3 10h4 M9 13l2.5-7 2.5 7 M9.8 11h3.4',
  textLeft: 'M2.5 3.5h11 M2.5 6.5h7 M2.5 9.5h11 M2.5 12.5h7',
  textCenter: 'M2.5 3.5h11 M4.5 6.5h7 M2.5 9.5h11 M4.5 12.5h7',
  textRight: 'M2.5 3.5h11 M6.5 6.5h7 M2.5 9.5h11 M6.5 12.5h7',
  textJustify: 'M2.5 3.5h11 M2.5 6.5h11 M2.5 9.5h11 M2.5 12.5h11',
  mask: 'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 2.5v11',
  folder: 'M1.5 4V3h4.5l1.5 1.5h7v8.5h-13z',
  path: 'M2.5 12.5C4 4 12 12 13.5 3.5 M1.5 11.5h2v2h-2z M12.5 2.5h2v2h-2z',
  // Bibliothèque photo : planche de vignettes, drapeaux et étoile.
  photoLibrary: 'M1.5 2.5h5.5v4.5H1.5z M9 2.5h5.5v4.5H9z M1.5 9h5.5v4.5H1.5z M9 9h5.5v4.5H9z',
  flag: 'M4 14.5V2 M4 2.5h8.5l-2 3 2 3H4',
  flagReject: 'M4 14.5V2 M4 2.5h8.5l-2 3 2 3H4 M6.5 4l3 3 M9.5 4l-3 3',
  library:
    'M2.5 2.5h4.5v4.5h-4.5z M9 2.5h4.5v4.5H9z M2.5 9h4.5v4.5h-4.5z M11.25 9a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5z',
  template: 'M2.5 2.5h11v11h-11z M2.5 6.5h11 M6.5 6.5v7',
  resize: 'M2.5 9.5v4h4 M2.5 13.5l5-5 M13.5 6.5v-4h-4 M13.5 2.5l-5 5',
  palette:
    'M8 2a6 6 0 1 0 0 12c1 0 1.5-.6 1.5-1.3 0-1-1-1.2-1-2.2 0-.8.6-1.3 1.5-1.3H12a2 2 0 0 0 2-2C14 4.4 11.3 2 8 2z M5 7.5h.1 M6.5 4.8h.1 M9.8 4.8h.1',
  search: 'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M10.3 10.3l3.2 3.2',
  shuffle:
    'M2 4.5h2.5c3 0 4 7 7 7H14 M12 9.5l2 2-2 2 M2 11.5h2.5c1.2 0 2-1 2.7-2.3 M9.3 6.8c.7-1.3 1.5-2.3 2.7-2.3H14 M12 2.5l2 2-2 2',
  link: 'M6.5 9.5l3-3 M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1 M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1',
  unlink:
    'M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1 M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1 M2.5 2.5l2 2 M13.5 13.5l-2-2',
  pages: 'M4.5 1.5h7v10h-7z M2.5 4v10.5h7',
  master: 'M3.5 1.5h9v13h-9z M5.5 4h5 M5.5 6.5h5 M6.5 11.5h3',
  duplicate: 'M5.5 5.5h8v8h-8z M2.5 10.5v-8h8',
  textFrame: 'M2.5 2.5h11v11h-11z M5 5h6 M8 5v6',
  proof: 'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 2.5v11 M8 5.5h5 M8 10.5h5',
  pageNumber: 'M3.5 1.5h9v13h-9z M6.5 10.5h3 M7 8.5l1-1v3',
  arrange: 'M2.5 2.5h4.5v5H2.5z M9 2.5h4.5v5H9z M2.5 9.5h4.5v4H2.5z M9 9.5h4.5v4H9z',
  settings:
    'M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4',
  marqueeRect:
    'M2.5 3.5h2 M6.5 3.5h3 M11.5 3.5h2v2 M13.5 7.5v1 M13.5 10.5v2h-2 M9.5 12.5h-3 M4.5 12.5h-2v-2 M2.5 8.5v-1 M2.5 5.5v-2',
  marqueeEllipse:
    'M8 3c-3 0-5.5 2.2-5.5 5 M8 3c3 0 5.5 2.2 5.5 5 M13.5 8c0 2.8-2.5 5-5.5 5 M2.5 8c0 2.8 2.5 5 5.5 5',
  lasso:
    'M8 3c3.6 0 6 1.6 6 3.5S11.6 10 8 10 2 8.4 2 6.5 4.4 3 8 3z M5 9.6c-.8.8-1 1.8-.3 2.6.8.9 2.3.6 2.3-.6 0-.8-.7-1.2-1.4-1',
  magicWand: 'M2.5 13.5l7-7 M8.5 5.5l2 2 M11 1.5v2 M13.5 4l-1.4 1.4 M14.5 7h-2 M8.5 2.5l1 1.5',
  brush:
    'M13.5 2.5c-1.5.5-5 3.8-6.5 6l1.5 1.5c2.2-1.5 5.5-5 6-6.5z M7 8.5c-1.5 0-2.5 1-2.5 2.5S3.5 13.5 2.5 13.5c2 1 5 .5 5.5-2a1.6 1.6 0 0 0-1-3',
  eraser: 'M6 13.5h7.5 M2.8 10.2l6.4-6.4a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 13.5H6z M5.5 7.5l4 4',
  fill: 'M3 7.5l5-5 5 5-5 5z M3 7.5h10 M13.5 10.5c0 1-.6 2-1.3 2s-1.2-1-1.2-2c0-.7 1.2-2 1.2-2s1.3 1.3 1.3 2z',
  magicEraser:
    'M2.8 10.2l5.4-5.4a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L7 12h-2.2z M5 13.5h4 M12.5 1.5v3 M11 3h3 M14 9.5v2 M13 10.5h2',
  clone: 'M5.5 2.5h5v3h-5z M8 5.5v3 M3.5 8.5h9v2h-9z M4.5 10.5v3h7v-3',
  dodge: 'M8 2.5v3 M6 7.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0z M8 9.5v4 M6 13.5h4',
  burn: 'M4.5 9.5a3.5 3.5 0 0 1 7 0v4h-7z M8 2v4 M5.5 3.5l1 1.5 M10.5 3.5l-1 1.5',
  blurBrush: 'M8 2.5c2 3 4 5 4 7.2a4 4 0 0 1-8 0C4 7.5 6 5.5 8 2.5z',
  sharpenBrush: 'M8 2l3.5 11h-7z M8 2v11',
  adjust: 'M8 2.5a5.5 5.5 0 1 1 0 11z M8 2.5a5.5 5.5 0 1 0 0 11',
  pixelLayer:
    'M2.5 2.5h11v11h-11z M2.5 6.2h3.7v3.7H2.5z M9.8 6.2h3.7v3.7H9.8z M6.2 2.5h3.6v3.7H6.2z M6.2 9.8h3.6v3.7H6.2z',
  addMask: 'M2.5 2.5h11v11h-11z M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  invertSel: 'M2.5 2.5h11v11h-11z M5.5 5.5h5v5h-5z M2.5 2.5l3 3 M13.5 2.5l-3 3 M2.5 13.5l3-3 M13.5 13.5l-3-3',
  deselect:
    'M2.5 3.5h2 M6.5 3.5h3 M11.5 3.5h2v2 M13.5 7.5v1 M13.5 10.5v2h-2 M9.5 12.5h-3 M4.5 12.5h-2v-2 M2.5 8.5v-1 M2.5 5.5v-2 M5.5 5.5l5 5 M10.5 5.5l-5 5',
  modeReplace: 'M3.5 3.5h9v9h-9z',
  modeAdd: 'M2.5 2.5h7v7h-7z M6.5 6.5h7v7h-7z',
  modeSubtract: 'M2.5 2.5h7v4H6.5v3h-4z M6.5 6.5h7v7h-7z',
  modeIntersect: 'M2.5 2.5h7v7h-7z M6.5 6.5h7v7h-7z M6.5 6.5h3v3h-3z',
  histogram: 'M2 13.5h12 M3 13.5v-3 M5 13.5V8 M7 13.5V4 M9 13.5V6 M11 13.5v-4 M13 13.5v-2',
  play: 'M5 3l8 5-8 5z',
  import: 'M8 2v8 M5 7l3 3 3-3 M2.5 9.5v4h11v-4',
  extension: 'M3 5.5h3V4a1.5 1.5 0 0 1 3 0v1.5h3v3h-1.5a1.5 1.5 0 0 0 0 3H12v3H3z',
  keyboard: 'M1.5 4.5h13v7h-13z M4 7h1 M7 7h1 M10 7h2 M4.5 9.5h7',
  update: 'M13 8a5 5 0 1 1-1.5-3.6 M13 2.5v3h-3',
  polyLasso: 'M3 4.5l7-2 3.5 5-4 5.5-6.5-2z M3 4.5h0 M10 2.5h0 M13.5 7.5h0 M9.5 13h0 M3 11h0',
  quickSelect:
    'M10.5 2.5c1.6 0 3 1.3 3 3s-1.4 3-3 3-3-1.3-3-3 1.4-3 3-3z M8.2 7.8L2.5 13.5 M2.5 4.5h1.5 M2.5 7h1 M5 2.5v1.5',
  heal: 'M4.6 11.4a2.2 2.2 0 0 1 0-3.1l3.7-3.7a2.2 2.2 0 0 1 3.1 3.1l-3.7 3.7a2.2 2.2 0 0 1-3.1 0z M7 8h.01 M9 8h.01 M8 7h.01 M8 9h.01',
  smudge:
    'M6.5 13.5V7a1 1 0 0 1 2 0v3 M8.5 6a1 1 0 0 1 2 0v4 M10.5 7a1 1 0 0 1 2 0v3.5a3 3 0 0 1-3 3h-1.5a3 3 0 0 1-2.5-1.4L3.6 9.6a1 1 0 0 1 1.6-1.2l1.3 1.6',
  liquify:
    'M2.5 4c2-1.5 3.5 1.5 5.5 0s3.5-1.5 5.5 0 M2.5 8c2-1.5 3.5 1.5 5.5 0s3.5-1.5 5.5 0 M2.5 12c2-1.5 3.5 1.5 5.5 0s3.5-1.5 5.5 0',
  straighten: 'M2 11.5l12-5 M2.5 13.5h11 M3.5 3.5a5 5 0 0 1 4-1',
  perspective: 'M4.5 3.5h7l2 9h-11z M6 3.5l-1 9 M10 3.5l1 9 M3.5 8h9',
  lut: 'M2.5 2.5h11v11h-11z M2.5 6.2h11 M2.5 9.8h11 M6.2 2.5v11 M9.8 2.5v11',
  imageSize: 'M2.5 2.5h8v8h-8z M10.5 6.5h3v7h-7v-3 M12 12l1.5 1.5',
  canvasSize: 'M4.5 4.5h7v7h-7z M2 2l2.5 2.5 M14 2l-2.5 2.5 M2 14l2.5-2.5 M14 14l-2.5-2.5',
  scissors:
    'M4 3l7 7.5 M12 3l-7 7.5 M3.6 11.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z M12.4 11.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z',
  knife: 'M2.5 9.5l5-7h3l-4 7z M2.5 9.5h6 M5 9.5v4 M13.5 2.5l-3 11',
  corner: 'M3 13.5V8a5 5 0 0 1 5-5h5.5 M3 13.5h10.5 M13.5 3v10.5',
  shapeBuilder: 'M2.5 2.5h7v7h-7z M6.5 6.5h7v7h-7z M1.5 11.5c3.5 0 9-5.5 13-9',
  symbol: 'M8 1.8l5.5 3.1v6.2L8 14.2 2.5 11.1V4.9z M8 5.3l2.8 1.6v3.2L8 11.7l-2.8-1.6V6.9z',
  styleSave: 'M3 2.5h8l2.5 2.5v8.5H3z M5.5 2.5v4h5v-4 M5.5 9.5h5v4h-5z',
  columns: 'M2.5 2.5h11v11h-11z M8 2.5v11 M4 5h2.5 M4 7.5h2.5 M4 10h2.5 M9.5 5H12 M9.5 7.5H12 M9.5 10H12',
  gradient: 'M2.5 3.5h11v9h-11z M5 10l6-4 M5 10a1 1 0 1 0 0-.1 M11 6a1 1 0 1 0 0-.1',
  transparency: 'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 2.5v11 M8 4.5h3.5 M8 8h5.5 M8 11.5h3.5',
  contour: 'M5.5 5.5h5v5h-5z M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z',
  strokeWidth: 'M1.5 11.5c3-6.5 10-6.5 13 0 M1.5 11.5c3-3 10-3 13 0 M8 2v4.5',
  nodeSharp: 'M2.5 13.5L6.8 5.5 M9.2 5.5l4.3 8 M6.5 2.5h3v3h-3z',
  nodeSmooth:
    'M2 13.5C3 7.5 13 7.5 14 13.5 M2.5 9h3.9 M9.6 9h3.9 M9.6 9a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
  nodeSmart:
    'M2 13.5C3 7.5 13 7.5 14 13.5 M2.5 9h3.3 M10.2 9h3.3 M10.2 9a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z M8.3 9a.3.3 0 1 1-.6 0 .3.3 0 0 1 .6 0z',
  splitCurve: 'M2 13.5C4 6.5 12 6.5 14 13.5 M6.8 7h2.4v2.4H6.8z M8 1.5V5 M6.25 3.25h3.5',
  breakCurve:
    'M2 13C3 9 4.2 7 5.2 6.5 M10.8 6.5C11.8 7 13 9 14 13 M5.2 5.2h2.6v2.6H5.2z M8.2 5.2h2.6v2.6H8.2z',
  closeCurve: 'M10 2.8A5.5 5.5 0 1 0 13.4 6.5 M10 2.8l3.4 3.7',
  smoothCurve: 'M1.5 9.5c2.2-4.5 4.3-4.5 6.5 0s4.3 4.5 6.5 0',
  joinCurves: 'M2 13.5C2 8 4.5 5.2 6.8 4.5 M14 13.5C14 8 11.5 5.2 9.2 4.5 M6.8 3.3h2.4v2.4H6.8z',
  reverseCurve: 'M2.5 5.5h10 M10 3l2.5 2.5L10 8 M13.5 10.5h-10 M6 8l-2.5 2.5L6 13',
  nodeTransform:
    'M2.5 2.5h3v3h-3z M10.5 2.5h3v3h-3z M2.5 10.5h3v3h-3z M10.5 10.5h3v3h-3z M5.5 4h5 M5.5 12h5 M4 5.5v5 M12 5.5v5',
  alignNodes: 'M2.5 3.5h3v3h-3z M10.5 9.5h3v3h-3z M4 6.5V11h6.5',
  snapHandles: 'M6.8 9.3h2.4v2.4H6.8z M8 9.3V3.5 M9.2 10.5h4.3 M2.5 10.5h4.3',
  orientation: 'M2 12.5C4 6.5 9 4.5 14 4.5 M11 2l3 2.5L11 7',
  opentype: 'M2 12.5l3-9 3 9 M3 9.5h4 M10 3.5v9 M8.5 3.5h3 M13 6.5v6 M12 9.5h2',
  // Outils de la version 1.2.
  roundRect:
    'M5 3.5h6a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 10V6A2.5 2.5 0 0 1 5 3.5z',
  triangle: 'M8 2.5l6 11H2z',
  arrow: 'M1.5 6h7.5V3l5.5 5-5.5 5v-3H1.5z',
  callout: 'M3 2.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5l-3.5 3v-3H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z',
  donut: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  pie: 'M8 2a6 6 0 1 1-6 6h6z',
  cog: 'M7 1.5h2l.4 1.8 1.5.6 1.6-1 1.4 1.4-1 1.6.6 1.5 1.8.4v2l-1.8.4-.6 1.5 1 1.6-1.4 1.4-1.6-1-1.5.6-.4 1.8H7l-.4-1.8-1.5-.6-1.6 1-1.4-1.4 1-1.6-.6-1.5L1.5 9V7l1.8-.4.6-1.5-1-1.6 1.4-1.4 1.6 1 1.5-.6z M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  cloud: 'M4.5 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7-.9 3.5 3.5 0 0 1-.3 6.9z',
  heart: 'M8 13.5S2 9.8 2 5.8a3 3 0 0 1 6-1.3 3 3 0 0 1 6 1.3c0 4-6 7.7-6 7.7z',
  spiral:
    'M8 8.5a.8.8 0 0 1 .8-.8 1.6 1.6 0 0 1 1.6 1.6 2.4 2.4 0 0 1-2.4 2.4 3.2 3.2 0 0 1-3.2-3.2 4 4 0 0 1 4-4 4.8 4.8 0 0 1 4.8 4.8',
  vectorBrush:
    'M13.5 2.5L8 8.5 M8 8.5L6.5 7c-1.8.2-2.6 1.4-2.8 3.2-.1 1.2-.7 2-1.5 2.8 2.5.4 4.8-.2 5.7-2.2.3-.8.4-1.6.1-2.3z M10.5 13.5h3',
  vectorFill:
    'M7 2l5.5 5.5-5 5L2 7z M2 7h10.5 M13.5 9.5c.8 1.2 1.2 2 1.2 2.6a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.4 1.2-2.6z',
  vectorCrop: 'M4.5 1.5v10h10 M1.5 4.5h10v10 M6.5 9.5l3-3',
  stylePicker: 'M10.5 2.5l3 3-1.5 1.5-3-3z M9 4l3 3-4.5 4.5H5v-2.5z M1.5 11.5h3v3h-3z',
  frameText: 'M2.5 2.5h11v11h-11z M5 5.5h6 M8 5.5v5',
  table: 'M2.5 3h11v10h-11z M2.5 6.5h11 M2.5 9.8h11 M6.2 3v10 M9.8 3v10',
  pictureFrameRect: 'M2.5 2.5h11v11h-11z M2.5 2.5l11 11 M13.5 2.5l-11 11',
  pictureFrameEllipse: 'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M4.1 4.1l7.8 7.8 M11.9 4.1l-7.8 7.8',
  crop: 'M4.5 1.5v10h10 M1.5 4.5h10v10',
  pixelGradient: 'M2.5 3.5h11v9h-11z M5.5 3.5v9 M8 3.5v9 M10 3.5v9 M11.8 3.5v9',
  sponge:
    'M3 5.5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M6 6h.1 M9.5 6.5h.1 M7 9.5h.1 M10 10.5h.1',
  backgroundEraser:
    'M6 13.5h7.5 M2.8 10.2l6.4-6.4a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 13.5H6z M1.5 1.5h2v2h-2z M3.5 3.5h2v2h-2z',
  floodEraser:
    'M6 13.5h7.5 M2.8 10.2l6.4-6.4a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 13.5H6z M3 1.5c.7 1 1 1.6 1 2.1a1 1 0 0 1-2 0c0-.5.3-1.1 1-2.1z',
  colorReplace:
    'M13.5 2.5c-1.5.5-5 3.8-6.5 6l1.5 1.5c2.2-1.5 5.5-5 6-6.5z M7 8.5c-1.5 0-2.5 1-2.5 2.5S3.5 13.5 2.5 13.5c2 1 5 .5 5.5-2a1.6 1.6 0 0 0-1-3 M2 2.5l2 2 M4 2.5l-2 2',
  patch: 'M2.5 9.5h5v4h-5z M8.5 2.5h5v4h-5z M5 9.5V6.5h3.5 M7 4.8l1.5 1.7L7 8.2',
  blemish: 'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  redEye:
    'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M8 7.5v1',
  // Outil Déplacer (tools/move) : point d'origine, transformer séparément.
  transformOrigin: 'M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M8 1.5v4 M8 10.5v4 M1.5 8h4 M10.5 8h4',
  transformSeparately:
    'M2 2h5v5H2z M9 9h5v5H9z M4.5 4.5v.1 M11.5 11.5v.1 M9.5 2.5a4 4 0 0 1 4 4 M6.5 13.5a4 4 0 0 1-4-4',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="i"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
