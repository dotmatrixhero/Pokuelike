/*
 * File:   Gameplay.h
 * Author: Brian
 *
 * Created on June 17, 2012, 1:45 AM
 */

#ifndef GAMEPLAY_H
#define	GAMEPLAY_H
#include <libtcod/libtcod.hpp>
#include "Drawable.h"
#include "Actor.h"
#include "MapManager.h"
#include "MapGenerator.h"
#include <vector>
#include "Pokemon.h"
#include "Renderer.h"
#include <math.h>

using namespace std;


class Gameplay {
    Pokemon* player;
protected:
    int mapPosx, mapPosy;
   static const int mapw = 50;
   static const int maph = 40;
   int currentLayer;
   vector<MapManager*> mapLayers;
   void attackMode();
public:
    MapManager* Map;
    char* gamething;
    void console();
    void clear();
    void compTurn();
    void cycleMapLayer(int newLayer);
    int playerTurn();
    int tryMove(MapManager * map);
    Gameplay(Pokemon*, Renderer*);
    Gameplay(const Gameplay& orig);
    void makeMap(int numberLayers);
    int playgame();
    virtual ~Gameplay();

private:
    TCODRandom* RNG;
    int timer;
    void animate();
    TCODConsole* HUD;
    vector<TCODConsole*> menuTab;
    int currentTab;
    Renderer* HUDRender;
};

#endif	/* GAMEPLAY_H */

