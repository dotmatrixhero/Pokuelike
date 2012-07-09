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
 * CreateActor.h"
#include "Effects.h"
#include "Terrain.h"
#include "Item.h"
#include "Gameplay.h"
#include "TileInterpret.h"
#include "Drawable.h"
#include <iostream>
#include <fstream>
#include <string.h>
#include <map>
#include <vector>
using namespace std;;

class TileInterpret {
public:
    TileInterpret();
    virtual ~TileInterpret();
    Terrain* returnTerrVal(string);
    Item* returnItemVal(string);
    d on June 20, 2012, 2:27 PM
 */

#ifndef TILEINTERPRET_H
#define	TILEINTERPRET_H
#include <libtcod/libtcod.hpp>
#include "Actor.h"
#include "Effects.h"
#include "Terrain.h"
#include "Item.h"
#include "Gameplay.h"
#include "TileInterpret.h"
#include "Drawable.h"
#include <iostream>
#include <fstream>
#include <string.h>
#include <map>
#include <vector>
using namespace std;;

class TileInterpret {
public:
    TileInterpret();
    virtual ~TileInterpret();
    Terrain* returnTerrVal(string);
    Item* returnItemVal(string);
    Actor* returnActoVal(string);
    Effects* returnEffeVal(string);
    friend class Gameplay;
private:
    map<string, Terrain*> interpTerrMap;
    map<string, Item*> interpItemMap;
    map<string, Actor*> interpActoMap;
    map<string, Effects*> interpEffeMap;

};

#endif	/* TILEINTERPRET_H */

