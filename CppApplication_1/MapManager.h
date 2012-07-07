/* 
 * File:   MapManager.h
 * Author: Brian
 *
 * Created on June 17, 2012, 7:33 PM
 */

#include "TileInterpret.h"
#include "libtcod.hpp"
#include "Actor.h"
#include "Effects.h"
#include "Terrain.h"
#include "Item.h"
#include "Gameplay.h"
#include <iostream>
#include <fstream>
#ifndef MAPMANAGER_H
#define	MAPMANAGER_H

class MapManager {
public:
    TCODMap *gameMap;
    void makeNew();
    void createTerrArray();
    void createItemArray();
    void createActoArray();
    void createEffeArray();
    void loadMap();
    void terrToDraw();
    void actoToDraw();
    void effeToDraw();
    void itemToDraw();
    MapManager();
    MapManager(const MapManager& orig);
    virtual ~MapManager();
private:

    TileInterpret tilein;
    Terrain* arrayTerrain[mapw][maph];
    Item* arrayItem[mapw][maph];
    Actor* arrayActors[mapw][maph];
    Effects* arrayEffects[mapw][maph];
    bool* arrayTrans[mapw][maph];
    bool* arrayWalk[mapw][maph];

};

#endif	/* MAPMANAGER_H */

