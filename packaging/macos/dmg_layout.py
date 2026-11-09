"""Finder layout; run with the isolated build/packaging-tools Python."""
from pathlib import Path
import sys
from ds_store import DSStore
from mac_alias import Alias

folder = Path(sys.argv[1])
with DSStore.open(str(folder/'.DS_Store'), 'w+') as store:
    store['.']['vSrn'] = ('long', 1)
    store['.']['icvl'] = ('type', b'icnv')
    store['.']['vstl'] = ('type', b'icnv')
    store['.']['bwsp'] = {'ShowToolbar':False, 'ShowSidebar':False,
        'ContainerShowSidebar':False, 'PreviewPaneVisibility':False, 'ShowTabView':False,
        'ShowStatusBar':False, 'ShowPathbar':False,
        'WindowBounds':'{{300, 200}, {700, 440}}'}
    store['.']['icvp'] = {'viewOptionsVersion':1, 'iconSize':112.0,
        'backgroundType':2, 'backgroundColorRed':1.0, 'backgroundColorGreen':1.0, 'backgroundColorBlue':1.0,
        'scrollPositionX':0.0, 'scrollPositionY':0.0,
        'backgroundImageAlias':Alias.for_file(str(folder/'.background/installer.png')).to_bytes(),
        'textSize':13.0, 'arrangeBy':'none', 'labelOnBottom':True,
        'showItemInfo':False, 'showIconPreview':True,
        'gridSpacing':100.0, 'gridOffsetX':0.0, 'gridOffsetY':0.0}
    store['Minimal Data Studio.app']['Iloc'] = (185, 215)
    store['Applications']['Iloc'] = (515, 215)
    # Keep the artwork folder beyond the 700px window even when Finder shows
    # hidden files. It still supplies the background through the alias above.
    store['.background']['Iloc'] = (1100, 215)
