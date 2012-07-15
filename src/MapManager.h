/* 
 * File:   MapManager.h
 * Author: Brian
 *
 * Created on June 17, 2012, 7:33 PM
 */

#ifndef _MAPMANAGER_H
#define _MAPMANAGER_H

#include "TileInterpret.h"
#include <libtcod/libtcod.hpp>
#include "Actor.h"
#include "Effect.h"
#include "Terrain.h"
#include "Item.h"
#include <iostream>
#include <fstream>

class MapManager {
    private:
        static const int mapw= 78;
        static const int maph = 45;
        TileInterpret tilein;
        Terrain* arrayTerrain[mapw][maph];
        Item* arrayItem[mapw][maph];
        Actor* arrayActors[mapw][maph];
        Effect* arrayEffects[mapw][maph];
        bool* arrayTrans[mapw][maph];

        bool arrayWalk[mapw][maph];
    public:
        MapManager();
        MapManager(const MapManager& orig);
        ~MapManager();


        TCODMap *gameMap;
        bool isWalkable(int x, int y);
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

};

#endif	/* _MAPMANAGER_H */

