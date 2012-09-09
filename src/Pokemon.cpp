/*
 * File:   Pokemon.cpp
 * Author: Brian
 *
 * Created on July 15, 2012, 1:49 AM
 */

#include "Pokemon.h"

Pokemon::Pokemon(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, string key)
    : Actor(x, y, c, fore, back, trans, walk, key)
{
}


Pokemon::~Pokemon() {
}

bool Pokemon::moveRight()
{
    //implement using gameplay.mapPosx, etc. to define these values
    if (x < mapw-1)
    {
        x++;
        currentc = c + 1;
        return true;
    }
    return false;
}

bool Pokemon::moveDown()
{
    if (y < maph-1)
    {
        y++;
        currentc =c;
        return true;
    }
    return false;
}

bool Pokemon::moveLeft()
{
    if (x > 0)
    {
        currentc = c -31;
        x--;
        return true;
    }
    return false;
}

bool Pokemon::moveUp()
{
    if (y > 0)
    {
        currentc = c -32;
        y--;
        return true;
    }
    return false;
}


