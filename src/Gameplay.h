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


class Gameplay {
    Actor* player;
protected:
    int mapPosx, mapPosy;
   static const int mapw=50;
   static const int maph = 25;
   bool* arrayWalk[mapw][maph];
public:
    MapManager* Map;
    char* gamething;
    void console();
    void clear();
    void compTurn();
    int playerTurn();
    int tryMove();
    Gameplay(Actor*, MapManager*);
    Gameplay(const Gameplay& orig);
    virtual ~Gameplay();
    friend class MapManager;
    friend class Drawable;
    friend class TileInterpret;
private:

};

#endif	/* GAMEPLAY_H */

