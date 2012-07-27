/* 
 * File:   MapGenerator.h
 * Author: Brian
 *
 * Created on July 23, 2012, 10:28 PM
 */

#ifndef MAPGENERATOR_H
#define	MAPGENERATOR_H
#include "TileInterpret.h"
#include <libtcod/libtcod.hpp>
#include "Actor.h"
#include "Effect.h"
#include "Terrain.h"
#include "Item.h"
#include <vector>
#include <iostream>
#include <fstream>

class MapGenerator {
public:
    MapGenerator();
    MapGenerator(const MapGenerator& orig);
    virtual ~MapGenerator();
private:
    static const int mapw = 78;
    static const int maph = 45;

};

#endif	/* MAPGENERATOR_H */

