Boot images for the player editor.

Name each file boot_id_NNNN.png (jpg/webp also fine) where NNNN is the game's boot id (shoetypecode).
Example: the boot worn by many players with shoetypecode 158 -> boot_id_0158.png or boot_id_158.png.

After adding images run:  node scripts/build_customization_catalog.js
Boots without an image still show up in the editor as numbered tiles.
