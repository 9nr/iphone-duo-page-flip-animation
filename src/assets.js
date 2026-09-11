/* The artwork the page opens with, in flip order.

   A page cannot list a directory and there is no build step, so the names live
   here. They are sorted by filename, the same order regression.py picks by.
   Add a file to assets/ and add its name to this list.

   A design whose aspect ratio differs from the selected size preset is
   stretched to fill it - the preset is the stage, not the file. */
const ASSETS = [
  'DT grid 33.png',
  'DT grid 4.png',
  'DT grid 6.png',
  'DT grid 8.png',
];
