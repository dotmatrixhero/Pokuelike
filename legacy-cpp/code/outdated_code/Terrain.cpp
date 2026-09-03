/*
 * File:   Terrain.cpp
 * Author: DAWT
 *
 * Created on June 20, 2012, 1:50 PM
 */

#include "Terrain.h"

Terrain::Terrain(int x, int y, int c)
    : Drawable(x, y, c)
{

}

Terrain::Terrain(int c, TCODColor fore,TCODColor back, bool trans, bool walk)
    : Drawable(c, fore, back, trans, walk)
{
}

Terrain::Terrain(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, string key)
    : Drawable(x, y, c, fore, back, trans, walk, key)
{
}

Terrain::~Terrain()
{
}

