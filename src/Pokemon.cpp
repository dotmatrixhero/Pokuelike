/* 
 * File:   Pokemon.cpp
 * Author: Brian
 * 
 * Created on July 15, 2012, 1:49 AM
 */

#include "Pokemon.h"

Pokemon::Pokemon(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk)
    : Actor(x, y, c, fore, back, trans, walk)
{
}


Pokemon::~Pokemon() {
}

