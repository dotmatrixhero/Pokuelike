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
#include <vector>
#include <iostream>
#include <fstream>
using namespace std;

class MapManager {
    private:
        static const int mapw= 78;
        static const int maph = 45;
        TCODConsole* ConsoleMap;
        TileInterpret tilein;
        Terrain* arrayTerrain[mapw][maph];
        Item* arrayItem[mapw][maph];
        Actor* arrayActors[mapw][maph];
        Effect* arrayEffects[mapw][maph];
        bool* arrayExplored[mapw][maph];

        TCODMap *gameMap;
    public:
        MapManager(TCODConsole* consolemap);
        MapManager(const MapManager& orig);
        ~MapManager();


        
        bool isWalkable(int x, int y);
        vector<int> FOV(int playerx, int playery);
        void makeNew();
        void createTerrArray();
        void createItemArray();
        void createActoArray();
        void createEffeArray();
        void loadMap();
        void terrToDraw(bool wholeMap, vector<int> FOV);
        void actoToDraw();
        void effeToDraw();
        void itemToDraw();
        TCODConsole* returnConsoleMap();
        TCODMap* returnFOVMap();

};

#endif	/* _MAPMANAGER_H */

