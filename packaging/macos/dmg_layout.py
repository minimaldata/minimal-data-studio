"""Finder layout; run with the isolated build/packaging-tools Python."""
from pathlib import Path
import sys
from ds_store import DSStore

folder = Path(sys.argv[1])
with DSStore.open(str(folder/'.DS_Store'), 'w+') as store:
    store['.']['vSrn'] = ('long', 1)
    store['.']['icvl'] = ('type', b'icnv')
    store['.']['bwsp'] = {'ShowToolbar':False, 'ShowSidebar':False,
        'ShowStatusBar':False, 'ShowPathbar':False,
        'WindowBounds':'{{300, 200}, {600, 340}}'}
    store['.']['icvp'] = {'viewOptionsVersion':1, 'iconSize':96.0,
        'textSize':13.0, 'arrangeBy':'none', 'labelOnBottom':True,
        'showItemInfo':False, 'showIconPreview':True,
        'gridSpacing':100.0, 'gridOffsetX':0.0, 'gridOffsetY':0.0}
    store['Minimal Data Studio.app']['Iloc'] = (150, 110)
    store['Applications']['Iloc'] = (450, 110)
    store['Install — drag Studio to Applications.txt']['Iloc'] = (300, 255)
