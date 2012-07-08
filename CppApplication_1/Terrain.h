/* 
 * File:   Terrain.h
 * Author: DAWT
 *
 * Created on June 20, 2012, 1:50 PM
 */

#ifndef TERRAIN_H
#define	TERRAIN_H
#include "libtcod.hpp"
#include "Drawable.h"
class Terrain: public Drawable {
public:
    Terrain(int,int,int,TCODColor, TCODColor, bool, bool);
    Terrain(int,TCODColor, TCODColor, bool, bool);
    Terrain(const Terrain& orig);
    virtual ~Terrain();
private:

};

#endif	/* TERRAIN_H */

