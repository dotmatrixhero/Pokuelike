/* 
 * File:   Terrain.h
 * Author: DAWT
 *
 * Created on June 20, 2012, 1:50 PM
 */

#ifndef TERRAIN_H
#define	TERRAIN_H

#include <libtcod/libtcod.hpp>
#include "Drawable.h"
#include <iostream>

class Terrain: public Drawable {
    private:

    public:
        Terrain(int x, int y, int c);
        Terrain(int c, TCODColor fore,TCODColor back, bool trans, bool walk);
        Terrain(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk);
        virtual ~Terrain();
};

#endif	/* TERRAIN_H */

