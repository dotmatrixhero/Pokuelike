/* Tile interpret will create a map object from a text file
 * which will map a string to a set of strings.
 * it will only have to be called once.
 * 
 * Its return function will take a string as input
 * then utilize the map to create a Drawable object,
 * and return that Drawable.
 * 
 * File:   TileInterpret.h
 * Author: Exiiile
 *
 * Created on June 20, 2012, 2:27 PM
 */

#ifndef TILEINTERPRET_H
#define	TILEINTERPRET_H

#include <string>

#include <map>
#include <vector>
#include <iostream>
#include "Actor.h"
#include "Effect.h"
#include "Terrain.h"
#include "Item.h"

class TileInterpret {
    private:
        std::map<std::string, Terrain*> terrainMap;
        std::map<std::string, Item*>    itemMap;
        std::map<std::string, Actor*>   actorMap;
        std::map<std::string, Effect*>  effectMap;
        TCODColor returnColor(std::string color);

    public:
        TileInterpret();
        ~TileInterpret();

        Terrain* getTerrain(const std::string& key);
        Item*    getItem(const std::string& key);
        Actor*   getActor(const std::string& key);
        Effect*  getEffect(const std::string& key);
};

#endif	/* TILEINTERPRET_H */

