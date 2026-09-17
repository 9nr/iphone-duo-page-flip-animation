/* The artwork the page opens with, in flip order.

   A page cannot list a directory and there is no build step, so the names live
   here. They are sorted by filename, the same order regression.py picks by.
   Add a file to assets/ and add its name to this list.

   A design whose aspect ratio differs from the selected size preset is
   stretched to fill it - the preset is the stage, not the file. The page opens
   on Auto for exactly that reason: these two are 1750x1134 (1.54:1), which is
   no preset's shape. */
const ASSETS = [
  'day.jpg',
  'night.jpg',
];
