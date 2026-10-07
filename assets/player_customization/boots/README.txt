Boot pictures for the player editor, one folder per brand: boots/<brand>/boot_NNN_<name>.png
Names come from boots_index.csv. After adding or moving pictures run:

    node scripts/build_customization_catalog.js

The pictures are not tied to the game's boot ids. In the editor: Boots tab > "Link pictures to game ids", then click the
picture of the boot the player wears in the game. Links are saved in boot_links.json in the app's data folder
(assets/data/boots_id_map.json can ship defaults).
